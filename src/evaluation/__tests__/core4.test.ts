// DS Core 4: the curated examples resolve to existing labeled cases, cover the README categories, reproduce their
// source labels with every privacy check holding, and the committed summary is current. Offline and synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCore4, loadCore4, renderCore4 } from '../core4.ts';
import { loopWithoutAssessment, previewOnCandidate } from '../decision-baselines.ts';

const inputs = await loadCore4();
const rows = await buildCore4(inputs);
const { core4 } = inputs;

test('selection: every example is an existing case, listed once, and carries no copied label or story', () => {
  assert.equal(new Set(core4.examples.map((e) => `${e.suite}:${e.id}`)).size, core4.examples.length);
  assert.equal(rows.length, core4.examples.length);
  for (const e of core4.examples) {
    assert.deepEqual(Object.keys(e).sort(), ['covers', 'id', 'relationship', 'suite', 'why'], e.id);
    for (const c of e.covers) assert.ok(core4.coverage.includes(c), `${e.id}: ${c}`);
  }
  const raw = JSON.stringify(core4);
  for (const k of ['"expected"', '"story"', '"candidate"', '"assessment"', '"privateContext"', 'SYNTHETIC:']) assert.ok(!raw.includes(k), k);
});

test('selection: relationship field matches the source case', () => {
  for (const e of core4.examples) {
    const src = e.suite === 'decision' ? inputs.decision.cases.find((c) => c.id === e.id)!.relationship
      : inputs.support.cases.find((c: { id: string }) => c.id === e.id).relationship;
    assert.equal(e.relationship, src, e.id);
  }
});

test('coverage: partner, friend, family and private-party examples; refusal, uncertainty, recipient-specific permission, silence', () => {
  for (const r of ['partners', 'friends', 'family']) assert.ok(core4.examples.filter((e) => e.relationship === r).length >= 3, r);
  for (const c of core4.coverage) assert.ok(core4.examples.filter((e) => e.covers.includes(c)).length >= 2, c);
  // README Core 4 names the private-party no-action case explicitly.
  const pp = rows.find((r) => r.example.id === 'a9-private-party-no-candidate')!;
  assert.match(pp.actual, /^no_action/);
  assert.equal(pp.recipientCopy, null);
});

test('results: every example reproduces its source label and every privacy check holds; no known gaps hidden', () => {
  for (const r of rows) {
    assert.ok(r.matches, `${r.example.id}: expected ${r.expected}, got ${r.actual}`);
    for (const p of r.privacy) assert.ok(p.ok, `${r.example.id}: ${p.check}`);
    assert.equal(r.knownGap, null, r.example.id);
  }
});

test('silence is silent: no correct_silence example shows the recipient anything', () => {
  for (const r of rows.filter((r) => r.example.covers.includes('correct_silence'))) assert.equal(r.recipientCopy, null, r.example.id);
});

test('done criteria point at selected examples that reproduce', () => {
  for (const [k, ids] of Object.entries(core4.doneCriteria)) {
    assert.ok(ids.length > 0, k);
    for (const id of ids) assert.ok(rows.find((r) => r.example.id === id)?.matches, `${k}: ${id}`);
  }
});

test('the committed results/core4.md is current (run node src/evaluation/core4.ts --write)', async () => {
  const committed = await readFile(new URL('../results/core4.md', import.meta.url), 'utf8');
  assert.equal(committed, renderCore4(inputs, rows));
});

// Negative controls: the privacy checks must flag a leak when one exists, or a clean 70/70 means nothing.
test('negative control: dropping the exclusion from r4 surfaces Alex, and the Core 4 privacy check flags it', async () => {
  const leaky = structuredClone(inputs);
  const r4 = leaky.decision.cases.find((c) => c.id === 'r4-refusal-stated-only-in-entry')!;
  r4.assessment = { intent: 'wants_connection', excludedNames: [], preferredNames: [] };
  const row = (await buildCore4(leaky)).find((r) => r.example.id === r4.id)!;
  assert.equal(row.matches, false);
  assert.ok(row.privacy.some((p) => !p.ok && /forbidden-disclosure/.test(p.check)), JSON.stringify(row.privacy));
});

test('negative control: a story term in what crosses to the recipient is flagged for a support example', async () => {
  const leaky = structuredClone(inputs);
  const p1 = leaky.support.cases.find((c: { id: string }) => c.id === 'p1-partners-call-this-week');
  p1.forbiddenDisclosures = [...p1.forbiddenDisclosures, 'short_call']; // the approved envelope does carry this term
  const row = (await buildCore4(leaky)).find((r) => r.example.id === p1.id)!;
  assert.ok(row.privacy.some((p) => !p.ok && /crossed/.test(p.check)), JSON.stringify(row.privacy));
});

test('negative control: a system that ignores the assessment re-offers the excluded person, and the check flags it', async () => {
  const row = (await buildCore4(inputs, loopWithoutAssessment)).find((r) => r.example.id === 'r4-refusal-stated-only-in-entry')!;
  assert.ok(row.privacy.some((p) => !p.ok && /excluded or paused/.test(p.check)), JSON.stringify(row.privacy));
});

test('negative control: a "preview whenever there is a candidate" system previews in a silence case, and the check flags it', async () => {
  const row = (await buildCore4(inputs, previewOnCandidate)).find((r) => r.example.id === 'g2-company-but-not-this-friend')!;
  assert.ok(row.privacy.some((p) => !p.ok && /did not choose/.test(p.check)), JSON.stringify(row.privacy));
});

test('negative control: a story term in the post-approval nudge copy is flagged for a decision example', async () => {
  const leaky = structuredClone(inputs);
  const a17 = leaky.decision.cases.find((c) => c.id === 'a17-partners-exam-seed')!;
  a17.forbidden = { ...a17.forbidden, private_activity: [...(a17.forbidden.private_activity ?? []), 'short call'] }; // template wording
  const row = (await buildCore4(leaky)).find((r) => r.example.id === a17.id)!;
  assert.ok(row.recipientCopy?.includes('short call'));
  assert.ok(row.privacy.some((p) => !p.ok && /after simulated approval/.test(p.check)), JSON.stringify(row.privacy));
});
