import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrivateReflectionPort, VoicePort } from '@kinetic/contracts';
import { ProviderError, httpStatusFor } from '../errors.js';
import { MAX_SELECTED_TEXT_CHARS } from '../reflection/claude.js';

/** Who is calling, as established by the app's session layer (Clerk). `configured: false` never means anonymous access. */
export interface RouteSession {
  configured: boolean;
  userId: string | null;
}

/** Fixed-window limit per user. In-memory, so it is per server instance; a shared store is a deployment follow-up. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limits: { limit: number; windowMs: number }, private readonly now: () => number = Date.now) {}

  take(key: string): boolean {
    const now = this.now();
    if (this.windows.size > 10_000) for (const [k, w] of this.windows) if (now - w.start >= this.limits.windowMs) this.windows.delete(k);
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.limits.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count++;
    return window.count <= this.limits.limit;
  }
}

const ReflectionRequestSchema = z.object({
  selectedText: z.string().min(1).max(MAX_SELECTED_TEXT_CHARS),
  clientRequestId: z.string().min(1).max(128),
}).strict();
const EmptyBodySchema = z.object({}).strict();
const MAX_BODY_BYTES = 64 * 1024;

type ErrorCode = 'unauthenticated' | 'invalid' | 'rate_limited' | 'unavailable';

/**
 * POST /api/reflections. Body `{selectedText, clientRequestId}` → `PrivateReflection` for the caller's local vault.
 * Nothing is persisted or logged here; error bodies carry codes only and never echo input.
 */
export async function handleReflectionRequest(request: Request,
  deps: { session: RouteSession; reflection: PrivateReflectionPort; limiter?: RateLimiter }): Promise<Response> {
  const gate = admit(deps.session, deps.limiter);
  if (gate) return gate;
  const body = await readJson(request);
  const parsed = ReflectionRequestSchema.safeParse(body);
  if (!parsed.success) return failure(422, 'invalid', 'Invalid reflection request');
  try {
    return json(200, await deps.reflection.reflect(parsed.data.selectedText, parsed.data.clientRequestId));
  } catch (error) {
    return providerFailure(error);
  }
}

/** POST /api/voice/session. Empty body → `VoiceSession` with a short-lived scoped token; never the master key. */
export async function handleVoiceSessionRequest(request: Request,
  deps: { session: RouteSession; voice: VoicePort; limiter?: RateLimiter }): Promise<Response> {
  const gate = admit(deps.session, deps.limiter);
  if (gate) return gate;
  const body = await readJson(request, true);
  if (!EmptyBodySchema.safeParse(body).success) return failure(422, 'invalid', 'Invalid voice session request');
  try {
    return json(200, await deps.voice.createSession(randomUUID()));
  } catch (error) {
    return providerFailure(error);
  }
}

function admit(session: RouteSession, limiter?: RateLimiter): Response | null {
  if (!session.configured) return failure(503, 'unavailable', 'Authentication is not configured');
  if (!session.userId) return failure(401, 'unauthenticated', 'Sign in required');
  if (limiter && !limiter.take(session.userId)) return failure(429, 'rate_limited', 'Too many requests');
  return null;
}

async function readJson(request: Request, allowEmpty = false): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return undefined;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return undefined;
  }
  if (text.length > MAX_BODY_BYTES) return undefined;
  if (allowEmpty && text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function providerFailure(error: unknown): Response {
  if (!(error instanceof ProviderError)) return failure(503, 'unavailable', 'Provider unavailable');
  const status = httpStatusFor(error.code);
  const code: ErrorCode = status === 422 ? 'invalid' : status === 429 ? 'rate_limited' : 'unavailable';
  return failure(status, code, `${error.provider} ${error.code}`);
}

function failure(status: number, code: ErrorCode, message: string): Response {
  return json(status, { error: { code, message, requestId: randomUUID() } });
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
