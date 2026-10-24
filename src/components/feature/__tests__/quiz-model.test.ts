import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovedSignalSchema } from '@dor/contracts';
import { EMPTY_ANSWERS, buildProfile, buildQuizExtras, countAnswered } from '../quiz-model.ts';

test('"space" maps to no support mode (no-action case) and is kept local', () => {
  const a = { ...EMPTY_ANSWERS, afterLongDay: ['space' as const] };
  const profile = buildProfile(a);
  assert.equal(profile.success, true);
  assert.deepEqual(profile.data?.preferredSupportModes, []);
  assert.equal(buildQuizExtras(a).prefersSpace, true);
});

test('space alongside real modes keeps only contract modes in the profile', () => {
  const profile = buildProfile({ ...EMPTY_ANSWERS, afterLongDay: ['space', 'short_call'], friendQuiet: ['short_call'] });
  assert.deepEqual(profile.data?.preferredSupportModes, ['short_call']);
});

test('Q5/Q6/Q8 answers never enter the shared-schema profile', () => {
  const a = { ...EMPTY_ANSWERS, activities: ['games' as const, 'other' as const], activitiesNote: '  synthetic note  ',
    scheduleSuggestions: 'keep_private' as const, reviewComfort: 'quick_review' as const };
  const profile = buildProfile(a);
  assert.equal(profile.success, true);
  const keys = Object.keys(profile.data ?? {});
  for (const k of ['activities', 'activitiesNote', 'scheduleSuggestions', 'reviewComfort', 'prefersSpace']) assert.ok(!keys.includes(k));
  assert.equal(buildQuizExtras(a).activitiesNote, 'synthetic note');
  assert.equal(ApprovedSignalSchema.safeParse(buildQuizExtras(a)).success, false);
});

test('other-activity note is dropped unless "other" is selected; empty quiz counts zero', () => {
  assert.equal(buildQuizExtras({ ...EMPTY_ANSWERS, activitiesNote: 'x' }).activitiesNote, null);
  assert.equal(countAnswered(EMPTY_ANSWERS), 0);
});
