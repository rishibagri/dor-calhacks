import type { ReducerErrorCode, ReducerResult } from '@/lib/backend/ports';

const CODES: readonly ReducerErrorCode[] = [
  'unauthenticated',
  'unauthorized',
  'not_found',
  'stale',
  'invalid',
  'rate_limited',
  'unavailable',
];

/** Parses a SenderError message of the form '<code>: <message>'. */
export function parseReducerError(raw: unknown): ReducerResult {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : 'unknown error';
  const match = /(?:^|\s)([a-z_]+):\s*(.*)$/s.exec(text);
  const code = CODES.find((c) => c === match?.[1]);
  if (code && match) return { ok: false, code, message: match[2] || text };
  return { ok: false, code: 'unavailable', message: text };
}
