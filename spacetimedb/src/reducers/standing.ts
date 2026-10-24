// D044 automatic nudges (Cyber, README "Existing-connection privacy decision — D044").
// Owner-only standing consent for one pair; off by default. Never set by a preset, quiz, journal, assessment, model,
// provider or the recipient: only this explicit owner reducer creates it. Delivery keeps every recipient-side check.
import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import {
  categoriesOf, DISCLOSURE_CONSENT_VERSION, DISCLOSURE_PURPOSE, guardApproval, guardStandingRule, payloadRevision, policyErrorCode,
  standingErrorCode, standingRuleStands, type StandingDenyReason,
} from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { otherMember, requireAccount, requireMemberPair } from '../guards';
import { newId } from '../ids';
import { findStandingRow, fromMs, hex, loadStanding, loadStandingPreset, pauseInForce, toMs, toStandingState } from '../policy_state';
import { endStandingRule } from '../standing_effects';

function refuse(reason: StandingDenyReason): never {
  return fail(standingErrorCode(reason), reason);
}

/**
 * Explicit setup (before any journal-derived candidate): one named pair, allowlisted categories the owner's current
 * preset already allows, the preset/assignment versions and notice the owner was shown, an expiry of 1 h to 30 days.
 * `expected_version` is the current rule version (0 for none). Refused while the owner is pausing that person.
 */
export const set_standing_consent = spacetimedb.reducer(
  {
    pair_id: t.string(), categories: t.array(t.string()), expires_at: t.string(), expected_version: t.u32(),
    expected_policy_version: t.u32(), expected_assignment_version: t.u32(), notice_version: t.u32(),
  },
  (ctx, a) => {
    requireAccount(ctx);
    const pair = requireMemberPair(ctx, a.pair_id);
    const recipient = otherMember(pair, ctx.sender);
    const nowMs = toMs(ctx.timestamp);
    const g = guardStandingRule({
      pairAccepted: pair.status === 'accepted' && Boolean(recipient), preset: loadStandingPreset(ctx.db, ctx.sender, a.pair_id),
      categories: a.categories, expiresAtMs: Date.parse(a.expires_at), expectedPolicyVersion: a.expected_policy_version,
      expectedAssignmentVersion: a.expected_assignment_version, noticeVersion: a.notice_version,
      paused: pauseInForce(ctx.db, ctx.sender, a.pair_id, nowMs), nowMs,
    });
    if (!g.ok) refuse(g.reason);
    const cur = findStandingRow(ctx.db, ctx.sender, a.pair_id);
    if ((cur?.version ?? 0) !== a.expected_version) fail('stale', 'standing rule version changed');
    // Replacing a rule ends the old one's unused approvals first (a narrowed rule must not keep wider approvals alive).
    if (cur && !cur.revoked_at) endStandingRule(ctx, ctx.sender, a.pair_id);
    const after = findStandingRow(ctx.db, ctx.sender, a.pair_id);
    const row = {
      owner: ctx.sender, pair_id: a.pair_id, recipient: recipient!, categories: g.categories,
      recipient_policy_version: a.expected_policy_version, preset_assignment_version: a.expected_assignment_version,
      notice_version: a.notice_version, version: (after?.version ?? 0) + 1, expires_at: new Timestamp(fromMs(g.expiresAtMs)),
      revoked_at: undefined, updated_at: ctx.timestamp,
    };
    if (after) ctx.db.standing_consent.rule_id.update({ ...after, ...row });
    else ctx.db.standing_consent.insert({ rule_id: newId(ctx), created_at: ctx.timestamp, ...row });
  }
);

/** Owner revokes the rule now; idempotent. Unused automatic approvals and their nudges are killed. */
export const revoke_standing_consent = spacetimedb.reducer(
  { pair_id: t.string() },
  (ctx, { pair_id }) => {
    requireAccount(ctx);
    requireMemberPair(ctx, pair_id);
    if (!findStandingRow(ctx.db, ctx.sender, pair_id)) fail('not_found', 'standing rule');
    endStandingRule(ctx, ctx.sender, pair_id);
  }
);

