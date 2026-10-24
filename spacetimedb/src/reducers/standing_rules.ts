// D047 standing-rule automatic nudges (CS; Cyber review requested). Owner-only, explicit, revocable, off by default.
// A rule lets the owner's client approve a matching signal in ONE accepted pair without the per-item preview. It only
// narrows: the current preset/assignment stays the ceiling and every recipient-side check (consent, opt-in, quiet
// hours, cooldown, D041 pause) still runs at commit_nudge. Docs: docs/features/AUTOMATIC_NUDGES.md.
import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { DISCLOSURE_CONSENT_VERSION, DISCLOSURE_PURPOSE, guardRuleApproval, guardRuleCreation, policyErrorCode } from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { otherMember, requireAccount, requireMemberPair } from '../guards';
import { newId } from '../ids';
import { findRuleRow, fromMs, hex, loadStanding, pauseInForce, toMs, toRuleState } from '../policy_state';
import { revokeRule, revokeUndeliveredRuleSignals } from '../standing_rule';

/**
 * Create or replace the caller's standing rule for one accepted pair. `expected_version` is the version in
 * `my_standing_rules` (0 for none). Must lie within the caller's current preset for this recipient (never broadens it),
 * is refused while the caller is pausing the recipient, and bumps the version: signals approved under the previous
 * version are revoked if undelivered, so a changed rule never lets old approvals through.
 */
export const set_standing_rule = spacetimedb.reducer(
  {
    pair_id: t.string(),
    support_modes: t.array(t.string()),
    availability: t.array(t.string()),
    purpose: t.string(),
    expires_at: t.string(),
    expected_version: t.u32(),
  },
  (ctx, args) => {
    requireAccount(ctx);
    requireMemberPair(ctx, args.pair_id);
    const nowMs = toMs(ctx.timestamp);
    if (pauseInForce(ctx.db, ctx.sender, args.pair_id, nowMs)) fail('unauthorized', 'recipient_paused');
    const d = guardRuleCreation({
      callerId: hex(ctx.sender), pairId: args.pair_id, supportModes: args.support_modes, availability: args.availability,
      purpose: args.purpose, expiresAtMs: Date.parse(args.expires_at),
    }, { nowMs, ...loadStanding(ctx.db, ctx.sender, args.pair_id) });
    if (!d.allowed) fail(policyErrorCode(d.reason), d.reason);
    const cur = findRuleRow(ctx.db, ctx.sender, args.pair_id);
    if ((cur?.version ?? 0) !== args.expected_version) fail('stale', 'rule version changed');
    const row = {
      support_modes: args.support_modes, availability: args.availability, purpose: args.purpose,
      expires_at: new Timestamp(fromMs(Date.parse(args.expires_at))), revoked_at: undefined, updated_at: ctx.timestamp,
    };
    if (cur) {
      revokeUndeliveredRuleSignals(ctx, cur);
      ctx.db.standing_rule.rule_id.update({ ...cur, ...row, version: cur.version + 1 });
    } else {
      ctx.db.standing_rule.insert({
        rule_id: newId(ctx), owner: ctx.sender, pair_id: args.pair_id, version: 1, created_at: ctx.timestamp, ...row,
      });
    }
  }
);

/**
 * End the caller's standing rule now. Undelivered signals approved under it are revoked; already-delivered nudges are
 * untouched. Idempotent for an already-revoked rule; a caller with no rule on that pair gets not_found.
 */
export const revoke_standing_rule = spacetimedb.reducer(
  { pair_id: t.string(), expected_version: t.u32() },
  (ctx, { pair_id, expected_version }) => {
    requireAccount(ctx);
    const cur = findRuleRow(ctx.db, ctx.sender, pair_id);
    if (!cur) fail('not_found', 'rule');
    if (cur.version !== expected_version) fail('stale', 'rule version changed');
    revokeRule(ctx, cur);
  }
);

/**
 * Approve a signal under the caller's standing rule, without the per-item preview. Writes the same `approved_signal`
 * row and `approved` receipt as approve_signal (the worker and commit_nudge are unchanged); the row also records which
 * rule version authorized it, which no worker or recipient view exposes. Idempotent per sender `client_request_id`,
 * shared with approve_signal: a replay never re-approves and never resurrects a revoked signal.
 */
export const approve_signal_by_rule = spacetimedb.reducer(
  {
    pair_id: t.string(),
    support_mode: t.option(t.string()),
    availability: t.option(t.string()),
    rule_version: t.u32(),
    client_request_id: t.string(),
  },
  (ctx, args) => {
    requireAccount(ctx);
    if (pauseInForce(ctx.db, ctx.sender, args.pair_id, toMs(ctx.timestamp))) fail('unauthorized', 'recipient_paused');
    const prior = [...ctx.db.approved_signal.sender_id.filter(ctx.sender)].find(s => s.client_request_id === args.client_request_id);
    if (prior) {
      const same = prior.pair_id === args.pair_id && prior.support_mode === args.support_mode &&
        prior.availability === args.availability && prior.rule_version === args.rule_version && prior.rule_id !== undefined;
      if (same) return;
      fail('invalid', 'client_request_id reused');
    }
    const row = findRuleRow(ctx.db, ctx.sender, args.pair_id);
    const d = guardRuleApproval({
      callerId: hex(ctx.sender), pairId: args.pair_id, supportMode: args.support_mode, availability: args.availability,
      ruleVersion: args.rule_version, clientRequestId: args.client_request_id,
    }, { nowMs: toMs(ctx.timestamp), ...loadStanding(ctx.db, ctx.sender, args.pair_id), rule: row ? toRuleState(ctx.db, row) : null });
    if (!d.allowed) fail(policyErrorCode(d.reason), d.reason);

    const recipient = otherMember(ctx.db.pair.pair_id.find(args.pair_id)!, ctx.sender)!;
    if (hex(recipient) !== d.recipientId || !row) fail('invalid', 'recipient mismatch'); // unreachable; belt and braces
    const standing = loadStanding(ctx.db, ctx.sender, args.pair_id);
    const signalId = newId(ctx);
    ctx.db.approved_signal.insert({
      signal_id: signalId, pair_id: args.pair_id, sender_id: ctx.sender, recipient_id: recipient,
      purpose: DISCLOSURE_PURPOSE, support_mode: args.support_mode, availability: args.availability,
      consent_version: DISCLOSURE_CONSENT_VERSION, recipient_policy_id: d.recipientPolicyId,
      recipient_policy_version: standing.preset!.version, preset_assignment_version: standing.assignment!.assignmentVersion,
      expires_at: new Timestamp(fromMs(d.expiresAtMs)), revoked_at: undefined,
      client_request_id: args.client_request_id, rule_id: row.rule_id, rule_version: row.version,
    });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id: signalId, sender_id: ctx.sender, recipient_id: recipient,
      categories: d.categories, consent_version: DISCLOSURE_CONSENT_VERSION, recipient_policy_version: standing.preset!.version,
      preset_assignment_version: standing.assignment!.assignmentVersion, action: 'approved', created_at: ctx.timestamp,
    });
  }
);
