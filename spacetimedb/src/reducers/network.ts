// Network (D045): profile details, friend-of-friend nudge requests, and acceptance linking the two as a pair.
import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { requireAccount } from '../guards';
import { newId } from '../ids';
import { blockedEitherWay, hex } from '../policy_state';
import { MAX_PENDING_NUDGE_REQUESTS, nameOf, nearbyCandidates, requestBetween } from '../network_state';

const MAX_BIO = 280;
const MAX_SHORT = 120;
const MAX_AREA = 64;
const MAX_TAGS = 12;
const MAX_TAG = 40;
const MAX_NUDGE_MESSAGE = 200;

function text(value: string, max: number, field: string): string {
  const v = value.trim();
  if (v.length > max) fail('invalid', `${field} too long`);
  return v;
}

function list(values: string[], maxItems: number, maxLen: number, field: string): string[] {
  if (values.length > maxItems) fail('invalid', `${field} too many`);
  const out = [...new Set(values.map(v => v.trim().toLowerCase()).filter(Boolean))];
  if (out.some(v => v.length > maxLen)) fail('invalid', `${field} entry too long`);
  return out;
}

/** Owner writes their own profile details. Replaces the whole row. */
export const set_profile_detail = spacetimedb.reducer(
  {
    bio: t.string(), home_area: t.string(), availability: t.string(), up_to: t.string(),
    interests: t.array(t.string()), answers: t.array(t.string()),
  },
  (ctx, a) => {
    requireAccount(ctx);
    if (a.answers.length > 0) fail('invalid', 'quiz answers are private');
    const row = {

      owner: ctx.sender,
      bio: text(a.bio, MAX_BIO, 'bio'),
      home_area: text(a.home_area, MAX_AREA, 'home_area').toLowerCase(),
      availability: text(a.availability, MAX_SHORT, 'availability'),
      up_to: text(a.up_to, MAX_SHORT, 'up_to'),
      interests: list(a.interests, MAX_TAGS, MAX_TAG, 'interests'),
      // Keep the legacy column empty; quiz answers are private local-vault data.
      answers: [],
      updated_at: ctx.timestamp,
    };
    if (ctx.db.profile_detail.owner.find(ctx.sender)) ctx.db.profile_detail.owner.update(row);
    else ctx.db.profile_detail.insert(row);
  }
);

function pendingOutgoing(ctx: Ctx): number {
  let n = 0;
  for (const r of ctx.db.nudge_request.sender.filter(ctx.sender)) if (r.status === 'pending') n++;
  return n;
}

/** Nudge someone a friend knows nearby. The candidate must be reachable and in the caller's area right now. */
export const send_nudge_request = spacetimedb.reducer(
  { candidate_ref: t.string(), message: t.string() },
  (ctx, { candidate_ref, message }) => {
    requireAccount(ctx);
    const c = nearbyCandidates(ctx.db, ctx.sender).find(x => x.publicationId === candidate_ref);
    if (!c) fail('not_found', 'candidate');
    const prior = requestBetween(ctx.db, ctx.sender, c.who);
    if (prior?.status === 'pending') fail('invalid', 'request already pending');
    if (prior?.status === 'declined' && prior.sender.isEqual(ctx.sender)) fail('not_found', 'candidate');
    if (pendingOutgoing(ctx) >= MAX_PENDING_NUDGE_REQUESTS) fail('rate_limited', 'too many pending requests');
    ctx.db.nudge_request.insert({
      request_id: newId(ctx), sender: ctx.sender, recipient: c.who, via: c.via, via_name: nameOf(ctx.db, c.via),
      hops: c.hops, shared_tags: c.sharedTags, message: text(message, MAX_NUDGE_MESSAGE, 'message'),
      status: 'pending', pair_id: undefined, created_at: ctx.timestamp, responded_at: undefined,
    });
  }
);

function linkPair(ctx: Ctx, a: Ctx['sender'], b: Ctx['sender']): string {
  for (const m of ctx.db.pair_member.member.filter(a)) {
    const p = ctx.db.pair.pair_id.find(m.pair_id);
    if (!p || p.status !== 'accepted' || !p.member_b) continue;
    if (p.member_a.isEqual(b) || p.member_b.isEqual(b)) return p.pair_id;
  }
  const pairId = newId(ctx);
  ctx.db.pair.insert({ pair_id: pairId, member_a: a, member_b: b, status: 'accepted', created_at: ctx.timestamp });
  for (const who of [a, b]) ctx.db.pair_member.insert({ key: `${pairId}:${hex(who)}`, pair_id: pairId, member: who });
  return pairId;
}

/** Recipient only, while pending. Accepting links both people as an accepted pair (nudges, plans, shelf). */
export const respond_nudge_request = spacetimedb.reducer(
  { request_id: t.string(), accept: t.bool() },
  (ctx, { request_id, accept }) => {
    requireAccount(ctx);
    const r = ctx.db.nudge_request.request_id.find(request_id);
    if (!r || !r.recipient.isEqual(ctx.sender)) fail('not_found', 'request');
    if (r.status !== 'pending') fail('invalid', 'request no longer pending');
    if (accept && (blockedEitherWay(ctx.db, r.sender, r.recipient) ||
      !nearbyCandidates(ctx.db, r.sender).some(c => c.who.isEqual(r.recipient)))) fail('not_found', 'request');
    const pairId = accept ? linkPair(ctx, r.sender, r.recipient) : undefined;
    ctx.db.nudge_request.request_id.update({
      ...r, status: accept ? 'accepted' : 'declined', pair_id: pairId, responded_at: ctx.timestamp,
    });
  }
);

/** Sender only, while pending. */
export const cancel_nudge_request = spacetimedb.reducer(
  { request_id: t.string() },
  (ctx, { request_id }) => {
    requireAccount(ctx);
    const r = ctx.db.nudge_request.request_id.find(request_id);
    if (!r || !r.sender.isEqual(ctx.sender)) fail('not_found', 'request');
    if (r.status !== 'pending') fail('invalid', 'request no longer pending');
    ctx.db.nudge_request.request_id.update({ ...r, status: 'cancelled', responded_at: ctx.timestamp });
  }
);
