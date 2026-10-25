// DS transition evaluation (README D045 DS Phases 0–3, 5 prep): Berkeley newcomer personas, the paired new-vs-reconnect
// scenario, source replay through CS's real normalizer, and a privacy scan of every evaluation output. Offline, synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validSlugAllowlist, guardPublicationDraft, DISCOVERY_AUDIENCES, DISCOVERY_NOTICE_VERSION } from '@dor/contracts/policy';
import { AREA_KEYS, DISCOVERY_TAGS } from '../../lib/discovery/config.ts';
import { TRANSITIONS } from '../../components/feature/transition-model.ts';
import { NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE } from '../../components/feature/decision-loop-model.ts';
import { REPORT_NOTICE, emptyState, reasonLines } from '../../features/discovery/view-model.ts';
import { rankDiscoveryCards } from '../../features/discovery/adapters.ts';
import { eligibleEvents, rankEventCompanions } from '../events.ts';
import { resolveCases } from '../decision-loop.ts';
import {
  buildWorld, discover, loadWorld, pubRef, renderTransition, scoreDiscovery, scorePaired, serverViews, type World,
} from '../transition.ts';
import { renderReplay, replayCatalogue, DEFAULT_DATASET } from '../source-replay.ts';

const json = async (u: string) => JSON.parse(await readFile(new URL(u, import.meta.url), 'utf8'));
const w = await loadWorld();
const now = w.now;
const results = (world: World) => world.file.discoveryCases.map(c => JSON.stringify(discover(world, c.viewer, c.mode)));
const dataset = await json('../fixtures/berkeley-luma.synthetic.json');

test('fixture: synthetic, real allowlists, device-local transitions, labels internally consistent', () => {
  assert.equal(w.file.clock, w.decisions.clock, 'same clock as decision-cases.json');
  const transitionIds = TRANSITIONS.map(t => t.id) as readonly string[];
  for (const [key, p] of Object.entries(w.file.people)) {
    assert.ok(AREA_KEYS.includes(p.areaKey), `${key}: area`);
    if (p.transition !== undefined) assert.ok(transitionIds.includes(p.transition), `${key}: transition`);
    if (!['mal', 'ben'].includes(key)) assert.ok(p.interestTags.every(t => DISCOVERY_TAGS.includes(t)), `${key}: tags`);
  }
  assert.equal(w.file.people.maya!.ownerId, w.decisions.ownerId, 'Maya is the decision-loop owner');
  for (const c of w.file.discoveryCases) {
    const suggested = c.expected.refs ?? c.expected.events?.flatMap(e => e.companions) ?? [];
    assert.deepEqual(suggested.filter(r => (c.expected.mustNotSuggest ?? []).includes(r)), [], c.id);
  }
  for (const p of w.file.pairedCases) {
    assert.ok(w.file.discoveryCases.some(c => c.id === p.discovery), p.id);
    assert.ok(w.decisions.cases.some(c => c.id === p.reconnect), p.id);
  }
  // Both outcome groups, every honest no-result reason the DS UI can show for nearby, and at least one event case.
  for (const reason of ['not_published', 'empty_area', 'no_fit', 'viewer_no_event_intent'])
    assert.ok(w.file.discoveryCases.some(c => c.expected.reason === reason), reason);
});

for (const c of w.file.discoveryCases) {
  test(`discovery ${c.id} [${c.group}] → ${c.expected.kind}`, () => {
    const s = scoreDiscovery(w, c);
    assert.deepEqual(s.falseMatches, [], 'false match');
    assert.ok(s.matches, `expected ${s.expected}, got ${s.got}`);
  });
}

for (const p of w.file.pairedCases) {
  test(`paired ${p.id}: new ${p.expected.new}, reconnect ${p.expected.reconnect}`, () => {
    const s = scorePaired(w, p);
    assert.ok(s.reconnectLabelMet, 'the referenced decision case still meets its own label');
    assert.equal(s.newStep, p.expected.new);
    assert.equal(s.reconnectStep, p.expected.reconnect);
  });
}

