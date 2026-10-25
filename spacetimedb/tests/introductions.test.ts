// PROPOSED C8 introductions, report, repeat-probe limits and AI-proposal commits (Cyber, CYBER-R2, D038):
// direct reducer and view calls with a third account. Synthetic names/tags only. In-process harness: no
// deployed isolation, real JWT mapping, real scheduler or browser evidence.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { inDays, jwtAuth, mod, setup, sweep, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_US = 3_600_000_000n;
const DAY_US = 24n * HOUR_US;

function world() {
  const w = setup();
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking', 'live-music'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus', 'oakland-downtown'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  return w;
}
const advance = (w: W, us: bigint) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + us));
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
const refOf = (w: W, who: Who) => mine(w, who).publication_id as string;
const revOf = (w: W, who: Who) => mine(w, who).revision as number;
function publish(w: W, who: Who, over: Record<string, unknown> = {}) {
  const expected_revision = mine(w, who)?.revision ?? 0;
  w.call(who, ctx => mod.publish_discovery_profile(ctx, {
    display_name: 'Synthetic', interest_tags: ['board-games', 'hiking'], audience: 'area_discoverers', notice_version: 1,
    expires_at: inDays(w, 7), expected_revision, ...over,
  } as Parameters<typeof mod.publish_discovery_profile>[1]));
}
const join = (w: W, who: Who, area = 'berkeley-campus') => w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: area }));
const participate = (w: W, who: Who, over?: Record<string, unknown>, area?: string) => { publish(w, who, over); join(w, who, area); };
const intros = (w: W, who: Who) => view<any>(w, who, mod.my_introductions);
const proposals = (w: W, who: Who) => view<any>(w, who, mod.my_introduction_proposals);
let seq = 0;
const reqId = () => `request-${String(++seq).padStart(4, '0')}`;
function ask(w: W, from: Who, to: Who, id = reqId()) {
  const card_ref = refOf(w, to);
  w.call(from, ctx => mod.send_introduction_request(ctx, { card_ref, client_request_id: id }));
  return id;
}
const incomingId = (w: W, who: Who) => intros(w, who).find(i => i.direction === 'incoming')!.intro_id as string;
const respond = (w: W, who: Who, intro_id: string, accept: boolean) =>
  w.call(who, ctx => mod.respond_introduction_request(ctx, { intro_id, accept }));
const rows = (w: W) => w.h.withReducerTx(w.admin, ctx => [...ctx.db.introduction.iter()]);
const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);

/** Alice and Bob published in the same area with overlapping tags; Carol is a published third account there too. */
function trio() {
  const w = world();
  participate(w, w.alice, { display_name: 'Alice S' });
  participate(w, w.bob, { display_name: 'Bob S', interest_tags: ['hiking', 'live-music'] });
  participate(w, w.carol, { display_name: 'Carol S' });
  return w;
}
function extraAccounts(w: W, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const who = jwtAuth(`extra-${i}`, 100n + BigInt(i));
    w.call(who, ctx => mod.register_account(ctx, { display_name: `Extra ${i}` }));
    participate(w, who);
    return who;
  });
}

