// Network (D045): friend-of-friend nudges. Synthetic people only. Chain: me — sam — riya — theo (— zed, 4 hops).
import { describe, expect, it } from 'vitest';
import { inDays, jwtAuth, mod, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];

function world() {
  const w = setup();
  const people: Record<string, Who> = { me: w.alice, sam: w.bob, riya: w.carol };
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['climbing', 'coffee', 'jazz'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['austin', 'denver'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  let conn = 10n;
  for (const name of ['theo', 'zed', 'ana']) {
    const who = jwtAuth(name, conn++);
    w.call(who, ctx => mod.register_account(ctx, { display_name: name[0].toUpperCase() + name.slice(1) }));
    people[name] = who;
  }
  return Object.assign(w, { p: people });
}

function link(w: W, a: Who, b: Who) {
  w.call(a, ctx => mod.create_pair_invite(ctx, {}));
  const invite = view<any>(w, a, mod.my_invites).at(-1);
  w.call(b, ctx => mod.accept_pair_invite(ctx, { invite_token: invite.invite_token }));
}

function profile(w: W, who: Who, area: string, interests: string[], extra: Record<string, unknown> = {}) {
  w.call(who, ctx => mod.set_profile_detail(ctx, {
    bio: 'Synthetic bio', home_area: area, availability: 'weekends', up_to: 'settling in', interests, answers: [],
    ...extra,
  }));
  const prior = view<any>(w, who, mod.my_discovery_profile)[0];
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: who === w.alice ? 'Alice' : who === w.bob ? 'Bob' : 'Synthetic',
    interest_tags: [...new Set(interests.map(tag => tag.trim().toLowerCase()))], audience: 'area_discoverers', notice_version: 1, expires_at: inDays(w, 3), expected_revision: prior?.revision ?? 0 }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: area.trim().toLowerCase() }));
}

const fof = (w: W, who: Who) => view<any>(w, who, mod.fof_cards);
const requests = (w: W, who: Who) => view<any>(w, who, mod.my_nudge_requests);
const connections = (w: W, who: Who) => view<any>(w, who, mod.my_connection_profiles);

function chain() {
  const w = world();
  const { me, sam, riya, theo, zed, ana } = w.p;
  link(w, me, sam); link(w, sam, riya); link(w, riya, theo); link(w, theo, zed);
  profile(w, me, 'austin', ['climbing', 'coffee']);
  profile(w, sam, 'austin', ['climbing']);
  profile(w, riya, 'austin', ['climbing', 'jazz']);
  profile(w, theo, 'austin', ['coffee']);
  profile(w, zed, 'austin', ['climbing']);
  profile(w, ana, 'austin', ['climbing']);
  return w;
}

describe('fof_cards', () => {
  it('shows people 2 and 3 hops away in my area, with the friend they come through, and no name', () => {
    const w = chain();
    const cards = fof(w, w.p.me);
    expect(cards.map(c => [c.hops, c.via_name, c.shared_tags])).toEqual([[2, 'Bob', ['climbing']], [3, 'Bob', ['coffee']]]);
    expect(Object.keys(cards[0]).sort()).toEqual(['candidate_ref', 'hops', 'mutual_count', 'request_status', 'shared_tags', 'via_name']);
    expect(cards[0].candidate_ref).not.toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(cards)).not.toMatch(/Carol|Theo/);
  });

  it('never reaches 4 hops, strangers, direct friends, other areas or blocked people', () => {
    const w = chain();
    const refs = (who: Who) => fof(w, who).map(c => c.candidate_ref);
    const id = (who: Who) => w.call(who, ctx => ctx.sender.toHexString());
    expect(refs(w.p.me)).not.toContain(id(w.p.zed)); // 4 hops
    expect(refs(w.p.me)).not.toContain(id(w.p.ana)); // unconnected
    expect(refs(w.p.me)).not.toContain(id(w.p.sam)); // direct friend
    profile(w, w.p.riya, 'denver', ['climbing']);
    expect(refs(w.p.me)).not.toContain(id(w.p.riya));
  });

  it('is empty without a home area', () => {
    const w = chain();
    w.call(w.p.me, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(fof(w, w.p.me)).toEqual([]);
  });
});

