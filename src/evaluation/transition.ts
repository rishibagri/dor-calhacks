// DS transition evaluation (README D045 DS Phases 0–3, 5 prep). Berkeley newcomer personas through the real discovery
// path, and a paired "meet someone new" vs "reconnect with an existing tie" comparison. Pure core plus a small CLI.
//
// Server state is a DS stand-in, not the module: it applies Cyber's real guards from `@dor/contracts/policy`
// (guardPublicationDraft, guardDiscoveryVisibility, projectDiscoveryCard, guardEventIntent) to the fixture people and
// hides accepted pairs (the module's connectedCounterparts), producing `discovery_cards`, `my_event_intents` and
// `event_companions` rows. Ranking is the shipped DS code exactly as CS calls it (`rankDiscoveryCards` with
// `eventIntents: []` for nearby; `rankEventCompanions` for events). The catalogue comes from source-replay.ts (CS's real
// normalizer). Reconnect episodes are existing decision-cases.json cases, by reference, through `replay`.
//
// The persona `transition` is device-local (CS transition-model.ts) and is never read here except to prove it never
// reaches an output.
//
//   node src/evaluation/transition.ts [--write | --check]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DISCOVERY_AUDIENCES, DISCOVERY_NOTICE_VERSION, guardDiscoveryVisibility, guardEventIntent, guardPublicationDraft, projectDiscoveryCard,
  type DiscoveryCardProjection, type DiscoveryParty, type PublicationState,
} from '@dor/contracts/policy';
import { eventIdFor } from '../server/discovery/normalize.ts';
import { DISCOVERY_TAGS } from '../lib/discovery/config.ts';
import { rankDiscoveryCards } from '../features/discovery/adapters.ts';
import type { DiscoveryShortlist } from '../features/discovery/types.ts';
import { rankEventCompanions, type CatalogueEventRow, type EventCompanionRow, type EventShortlist, type MyEventIntentRow } from './events.ts';
import { replay, resolveCases, scoreCase, type DecisionFile } from './decision-loop.ts';
import { replayCatalogue, type CatalogueReplay } from './source-replay.ts';
import type { Outcome } from '../components/feature/decision-loop-model.ts';

export interface Person {
  ownerId: string; displayName: string; interestTags: string[]; areaKey: string;
  /** Device-local only. Never published, ranked or output. */
  transition?: string;
  publication: 'active' | 'withdrawn' | 'expired' | 'none';
  intents: { event: string; kind: 'interested' | 'going' }[];
}
export interface DiscoveryCase {
  id: string; group: 'positive' | 'no-action'; viewer: string; mode: 'nearby' | 'events'; description: string;
  expected: { kind: 'shortlist' | 'events' | 'none'; refs?: string[]; relevant?: string[]; reason?: string;
    events?: { event: string; companions: string[] }[]; mustNotSuggest?: string[] };
}
export interface PairedCase {
  id: string; discovery: string; reconnect: string; description: string;
  expected: { new: NextStep; reconnect: NextStep };
}
export type NextStep = 'introduce' | 'preview' | 'clarify' | 'none';
export interface NewcomerFile {
  clock: string; dataset: string; people: Record<string, Person>; blocks: [string, string][];
  discoveryCases: DiscoveryCase[]; pairedCases: PairedCase[];
}

const HOUR = 3_600_000;
export const pubRef = (key: string) => `pub-${key}`;

/** Server-side stand-in for one person: publication (or refusal), area, and party for the visibility guard. */
interface Party { key: string; person: Person; party: DiscoveryParty; refusal: string | null }

export interface World {
  now: Date; file: NewcomerFile; catalogue: CatalogueReplay; decisions: DecisionFile;
  parties: Map<string, Party>; connected: Set<string>; blocked: Set<string>; eventIds: Map<string, string>;
}