describe('introduction requests: human-triggered, recipient alone accepts', () => {
  it('the recipient sees the sender\'s public name and published overlap; nothing else crosses', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const [incoming] = intros(w, w.bob);
    expect(Object.keys(incoming).sort()).toEqual(['counterpart_name', 'created_at', 'direction', 'expires_at', 'intro_id', 'shared_tags', 'status']);
    expect(incoming).toMatchObject({ direction: 'incoming', status: 'pending', counterpart_name: 'Alice S', shared_tags: ['hiking'] });
    const [outgoing] = intros(w, w.alice);
    expect(outgoing).toMatchObject({ direction: 'outgoing', status: 'pending' });
    expect(outgoing.counterpart_name).toBeUndefined(); // the recipient's name only after they accept
    expect(json([incoming, outgoing])).not.toMatch(/berkeley|identity|card|board-games/);
  });

  it('a third account sees none of it and cannot act on someone else\'s introduction (not_found)', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    expect(intros(w, w.carol)).toHaveLength(0);
    expect(() => respond(w, w.carol, id, true)).toThrow('not_found: introduction');
    expect(() => w.call(w.carol, ctx => mod.cancel_introduction_request(ctx, { intro_id: id }))).toThrow('not_found: introduction');
    expect(() => w.call(w.carol, ctx => mod.block_introduction_participant(ctx, { intro_id: id }))).toThrow('not_found: introduction');
    expect(() => w.call(w.carol, ctx => mod.report_discovery_user(ctx, { target_kind: 'introduction', target_ref: id, reason: 'spam' }))).toThrow('not_found: introduction');
    expect(rows(w)[0].status).toBe('pending');
  });

  it('only the recipient accepts or declines; only the sender cancels', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    expect(() => respond(w, w.alice, id, true)).toThrow('not_found: not_participant');
    expect(() => w.call(w.bob, ctx => mod.cancel_introduction_request(ctx, { intro_id: id }))).toThrow('not_found: not_participant');
    respond(w, w.bob, id, true);
    expect(intros(w, w.alice)[0]).toMatchObject({ status: 'accepted', counterpart_name: 'Bob S' });
    expect(intros(w, w.bob)[0]).toMatchObject({ status: 'accepted' });
    expect(() => respond(w, w.bob, id, false)).toThrow('stale: not_pending'); // replayed response cannot flip it
  });

  it('acceptance is an in-app connection only: no pair, preset, signal or support state is created', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    respond(w, w.bob, incomingId(w, w.bob), true);
    for (const who of [w.alice, w.bob]) {
      for (const v of [mod.my_pairs, mod.my_presets, mod.my_preset_assignments, mod.my_signals, mod.my_support_preferences, mod.my_nudges]) {
        expect(view(w, who, v)).toHaveLength(0);
      }
    }
  });

  it('requests need a card the sender can see now: other area, unpublished, self or a guessed ref are not_found', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob, undefined, 'oakland-downtown');
    publish(w, w.carol); // published but no area: a lurker cannot request either
    const bobRef = refOf(w, w.bob), aliceRef = refOf(w, w.alice);
    const send = (who: Who, card_ref: string) => () => w.call(who, ctx => mod.send_introduction_request(ctx, { card_ref, client_request_id: reqId() }));
    expect(send(w.alice, bobRef)).toThrow('not_found: card');
    expect(send(w.alice, aliceRef)).toThrow('not_found: card');
    expect(send(w.alice, 'guessed-ref')).toThrow('not_found: card');
    expect(send(w.carol, aliceRef)).toThrow('not_found: card');
    expect(() => w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'x' }))).toThrow('invalid: client_request_id');
  });
});

describe('no decline oracle, no re-ask pressure', () => {
  it('a decline reads as pending to the sender until it lapses; resending looks the same either way', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    ask(w, w.alice, w.carol);
    respond(w, w.bob, incomingId(w, w.bob), false); // bob declines, carol does not answer
    expect(intros(w, w.alice).map(i => i.status)).toEqual(['pending', 'pending']);
    const errOf = (to: Who) => { try { ask(w, w.alice, to); return 'sent'; } catch (e) { return (e as Error).message; } };
    expect(errOf(w.bob)).toBe(errOf(w.carol));
    expect(errOf(w.bob)).toMatch(/stale: already_requested$/);
    advance(w, 73n * HOUR_US); sweep(w);
    expect(intros(w, w.alice).map(i => i.status)).toEqual(['closed', 'closed']);
  });

  it('after a decline or a lapse the same sender waits out a cooldown; the other person can still ask', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    respond(w, w.bob, incomingId(w, w.bob), false);
    advance(w, 73n * HOUR_US); sweep(w);
    participate(w, w.alice); participate(w, w.bob); // renew area (24 h) to stay visible
    expect(() => ask(w, w.alice, w.bob)).toThrow('stale: already_requested');
    ask(w, w.bob, w.alice); // a decline only limits the person who asked
    expect(intros(w, w.alice).some(i => i.direction === 'incoming' && i.status === 'pending')).toBe(true);
  });
});

