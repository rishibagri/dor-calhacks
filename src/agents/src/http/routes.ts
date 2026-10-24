import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrivateReflection, PrivateReflectionPort, VoicePort } from '@dor/contracts';
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

/**
 * Short-lived in-flight request coalescing: a double submit or client retry of the same request joins the call
 * already running instead of paying for a second one. Keyed by user, client request ID and a digest of the text,
 * so a reused ID with different text runs separately and no user can join another's call. Entries are removed
 * when the call settles: results are never cached (no retention boundary for private reflections).
 */
export class InFlightRequests<T> {
  private readonly active = new Map<string, Promise<T>>();
  constructor(private readonly maxEntries = 1000) {}

  run(parts: string[], work: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(parts.join('\n')).digest('hex');
    const running = this.active.get(key);
    if (running) return running;
    const result = work();
    // At capacity, run uncoalesced rather than queue or fail.
    if (this.active.size >= this.maxEntries) return result;
    this.active.set(key, result);
    const done = () => { this.active.delete(key); };
    result.then(done, done);
    return result;
  }

  get size(): number {
    return this.active.size;
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
export async function handleReflectionRequest(request: Request, deps: { session: RouteSession;
  reflection: PrivateReflectionPort; limiter?: RateLimiter; inFlight?: InFlightRequests<PrivateReflection> }): Promise<Response> {
  const gate = admit(deps.session, deps.limiter);
  if (gate) return gate;
  const body = await readJson(request);
  const parsed = ReflectionRequestSchema.safeParse(body);
  if (!parsed.success) return failure(422, 'invalid', 'Invalid reflection request');
  const { selectedText, clientRequestId } = parsed.data;
  const call = () => deps.reflection.reflect(selectedText, clientRequestId);
  try {
    return json(200, await (deps.inFlight ? deps.inFlight.run([deps.session.userId!, clientRequestId, selectedText], call) : call()));
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
