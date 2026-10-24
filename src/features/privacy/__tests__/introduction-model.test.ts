// Introduction controls model (Cyber, CYBER-R2). Pure logic only; rendering and the live reducers are not exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_REPORT_REASONS } from '@dor/contracts';
import {
  ACTION_MESSAGES, groupIntroductions, messageForError, REPORT_REASON_LABELS, REPORT_REASONS, runAction,
  type IntroductionView,
} from '../introduction-model.ts';

const row = (over: Partial<IntroductionView>): IntroductionView =>
  ({ introId: 'i', direction: 'incoming', status: 'pending', counterpartName: 'Sam', sharedTags: ['hiking'], ...over });

test('groups pending incoming, pending outgoing and accepted; history is not shown', () => {
  const g = groupIntroductions([
    row({ introId: 'a' }), row({ introId: 'b', direction: 'outgoing', counterpartName: null }),
    row({ introId: 'c', status: 'accepted' }), row({ introId: 'd', status: 'declined' }), row({ introId: 'e', direction: 'outgoing', status: 'closed' }),
  ]);
  assert.deepEqual(g.incoming.map(r => r.introId), ['a']);
  assert.deepEqual(g.outgoing.map(r => r.introId), ['b']);
  assert.deepEqual(g.connected.map(r => r.introId), ['c']);
});

test('refusals map to fixed copy; server text, identifiers and unknown shapes are never echoed', () => {
  assert.equal(messageForError(new Error('stale: already_requested')), ACTION_MESSAGES.already_requested);
  assert.equal(messageForError(new Error('rate_limited: introduction_request')), ACTION_MESSAGES.rate_limited);
  assert.equal(messageForError(new Error('unavailable: disabled')), ACTION_MESSAGES.unavailable);
  assert.equal(messageForError(new Error('not_found: introduction')), ACTION_MESSAGES.not_found);
  for (const leak of ['stale: user c200b4… declined you', 'Error: connect ECONNREFUSED 10.0.0.5', '', 42, null] as unknown[]) {
    assert.equal(messageForError(leak instanceof Error ? leak : new Error(String(leak))), ACTION_MESSAGES.generic);
  }
});

test('the sender-facing copy cannot reveal a decline', () => {
  const copy = Object.values(ACTION_MESSAGES).join(' ').toLowerCase();
  assert.equal(/declin|reject|turned down/.test(copy), false);
});

test('report reasons are exactly the server allowlist, each with a label', () => {
  assert.deepEqual([...REPORT_REASONS], [...DISCOVERY_REPORT_REASONS]);
  for (const r of DISCOVERY_REPORT_REASONS) assert.ok(REPORT_REASON_LABELS[r]);
});

test('runAction never throws and returns null on success', async () => {
  assert.equal(await runAction(async () => {}), null);
  assert.equal(await runAction(async () => { throw new Error('stale: not_pending'); }), ACTION_MESSAGES.not_pending);
});