describe('relationship state is checked in both directions', () => {
  it('a request the other person already sent blocks a crossing request; their accepted request counts as connected', () => {
    const w = trio();
    ask(w, w.bob, w.alice); // bob → alice pending
    expect(() => ask(w, w.alice, w.bob)).toThrow('stale: already_requested');
    respond(w, w.alice, incomingId(w, w.alice), true);
    expect(() => ask(w, w.alice, w.bob)).toThrow('stale: already_connected');
    expect(() => ask(w, w.bob, w.alice)).toThrow('stale: already_connected');
  });
});

describe('replay and idempotency', () => {
  it('replaying a request is a no-op, even after a decline; reusing its id for someone else is refused', () => {
    const w = trio();
    const id = ask(w, w.alice, w.bob);
    ask(w, w.alice, w.bob, id);
    expect(rows(w)).toHaveLength(1);
    respond(w, w.bob, incomingId(w, w.bob), false);
    ask(w, w.alice, w.bob, id); // cannot revive the declined request
    expect(rows(w)).toHaveLength(1);
    expect(rows(w)[0].status).toBe('declined');
    expect(() => ask(w, w.alice, w.carol, id)).toThrow('invalid: request_id_reused');
  });

  it('an expired request cannot be accepted, before or after the sweep', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    advance(w, 72n * HOUR_US);
    expect(() => respond(w, w.bob, id, true)).toThrow('stale: expired');
    sweep(w);
    expect(intros(w, w.bob)[0].status).toBe('closed');
    expect(() => respond(w, w.bob, id, true)).toThrow('stale: not_pending');
  });
});

describe('withdrawal, profile edits and blocks take effect on introductions immediately', () => {
  it('sender withdraws while pending: the request disappears for the recipient and cannot be accepted', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    w.call(w.alice, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(intros(w, w.bob).filter(i => i.status === 'pending')).toHaveLength(0);
    expect(() => respond(w, w.bob, id, true)).toThrow('stale: not_pending');
  });

  it('recipient withdraws while pending: the sender only ever sees "closed"', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    w.call(w.bob, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(intros(w, w.alice)[0].status).toBe('closed');
  });

  it('a sender profile edit stales the pending request (the recipient never accepts a profile they were not shown)', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    publish(w, w.alice, { display_name: 'Someone Else' });
    expect(intros(w, w.bob).filter(i => i.status === 'pending')).toHaveLength(0);
    expect(() => respond(w, w.bob, id, true)).toThrow('stale: not_pending');
    ask(w, w.alice, w.bob); // a fresh request from the new revision is allowed
    expect(intros(w, w.bob).find(i => i.status === 'pending')!.counterpart_name).toBe('Someone Else');
  });

  it('accepting rechecks a race-free current state: a block between request and accept refuses it', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    const bobRef = refOf(w, w.bob);
    w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
    expect(intros(w, w.bob)).toHaveLength(0);
    expect(intros(w, w.alice)).toHaveLength(0);
    expect(() => respond(w, w.bob, id, true)).toThrow('stale: not_pending');
  });

  it('the recipient can block the sender straight from the request; an accepted introduction ends on block', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const fromAlice = incomingId(w, w.bob); // views: outside the tx
    w.call(w.bob, ctx => mod.block_introduction_participant(ctx, { intro_id: fromAlice }));
    expect(intros(w, w.bob)).toHaveLength(0);
    expect(view<any>(w, w.alice, mod.discovery_cards).map(c => c.display_name)).toEqual(['Carol S']);
    ask(w, w.alice, w.carol);
    const carolId = incomingId(w, w.carol);
    respond(w, w.carol, carolId, true);
    w.call(w.alice, ctx => mod.block_introduction_participant(ctx, { intro_id: carolId }));
    expect(intros(w, w.carol)).toHaveLength(0);
    expect(rows(w).find(r => r.intro_id === carolId)!.status).toBe('ended');
  });
});

