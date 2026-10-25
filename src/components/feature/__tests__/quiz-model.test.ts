import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovedSignalSchema } from '@dor/contracts';
import { EMPTY_ANSWERS, buildProfile, buildQuizExtras, countAnswered, draftCategoriesFor } from '../quiz-model.ts';

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

test('all quiz answers and activity choices remain outside the shared profile', () => {
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

test('draftCategoriesFor: no profile gives an empty, unsuggested draft', () => {
  assert.deepEqual(draftCategoriesFor(undefined, null), { categories: [], suggested: false });
});

test('draftCategoriesFor: an existing saved preset is never overridden', () => {
  const profile = { draftSharingCategories: ['coarse_availability' as const], preferredSupportModes: ['short_call' as const] };
  assert.deepEqual(draftCategoriesFor({ allowedCategories: [] }, profile), { categories: [], suggested: false });
});

test('draftCategoriesFor: keeps valid category keys only', () => {
  const profile = { draftSharingCategories: ['coarse_availability', 'bogus', 'coarse_availability'] as never, preferredSupportModes: ['short_call' as const] };
  assert.deepEqual(draftCategoriesFor(null, profile), { categories: ['coarse_availability'], suggested: true });
});

test('draftCategoriesFor: space-only answer nominates no support category', () => {
  const built = buildProfile({ ...EMPTY_ANSWERS, afterLongDay: ['space'], categories: ['support_preference', 'coarse_availability'] });
  assert.ok(built.data);
  assert.deepEqual(draftCategoriesFor(null, built.data), { categories: ['coarse_availability'], suggested: true });
});
