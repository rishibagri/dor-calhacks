export type Provider = 'anthropic' | 'cartesia' | 'factory';
export type ProviderErrorCode = 'not_configured' | 'invalid_input' | 'auth_failed' | 'rate_limited' |
  'timeout' | 'unavailable' | 'refused' | 'invalid_output';

/** Sanitized failure: provider + code only. Never carries request text, audio, or provider response bodies. */
export class ProviderError extends Error {
  constructor(readonly provider: Provider, readonly code: ProviderErrorCode, readonly status?: number) {
    super(`${provider} ${code}`);
    this.name = 'ProviderError';
  }
}

/** Status for the API contract error envelope; 503 for anything the caller cannot fix. */
export function httpStatusFor(code: ProviderErrorCode): 422 | 429 | 503 {
  if (code === 'invalid_input' || code === 'refused') return 422;
  if (code === 'rate_limited') return 429;
  return 503;
}

/** Maps Stainless-style SDK errors by name/status without retaining the original message or cause. */
export function toProviderError(provider: Provider, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as { name?: unknown; status?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : '';
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (name === 'APIConnectionTimeoutError' || name === 'AbortError' || status === 408)
    return new ProviderError(provider, 'timeout', status);
  if (status === 401 || status === 403) return new ProviderError(provider, 'auth_failed', status);
  if (status === 429) return new ProviderError(provider, 'rate_limited', status);
  if (status !== undefined && status >= 400 && status < 500) return new ProviderError(provider, 'invalid_input', status);
  return new ProviderError(provider, 'unavailable', status);
}
