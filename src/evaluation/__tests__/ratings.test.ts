// DS Core 3: rating workflow + deterministic baseline comparison. Any filled ratings here are generated inside the
// test to exercise the parser and aggregator; they are never written to results/ or reported as teammate ratings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DECISION_SYSTEMS, loopWithoutAssessment, previewOnCandidate } from '../decision-baselines.ts';
import { d040Loop, resolveCases, scoreCase } from '../decision-loop.ts';
import {
  CONCERNS, RATERS, aggregateRatings, buildRatingItems, cohensKappa, keyOf, parseSheet, renderRatingSummary, renderSheet,
  type RaterId, type RatingItem,
} from '../ratings.ts';

const json = async (u: string) => JSON.parse(await readFile(new URL(u, import.meta.url), 'utf8'));
const file = resolveCases(await json('../fixtures/decision-cases.json'), await json('../../agents/fixtures/reflection.synthetic.json'));
const items = buildRatingItems(file, DECISION_SYSTEMS);
const key = keyOf(items, Object.keys(DECISION_SYSTEMS), 'test-hash');
const sheet = (r: RaterId) => renderSheet(file, items, r, 'test-hash');

/** Fills a sheet's rows with `cells(item)`; test-only. */
function fill(md: string, cells: (it: RatingItem) => string): string {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return md.replace(/^\| (item-\d{3}) \|  \|  \|  \|  \|  \|$/gm, (_, id: string) => `| ${id} | ${cells(byId.get(id)!)} |`);
}

test('items: every (case, system) pair maps to exactly one item; identical outcomes are rated once', () => {
  for (const c of file.cases) for (const s of Object.keys(DECISION_SYSTEMS)) {
    assert.equal(items.filter((i) => i.caseId === c.id && i.systems.includes(s)).length, 1, `${c.id}/${s}`);
  }
  for (const c of file.cases) {
    const outs = items.filter((i) => i.caseId === c.id).map((i) => JSON.stringify(i.outcome));
    assert.equal(new Set(outs).size, outs.length, `${c.id} duplicate outcome`);
  }
  assert.deepEqual(items.map((i) => i.itemId), items.map((_, n) => `item-${String(n + 1).padStart(3, '0')}`));
  assert.deepEqual(buildRatingItems(file, DECISION_SYSTEMS), items, 'deterministic');
});

test('sheets are blinded: no system name, case ID, expected label or outcome vocabulary', () => {
  for (const r of RATERS) {
    const md = sheet(r);
    for (const s of Object.keys(DECISION_SYSTEMS)) assert.equal(md.includes(s), false, s);
    for (const c of file.cases) assert.equal(new RegExp(`\\b${c.id}\\b`).test(md), false, c.id);
    assert.doesNotMatch(md, /no_action|needs_clarification|ready_for_preview|expected|knownGap|labelHistory/);
    for (const id of Object.keys(file.people)) assert.equal(new RegExp(`\\b${id}\\b`).test(md), false, `internal pair ID ${id}`);
  }
});

