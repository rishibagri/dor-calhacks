// D056: attach a talking point to the caller's own approved signal, so the recipient's nudge says what to bring up.
import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { requireAccount } from '../guards';

const MAX_HOOK_CHARS = 140;
const URLISH = /(https?:\/\/|www\.|\S+\.(com|net|org|io|app|dev)\b)/i;

/** Trims and collapses whitespace; rejects empty, oversized, multi-line, link-like or control-character text. */
function cleanHook(raw: string): string {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v) fail('invalid', 'hook empty');
  if (v.length > MAX_HOOK_CHARS) fail('invalid', 'hook too long');
  if (/[\u0000-\u001f\u007f]/.test(raw.replace(/[\n\r\t]/g, ''))) fail('invalid', 'hook has control characters');
  if (URLISH.test(v)) fail('invalid', 'hook has a link');
  return v;
}

export const attach_signal_hook = spacetimedb.reducer(
  { client_request_id: t.string(), hook: t.string() },
  (ctx, { client_request_id, hook }) => {
    requireAccount(ctx);
    const signal = [...ctx.db.approved_signal.sender_id.filter(ctx.sender)].find(s => s.client_request_id === client_request_id);
    if (!signal) fail('not_found', 'signal');
    if (signal.revoked_at) fail('invalid', 'signal revoked');
    const row = { signal_id: signal.signal_id, sender_id: ctx.sender, hook: cleanHook(hook), created_at: ctx.timestamp };
    if (ctx.db.signal_hook.signal_id.find(signal.signal_id)) ctx.db.signal_hook.signal_id.update(row);
    else ctx.db.signal_hook.insert(row);
  }
);
