import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { parseFuture, requireAccount } from '../guards';
import { MAX_SNOOZE_MICROS } from '../constants';

/** Only the recipient may act; anyone else gets not_found (no existence leak). */
function recipientNudge(ctx: Ctx, id: string) {
  requireAccount(ctx);
  const n = ctx.db.nudge.id.find(id);
  if (!n || !n.recipient_id.isEqual(ctx.sender) || n.suppressed) fail('not_found', 'nudge');
  return n;
}

export const dismiss_nudge = spacetimedb.reducer({ nudge_id: t.string() }, (ctx, { nudge_id }) => {
  const n = recipientNudge(ctx, nudge_id);
  ctx.db.nudge.id.update({ ...n, dismissed: true });
});

export const snooze_nudge = spacetimedb.reducer(
  { nudge_id: t.string(), until: t.string() },
  (ctx, { nudge_id, until }) => {
    const n = recipientNudge(ctx, nudge_id);
    const ts = parseFuture(ctx, until, 'until');
    if (ts.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch + MAX_SNOOZE_MICROS) {
      fail('invalid', 'snooze too long');
    }
    ctx.db.nudge.id.update({ ...n, snoozed_until: new Timestamp(ts.microsSinceUnixEpoch) });
  }
);
