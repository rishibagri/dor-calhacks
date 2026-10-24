// CYBER-R3 event, intent, C7 approval and plan-check guards (proposed C7/C8, D039). Offline, synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardCatalogueEvent, catalogueEventUsable, guardEventIntent, intentStands, guardActivityApproval, activityApprovalStands,
  planSourceCheck, guardPlanTiming, eventErrorCode, validHostAllowlist, applyPlanAction,
  ACTIVITY_CATEGORY, CATALOGUE_MAX_SOURCE_AGE_MS, PLAN_MIN_LEAD_MS, PLAN_MAX_LIFETIME_MS, EVENT_DEFAULT_DURATION_MS,
  ACTIVITY_APPROVAL_MAX_LIFETIME_MS, SHARING_CATEGORIES,
} from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const H = 3600e3;
const ALLOW = { tags: ['hiking', 'board-games'], areas: ['berkeley-campus'], hosts: ['events.example.edu'] };
const raw = (over = {}) => ({ eventId: 'evt-1', title: 'Hike', startsAtMs: NOW + 72 * H, endsAtMs: NOW + 75 * H, status: 'scheduled',
  fetchedAtMs: NOW, topics: ['hiking'], format: 'in_person', areaKey: 'berkeley-campus', sourceUrl: 'https://events.example.edu/e/1', ...over });
const ev = (over = {}) => ({ eventId: 'evt-1', startsAtMs: NOW + 72 * H, endsAtMs: null, status: 'scheduled', fetchedAtMs: NOW,
  topics: ['hiking'], staleMarked: false, ...over });

test('zod-free policy entry exposes the event guards and the D034 lifecycle for the module', () => {
  assert.equal(zodFree.guardCatalogueEvent, guardCatalogueEvent);
  assert.equal(zodFree.applyPlanAction, applyPlanAction);
});

test('catalogue: unknown fields (venue, organizer, attendees, description) are rejected, never stripped', () => {
  for (const extra of [{ venue: 'Room 101' }, { organizer: 'x' }, { attendees: ['a'] }, { description: 'd' }, { lat: 37.8 }]) {
    assert.equal(guardCatalogueEvent(raw(extra), ALLOW, NOW).reason, 'invalid_schema');
  }
});

test('catalogue: title sanitized; topics/area allowlisted; links safe; no future fetch; horizon bounded', () => {
  const g = guardCatalogueEvent(raw({ title: ' <b>Hike</b>​‮  now ' }), ALLOW, NOW);
  assert.equal(g.ok, true);
  assert.equal(/[<>​‮]/.test(g.event.title), false);
  assert.equal(guardCatalogueEvent(raw({ topics: ['support-group'] }), ALLOW, NOW).reason, 'topic_not_allowlisted');
  assert.equal(guardCatalogueEvent(raw({ areaKey: '37.87,-122.25' }), ALLOW, NOW).reason, 'area_not_allowlisted');
  assert.equal(guardCatalogueEvent(raw({ format: 'online' }), ALLOW, NOW).reason, 'invalid_schema');
  assert.equal(guardCatalogueEvent(raw({ format: 'online', areaKey: null }), ALLOW, NOW).ok, true);
  assert.equal(guardCatalogueEvent(raw({ sourceUrl: 'javascript:alert(1)' }), ALLOW, NOW).reason, 'unsafe_source_url');
  assert.equal(guardCatalogueEvent(raw({ fetchedAtMs: NOW + H }), ALLOW, NOW).reason, 'invalid_schema');
  assert.equal(guardCatalogueEvent(raw({ endsAtMs: NOW }), ALLOW, NOW).reason, 'invalid_schema');
  assert.equal(guardCatalogueEvent(raw({ startsAtMs: NOW + 61 * 24 * H }), ALLOW, NOW).reason, 'too_far_ahead');
  assert.equal(guardCatalogueEvent(raw({ eventId: 'Evt 1!' }), ALLOW, NOW).reason, 'invalid_schema');
});

