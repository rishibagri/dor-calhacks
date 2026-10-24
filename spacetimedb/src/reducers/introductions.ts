// PROPOSED C8 introductions, report and AI-proposal commit (Cyber, CYBER-R2, D038). Same feature flag as
// discovery. Accepting an introduction creates no pair, preset, signal, contact detail or message.
import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import {
  DISCOVERY_REPORT_REASONS, guardDiscoveryVisibility, guardIntroductionProposalCommit, guardIntroductionRequest,
  guardIntroductionResponse, introductionErrorCode, introductionErrorMessage, validClientRequestId,
  type IntroductionDenyReason,
} from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { requireAccount } from '../guards';
import { newId } from '../ids';
import { blockedEitherWay, connectedCounterparts, discoveryEnabled, fromMs, loadDiscoveryParty, toMs } from '../policy_state';
import { applyBlock, consumeRate, introductionsBetween, requireDiscovery, toIntroductionState } from '../discovery_effects';

function refuse(reason: IntroductionDenyReason): never {
  return fail(introductionErrorCode(reason), introductionErrorMessage(reason));
}

/** Card ref → owner, only if the caller can see that card right now. Anything else is not_found. */
function visibleCardOwner(ctx: Ctx, cardRef: string) {
  const target = ctx.db.discovery_publication.publication_id.find(cardRef);
  if (!target || target.owner.isEqual(ctx.sender)) fail('not_found', 'card');
  const seen = guardDiscoveryVisibility(loadDiscoveryParty(ctx.db, ctx.sender), loadDiscoveryParty(ctx.db, target.owner),
    blockedEitherWay(ctx.db, ctx.sender, target.owner), discoveryEnabled(ctx.db), toMs(ctx.timestamp));
  if (!seen.ok) fail('not_found', 'card');
  return target;
}

/** The other participant of an introduction the caller belongs to; non-participants get not_found. */
function introductionCounterpart(ctx: Ctx, introId: string) {
  const r = ctx.db.introduction.intro_id.find(introId);
  if (!r) fail('not_found', 'introduction');
  if (r.sender.isEqual(ctx.sender)) return { row: r, other: r.recipient };
  if (r.recipient.isEqual(ctx.sender)) return { row: r, other: r.sender };
  return fail('not_found', 'introduction');
}

/**
 * Human-triggered request to a card the sender can see now. Idempotent on (sender, client_request_id): a
 * replay is a no-op whatever happened since, so it can never revive a declined, cancelled or expired request.
 */
export const send_introduction_request = spacetimedb.reducer(
  { card_ref: t.string(), client_request_id: t.string() },
  (ctx, { card_ref, client_request_id }) => {
    requireDiscovery(ctx);
    if (!validClientRequestId(client_request_id)) fail('invalid', 'client_request_id');
    const prior = [...ctx.db.introduction.sender.filter(ctx.sender)].find(r => r.client_request_id === client_request_id);
    if (prior) {
      const target = ctx.db.discovery_publication.publication_id.find(card_ref);
      if (target && prior.recipient.isEqual(target.owner)) return;
      refuse('request_id_reused');
    }
    const target = visibleCardOwner(ctx, card_ref);
    // Already connected through an accepted pair: an introduction would add nothing (and isn't a way back in).
    if (connectedCounterparts(ctx.db, ctx.sender).has(target.owner.toHexString())) refuse('already_connected');
    const nowMs = toMs(ctx.timestamp);
    const sender = loadDiscoveryParty(ctx.db, ctx.sender), recipient = loadDiscoveryParty(ctx.db, target.owner);
    const pendingOut = [...ctx.db.introduction.sender.filter(ctx.sender)].filter(r => r.status === 'pending' &&
      toMs(r.expires_at) > nowMs).length;
    const g = guardIntroductionRequest({
      sender, recipient, blockedEitherWay: false, enabled: true, nowMs,
      between: introductionsBetween(ctx.db, ctx.sender, target.owner).map(toIntroductionState), senderPendingOutgoing: pendingOut,
    });
    if (!g.ok) refuse(g.reason);
    consumeRate(ctx, 'introduction_request');
    const s = sender.publication!, r = recipient.publication!;
    ctx.db.introduction.insert({
      intro_id: newId(ctx), sender: ctx.sender, recipient: target.owner, client_request_id, sender_revision: s.revision,
      sender_name: s.displayName, recipient_name: undefined, shared_tags: s.interestTags.filter(x => r.interestTags.includes(x)),
      status: 'pending', sender_closed: false, created_at: ctx.timestamp, expires_at: new Timestamp(fromMs(g.expiresAtMs)),
      responded_at: undefined,
    });
  }
);

