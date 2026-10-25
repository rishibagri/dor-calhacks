/**
 * Log fields for errors: codes only, never raw message text (Cyber LOW finding). A reducer refusal, provider error or
 * SDK fault may carry free text, so only a bare lowercase `code:` prefix is kept; anything else logs as `unknown`.
 */
export function errorCode(error: unknown): string {
  const head = error instanceof Error ? error.message.split(':')[0]! : '';
  return /^[a-z][a-z_]{0,39}$/.test(head) ? head : 'unknown';
}

/** Startup failures: the code, plus the missing env var's NAME (never its value) so an operator can fix the config. */
export function fatalFields(error: unknown): Record<string, string> {
  const missing = error instanceof Error ? /^not_configured: missing ([A-Z][A-Z0-9_]{0,63})$/.exec(error.message)?.[1] : undefined;
  return { code: errorCode(error), ...(missing ? { missing } : {}) };
}