describe('report', () => {
  it('a report is a coarse reason, private to moderation, and also blocks; the target is never told', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    const id = incomingId(w, w.bob);
    expect(() => w.call(w.bob, ctx => mod.report_discovery_user(ctx, { target_kind: 'introduction', target_ref: id, reason: 'Alice texted me at 555-0100' }))).toThrow('invalid: reason');
    expect(() => w.call(w.bob, ctx => mod.report_discovery_user(ctx, { target_kind: 'pair', target_ref: id, reason: 'spam' }))).toThrow('invalid: target_kind');
    w.call(w.bob, ctx => mod.report_discovery_user(ctx, { target_kind: 'introduction', target_ref: id, reason: 'harassment' }));
    const reports = w.h.withReducerTx(w.admin, ctx => [...ctx.db.discovery_report.iter()]);
    expect(reports).toHaveLength(1);
    expect(Object.keys(reports[0]).sort()).toEqual(['created_at', 'reason', 'report_id', 'reporter', 'target'].sort());
    expect(intros(w, w.alice)).toHaveLength(0);
    expect(view<any>(w, w.alice, mod.discovery_cards).map(c => c.display_name)).toEqual(['Carol S']);
    expect(json([mine(w, w.alice), intros(w, w.alice)])).not.toMatch(/report|harass|block/i);
  });

  it('reporting by card needs a visible card; no exported view reads reports, blocks or rate windows', () => {
    const w = trio();
    const carolRef = refOf(w, w.carol);
    w.call(w.alice, ctx => mod.report_discovery_user(ctx, { target_kind: 'card', target_ref: carolRef, reason: 'spam' }));
    expect(() => w.call(w.alice, ctx => mod.report_discovery_user(ctx, { target_kind: 'card', target_ref: carolRef, reason: 'spam' }))).toThrow('not_found: card');
    const exported = Object.keys(mod);
    expect(exported.filter(k => /report|rate_window|discovery_block/.test(k) && !/^report_discovery_user$/.test(k))).toEqual([]);
  });
});

describe('repeat-probe and spam limits (per caller, successful actions)', () => {
  it('at most five pending outgoing requests at once', () => {
    const w = trio();
    const others = extraAccounts(w, 5);
    for (const o of others) ask(w, w.alice, o);
    expect(() => ask(w, w.alice, w.bob)).toThrow('rate_limited: pending_limit');
  });

  it('at most ten requests a day, even when each is cancelled straight away; the window resets', () => {
    const w = trio();
    for (let i = 0; i < 10; i++) {
      ask(w, w.alice, w.bob);
      const id = intros(w, w.alice).find(x => x.status === 'pending')!.intro_id;
      w.call(w.alice, ctx => mod.cancel_introduction_request(ctx, { intro_id: id }));
    }
    expect(() => ask(w, w.alice, w.bob)).toThrow('rate_limited: introduction_request');
    advance(w, DAY_US); sweep(w);
    join(w, w.alice); join(w, w.bob);
    ask(w, w.alice, w.bob);
  });

  it('area hopping to map who is where is bounded to four changes a day', () => {
    const w = world();
    publish(w, w.alice);
    for (let i = 0; i < 4; i++) join(w, w.alice, i % 2 ? 'berkeley-campus' : 'oakland-downtown');
    expect(() => join(w, w.alice)).toThrow('rate_limited: area_change');
  });

  it('blocks and reports are bounded per day', () => {
    const w = world();
    participate(w, w.alice);
    const others = extraAccounts(w, 21);
    for (const o of others.slice(0, 20)) { const ref = refOf(w, o); w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: ref })); }
    const last = refOf(w, others[20]!);
    expect(() => w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: last }))).toThrow('rate_limited: block');
  });

  it('limits are per caller: one person hitting a limit does not affect another', () => {
    const w = world();
    publish(w, w.alice); publish(w, w.bob);
    for (let i = 0; i < 4; i++) join(w, w.alice);
    expect(() => join(w, w.alice)).toThrow('rate_limited: area_change');
    join(w, w.bob);
  });
});

