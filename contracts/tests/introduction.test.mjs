import test from 'node:test';
import assert from 'node:assert/strict';
import { IntroductionOutcomeSchema, IntroductionProposalSchema, IntroductionShortlistSchema } from '../dist/index.js';

// SYNTHETIC opaque refs; no names, bios, areas or contact details exist in these shapes.
const candidate = (ref, over = {}) => ({ ref, publicationVersion: 1, reasons: ['shared_interest'], sharedTags: ['board-games'],
  sharedEventId: null, ...over });
const shortlist = (over = {}) => ({ schemaVersion: 1, requestId: 'req-1', viewerRef: 'card-viewer', viewerPublicationVersion: 2,
  candidates: [candidate('card-a'), candidate('card-b', { sharedTags: ['hiking', 'coffee'] })], ...over });
const proposal = (over = {}) => ({ schemaVersion: 1, proposalId: 'intro_1', requestId: 'req-1', viewerRef: 'card-viewer',
  candidateRef: 'card-a', viewerPublicationVersion: 2, candidatePublicationVersion: 1, reasonCode: 'shared_interest',
  sharedTags: ['board-games'], openerId: 'suggest_shared_interest', revision: 1, createdAt: '2026-10-24T06:00:00Z',
  expiresAt: '2026-10-25T06:00:00Z', decidedBy: 'deterministic', ...over });

test('shortlist: at most three unique, stated-overlap candidates; never the viewer; no extra fields', () => {
  assert.equal(IntroductionShortlistSchema.safeParse(shortlist()).success, true);
  assert.equal(IntroductionShortlistSchema.safeParse(shortlist({ candidates: [] })).success, true, 'empty is a valid outcome');
  const reject = (over, why) => assert.equal(IntroductionShortlistSchema.safeParse(shortlist(over)).success, false, why);
  reject({ candidates: ['a', 'b', 'c', 'd'].map(r => candidate(r)) }, 'more than three');
  reject({ candidates: [candidate('a'), candidate('a')] }, 'duplicate candidate');
  reject({ candidates: [candidate('card-viewer')] }, 'self');
  reject({ candidates: [candidate('a', { sharedTags: [] })] }, 'no stated overlap');
  reject({ candidates: [candidate('a', { sharedTags: ['Board Games!'] })] }, 'free text as a tag');
  reject({ candidates: [candidate('a', { reasons: [] })] }, 'no reason');
  reject({ candidates: [candidate('a', { reasons: ['compatibility_92'] })] }, 'unknown reason');
  reject({ candidates: [candidate('a', { sharedEventId: 'evt-1' })] }, 'shared event without the same_event reason');
  reject({ candidates: [candidate('a', { reasons: ['same_event'] })] }, 'same_event reason without the event');
  assert.equal(IntroductionShortlistSchema.safeParse(shortlist({ candidates: [candidate('a', { reasons: ['same_event', 'shared_interest'],
    sharedEventId: 'evt-1' })] })).success, true, 'DS same-event entry');
  reject({ candidates: [candidate('a', { displayName: 'Ana' })] }, 'unknown candidate field');
  reject({ candidates: [candidate('a', { coarseArea: 'cell-123' })] }, 'area never reaches the AI step');
  reject({ journal: 'x' }, 'unknown shortlist field');
});

test('proposal: reason, opener, tags and event agree; no self; no message text', () => {
  assert.equal(IntroductionProposalSchema.safeParse(proposal()).success, true);
  assert.equal(IntroductionProposalSchema.safeParse(proposal({ reasonCode: 'same_event', eventId: 'evt-1', sharedTags: [],
    openerId: 'suggest_event_together' })).success, true);
  const reject = (over, why) => assert.equal(IntroductionProposalSchema.safeParse(proposal(over)).success, false, why);
  reject({ candidateRef: 'card-viewer' }, 'self');
  reject({ reasonCode: 'same_event' }, 'event reason without an event');
  reject({ eventId: 'evt-1' }, 'event without the event reason');
  reject({ sharedTags: [] }, 'interest reason without a tag');
  reject({ openerId: 'suggest_event_together' }, 'opener does not match reason');
  reject({ message: 'Hey! I saw you like board games' }, 'model-written message');
  reject({ sharedTags: ['a1', 'b1', 'c1', 'd1'] }, 'too many tags');
});

test('outcome: codes and counts only', () => {
  const ok = { schemaVersion: 1, requestId: 'req-1', outcome: 'no_candidates', shortlisted: 0, eligible: 0, rounds: 0,
    modelCalls: 0, decidedBy: 'none' };
  assert.equal(IntroductionOutcomeSchema.safeParse(ok).success, true);
  assert.equal(IntroductionOutcomeSchema.safeParse({ ...ok, candidateRef: 'card-a' }).success, false);
  assert.equal(IntroductionOutcomeSchema.safeParse({ ...ok, modelCalls: 3 }).success, false);
});