test('D046: transition tags are publishable only if ordinary and allowlisted; the current allowlist has none', () => {
  assert.equal(validSlugAllowlist(['starting-college', 'new-to-city', 'new-job', 'recent-grad'], 'tag'), true);
  for (const bad of ['grief-support', 'divorce-recovery', 'immigration-help', 'sober-living', 'new-diagnosis'])
    assert.equal(validSlugAllowlist([bad], 'tag'), false, bad);
  assert.equal(validSlugAllowlist(DISCOVERY_TAGS, 'tag'), true);
  const transitionLike = /college|city|job|grad|move|moving|new-/;
  assert.deepEqual(DISCOVERY_TAGS.filter(t => transitionLike.test(t)), [], 'transitions are not public tags today');
  // A sensitive tag cannot be published even if someone tries to allowlist it.
  const draft = { displayName: 'Mal', interestTags: ['board-games', 'grief-support'], audience: DISCOVERY_AUDIENCES[0],
    noticeVersion: DISCOVERY_NOTICE_VERSION, expiresAtMs: now.getTime() + 3_600_000 };
  assert.equal(guardPublicationDraft(draft, [...DISCOVERY_TAGS, 'grief-support'], now.getTime()).ok, false);
  assert.equal(w.parties.get('mal')!.refusal, 'tag_not_allowlisted');
  assert.equal(w.parties.get('ben')!.refusal, 'invalid_schema', 'a profile needs at least one interest');
});

test('pair coupling: an accepted pair only hides that person; positive control shows the friend without it', () => {
  const ref = pubRef('sam-home');
  assert.equal(serverViews(w, 'maya').cards.some(c => c.cardRef === ref), false);
  const noPairs = { ...w, connected: new Set<string>() };
  const r = discover(noPairs, 'maya', 'nearby');
  assert.equal(r.kind, 'shortlist');
  assert.ok(r.kind === 'shortlist' && r.refs.includes(ref), 'without the pair Sam would be suggested');
  // Others never see Sam's pair: for Jun, Sam is an ordinary visible card.
  assert.ok(serverViews(w, 'jun').cards.some(c => c.cardRef === ref));
});

test('noninterference: the private reconnect side never changes discovery output', async () => {
  const base = results(w);
  const raw = await json('../fixtures/decision-cases.json');
  const refl = await json('../../agents/fixtures/reflection.synthetic.json');
  const variants = [
    // Every story replaced, assessments dropped, steps cleared.
    { ...raw, cases: raw.cases.map((c: Record<string, unknown>) => ({ ...c, story: 'SYNTHETIC: a completely different private entry about a party.',
      assessment: null, steps: [] })) },
    // The owner pauses Sam and Alex (D041 never touches discovery).
    { ...raw, cases: raw.cases.map((c: Record<string, unknown>) => ({ ...c, pauses: ['p-sam', 'p-alex'].map(pairId =>
      ({ pairId, version: 1, expiresAt: '2026-10-25T06:00:00Z', active: true, createdAt: '2026-10-24T17:00:00Z' })) })) },
  ];
  for (const v of variants) assert.deepEqual(results(buildWorld(w.file, w.catalogue, resolveCases(v, refl))), base);
});

test('reverse direction: discovery never adds a reconnect recipient, and no suggestion is an existing tie', () => {
  const recipients = new Set(Object.values(w.decisions.people).map(p => p.recipientId));
  const owners = new Map(Object.entries(w.file.people).map(([k, p]) => [pubRef(k), p.ownerId]));
  for (const c of w.file.discoveryCases.filter(x => x.viewer === 'maya')) {
    const r = discover(w, c.viewer, c.mode);
    const refs = r.kind === 'shortlist' ? r.refs : r.kind === 'events' ? r.events.flatMap(e => e.companions) : [];
    for (const ref of refs) assert.equal(recipients.has(owners.get(ref)!), false, `${c.id}: ${ref}`);
  }
  for (const p of w.file.pairedCases) {
    const c = w.decisions.cases.find(x => x.id === p.reconnect)!;
    assert.ok(c.recipients.every(id => id in w.decisions.people), `${p.id}: recipients come only from the owner's pairs`);
  }
});

