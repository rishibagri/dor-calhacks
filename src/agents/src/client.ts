/**
 * Browser-safe clients for the AI routes. No provider SDKs, keys or Node APIs; responses are schema-checked
 * before they reach UI code. Import from `@dor/agents/client`.
 */
import { PrivateReflectionSchema, VoiceSessionSchema, type PrivateReflection, type VoiceSession } from '@dor/contracts';

/** Route failure with the API error code only (`unauthenticated`, `invalid`, `rate_limited`, `unavailable`, ...). */
export class RouteError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`${status} ${code}`);
    this.name = 'RouteError';
  }
}

export interface RouteClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export function createReflectionClient(options: RouteClientOptions = {}) {
  return {
    /** Send only text the owner selected; store the result in the local vault. */
    async reflect(selectedText: string, clientRequestId: string, signal?: AbortSignal): Promise<PrivateReflection> {
      const body = await post(options, '/api/reflections', { selectedText, clientRequestId }, signal);
      const parsed = PrivateReflectionSchema.safeParse(body);
      if (!parsed.success) throw new RouteError(502, 'invalid_response');
      return parsed.data;
    },
  };
}

export interface OpenerDraft { message: string; angle: string; suggestion: string }

export function createOpenerClient(options: RouteClientOptions = {}) {
  return {
    /** Card fields the sender can already see plus their own profile; returns an editable draft. */
    async draft(input: unknown, signal?: AbortSignal): Promise<OpenerDraft> {
      const body = await post(options, '/api/network/opener', input, signal) as Partial<OpenerDraft> | null;
      if (!body || typeof body.message !== 'string' || !body.message.trim()) throw new RouteError(502, 'invalid_response');
      return { message: body.message, angle: String(body.angle ?? ''), suggestion: String(body.suggestion ?? '') };
    },
  };
}

export function createVoiceSessionClient(options: RouteClientOptions = {}) {
  return {
    async createSession(signal?: AbortSignal): Promise<VoiceSession> {
      const body = await post(options, '/api/voice/session', {}, signal);
      const parsed = VoiceSessionSchema.safeParse(body);
      if (!parsed.success) throw new RouteError(502, 'invalid_response');
      return parsed.data;
    },
  };
}

async function post(options: RouteClientOptions, path: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await doFetch(`${options.baseUrl ?? ''}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    credentials: 'same-origin', cache: 'no-store', signal,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON bodies are reported by status only.
  }
  if (!response.ok) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    throw new RouteError(response.status, typeof code === 'string' ? code : 'unavailable');
  }
  return body;
}

export { CARTESIA_HTTP_BASE, CARTESIA_STT_WS_URL, VoiceDictation, VoiceError, speak, startMicCapture, streamingSttUrl,
  toPcm16, type DictationSnapshot, type DictationState, type MicCapture, type MicStarter, type SocketFactory,
  type SocketLike, type SpeakOptions, type VoiceDictationDeps, type VoiceErrorCode } from './voice/browser.js';