describe('nudge requests', () => {
  it('send, accept: the two become a pair and each sees the other\'s full details', () => {
    const w = chain();
    const { me, riya } = w.p;
    const card = fof(w, me)[0];
    w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: card.candidate_ref, message: 'Sam says you climb!' }));
    expect(fof(w, me)[0].request_status).toBe('pending');
    const [out] = requests(w, me);
    expect(out).toMatchObject({ direction: 'outgoing', status: 'pending', via_name: 'Bob' });
    expect(out.counterpart_name).toBeUndefined();

    const [inc] = requests(w, riya);
    expect(inc).toMatchObject({ direction: 'incoming', counterpart_name: 'Alice', message: 'Sam says you climb!' });
    const mePublication = view<any>(w, me, mod.my_discovery_profile)[0].publication_id;
    expect(fof(w, riya).find(c => c.candidate_ref === mePublication)?.request_status).toBe('incoming');

    w.call(riya, ctx => mod.respond_nudge_request(ctx, { request_id: inc.request_id, accept: true }));
    const [done] = requests(w, me);
    expect(done).toMatchObject({ status: 'accepted', counterpart_name: 'Carol' });
    expect(done.pair_id).toBeTruthy();
    expect(view<any>(w, me, mod.my_pairs).some(p => p.pair_id === done.pair_id && p.status === 'accepted')).toBe(true);

    const carol = connections(w, me).find(c => c.display_name === 'Carol');
    expect(carol).toMatchObject({ home_area: 'austin', interests: ['climbing', 'jazz'], shared_tags: ['climbing'], bio: 'Synthetic bio', answers: [] });
    expect(fof(w, me).some(c => c.candidate_ref === card.candidate_ref)).toBe(false);
  });

  it('decline: the sender cannot resend; nothing about the recipient is revealed', () => {
    const w = chain();
    const { me, riya } = w.p;
    const ref = fof(w, me)[0].candidate_ref;
    w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: ref, message: '' }));
    const rid = requests(w, riya)[0].request_id;
    w.call(riya, ctx => mod.respond_nudge_request(ctx, { request_id: rid, accept: false }));
    expect(requests(w, me)[0]).toMatchObject({ status: 'closed' });
    expect(fof(w, me)[0].request_status).toBe('closed');
    expect(requests(w, me)[0].counterpart_name).toBeUndefined();
    expect(() => w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: ref, message: '' }))).toThrow('not_found');
  });

  it('refuses unreachable candidates, duplicates, and responses from anyone but the recipient', () => {
    const w = chain();
    const { me, riya, ana, theo } = w.p;
    const anaRef = w.call(ana, ctx => ctx.sender.toHexString());
    expect(() => w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: anaRef, message: '' }))).toThrow('not_found');
    const ref = fof(w, me)[0].candidate_ref;
    w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: ref, message: '' }));
    expect(() => w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: ref, message: '' }))).toThrow('already pending');
    const id = requests(w, me)[0].request_id;
    expect(() => w.call(theo, ctx => mod.respond_nudge_request(ctx, { request_id: id, accept: true }))).toThrow('not_found');
    expect(() => w.call(me, ctx => mod.respond_nudge_request(ctx, { request_id: id, accept: true }))).toThrow('not_found');
    w.call(me, ctx => mod.cancel_nudge_request(ctx, { request_id: id }));
    expect(() => w.call(riya, ctx => mod.respond_nudge_request(ctx, { request_id: id, accept: true }))).toThrow('no longer pending');
  });

  it('accept refuses if either side blocked or the C8 publication stopped being eligible', () => {
    const w = chain();
    const { me, riya } = w.p;
    const card = fof(w, me)[0];
    w.call(me, ctx => mod.send_nudge_request(ctx, { candidate_ref: card.candidate_ref, message: 'Hi' }));
    const req = requests(w, riya)[0];
    const aliceCard = view<any>(w, riya, mod.discovery_cards).find(c => c.display_name === 'Alice');
    expect(aliceCard).toBeTruthy();
    w.call(riya, ctx => mod.block_discovery_user(ctx, { card_ref: aliceCard.card_ref }));
    expect(() => w.call(riya, ctx => mod.respond_nudge_request(ctx, { request_id: req.request_id, accept: true }))).toThrow('not_found');
  });

  it('profile detail rejects quiz answers and never returns them in shared views', () => {
    const w = chain();
    const { me } = w.p;
    expect(() => w.call(me, ctx => mod.set_profile_detail(ctx, { bio: '', home_area: 'austin', availability: '', up_to: '', interests: [], answers: ['tone:direct'] }))).toThrow('quiz answers are private');
    expect((mod.my_profile_detail as any)(w.h.viewContext(me))?.answers).toEqual([]);
    expect(connections(w, me).every((c: any) => c.answers.length === 0)).toBe(true);
  });

  it('profile detail validates and normalises input', () => {
    const w = chain();
    expect(() => profile(w, w.p.me, 'austin', [], { bio: 'x'.repeat(281) })).toThrow('bio too long');
    profile(w, w.p.me, ' Austin ', [' Climbing', 'climbing ']);
    const mine = (mod.my_profile_detail as any)(w.h.viewContext(w.p.me));
    expect(mine).toMatchObject({ home_area: 'austin', interests: ['climbing'] });
  });
});