test('framing: no fixed copy on either path implies loneliness, failure or pressure to reconnect', () => {
  const copy = [
    ...Object.values(QUESTION_COPY), QUESTION_NOTE, ...Object.values(NO_ACTION_COPY), REPORT_NOTICE,
    ...(['not_published', 'viewer_has_nothing_published', 'viewer_no_event_intent', 'empty_area', 'no_fit'] as const)
      .flatMap(r => (['nearby', 'event'] as const).map(m => emptyState(r, m))).flatMap(e => [e.title, e.body]),
    ...reasonLines({ ref: 'x', reasons: ['shared_interest', 'same_event', 'event_fits_shared_interest'], sharedTags: ['coffee'], sharedEventId: 'e' }),
  ];
  const bad = /lonel|isolat|\balone\b|fail|drift|neglect|abandon|struggl|depress|\bsad\b|no friends|left out|too late|haven'?t talked|reach out before/i;
  assert.deepEqual(copy.filter(s => bad.test(s)), []);
});

test('defensive: projection bugs are rejected or withheld, never ranked', () => {
  const v = serverViews(w, 'maya');
  const viewer = { ...v.viewer, eventIntents: [] };
  const base = { viewer, mode: { kind: 'nearby' as const }, allowedTags: [...DISCOVERY_TAGS], now };
  const dup = rankDiscoveryCards({ ...base, rows: [...v.cards, v.cards[0]!] }).shortlist;
  assert.ok(dup.excluded.some(x => x.reason === 'duplicate'));
  const leaky = rankDiscoveryCards({ ...base, rows: v.cards.map((c, i) => (i === 0 ? { ...c, areaKey: 'berkeley-campus' } : c)) }).shortlist;
  assert.ok(leaky.excluded.some(x => x.ref === v.cards[0]!.cardRef && x.reason === 'invalid_card'));
  const bg1 = w.eventIds.get('evt-bg-1')!;
  const r = rankEventCompanions({ viewer: v.viewer, viewerAreaKey: v.areaKey, catalogue: w.catalogue.rows, myIntents: v.myIntents, cards: v.cards,
    companions: [...v.companions, { cardRef: pubRef('kai'), eventId: bg1 }, { cardRef: pubRef('jun'), eventId: bg1, kind: 'going' }],
    allowedTags: [...DISCOVERY_TAGS], now });
  assert.ok(r.withheld.some(x => x.cardRef === pubRef('kai') && x.reason === 'card_not_visible'), 'blocked person withheld');
  assert.ok(r.withheld.some(x => x.reason === 'invalid_companion'), 'leaked intent kind withheld');
  assert.equal(JSON.stringify(r).includes('"going"') && JSON.stringify(r.kind === 'events' ? r.events.map(e => e.companions) : []).includes('going'), false);
});

test('stale and cancelled events: old fetches age out; cancelled rows never reach the view', () => {
  const old = replayCatalogue({ ...dataset, _provenance: { ...dataset._provenance, fetchedAt: '2026-10-21T17:30:00Z' } }, now.getTime());
  const e = eligibleEvents(old.rows, 'berkeley-campus', [...DISCOVERY_TAGS], now);
  assert.deepEqual(e.eligible, []);
  assert.ok(e.excluded.every(x => x.reason === 'expired_source' || x.reason === 'wrong_area'));
  const ingestOutput = { provenance: { source: 'luma', sourceHost: 'lu.ma', fetchedAt: '2026-10-24T17:30:00Z' },
    events: [{ event_id: 'apify:cancelled0001', title: 'x', starts_at: '2026-10-28T02:00:00.000Z', ends_at: null, status: 'cancelled',
      fetched_at: '2026-10-24T17:30:00.000Z', topics: ['board-games'], format: 'in_person', area_key: 'berkeley-campus', source_url: null }] };
  const c = replayCatalogue(ingestOutput, now.getTime());
  assert.deepEqual(c.rows, []);
  assert.deepEqual(c.viewDropped, [{ eventId: 'apify:cancelled0001', reason: 'event_cancelled' }]);
  assert.equal(c.provenance.synthetic, false, 'ingest provenance without a synthetic flag is source-recorded');
});

