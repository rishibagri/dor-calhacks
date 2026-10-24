// DS quiz fixture checks (offline). Runs under `npm run test:app`.
// The interpreter below is a test-only reading of quiz.json; the app mapping is CS's
// buildProfile/buildQuizExtras/draftCategoriesFor, which are checked against the same expected outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AgentAckSchema, ApprovedSignalSchema, DisclosureReceiptSchema, LocalConnectionProfileSchema,
  RecipientPresetAssignmentSchema, RelationshipPresetSchema,
} from '@dor/contracts';
import { buildProfile, buildQuizExtras, draftCategoriesFor } from '../../components/feature/quiz-model.ts';

const load = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const quiz = await load('quiz.json');
const profiles = await load('quiz-profiles.json');

const question = (key: string) => quiz.questions.find((q: { answerKey?: string }) => q.answerKey === key);
const part = (key: string) => quiz.questions.find((q: { id: string }) => q.id === 'q3').parts
  .find((p: { answerKey: string }) => p.answerKey === key);
const values = (q: { values?: string[]; options?: { value: string }[] }) => q.values ?? q.options!.map(o => o.value);

function oneOf(key: string, allowed: string[], v: unknown) {
  if (v !== null && !allowed.includes(v as string)) throw new Error(`invalid ${key}: ${String(v)}`);
  return v;
}
function manyOf(key: string, allowed: string[], vs: unknown[]) {
  for (const v of vs) if (!allowed.includes(v as string)) throw new Error(`invalid ${key}: ${String(v)}`);
  return vs as string[];
}
const unique = <T,>(xs: T[]) => Array.from(new Set(xs));

function mapAnswers(answers: Record<string, unknown>) {
  const a = { ...profiles.cases.find((c: { id: string }) => c.id === 'skip-all').answers, ...answers };
  const q1 = question('afterLongDay');
  const modeOf = (v: string) => q1.options.find((o: { value: string }) => o.value === v)?.profileValue ?? null;
  const longDay = manyOf('afterLongDay', values(q1), a.afterLongDay);
  const quiet = manyOf('friendQuiet', values(question('friendQuiet')), a.friendQuiet);
  const profile = LocalConnectionProfileSchema.parse({
    schemaVersion: 1,
    communicationStyle: oneOf('tone', part('tone').values, a.tone),
    preferredSupportModes: unique([...longDay.map(modeOf).filter((m): m is string => m !== null), ...quiet]),
    draftSharingCategories: manyOf('categories', values(question('categories')), a.categories),
    rhythm: oneOf('rhythm', part('rhythm').values, a.rhythm),
    suggestionIntensity: oneOf('overwhelmed', values(question('overwhelmed')), a.overwhelmed),
  });
  const activities = manyOf('activities', values(question('activities')), a.activities);
  const { maxLength } = question('activities').freeText;
  const note = activities.includes('other') ? String(a.activitiesNote).trim().slice(0, maxLength) : '';
  const extras = {
    prefersSpace: longDay.includes('space'),
    activities,
    activitiesNote: note.length > 0 ? note : null,
    scheduleSuggestions: oneOf('scheduleSuggestions', values(question('scheduleSuggestions')), a.scheduleSuggestions),
    reviewComfort: oneOf('reviewComfort', values(question('reviewComfort')), a.reviewComfort),
  };
  // Unsaved preset draft (CS draftCategoriesFor): support_preference only with a support mode. Space is not read.
  const presetDrafts = profile.preferredSupportModes.length > 0 ? profile.draftSharingCategories
    : profile.draftSharingCategories.filter((c) => c !== 'support_preference');
  return { profile, extras, presetDrafts };
}

const wireSchemas = { ApprovedSignalSchema, RelationshipPresetSchema, RecipientPresetAssignmentSchema, AgentAckSchema, DisclosureReceiptSchema };