function partyOf(key: string, p: Person, nowMs: number): Party {
  const area = { ownerId: p.ownerId, areaKey: p.areaKey, expiresAtMs: nowMs + 12 * HOUR, active: true, expiredMarked: false };
  if (p.publication === 'none') return { key, person: p, party: { id: p.ownerId, publication: null, area }, refusal: 'not_published' };
  const g = guardPublicationDraft({ displayName: p.displayName, interestTags: p.interestTags, audience: DISCOVERY_AUDIENCES[0],
    noticeVersion: DISCOVERY_NOTICE_VERSION, expiresAtMs: nowMs + 72 * HOUR }, DISCOVERY_TAGS, nowMs);
  if (!g.ok) return { key, person: p, party: { id: p.ownerId, publication: null, area }, refusal: g.reason };
  const publication: PublicationState = { publicationId: pubRef(key), ownerId: p.ownerId, displayName: g.draft.displayName,
    interestTags: g.draft.interestTags, audience: g.draft.audience, noticeVersion: g.draft.noticeVersion, revision: 1,
    expiresAtMs: g.draft.expiresAtMs, withdrawnAtMs: p.publication === 'withdrawn' ? nowMs - HOUR : null,
    expiredMarked: p.publication === 'expired' };
  return { key, person: p, party: { id: p.ownerId, publication, area }, refusal: null };
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Accepted pairs from decision-cases.json: the owner and each of their connections (connectedCounterparts). */
export function connectedFrom(decisions: DecisionFile): Set<string> {
  return new Set(Object.values(decisions.people).map(p => pairKey(decisions.ownerId, p.recipientId)));
}

export function buildWorld(file: NewcomerFile, catalogue: CatalogueReplay, decisions: DecisionFile): World {
  const now = new Date(file.clock);
  const parties = new Map(Object.entries(file.people).map(([k, p]) => [k, partyOf(k, p, now.getTime())]));
  const blocked = new Set(file.blocks.map(([a, b]) => pairKey(file.people[a]!.ownerId, file.people[b]!.ownerId)));
  // Fixture intents name source ids; the catalogue holds CS's stable `apify:<hash>` ids (source id basis, so no URL/time).
  const eventIds = new Map(Object.values(file.people).flatMap(p => p.intents)
    .map(i => [i.event, eventIdFor('luma', i.event, null, 0)] as [string, string]));
  return { now, file, catalogue, decisions, parties, connected: connectedFrom(decisions), blocked, eventIds };
}

export interface ServerViews {
  viewer: { ref: string; published: boolean; tags: string[] };
  areaKey: string | null;
  cards: DiscoveryCardProjection[];
  myIntents: MyEventIntentRow[];
  companions: EventCompanionRow[];
}

function intentRows(w: World, p: Person): MyEventIntentRow[] {
  const rows: MyEventIntentRow[] = [];
  for (const i of p.intents) {
    const e = w.catalogue.rows.find(r => r.eventId === w.eventIds.get(i.event));
    if (!e) continue;
    const g = guardEventIntent({ eventId: e.eventId, startsAtMs: Date.parse(e.startsAt), endsAtMs: e.endsAt ? Date.parse(e.endsAt) : null,
      status: 'scheduled', fetchedAtMs: Date.parse(e.fetchedAt), topics: e.topics, staleMarked: false }, i.kind, w.now.getTime());
    if (g.ok) rows.push({ eventId: e.eventId, kind: i.kind, version: 1, active: true, expiresAt: new Date(g.expiresAtMs).toISOString() });
  }
  return rows;
}

/** What the module's views would serve this viewer (DS stand-in over Cyber's guards). */
export function serverViews(w: World, viewerKey: string): ServerViews {
  const v = w.parties.get(viewerKey)!;
  const nowMs = w.now.getTime();
  const tags = v.party.publication ? [...v.party.publication.interestTags] : [];
  const visible = [...w.parties.values()].filter(t => t.key !== viewerKey &&
    guardDiscoveryVisibility(v.party, t.party, w.blocked.has(pairKey(v.party.id, t.party.id)), true, nowMs).ok &&
    !w.connected.has(pairKey(v.party.id, t.party.id)));
  const published = v.party.publication !== null && v.refusal === null;
  const myIntents = published ? intentRows(w, v.person) : [];
  const mine = new Set(myIntents.map(i => i.eventId));
  const companions = visible.flatMap(t => intentRows(w, t.person).filter(i => mine.has(i.eventId))
    .map(i => ({ cardRef: t.party.publication!.publicationId, eventId: i.eventId })));
  return {
    viewer: { ref: v.party.publication?.publicationId ?? 'self', published, tags },
    areaKey: published ? v.person.areaKey : null,
    cards: visible.map(t => projectDiscoveryCard(t.party.publication!, tags)),
    myIntents, companions,
  };
}

export type DiscoveryResult =
  | { kind: 'shortlist'; refs: string[]; shortlist: DiscoveryShortlist }
  | { kind: 'events'; events: { eventId: string; companions: string[] }[]; result: EventShortlist }
  | { kind: 'none'; reason: string; result: DiscoveryShortlist | EventShortlist };

export function discover(w: World, viewerKey: string, mode: 'nearby' | 'events', views = serverViews(w, viewerKey)): DiscoveryResult {
  const allowedTags = [...DISCOVERY_TAGS];
  if (mode === 'nearby') {
    // Exactly CS's shortlistFor: nearby mode, no event intents, DISCOVERY_TAGS.
    const { shortlist } = rankDiscoveryCards({ rows: views.cards, viewer: { ...views.viewer, eventIntents: [] }, mode: { kind: 'nearby' },
      allowedTags, now: w.now });
    return shortlist.kind === 'shortlist' ? { kind: 'shortlist', refs: shortlist.entries.map(e => e.ref), shortlist }
      : { kind: 'none', reason: shortlist.reason, result: shortlist };
  }
  const r = rankEventCompanions({ viewer: views.viewer, viewerAreaKey: views.areaKey, catalogue: w.catalogue.rows, myIntents: views.myIntents,
    cards: views.cards, companions: views.companions, allowedTags, now: w.now });
  return r.kind === 'events' ? { kind: 'events', events: r.events.map(e => ({ eventId: e.eventId, companions: e.companions.map(c => c.ref) })), result: r }
    : { kind: 'none', reason: r.reason, result: r };
}

export interface DiscoveryScore {
  id: string; matches: boolean; got: string; expected: string; falseMatches: string[]; top1Relevant: boolean | null;
}

const suggestedRefs = (r: DiscoveryResult) => r.kind === 'shortlist' ? r.refs : r.kind === 'events' ? r.events.flatMap(e => e.companions) : [];
const summary = (r: DiscoveryResult, w: World) => r.kind === 'shortlist' ? `shortlist ${r.refs.join(', ')}`
  : r.kind === 'events' ? `events ${r.events.map(e => `${sourceIdOf(w, e.eventId)}: ${e.companions.join(', ')}`).join('; ')}` : `none: ${r.reason}`;
const sourceIdOf = (w: World, eventId: string) => [...w.eventIds].find(([, id]) => id === eventId)?.[0] ?? eventId;

export function scoreDiscovery(w: World, c: DiscoveryCase, r = discover(w, c.viewer, c.mode)): DiscoveryScore {
  const x = c.expected;
  const expected = x.kind === 'shortlist' ? `shortlist ${x.refs!.join(', ')}`
    : x.kind === 'events' ? `events ${x.events!.map(e => `${e.event}: ${e.companions.join(', ')}`).join('; ')}` : `none: ${x.reason}`;
  const got = summary(r, w);
  const suggested = suggestedRefs(r);
  return {
    id: c.id, matches: got === expected, got, expected,
    falseMatches: suggested.filter(ref => (x.mustNotSuggest ?? []).includes(ref)),
    top1Relevant: x.relevant ? (r.kind === 'shortlist' ? x.relevant.includes(r.refs[0] ?? '') : false) : null,
  };
}

export const nextStepOf = (o: Outcome): NextStep =>
  o.kind === 'ready_for_preview' ? 'preview' : o.kind === 'needs_clarification' ? 'clarify' : 'none';

export interface PairedScore {
  id: string; newStep: NextStep; reconnectStep: NextStep; matches: boolean; reconnectLabelMet: boolean; reconnectOutcome: Outcome;
}

export function scorePaired(w: World, p: PairedCase): PairedScore {
  const dc = w.file.discoveryCases.find(c => c.id === p.discovery)!;
  const r = discover(w, dc.viewer, dc.mode);
  const newStep: NextStep = suggestedRefs(r).length > 0 ? 'introduce' : 'none';
  const c = w.decisions.cases.find(x => x.id === p.reconnect)!;
  const o = replay(w.decisions, c.story, c.candidate, c.recipients, c.steps, c.assessment, c.pauses).outcome;
  const reconnectStep = nextStepOf(o);
  return { id: p.id, newStep, reconnectStep, reconnectOutcome: o,
    matches: newStep === p.expected.new && reconnectStep === p.expected.reconnect, reconnectLabelMet: scoreCase(w.decisions, c).matches };
}

export async function loadWorld(datasetPath?: string): Promise<World> {
  const json = async (u: string | URL) => JSON.parse(await readFile(u, 'utf8'));
  const file: NewcomerFile = await json(new URL('./fixtures/berkeley-newcomers.json', import.meta.url));
  const data = await json(datasetPath ?? new URL(`./fixtures/${file.dataset}`, import.meta.url));
  const decisions = resolveCases(await json(new URL('./fixtures/decision-cases.json', import.meta.url)),
    await json(new URL('../agents/fixtures/reflection.synthetic.json', import.meta.url)));
  return buildWorld(file, replayCatalogue(data, Date.parse(file.clock)), decisions);
}

/** Markdown summary. Persona keys, refs, source event ids and reason codes only: no names, transitions or stories. */
export function renderTransition(w: World): string {
  const ds = w.file.discoveryCases.map(c => scoreDiscovery(w, c));
  const ps = w.file.pairedCases.map(p => scorePaired(w, p));
  const n = (f: (x: typeof ds[number]) => boolean) => ds.filter(f).length;
  const positives = w.file.discoveryCases.filter(c => c.group === 'positive').map(c => c.id);
  const refusals = [...w.parties.values()].filter(p => p.refusal && p.person.publication !== 'none').map(p => `${p.key} (${p.refusal})`);
  const useful = (k: 'newStep' | 'reconnectStep', step: NextStep) => ps.filter(s => s[k] === step).length;
  return [
    '# DS transition evaluation: Berkeley newcomers (synthetic)', '',
    `**Data:** SYNTHETIC personas (\`fixtures/berkeley-newcomers.json\`, ${Object.keys(w.file.people).length} people) and catalogue (${w.catalogue.provenance.label}). Clock ${w.file.clock}.`,
    'Server views are a DS stand-in over Cyber\'s real guards; ranking is the shipped DS code as CS calls it; reconnect episodes are decision-cases.json cases by reference. Labels: one DS annotator, written before the first run. Not live, not rated by teammates.',
    'Regenerate with `node src/evaluation/transition.ts --write`.', '',
    '## Discovery cases', '',
    `Expected ${n(s => s.matches)}/${ds.length}; nearby top-1 relevant ${n(s => s.top1Relevant === true)}/${n(s => s.top1Relevant !== null)}; false matches ${ds.reduce((a, s) => a + s.falseMatches.length, 0)}; correct no-action ${n(s => s.matches && w.file.discoveryCases.find(c => c.id === s.id)!.group === 'no-action')}/${w.file.discoveryCases.length - positives.length}.`,
    `Publications refused by guardPublicationDraft: ${refusals.join(', ') || 'none'}.`, '',
    '| Case | Expected | Got | OK |', '|---|---|---|---|',
    ...ds.map(s => `| ${s.id} | ${s.expected} | ${s.got} | ${s.matches ? 'yes' : '**no**'} |`), '',
    '## New connection vs reconnect (paired)', '',
    `Useful next step: new ${useful('newStep', 'introduce')}/${ps.length} (introduce), reconnect ${useful('reconnectStep', 'preview')}/${ps.length} (owner preview), reconnect pending an owner answer ${useful('reconnectStep', 'clarify')}; both paths silent ${ps.filter(s => s.newStep === 'none' && s.reconnectStep === 'none').length}. Expected ${ps.filter(s => s.matches).length}/${ps.length}; reconnect labels from decision-cases.json met ${ps.filter(s => s.reconnectLabelMet).length}/${ps.length}.`,
    'A "none" is a correct, honest result when labeled so; reconnecting is never offered as a fallback for an empty discovery result, and nothing here measures loneliness or AI use.', '',
    '| Pair | Discovery | Reconnect case | New | Reconnect | OK |', '|---|---|---|---|---|---|',
    ...ps.map(s => { const p = w.file.pairedCases.find(x => x.id === s.id)!;
      return `| ${s.id} | ${p.discovery} | ${p.reconnect} | ${s.newStep} | ${s.reconnectStep} | ${s.matches ? 'yes' : '**no**'} |`; }), '',
    '## Limits', '',
    '- Synthetic people and events; the stand-in is not the deployed module (Cyber\'s module tests cover the real views).',
    '- Current DISCOVERY_TAGS has no transition tags, so transitions stay device-local; D046 would allow ordinary, non-sensitive transition tags if CS adds them to the allowlist.',
    '- Rerun against a saved approved Actor dataset with `--dataset <file>` (event-mode labels then no longer apply, because source ids differ).', '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dataset');
  const w = await loadWorld(i >= 0 ? args[i + 1] : undefined);
  const md = renderTransition(w);
  const out = new URL('./results/transition.md', import.meta.url);
  if (args.includes('--check')) {
    const cur = await readFile(out, 'utf8').catch(() => '');
    if (cur !== md) { console.error('results/transition.md is stale: run node src/evaluation/transition.ts --write'); process.exit(1); }
    console.log('results/transition.md is current');
  } else {
    if (args.includes('--write')) await writeFile(out, md);
    process.stdout.write(md);
  }
}