test('source replay: exact normalizer drops, merged duplicate, and a report with no titles, URLs, hosts or guests', () => {
  const r = replayCatalogue(dataset, now.getTime());
  assert.equal(r.provenance.synthetic, true);
  assert.deepEqual(r.normalizerRejected.map(x => x.reason).sort(),
    ['already_started', 'instruction_like_title', 'outside_region', 'outside_window', 'unsafe_source_url']);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows.find(x => x.eventId === w.eventIds.get('evt-bg-1'))!.topics, ['board-games', 'hiking']);
  const md = renderReplay(r, now, 'fixtures/berkeley-luma.synthetic.json');
  assert.match(md, /SYNTHETIC/);
  for (const forbidden of ['Synthetic Guest', 'guest@example.test', 'Synthetic Host', 'synhost', 'luma.com/', 'board games night', 'Open mic'])
    assert.equal(md.includes(forbidden), false, forbidden);
  assert.equal(DEFAULT_DATASET.endsWith('berkeley-luma.synthetic.json'), true);
});

test('privacy scan: no story text, transition, display name or guest data in any evaluation output', async () => {
  const raw = await json('../fixtures/decision-cases.json');
  const refl = await json('../../agents/fixtures/reflection.synthetic.json');
  const stories = [...raw.cases.map((c: { story?: string }) => c.story).filter(Boolean), ...refl.cases.map((c: { input: string }) => c.input)];
  const fragments = [...new Set(stories.flatMap((s: string) => s.replace(/^SYNTHETIC:\s*/, '').split(/[.;,!?]/).map(x => x.trim())
    .filter(x => x.split(/\s+/).length >= 4)))];
  const transitions = TRANSITIONS.flatMap(t => [t.id, t.label]);
  const names = Object.values(w.file.people).map(p => p.displayName);
  // The README's own example sentence is quoted in core4.md as documentation; nothing else may appear.
  const allowed: Record<string, string[]> = { 'core4.md': ['but not Alex tonight'] };
  const generated = { 'transition.md': renderTransition(w), 'source-replay.md': renderReplay(replayCatalogue(dataset, now.getTime()), now, 'x') };
  const dir = new URL('../results/', import.meta.url);
  const files = (await readdir(dir)).filter(f => f.endsWith('.md'));
  const outputs: Record<string, string> = { ...Object.fromEntries(await Promise.all(files.map(async f => [f, await readFile(new URL(f, dir), 'utf8')] as const))), ...generated };
  for (const [file, text] of Object.entries(outputs)) {
    const hits = fragments.filter(f => text.includes(f) && !(allowed[file] ?? []).includes(f));
    assert.deepEqual(hits, [], `${file}: story text`);
    for (const g of ['Synthetic Guest', 'guest@example.test', 'Synthetic Host']) assert.equal(text.includes(g), false, `${file}: ${g}`);
  }
  for (const [file, text] of Object.entries(generated)) {
    assert.deepEqual(transitions.filter(t => new RegExp(`\\b${t}\\b`).test(text)), [], `${file}: transition`);
    assert.deepEqual(names.filter(n => text.includes(n)), [], `${file}: display name`);
  }
  // Rater sheets show synthetic entries to humans by design; they must say so.
  for (const f of ['rater-a.md', 'rater-b.md'])
    assert.match(await readFile(new URL(`ratings/${f}`, dir), 'utf8'), /Synthetic data only/);
});

test('results/transition.md and results/source-replay.md are current', async () => {
  assert.equal(await readFile(new URL('../results/transition.md', import.meta.url), 'utf8'), renderTransition(w));
  assert.equal(await readFile(new URL('../results/source-replay.md', import.meta.url), 'utf8'),
    renderReplay(replayCatalogue(dataset, now.getTime()), now, 'fixtures/berkeley-luma.synthetic.json'));
});