test('host allowlist accepts DNS names only', () => {
  assert.equal(validHostAllowlist(['events.example.edu', 'example.org']), true);
  for (const bad of [[], ['localhost'], ['10.0.0.1'], ['Example.com'], ['a.com/path'], ['x.com', 'x.com']]) assert.equal(validHostAllowlist(bad), false);
});

test('usable event: scheduled, fresh (≤ 48 h), not started, not sweep-marked', () => {
  assert.equal(catalogueEventUsable(ev(), NOW), null);
  assert.equal(catalogueEventUsable(null, NOW), 'event_not_found');
  assert.equal(catalogueEventUsable(ev({ status: 'cancelled' }), NOW), 'event_cancelled');
  assert.equal(catalogueEventUsable(ev({ status: 'unknown' }), NOW), 'event_status_unknown');
  assert.equal(catalogueEventUsable(ev({ fetchedAtMs: NOW - CATALOGUE_MAX_SOURCE_AGE_MS - 1 }), NOW), 'source_stale');
  assert.equal(catalogueEventUsable(ev({ staleMarked: true }), null), 'source_stale');
  assert.equal(catalogueEventUsable(ev({ startsAtMs: NOW }), NOW), 'event_started');
});

test('intent: allowed kinds only; ends with the event (or start + default duration)', () => {
  assert.equal(guardEventIntent(ev(), 'going', NOW).expiresAtMs, NOW + 72 * H + EVENT_DEFAULT_DURATION_MS);
  assert.equal(guardEventIntent(ev({ endsAtMs: NOW + 73 * H }), 'interested', NOW).expiresAtMs, NOW + 73 * H);
  assert.equal(guardEventIntent(ev(), 'with-bob', NOW).reason, 'invalid_schema');
  const i = { intentId: 'i', ownerId: 'a', eventId: 'evt-1', version: 2, expiresAtMs: NOW + H, revokedAtMs: null, expiredMarked: false };
  assert.equal(intentStands(i, 'a', 'evt-1', 2, NOW), true);
  assert.equal(intentStands(i, 'a', 'evt-1', 1, NOW), false);
  assert.equal(intentStands(i, 'b', 'evt-1', 2, NOW), false);
  assert.equal(intentStands({ ...i, revokedAtMs: NOW }, 'a', 'evt-1', 2, NOW), false);
  assert.equal(intentStands(i, 'a', 'evt-1', 2, NOW + H), false);
});

test('C7 category is preset-only: never a C3 signal category', () => {
  assert.equal(SHARING_CATEGORIES.includes(ACTIVITY_CATEGORY), false);
});

test('C7 approval: needs the preset category, previewed versions, allowlisted topics and the notice; ≤ 24 h', () => {
  const preset = { allowedCategories: ['support_preference', ACTIVITY_CATEGORY], version: 3, assignmentVersion: 2, expiresAtMs: NOW + 100 * H, revoked: false };
  const g = (over = {}) => guardActivityApproval({ ownerId: 'a', recipientId: 'b', pairAccepted: true, preset, topics: ['hiking'],
    allowedTopics: ALLOW.tags, expectedPolicyVersion: 3, expectedAssignmentVersion: 2, consentVersion: 1, nowMs: NOW, ...over });
  assert.deepEqual(g(), { ok: true, topics: ['hiking'], expiresAtMs: NOW + ACTIVITY_APPROVAL_MAX_LIFETIME_MS });
  assert.equal(g({ preset: { ...preset, allowedCategories: ['support_preference'] } }).reason, 'no_preset_category');
  assert.equal(g({ preset: null }).reason, 'no_preset_category');
  assert.equal(g({ expectedPolicyVersion: 2 }).reason, 'stale_revision');
  assert.equal(g({ consentVersion: 0 }).reason, 'stale_revision');
  assert.equal(g({ topics: ['support-group'] }).reason, 'topic_not_allowlisted');
  assert.equal(g({ recipientId: 'a' }).reason, 'not_participant');
  assert.equal(g({ pairAccepted: false }).reason, 'not_participant');
  assert.equal(g({ preset: { ...preset, expiresAtMs: NOW + H } }).expiresAtMs, NOW + H);
  assert.equal(eventErrorCode('no_preset_category'), 'unauthorized');
});