test('quiz has 8 skippable questions; every profile target is a LocalConnectionProfile field', () => {
  assert.equal(quiz.skippable, true);
  assert.equal(quiz.questions.length, 8);
  const fields = new Set(Object.keys(LocalConnectionProfileSchema.shape));
  const targets = quiz.questions.flatMap((q: { target?: string; parts?: { target: string }[] }) =>
    q.parts ? q.parts.map(p => p.target) : [q.target!]);
  for (const t of targets.flatMap((t: string) => t.split(' + ')).filter((t: string) => t.startsWith('profile.')))
    assert.ok(fields.has(t.slice('profile.'.length)), t);
});

for (const c of profiles.cases) {
  test(`quiz case ${c.id} maps deterministically to profile + local extras`, () => {
    assert.deepEqual(mapAnswers(c.answers), c.expected);
    assert.deepEqual(mapAnswers(structuredClone(c.answers)), mapAnswers(c.answers));
  });

  test(`quiz case ${c.id} matches CS's buildProfile / buildQuizExtras / draftCategoriesFor`, () => {
    const profile = buildProfile(c.answers);
    assert.ok(profile.success);
    assert.deepEqual(profile.data, c.expected.profile);
    assert.deepEqual(buildQuizExtras(c.answers), c.expected.extras);
    assert.deepEqual(draftCategoriesFor(null, profile.data).categories, c.expected.presetDrafts);
  });

  test(`quiz case ${c.id} output is not a consent or sharing record`, () => {
    for (const [name, schema] of Object.entries(wireSchemas)) {
      assert.equal(schema.safeParse(c.expected.profile).success, false, `profile parsed as ${name}`);
      assert.equal(schema.safeParse(c.expected.extras).success, false, `extras parsed as ${name}`);
    }
    // Extras must stay out of the shared profile shape entirely.
    assert.equal(LocalConnectionProfileSchema.safeParse({ ...c.expected.profile, ...c.expected.extras }).success, false);
  });
}

test('skip-all yields an empty profile with no draft categories', () => {
  const skip = profiles.cases.find((c: { id: string }) => c.id === 'skip-all');
  assert.deepEqual(skip.expected.profile.draftSharingCategories, []);
  assert.deepEqual(skip.expected.profile.preferredSupportModes, []);
});

for (const c of profiles.invalidAnswers) {
  test(`invalid quiz answers rejected (${c.rejectedBy}): ${c.id}`, () => assert.throws(() => mapAnswers(c.answers)));
}

// core3-audit.md item 3 (CS 427cd3f): quiz "space" adds no support suggestion to the drafts and nothing more.
test('quiz space: no support draft without a mode, and a saved preset is never overridden', () => {
  const space = profiles.cases.find((c: { id: string }) => c.id === 'space-only');
  assert.equal(space.expected.extras.prefersSpace, true);
  assert.ok(space.answers.categories.includes('support_preference'));
  assert.deepEqual(space.expected.presetDrafts, []);
  // A preset the owner already confirmed is the only thing that counts; the quiz cannot narrow or widen it.
  const saved = { allowedCategories: ['support_preference' as const] };
  assert.deepEqual(draftCategoriesFor(saved, space.expected.profile).categories, ['support_preference']);
});

test('quiz space alongside modes changes neither the profile nor the drafts', () => {
  const withSpace = profiles.cases.find((c: { id: string }) => c.id === 'space-with-other-modes');
  const without = { ...withSpace.answers, afterLongDay: withSpace.answers.afterLongDay.filter((v: string) => v !== 'space') };
  const a = mapAnswers(withSpace.answers), b = mapAnswers(without);
  assert.deepEqual(a.profile, b.profile);
  assert.deepEqual(a.presetDrafts, b.presetDrafts);
  assert.equal(a.extras.prefersSpace, true);
  assert.equal(b.extras.prefersSpace, false);
});

test('quiz drafts are suggestions, not consent: no expected output is an approval, preset or assignment', () => {
  for (const c of profiles.cases) for (const [name, schema] of Object.entries(wireSchemas))
    assert.equal(schema.safeParse({ categories: c.expected.presetDrafts }).success, false, `${c.id} drafts parsed as ${name}`);
});
