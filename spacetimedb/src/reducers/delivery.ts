import { t } from 'spacetimedb/server';
import { validRecipientDelivery } from '@kinetic/contracts/policy';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { requireAccount, requireAcceptedPair } from '../guards';
import { newId } from '../ids';

/**
 * F5 (D017/D018): the caller sets THEIR OWN delivery settings as a recipient in one accepted pair.
 * Nobody can opt someone else in. Opting out suppresses nudges already pending for the caller in that pair.
 */
export const set_nudge_delivery = spacetimedb.reducer(
  {
    pair_id: t.string(),
    opted_in: t.bool(),
    quiet_start_minute: t.option(t.u16()),
    quiet_end_minute: t.option(t.u16()),
    utc_offset_minutes: t.i16(),
  },
  (ctx, args) => {
    requireAccount(ctx);
    requireAcceptedPair(ctx, args.pair_id);
    if (!validRecipientDelivery({
      optedIn: args.opted_in, quietStartMinute: args.quiet_start_minute ?? null,
      quietEndMinute: args.quiet_end_minute ?? null, utcOffsetMinutes: args.utc_offset_minutes,
    })) fail('invalid', 'delivery settings');
    const row = {
      recipient: ctx.sender, pair_id: args.pair_id, opted_in: args.opted_in,
      quiet_start_minute: args.quiet_start_minute, quiet_end_minute: args.quiet_end_minute,
      utc_offset_minutes: args.utc_offset_minutes, updated_at: ctx.timestamp,
    };
    const cur = [...ctx.db.nudge_delivery.iter()].find(d => d.pair_id === args.pair_id && d.recipient.isEqual(ctx.sender));
    if (cur) ctx.db.nudge_delivery.delivery_id.update({ ...cur, ...row });
    else ctx.db.nudge_delivery.insert({ delivery_id: newId(ctx), ...row });
    if (!args.opted_in) {
      for (const n of [...ctx.db.nudge.iter()]) {
        if (n.pair_id === args.pair_id && n.recipient_id.isEqual(ctx.sender) && !n.suppressed) {
          ctx.db.nudge.id.update({ ...n, suppressed: true });
        }
      }
    }
  }
);