function respond(ctx: Ctx, introId: string, action: 'accept' | 'decline' | 'cancel') {
  requireAccount(ctx); // decline and cancel stay available even if discovery is disabled later
  const { row } = introductionCounterpart(ctx, introId);
  const g = guardIntroductionResponse({
    intro: toIntroductionState(row), callerId: ctx.sender.toHexString(), action,
    sender: loadDiscoveryParty(ctx.db, row.sender), recipient: loadDiscoveryParty(ctx.db, row.recipient),
    blockedEitherWay: blockedEitherWay(ctx.db, row.sender, row.recipient), enabled: discoveryEnabled(ctx.db), nowMs: toMs(ctx.timestamp),
  });
  if (!g.ok) refuse(g.reason);
  const recipientName = g.status === 'accepted' ? loadDiscoveryParty(ctx.db, row.recipient).publication!.displayName : undefined;
  ctx.db.introduction.intro_id.update({
    ...row, status: g.status, responded_at: ctx.timestamp, recipient_name: recipientName,
    sender_closed: g.status === 'cancelled', // a decline stays "pending" to the sender until it lapses
  });
  if (g.status === 'accepted') {
    for (const p of [...ctx.db.introduction_proposal.viewer.filter(row.sender), ...ctx.db.introduction_proposal.viewer.filter(row.recipient)]) {
      const pair = (p.viewer.isEqual(row.sender) && p.candidate.isEqual(row.recipient)) ||
        (p.viewer.isEqual(row.recipient) && p.candidate.isEqual(row.sender));
      if (pair) ctx.db.introduction_proposal.proposal_id.delete(p.proposal_id);
    }
  }
}

/** Recipient only: accept (both profiles still standing, sender's profile unchanged, no block) or decline. */
export const respond_introduction_request = spacetimedb.reducer(
  { intro_id: t.string(), accept: t.bool() },
  (ctx, { intro_id, accept }) => respond(ctx, intro_id, accept ? 'accept' : 'decline')
);

/** Sender only, while pending. */
export const cancel_introduction_request = spacetimedb.reducer(
  { intro_id: t.string() },
  (ctx, { intro_id }) => respond(ctx, intro_id, 'cancel')
);

/** Block the other participant of an introduction (e.g. an unwanted incoming request). Same cascade as a card block. */
export const block_introduction_participant = spacetimedb.reducer(
  { intro_id: t.string() },
  (ctx, { intro_id }) => {
    requireAccount(ctx);
    const { other } = introductionCounterpart(ctx, intro_id);
    const already = blockedEitherWay(ctx.db, ctx.sender, other);
    if (!already) consumeRate(ctx, 'block');
    applyBlock(ctx, other, already);
  }
);

/**
 * Report a visible card or an introduction counterpart with a coarse reason; also blocks them. Stored
 * privately (no view); the target is never told who reported or why.
 */
export const report_discovery_user = spacetimedb.reducer(
  { target_kind: t.string(), target_ref: t.string(), reason: t.string() },
  (ctx, { target_kind, target_ref, reason }) => {
    requireAccount(ctx);
    if (!(DISCOVERY_REPORT_REASONS as readonly string[]).includes(reason)) fail('invalid', 'reason');
    let target;
    if (target_kind === 'card') target = visibleCardOwner(ctx, target_ref).owner;
    else if (target_kind === 'introduction') target = introductionCounterpart(ctx, target_ref).other;
    else return fail('invalid', 'target_kind');
    consumeRate(ctx, 'report');
    ctx.db.discovery_report.insert({ report_id: newId(ctx), reporter: ctx.sender, target, reason, created_at: ctx.timestamp });
    applyBlock(ctx, target, blockedEitherWay(ctx.db, ctx.sender, target));
  }
);

