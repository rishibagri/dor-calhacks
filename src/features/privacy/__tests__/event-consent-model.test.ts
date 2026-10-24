// Event consent copy and controls model (Cyber, CYBER-R3). Pure logic; rendering and live reducers not exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE_MAX_SOURCE_AGE_MS } from '@dor/contracts';
import {
  activityApprovalPreviewCopy, EVENT_ACTION_MESSAGES, intentPreviewCopy, messageForEventError, PLAN_STATUS_COPY, planAcceptCopy,
  runEventAction, sourceAgeLabel,
} from '../event-consent-model.ts';

test('intent preview says who sees it, that the kind stays private, when it ends, and that nothing is booked', () => {
  const c = intentPreviewCopy('Saturday hike');
  for (const must of ['Saturday hike', 'also marked', 'public profile', "won't see whether", 'ends when the event ends', 'withdraw', "doesn't RSVP"]) {
    assert.ok(c.includes(must), must);
  }
});

test('C7 preview names the person and exact topics, the plan side effect, the 24 h limit and revocation', () => {
  const c = activityApprovalPreviewCopy('Sam', ['board-games', 'live-music']);
  assert.ok(c.startsWith('Sam may learn that you\'re interested in board games and live music.'));
  for (const must of ['shared plan suggestion can reveal this', '24 hours', 'revoke']) assert.ok(c.includes(must), must);
});

test('plan copy: both must accept the same version; dor never books, RSVPs, buys or messages', () => {
  const c = planAcceptCopy('Sam');
  for (const must of ['both accepted this version', "doesn't book", 'RSVP', 'buy tickets', 'send messages']) assert.ok(c.includes(must), must);
});

test('source age is truthful and never claims a live feed', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(sourceAgeLabel(now - 10 * 60e3, now), 'Event details updated less than an hour ago');
  assert.equal(sourceAgeLabel(now - 5 * 3600e3, now), 'Event details updated 5 h ago');
  assert.equal(sourceAgeLabel(now - CATALOGUE_MAX_SOURCE_AGE_MS - 1, now), 'Event details may be out of date');
  assert.equal(/live/i.test(sourceAgeLabel(now, now)), false);
});

test('status copy never reveals the other person\'s decision before confirmation', () => {
  assert.equal(/accepted by|they accepted|declined by/i.test(Object.values(PLAN_STATUS_COPY).join(' ')), false);
});

test('refusals map to fixed copy; unknown text is never echoed', async () => {
  assert.equal(messageForEventError(new Error('stale: stale_source')), EVENT_ACTION_MESSAGES.stale_source);
  assert.equal(messageForEventError(new Error('unauthorized: no_preset_category')), EVENT_ACTION_MESSAGES.no_preset_category);
  assert.equal(messageForEventError(new Error('rate_limited: event_intent')), EVENT_ACTION_MESSAGES.rate_limited);
  assert.equal(messageForEventError(new Error('stale: plan by c200b4 for evt-1')), EVENT_ACTION_MESSAGES.generic);
  assert.equal(await runEventAction(async () => { throw new Error('not_found: plan'); }), EVENT_ACTION_MESSAGES.not_found);
  assert.equal(await runEventAction(async () => {}), null);
});