test('both raters get the same items in a different order', () => {
  const ids = (md: string) => [...md.matchAll(/^## (item-\d{3})$/gm)].map((m) => m[1]);
  const a = ids(sheet('rater-a')), b = ids(sheet('rater-b'));
  assert.deepEqual([...a].sort(), [...b].sort());
  assert.equal(a.length, items.length);
  assert.notDeepEqual(a, b);
});

test('parser: blank rows are unrated, invalid cells are reported and never guessed', () => {
  assert.deepEqual(Object.keys(parseSheet(sheet('rater-a')).ratings), []);
  assert.equal(parseSheet(sheet('rater-a')).blank.length, items.length);
  const bad = fill(sheet('rater-a'), (it) => (it.itemId === 'item-001' ? '7 | y | silent |  | ' : it.itemId === 'item-002' ? '3 | maybe | ask |  | '
    : it.itemId === 'item-003' ? '3 | y | ask | gossip | ' : it.itemId === 'item-004' ? '4 | n | preview | timing_detail, pressure | short note' : ' |  |  |  | '));
  const p = parseSheet(bad);
  assert.equal(p.rater, 'rater-a');
  assert.deepEqual(p.errors.map((e) => e.split(':')[0]).sort(), ['item-001', 'item-002', 'item-003']);
  assert.deepEqual(p.ratings['item-004'], { usefulness: 4, safe: false, preferred: 'preview', concerns: ['timing_detail', 'pressure'], note: 'short note' });
  assert.equal(Object.keys(p.ratings).length, 1);
});

test('aggregate: no sheets → not collected and no numbers', () => {
  const s = aggregateRatings(file, key, []);
  assert.equal(s.complete, false);
  assert.match(s.status, /not collected/);
  assert.match(renderRatingSummary(s), /No usefulness or rater-safety numbers/);
  assert.doesNotMatch(renderRatingSummary(s), /\d\.\d\d/);
});

test('aggregate: one sheet or a partial sheet is reported as incomplete', () => {
  const partial = parseSheet(fill(sheet('rater-a'), (it) => (it.itemId === 'item-001' ? '3 | y | ask |  | ' : ' |  |  |  | ')));
  const s = aggregateRatings(file, key, [partial]);
  assert.equal(s.complete, false);
  assert.match(s.status, /incomplete: rater-a 1\/\d+ rated/);
  assert.equal(s.agreement, null);
});

test('aggregate: two sheets with one gap or one invalid cell are still incomplete', () => {
  const full = (r: RaterId) => parseSheet(fill(sheet(r), () => '3 | y | ask |  | '));
  const gap = parseSheet(fill(sheet('rater-b'), (it) => (it.itemId === 'item-001' ? ' |  |  |  | ' : '3 | y | ask |  | ')));
  const invalid = parseSheet(fill(sheet('rater-b'), (it) => (it.itemId === 'item-001' ? '9 | y | ask |  | ' : '3 | y | ask |  | ')));
  assert.equal(aggregateRatings(file, key, [full('rater-a'), full('rater-b')]).complete, true);
  assert.equal(aggregateRatings(file, key, [full('rater-a'), gap]).complete, false);
  assert.equal(aggregateRatings(file, key, [full('rater-a'), invalid]).complete, false);
  assert.equal(aggregateRatings(file, key, [full('rater-a'), full('rater-a')]).complete, false, 'same rater twice');
});

test('aggregate: two complete sheets credit shared items to every system that produced them', () => {
  // Test-only raters: A marks every preview unsafe; B agrees except it calls previews of cases DS expects a preview for safe.
  const expected = new Map(file.cases.map((c) => [c.id, c.expected.kind]));
  const pref = (k: string) => (k === 'no_action' ? 'silent' : k === 'needs_clarification' ? 'ask' : 'preview');
  const a = parseSheet(fill(sheet('rater-a'), (it) => `${it.outcome.kind === 'ready_for_preview' ? 2 : 4} | ${it.outcome.kind === 'ready_for_preview' ? 'n' : 'y'} | ${pref(expected.get(it.caseId)!)} |  | `));
  const b = parseSheet(fill(sheet('rater-b'), (it) => {
    const preview = it.outcome.kind === 'ready_for_preview';
    const safe = !preview || expected.get(it.caseId) === 'ready_for_preview';
    return `${preview ? 3 : 4} | ${safe ? 'y' : 'n'} | ${pref(expected.get(it.caseId)!)} | ${safe ? '' : 'unwanted_suggestion'} | `;
  }));
  const s = aggregateRatings(file, key, [a, b]);
  assert.equal(s.complete, true);
  for (const sys of s.systems) assert.equal(sys.ratedByBoth, file.cases.length, sys.system);
  const d040 = s.systems.find((x) => x.system === 'd040_loop')!;
  const strawman = s.systems.find((x) => x.system === 'preview_on_candidate')!;
  assert.ok(strawman.unsafeByBoth > d040.unsafeByBoth);
  assert.equal(s.agreementWithDsLabels['rater-a']!.agree, items.length);
  assert.equal(s.agreement!.preferredKappa, 1);
  assert.ok(s.agreement!.safeKappa !== null && s.agreement!.safeKappa < 1);
  assert.match(renderRatingSummary(s), /complete \(2 of 2 raters/);
});

test("Cohen's kappa: known values and undefined cases", () => {
  assert.equal(cohensKappa(['y', 'y', 'n', 'n'], ['y', 'y', 'n', 'n']), 1);
  assert.equal(cohensKappa(['y', 'n', 'y', 'n'], ['n', 'y', 'n', 'y']), -1);
  assert.equal(cohensKappa(['y', 'y'], ['y', 'y']), null, 'no variation');
  assert.equal(cohensKappa(['y'], ['y']), null);
  // 10 items, 7 agree; marginals 5/5 and 6/4 → pe = 0.5, kappa = 0.4
  assert.ok(Math.abs(cohensKappa([1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0, 1, 1])! - 0.4) < 1e-9);
});

test('baselines: d040_loop is exactly the Core 1/2 scorer; Core 1/2 labels are scored unchanged', () => {
  for (const c of file.cases) assert.deepEqual(scoreCase(file, c, d040Loop), scoreCase(file, c), c.id);
  assert.equal(DECISION_SYSTEMS.d040_loop, d040Loop);
});

test('baselines: dropping the assessment re-offers an entry-excluded person; the support rule ignores refusals', () => {
  const byId = (id: string) => file.cases.find((c) => c.id === id)!;
  assert.deepEqual(scoreCase(file, byId('a3-not-alex-left-out'), loopWithoutAssessment).excludedSurfaced, ['p-alex']);
  assert.equal(scoreCase(file, byId('a3-not-alex-left-out'), d040Loop).excludedSurfaced.length, 0);
  const space = scoreCase(file, byId('c1-changed-to-space'), previewOnCandidate);
  assert.equal(space.outcome.kind, 'ready_for_preview');
  assert.equal(space.unsafe, true);
  assert.equal(scoreCase(file, byId('n1-nothing-to-share'), previewOnCandidate).outcome.kind, 'no_action');
});

test('baselines: metrics stay separate (an unsafe suggestion is not a leak and vice versa)', () => {
  // nn1 (known gap): Alex is offered (a leak) but nothing is previewed (not unsafe). r4m played this role before D042.
  const nn1 = scoreCase(file, file.cases.find((c) => c.id === 'nn1-nickname-alexander-excludes-alex')!);
  assert.equal(nn1.unsafe, false);
  assert.ok(nn1.leaks.length > 0);
  // And an unsafe suggestion with no forbidden term: the strawman previews for Riley although the owner skipped.
  const t2 = scoreCase(file, file.cases.find((c) => c.id === 't3-clear-timing-partner')!, previewOnCandidate);
  const skip = scoreCase(file, file.cases.find((c) => c.id === 'a8-unsure-skip-is-silence')!, previewOnCandidate);
  assert.equal(t2.unsafe, false);
  assert.equal(skip.unsafe, true);
  assert.deepEqual(skip.leaks.filter((l) => l.label !== 'unapproved_recipient'), []);
});

test('concern codes include all six forbidden-disclosure labels', () => {
  for (const l of file.cases.flatMap((c) => Object.keys(c.forbidden))) assert.ok((CONCERNS as readonly string[]).includes(l), l);
});