describe('AI introduction proposals: worker commit is the authority, model output is not', () => {
  function withWorker() {
    const w = trio();
    const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
    const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
    w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
    return { w, worker };
  }
  const args = (w: W, over: Record<string, unknown> = {}) => ({
    proposal_id: 'proposal-0001', viewer_ref: refOf(w, w.alice), candidate_ref: refOf(w, w.bob),
    viewer_publication_version: revOf(w, w.alice), candidate_publication_version: revOf(w, w.bob),
    reason_code: 'shared_interest', shared_tags: ['hiking'], event_id: undefined, opener_id: 'suggest_shared_interest',
    decided_by: 'deterministic', expires_at: inDays(w, 2), ...over,
  } as Parameters<typeof mod.commit_introduction_proposal>[1]);
  const commit = (w: W, who: Who, a: ReturnType<typeof args>) => w.call(who, ctx => mod.commit_introduction_proposal(ctx, a));

  it('only the allow-listed worker commits; the viewer alone sees it, capped to 24 h; the candidate learns nothing', () => {
    const { w, worker } = withWorker();
    const a = args(w);
    expect(() => commit(w, w.alice, a)).toThrow('unauthorized: worker only');
    commit(w, worker, a);
    const [p] = proposals(w, w.alice);
    expect(Object.keys(p).sort()).toEqual(['candidate_ref', 'decided_by', 'expires_at', 'opener_id', 'proposal_id', 'reason_code', 'shared_tags']);
    expect(p.expires_at.microsSinceUnixEpoch - w.h.clock.now().microsSinceUnixEpoch).toBeLessThanOrEqual(DAY_US);
    expect(proposals(w, w.bob)).toHaveLength(0);
    expect(intros(w, w.bob)).toHaveLength(0);
    commit(w, worker, a); // idempotent replay
    expect(() => commit(w, worker, { ...a, shared_tags: ['board-games'] })).toThrow('invalid: proposal_id reused');
  });

  it('withdrawal, block, area change or a profile edit during generation refuses the commit', () => {
    const cases: [string, (w: W) => void, string][] = [
      ['candidate withdraws', w => w.call(w.bob, ctx => mod.withdraw_discovery_profile(ctx, {})), 'unauthorized: withdrawn'],
      ['viewer blocks', w => { const r = refOf(w, w.bob); w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: r })); }, 'not_found: blocked'],
      ['candidate moves area', w => join(w, w.bob, 'oakland-downtown'), 'not_found: area_mismatch'],
      ['candidate edits profile', w => publish(w, w.bob, { interest_tags: ['hiking', 'live-music', 'board-games'] }), 'stale: stale_revision'],
    ];
    for (const [, race, error] of cases) {
      const { w, worker } = withWorker();
      const a = args(w); // what the worker read before generation
      race(w);
      expect(() => commit(w, worker, a)).toThrow(error);
      expect(proposals(w, w.alice)).toHaveLength(0);
    }
  });

  it('a model cannot widen the proposal: unshared tags, same_event, free openers and unknown deciders are refused', () => {
    const { w, worker } = withWorker();
    for (const over of [
      { shared_tags: ['board-games'] }, { shared_tags: ['hiking', 'hiking'] }, { shared_tags: [] },
      { reason_code: 'same_event', opener_id: 'suggest_event_together', event_id: 'event-1' },
      { opener_id: 'Hey Bob, Alice likes you!' }, { decided_by: 'gpt' }, { expires_at: inDays(w, -1) },
    ]) {
      expect(() => commit(w, worker, args(w, over))).toThrow(/^invalid:/);
    }
  });

  it('a committed proposal disappears when the candidate withdraws or edits, and on expiry; already asked means no proposal', () => {
    const { w, worker } = withWorker();
    commit(w, worker, args(w));
    publish(w, w.bob, { display_name: 'Bob Edited' });
    expect(proposals(w, w.alice)).toHaveLength(0);
    commit(w, worker, args(w, { proposal_id: 'proposal-0002' }));
    advance(w, DAY_US); sweep(w);
    expect(w.h.withReducerTx(w.admin, ctx => [...ctx.db.introduction_proposal.iter()])).toHaveLength(0);
    join(w, w.alice); join(w, w.bob);
    ask(w, w.alice, w.bob);
    expect(() => commit(w, worker, args(w, { proposal_id: 'proposal-0003' }))).toThrow('stale: already_connected');
  });

  it('defence in depth: views recheck revisions themselves even if a future reducer forgets a cascade', () => {
    const { w, worker } = withWorker();
    commit(w, worker, args(w));
    ask(w, w.carol, w.alice);
    // Bump publication revisions directly (no stalePublicationDependents), as a buggy writer would.
    w.h.withReducerTx(w.admin, ctx => {
      for (const p of [...ctx.db.discovery_publication.iter()]) ctx.db.discovery_publication.publication_id.update({ ...p, revision: p.revision + 1 });
    });
    expect(proposals(w, w.alice)).toHaveLength(0);
    expect(intros(w, w.alice).filter(i => i.direction === 'incoming')).toHaveLength(0);
  });

  it('the viewer can dismiss; nobody else can', () => {
    const { w, worker } = withWorker();
    commit(w, worker, args(w));
    expect(() => w.call(w.bob, ctx => mod.dismiss_introduction_proposal(ctx, { proposal_id: 'proposal-0001' }))).toThrow('not_found: proposal');
    w.call(w.alice, ctx => mod.dismiss_introduction_proposal(ctx, { proposal_id: 'proposal-0001' }));
    expect(proposals(w, w.alice)).toHaveLength(0);
  });
});

