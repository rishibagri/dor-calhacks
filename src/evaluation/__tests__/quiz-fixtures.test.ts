// DS quiz fixture checks (offline). Runs under `npm run test:app`.
// The interpreter below is a test-only reading of quiz.json; the app mapping is CS's
// buildProfile/buildQuizExtras, which must produce the same expected outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AgentAckSchema, ApprovedSignalSchema, DisclosureReceiptSchema, LocalConnectionProfileSchema,
  RecipientPresetAssignmentSchema, RelationshipPresetSchema,
} from '@dor/contracts';

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
  return { profile, extras, supportAction: extras.prefersSpace ? 'none' : 'eligible' };
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