const DECIDED_BY = ['deterministic', 'agent', 'fixed_template'];

/**
 * Worker-only (allow-listed identity) commit of an AI introduction proposal to the viewer's private list.
 * Rechecks current visibility, both publication versions and published tag overlap in this transaction, so
 * a withdrawal, block, area change, expiry or profile edit during generation refuses the commit.
 * Idempotent on proposal_id with identical content.
 */
export const commit_introduction_proposal = spacetimedb.reducer(
  {
    proposal_id: t.string(), viewer_ref: t.string(), candidate_ref: t.string(),
    viewer_publication_version: t.u32(), candidate_publication_version: t.u32(),
    reason_code: t.string(), shared_tags: t.array(t.string()), event_id: t.option(t.string()),
    opener_id: t.string(), decided_by: t.string(), expires_at: t.string(),
  },
  (ctx, a) => {
    if (!ctx.db.worker_identity.identity.find(ctx.sender)) fail('unauthorized', 'worker only');
    if (!discoveryEnabled(ctx.db)) fail('unavailable', 'disabled');
    if (!validClientRequestId(a.proposal_id) || !DECIDED_BY.includes(a.decided_by)) fail('invalid', 'invalid_schema');
    const v = ctx.db.discovery_publication.publication_id.find(a.viewer_ref);
    const c = ctx.db.discovery_publication.publication_id.find(a.candidate_ref);
    if (!v || !c) fail('not_found', 'card');
    const prior = ctx.db.introduction_proposal.proposal_id.find(a.proposal_id);
    if (prior) {
      const same = prior.viewer.isEqual(v.owner) && prior.candidate.isEqual(c.owner) && prior.reason_code === a.reason_code &&
        prior.viewer_revision === a.viewer_publication_version && prior.candidate_revision === a.candidate_publication_version &&
        JSON.stringify(prior.shared_tags) === JSON.stringify(a.shared_tags);
      if (same) return;
      fail('invalid', 'proposal_id reused');
    }
    const nowMs = toMs(ctx.timestamp);
    const g = guardIntroductionProposalCommit({
      viewerRef: a.viewer_ref, candidateRef: a.candidate_ref, viewerPublicationVersion: a.viewer_publication_version,
      candidatePublicationVersion: a.candidate_publication_version, reasonCode: a.reason_code, sharedTags: a.shared_tags,
      eventId: a.event_id ?? null, openerId: a.opener_id, expiresAtMs: Date.parse(a.expires_at),
    }, loadDiscoveryParty(ctx.db, v.owner), loadDiscoveryParty(ctx.db, c.owner), blockedEitherWay(ctx.db, v.owner, c.owner),
    true, nowMs);
    if (!g.ok) refuse(g.reason);
    // Already asked or connected: the suggestion would be noise (and could reveal a pending request).
    if (introductionsBetween(ctx.db, v.owner, c.owner).some(r => r.status === 'accepted' || (r.status === 'pending' && toMs(r.expires_at) > nowMs))) {
      fail('stale', 'already_connected');
    }
    ctx.db.introduction_proposal.insert({
      proposal_id: a.proposal_id, viewer: v.owner, candidate: c.owner, candidate_ref: c.publication_id,
      viewer_revision: a.viewer_publication_version, candidate_revision: a.candidate_publication_version,
      reason_code: a.reason_code, shared_tags: [...a.shared_tags], opener_id: a.opener_id, decided_by: a.decided_by,
      created_at: ctx.timestamp, expires_at: new Timestamp(fromMs(g.expiresAtMs)),
    });
  }
);

/** Viewer dismisses a suggestion. Anyone else gets not_found. */
export const dismiss_introduction_proposal = spacetimedb.reducer(
  { proposal_id: t.string() },
  (ctx, { proposal_id }) => {
    requireAccount(ctx);
    const p = ctx.db.introduction_proposal.proposal_id.find(proposal_id);
    if (!p || !p.viewer.isEqual(ctx.sender)) fail('not_found', 'proposal');
    ctx.db.introduction_proposal.proposal_id.delete(proposal_id);
  }
);