test('C7 approval at use: owner, named recipient, pair, unrevoked, unexpired, preset unchanged, covers the event', () => {
  const a = { approvalId: 'x', ownerId: 'a', recipientId: 'b', pairId: 'p', topics: ['hiking'], recipientPolicyVersion: 3,
    presetAssignmentVersion: 2, consentVersion: 1, expiresAtMs: NOW + H, revokedAtMs: null, expiredMarked: false };
  const preset = { allowedCategories: [ACTIVITY_CATEGORY], version: 3, assignmentVersion: 2, expiresAtMs: NOW + 9 * H, revoked: false };
  const e = { ownerId: 'a', recipientId: 'b', pairId: 'p', eventTopics: ['hiking', 'board-games'] };
  assert.equal(activityApprovalStands(a, preset, e, NOW), null);
  assert.equal(activityApprovalStands(a, preset, { ...e, recipientId: 'c' }, NOW), 'wrong_recipient');
  assert.equal(activityApprovalStands({ ...a, revokedAtMs: NOW }, preset, e, NOW), 'revoked');
  assert.equal(activityApprovalStands(a, preset, e, NOW + H), 'expired');
  assert.equal(activityApprovalStands(a, { ...preset, version: 4 }, e, NOW), 'stale_revision');
  assert.equal(activityApprovalStands(a, { ...preset, allowedCategories: [] }, e, NOW), 'stale_revision');
  assert.equal(activityApprovalStands(a, preset, { ...e, eventTopics: ['live-music'] }, NOW), 'approval_not_current');
});

test('plan check folds freshness, a moved start, intents and basis into the D034 lifecycle inputs', () => {
  const base = { nowMs: NOW, event: ev(), planEventStartsAtMs: NOW + 72 * H, intentsCurrent: true, basisCurrent: true, blocked: false };
  assert.deepEqual(planSourceCheck(base), { nowMs: NOW, eventScheduled: true, intentsCurrent: true, blocked: false });
  assert.equal(planSourceCheck({ ...base, planEventStartsAtMs: NOW + 70 * H }).eventScheduled, false);
  assert.equal(planSourceCheck({ ...base, event: ev({ fetchedAtMs: NOW - 49 * H }) }).eventScheduled, false);
  assert.equal(planSourceCheck({ ...base, basisCurrent: false }).intentsCurrent, false);
  // lifecycle: first acceptance, then a source lapses: the second acceptance is refused
  const state = { planId: 'p', revision: 1, participants: ['a', 'b'], acceptedBy: ['a'], status: 'pending', expiresAtMs: NOW + H, eventStartsAtMs: NOW + 72 * H };
  const r = applyPlanAction(state, { kind: 'accept', actor: 'b', revision: 1 }, planSourceCheck({ ...base, intentsCurrent: false }));
  assert.deepEqual([r.ok, r.reason], [false, 'stale_source']);
});

test('plan timing comes from the catalogue: ≥ 1 h before start, ≤ 48 h, never in the past', () => {
  assert.equal(guardPlanTiming(ev(), NOW + 99 * H, NOW).expiresAtMs, NOW + PLAN_MAX_LIFETIME_MS);
  assert.equal(guardPlanTiming(ev({ startsAtMs: NOW + 10 * H }), NOW + 99 * H, NOW).expiresAtMs, NOW + 10 * H - PLAN_MIN_LEAD_MS);
  assert.equal(guardPlanTiming(ev({ startsAtMs: NOW + PLAN_MIN_LEAD_MS }), NOW + H, NOW).reason, 'lead_time');
  assert.equal(guardPlanTiming(ev(), NOW, NOW).reason, 'invalid_schema');
  assert.equal(guardPlanTiming(ev({ status: 'cancelled' }), NOW + H, NOW).reason, 'event_cancelled');
});
