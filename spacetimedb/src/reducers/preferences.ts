import { t } from 'spacetimedb/server';
import { PREFERENCE_MAX_LIFETIME_MS, validSupportPreferences } from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { parseFuture, requireAccount, requireAcceptedPair, requireMemberPair } from '../guards';
import { newId } from '../ids';
import { findPreferenceRow, fromMs } from '../policy_state';

/** Suppress the caller's pending nudges in a pair (their consent no longer covers them). */
function suppressRecipientNudges(ctx: Ctx, pairId: string): void {
  for (const n of [...ctx.db.nudge.pair_id.filter(pairId)]) {
    if (n.recipient_id.isEqual(ctx.sender) && !n.suppressed) {
      ctx.db.nudge.id.update({ ...n, suppressed: true });
    }
  }
}

/**
 * C4 recipient consent (D021 #4, D035): the caller records which support modes / coarse windows THEY accept
 * from the other member of an accepted pair. Nobody can write another person's preferences. Optimistic
 * concurrency via expected_version (0 = create). Every change bumps consent_version, so a commit bound to the
 * version the coordinator read fails if the recipient edits or revokes mid-generation.
 */
export const set_support_preferences = spacetimedb.reducer(
  {
    pair_id: t.string(),
    support_modes: t.array(t.string()),
    availability: t.array(t.string()),
    expires_at: t.string(),
    expected_version: t.u32(),
  },
  (ctx, args) => {
    requireAccount(ctx);
    requireAcceptedPair(ctx, args.pair_id);
    if (!validSupportPreferences({ supportModes: args.support_modes, availability: args.availability })) {
      fail('invalid', 'invalid_schema');
    }
    const exp = parseFuture(ctx, args.expires_at, 'expires_at');
    if (exp.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch + fromMs(PREFERENCE_MAX_LIFETIME_MS)) {
      fail('invalid', 'expires_at too far');
    }
    const cur = findPreferenceRow(ctx.db, ctx.sender, args.pair_id);
    if ((cur?.consent_version ?? 0) !== args.expected_version) fail('stale', 'stale_policy');
    const row = {
      recipient: ctx.sender, pair_id: args.pair_id, support_modes: args.support_modes, availability: args.availability,
      consent_version: (cur?.consent_version ?? 0) + 1, expires_at: exp, revoked_at: undefined, updated_at: ctx.timestamp,
    };
    // Narrowing modes hides nudges the new consent no longer covers via the my_nudges recheck.
    if (cur) ctx.db.support_preference.consent_id.update({ ...cur, ...row });
    else ctx.db.support_preference.insert({ consent_id: newId(ctx), ...row });
  }
);

/**
 * Revoke the caller's own preference consent in a pair. Bumps the version (commits bound to any earlier
 * version fail) and suppresses the caller's pending nudges there. Allowed after unlink too. Idempotent.
 */
export const revoke_support_preferences = spacetimedb.reducer(
  { pair_id: t.string() },
  (ctx, { pair_id }) => {
    requireAccount(ctx);
    requireMemberPair(ctx, pair_id);
    const cur = findPreferenceRow(ctx.db, ctx.sender, pair_id);
    if (!cur) fail('not_found', 'preferences');
    if (cur.revoked_at) return;
    ctx.db.support_preference.consent_id.update({
      ...cur, revoked_at: ctx.timestamp, consent_version: cur.consent_version + 1, updated_at: ctx.timestamp,
    });
    suppressRecipientNudges(ctx, pair_id);
  }
);
