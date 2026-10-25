// Network (D045) views. Each filters by ctx.sender. A candidate is identified by an opaque ref; their name and
// details appear only once a nudge request between the two has been accepted.
import { t } from 'spacetimedb/server';
import { spacetimedb } from './schema';
import { blockedEitherWay, hex } from './policy_state';
import { FOF_CARD_LIMIT, areaOf, friendsOf, interestsOf, nameOf, nearbyCandidates, requestBetween } from './network_state';

const profileDetailRow = t.row('ProfileDetailRow', {
  bio: t.string(),
  home_area: t.string(),
  availability: t.string(),
  up_to: t.string(),
  interests: t.array(t.string()),
  answers: t.array(t.string()),
  updated_at: t.timestamp(),
});

const fofCardRow = t.row('FofCardRow', {
  candidate_ref: t.string(),
  via_name: t.string(),
  hops: t.u32(),
  mutual_count: t.u32(),
  shared_tags: t.array(t.string()),
  request_status: t.string(), // none | pending (outgoing) | incoming | closed (terminal; no decline oracle)
});

const nudgeRequestRow = t.row('NudgeRequestRow', {
  request_id: t.string(),
  direction: t.string(), // incoming | outgoing
  status: t.string(),
  counterpart_name: t.option(t.string()),
  via_name: t.string(),
  hops: t.u32(),
  shared_tags: t.array(t.string()),
  message: t.string(),
  pair_id: t.option(t.string()),
  created_at: t.timestamp(),
});

const connectionProfileRow = t.row('ConnectionProfileRow', {
  counterpart_ref: t.string(),
  display_name: t.string(),
  bio: t.string(),
  home_area: t.string(),
  availability: t.string(),
  up_to: t.string(),
  interests: t.array(t.string()),
  answers: t.array(t.string()),
  shared_tags: t.array(t.string()),
});

export const my_profile_detail = spacetimedb.view(
  { name: 'my_profile_detail', public: true }, t.option(profileDetailRow),
  ctx => {
    const d = ctx.db.profile_detail.owner.find(ctx.sender);
    if (!d) return undefined;
    return {
      bio: d.bio, home_area: d.home_area, availability: d.availability, up_to: d.up_to,
      interests: d.interests, answers: [], updated_at: d.updated_at,
    };
  }
);

/** "Someone Sam knows is nearby": reachable people in the caller's area, no name until a request is accepted. */
export const fof_cards = spacetimedb.view(
  { name: 'fof_cards', public: true }, t.array(fofCardRow),
  ctx => {
    if (!ctx.db.account.identity.find(ctx.sender)) return [];
    const out = [];
    for (const c of nearbyCandidates(ctx.db, ctx.sender)) {
      const r = requestBetween(ctx.db, ctx.sender, c.who);
      if (r?.status === 'accepted') continue; // now a direct friend
      const status = !r || (r.status === 'cancelled' && r.sender.isEqual(ctx.sender)) ? 'none'
        : r.status === 'pending' ? (r.sender.isEqual(ctx.sender) ? 'pending' : 'incoming')
        : 'closed';
      out.push({
        candidate_ref: c.publicationId, via_name: nameOf(ctx.db, c.via), hops: c.hops, mutual_count: c.mutualCount,
        shared_tags: c.sharedTags, request_status: status,
      });
      if (out.length >= FOF_CARD_LIMIT) break;
    }
    return out;
  }
);

export const my_nudge_requests = spacetimedb.view(
  { name: 'my_nudge_requests', public: true }, t.array(nudgeRequestRow),
  ctx => {
    const rows = [...ctx.db.nudge_request.sender.filter(ctx.sender), ...ctx.db.nudge_request.recipient.filter(ctx.sender)]
      .filter(r => !blockedEitherWay(ctx.db, r.sender, r.recipient));
    return rows.map(r => {
      const incoming = r.recipient.isEqual(ctx.sender);
      const other = incoming ? r.sender : r.recipient;
      return {
        request_id: r.request_id, direction: incoming ? 'incoming' : 'outgoing',
        status: !incoming && (r.status === 'declined' || r.status === 'cancelled') ? 'closed' : r.status,
        counterpart_name: incoming || r.status === 'accepted' ? nameOf(ctx.db, other) : undefined,
        via_name: r.via_name, hops: r.hops, shared_tags: r.shared_tags, message: r.message,
        pair_id: r.pair_id ?? undefined, created_at: r.created_at,
      };
    });
  }
);

/** Full details of everyone the caller is directly linked with. */
export const my_connection_profiles = spacetimedb.view(
  { name: 'my_connection_profiles', public: true }, t.array(connectionProfileRow),
  ctx => {
    if (!ctx.db.account.identity.find(ctx.sender)) return [];
    const mine = interestsOf(ctx.db, ctx.sender);
    return friendsOf(ctx.db, ctx.sender).map(f => {
      const d = ctx.db.profile_detail.owner.find(f);
      const interests = interestsOf(ctx.db, f);
      return {
        counterpart_ref: hex(f), display_name: nameOf(ctx.db, f),
        bio: d?.bio ?? '', home_area: areaOf(ctx.db, f), availability: d?.availability ?? '', up_to: d?.up_to ?? '',
        interests, answers: [], shared_tags: interests.filter(x => mine.includes(x)),
      };
    });
  }
);