describe('strangers never reach private state through discovery or introductions', () => {
  it('a third account in the same area sees only card projections; area keys, identities and private rows never appear', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    respond(w, w.bob, incomingId(w, w.bob), true);
    expect(intros(w, w.carol)).toHaveLength(0);
    expect(proposals(w, w.carol)).toHaveLength(0);
    const cards = view<any>(w, w.carol, mod.discovery_cards);
    expect(cards.every(c => Object.keys(c).sort().join() === 'card_ref,display_name,interest_tags,revision,shared_tags')).toBe(true);
    expect(json(cards)).not.toMatch(/berkeley|identity|accepted|intro/);
    for (const v of [mod.worker_signal_context, mod.worker_delivery, mod.worker_support_preferences]) {
      expect(view(w, w.carol, v)).toHaveLength(0);
    }
  });

  it('with discovery switched off, requests stop but decline, cancel, block and report still work', () => {
    const w = trio();
    ask(w, w.alice, w.bob);
    ask(w, w.carol, w.bob);
    w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['false'] }));
    expect(() => ask(w, w.alice, w.carol)).toThrow('unavailable: disabled');
    const [fromAlice, fromCarol] = rows(w).map(r => r.intro_id);
    expect(() => respond(w, w.bob, fromAlice!, true)).toThrow('unavailable: disabled');
    respond(w, w.bob, fromAlice!, false);
    w.call(w.bob, ctx => mod.block_introduction_participant(ctx, { intro_id: fromCarol! }));
  });
});
