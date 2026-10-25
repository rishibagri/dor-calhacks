// D056/D058: attach a talking point to the caller's own approved signal. Only ids from the fixed generic list are
// accepted (TALKING_POINTS), so nothing from the journal can reach the recipient through it.
import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { requireAccount } from '../guards';
import { isTalkingPointId } from '@dor/contracts/policy';

export const attach_signal_hook = spacetimedb.reducer(
  { client_request_id: t.string(), hook: t.string() },
  (ctx, { client_request_id, hook }) => {
    requireAccount(ctx);
    if (!isTalkingPointId(hook)) fail('invalid', 'hook not on the talking-point list');
    const signal = [...ctx.db.approved_signal.sender_id.filter(ctx.sender)].find(s => s.client_request_id === client_request_id);
    if (!signal) fail('not_found', 'signal');
    if (signal.revoked_at) fail('invalid', 'signal revoked');
    const row = { signal_id: signal.signal_id, sender_id: ctx.sender, hook, created_at: ctx.timestamp };
    if (ctx.db.signal_hook.signal_id.find(signal.signal_id)) ctx.db.signal_hook.signal_id.update(row);
    else ctx.db.signal_hook.insert(row);
  }
);