/**
 * Automatic approval: the owner's own client submits an enum-only candidate WITHOUT a per-item preview. The server runs
 * every manual-approval check (guardApproval, with the payload revision computed here from the rule-bound versions)
 * plus the rule check (current version, unrevoked, unexpired, categories cover the payload, preset unchanged) and the
 * D041 pause. The receipt action `approved_standing` is never projected (README: no per-event sender receipt); the
 * signal still appears in the owner's `my_signals` so it can be revoked. Idempotent on client_request_id.
 */
export const approve_signal_standing = spacetimedb.reducer(
  {
    pair_id: t.string(), support_mode: t.option(t.string()), availability: t.option(t.string()),
    client_request_id: t.string(), rule_version: t.u32(),
  },
  (ctx, a) => {
    requireAccount(ctx);
    const nowMs = toMs(ctx.timestamp);
    if (pauseInForce(ctx.db, ctx.sender, a.pair_id, nowMs)) fail('unauthorized', 'recipient_paused');
    const prior = [...ctx.db.approved_signal.sender_id.filter(ctx.sender)].find(s => s.client_request_id === a.client_request_id);
    if (prior) {
      if (prior.pair_id === a.pair_id && prior.support_mode === a.support_mode && prior.availability === a.availability) return;
      fail('invalid', 'client_request_id reused');
    }
    const pair = requireMemberPair(ctx, a.pair_id);
    const recipient = otherMember(pair, ctx.sender);
    const rule = findStandingRow(ctx.db, ctx.sender, a.pair_id);
    const categories = categoriesOf({ supportMode: a.support_mode, availability: a.availability });
    const stands = standingRuleStands(rule ? toStandingState(ctx.db, rule) : null, loadStandingPreset(ctx.db, ctx.sender, a.pair_id), {
      ownerId: hex(ctx.sender), recipientId: recipient ? hex(recipient) : '', pairId: a.pair_id, categories, ruleVersion: a.rule_version,
    }, nowMs);
    if (stands) refuse(stands);
    const versions = { recipientPolicyVersion: rule!.recipient_policy_version, presetAssignmentVersion: rule!.preset_assignment_version,
      consentVersion: DISCLOSURE_CONSENT_VERSION };
    const d = guardApproval({
      callerId: hex(ctx.sender), pairId: a.pair_id, supportMode: a.support_mode, availability: a.availability, ...versions,
      payloadRevision: payloadRevision({ pairId: a.pair_id, recipientId: hex(recipient!), supportMode: a.support_mode, availability: a.availability, ...versions }),
      clientRequestId: a.client_request_id,
    }, { nowMs, ...loadStanding(ctx.db, ctx.sender, a.pair_id) });
    if (!d.allowed) fail(policyErrorCode(d.reason), d.reason);
    const signalId = newId(ctx);
    ctx.db.approved_signal.insert({
      signal_id: signalId, pair_id: a.pair_id, sender_id: ctx.sender, recipient_id: recipient!, purpose: DISCLOSURE_PURPOSE,
      support_mode: a.support_mode, availability: a.availability, consent_version: DISCLOSURE_CONSENT_VERSION,
      recipient_policy_id: d.recipientPolicyId, recipient_policy_version: versions.recipientPolicyVersion,
      preset_assignment_version: versions.presetAssignmentVersion,
      expires_at: new Timestamp(fromMs(Math.min(d.expiresAtMs, toMs(rule!.expires_at)))), revoked_at: undefined,
      client_request_id: a.client_request_id,
    });
    ctx.db.standing_approval.insert({ signal_id: signalId, rule_id: rule!.rule_id, rule_version: rule!.version });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id: signalId, sender_id: ctx.sender, recipient_id: recipient!, categories: d.categories,
      consent_version: DISCLOSURE_CONSENT_VERSION, recipient_policy_version: versions.recipientPolicyVersion,
      preset_assignment_version: versions.presetAssignmentVersion, action: 'approved_standing', created_at: ctx.timestamp,
    });
  }
);
