import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveEpisode, fallbackProposals, reasonLive, type LiveContext, type ModelReasoning } from '../live.ts';
import { validateInput } from '../../core/validate.ts';

const NOW = '2026-10-25T18:00:00Z';
const ctx = (over: Partial<LiveContext> = {}): LiveContext => ({
  now: NOW, episodeId: 'ep-live',
  candidate: { supportMode: 'shared_activity', availability: 'today' },
  assessment: { intent: 'unclear', risk: 'none', mentionedNames: ['Sam'], excludedNames: [], preferredNames: [] },
  people: [
    { ref: 'p-sam', mentionedAs: 'Sam', excluded: false, paused: false, presetRevoked: false },
    { ref: 'p-maya', mentionedAs: null, excluded: false, paused: false, presetRevoked: false },
  ],
  ...over,
});
const proposal = (over: Partial<ModelReasoning['proposals'][number]>): ModelReasoning['proposals'][number] => ({
  rank: 1, action: 'CASUAL_INVITE', targetRef: 'p-sam', requestedMode: 'act', supportMode: 'shared_activity', revealValue: 'low',
  confidence: 'high', timing: 'now', delayMinutes: null, reassessMinutes: null, reassessCondition: null,
  rationale: ['pattern_prefers_company'], evidence: ['entry:text', 'person:p-sam'], ...over,
});
const model = (proposals: ModelReasoning['proposals'], over: Partial<ModelReasoning['situation']> = {}, people: ModelReasoning['people'] = []): ModelReasoning => ({
  situation: { eventKind: 'academic_setback', topic: 'exam', windowMinutes: 180, windowConfidence: 'medium', doesNotWantToTalk: false, ...over },
  people, proposals: [...proposals, proposal({ rank: 5, action: 'ABSTAIN', targetRef: null, requestedMode: 'abstain', supportMode: null, evidence: [] })],
});

test('episode built from live context is valid core input; names never appear in it', () => {
  const input = buildLiveEpisode(ctx(), null);
  assert.ok(validateInput(input));
  assert.ok(!JSON.stringify(input).includes('Sam'));
  assert.deepEqual(input.explicitIntent.namedRefs, ['p-sam']);
});

test('model proposal that passes every gate acts automatically, with the existing enum delivery mapping', async () => {
  const r = await reasonLive(ctx(), async () => model([proposal({})]));
  assert.equal(r.source, 'model');
  assert.equal(r.decision.mode, 'act');
  assert.equal(r.decision.deliveryMapping?.supportMode, 'shared_activity');
});

test('model may be proactive toward an unnamed connection when evidence and gates allow it', async () => {
  const r = await reasonLive(ctx(), async () => model([proposal({ targetRef: 'p-maya', evidence: ['entry:text', 'person:p-maya'] })]));
  assert.equal(r.decision.mode, 'act');
  assert.equal(r.decision.targetRef, 'p-maya');
});

test('the core still overrides the model: excluded, paused, high-reveal, conflict', async () => {
  const excluded = await reasonLive(ctx({ people: [{ ref: 'p-sam', mentionedAs: 'Sam', excluded: true, paused: false, presetRevoked: false }] }),
    async () => model([proposal({})]));
  assert.equal(excluded.decision.mode, 'abstain');
  const paused = await reasonLive(ctx({ people: [{ ref: 'p-sam', mentionedAs: 'Sam', excluded: false, paused: true, presetRevoked: false }] }),
    async () => model([proposal({})]));
  assert.equal(paused.decision.mode, 'abstain');
  // D056: high-reveal news no longer asks; the friend reaches out and the owner still tells them.
  const reveal = await reasonLive(ctx(), async () => model([proposal({ action: 'DIRECT_CHECK_IN', supportMode: 'encouraging_note', revealValue: 'high' })]));
  assert.equal(reveal.decision.mode, 'act');
  const conflict = await reasonLive(ctx({ assessment: { intent: 'unclear', risk: 'interpersonal_conflict', mentionedNames: ['Sam'], excludedNames: [], preferredNames: [] } }),
    async () => model([proposal({})]));
  assert.notEqual(conflict.decision.mode, 'act');
});

test('sensitive topics reported by the model drop that person (D056: dropped, not asked)', async () => {
  const r = await reasonLive(ctx(), async () => model([proposal({ action: 'DIRECT_CHECK_IN', supportMode: 'short_call' })], { topic: 'interviews' },
    [{ ref: 'p-sam', sensitiveTopics: ['interviews'] }]));
  assert.equal(r.decision.mode, 'abstain');
  assert.ok(r.decision.rejected.some(x => x.targetRef === 'p-sam' && x.reason === 'sensitive_topic'));
  assert.deepEqual(r.actions, []);
});

test('D056/D058 good exam + earlier goal: several friends nudged at once, each with a generic starter id; never asks', async () => {
  const people = [
    { ref: 'p-sam', mentionedAs: null, excluded: false, paused: false, presetRevoked: false },
    { ref: 'p-maya', mentionedAs: null, excluded: false, paused: false, presetRevoked: false },
    { ref: 'p-lee', mentionedAs: null, excluded: false, paused: true, presetRevoked: false },
  ];
  const c = ctx({ people, memoryIds: ['m1'], assessment: { intent: 'wants_connection', risk: 'none', mentionedNames: [], excludedNames: [], preferredNames: [] } });
  const r = await reasonLive(c, async () => ({
    ...model([
      proposal({ action: 'CELEBRATE', supportMode: 'encouraging_note', targetRef: 'p-sam', evidence: ['entry:text', 'memory:m1', 'person:p-sam'], talkingPoint: 'ask_new' }),
      proposal({ rank: 2, action: 'DIRECT_CHECK_IN', supportMode: 'short_call', targetRef: 'p-maya', evidence: ['entry:text', 'memory:m1', 'person:p-maya'], talkingPoint: 'Ask how the exam went, she did well' }),
      proposal({ rank: 3, action: 'CELEBRATE', supportMode: 'encouraging_note', targetRef: 'p-lee', evidence: ['entry:text', 'person:p-lee'] }),
    ], { eventKind: 'major_good_news', topic: 'exam' }),
    memory: { add: [{ kind: 'event', text: 'did well on an exam', ref: null, ttlDays: 3 }], expire: ['m1'] },
  }));
  assert.equal(r.decision.mode, 'act');
  assert.deepEqual(r.actions.map(a => [a.decision.targetRef, a.talkingPoint]), [['p-sam', 'ask_new'], ['p-maya', null]]); // free text from the entry is dropped
  assert.ok(r.actions.every(a => a.decision.mode === 'act'), 'paused Lee is never nudged');
  assert.deepEqual(r.memory?.expire, ['m1']);
});

test('D058 talking points are ids from the fixed generic list only; any text is dropped', async () => {
  const { cleanTalkingPoint } = await import('../live.ts');
  const { TALKING_POINT_IDS, talkingPointText } = await import('@dor/contracts/policy');
  for (const id of TALKING_POINT_IDS) assert.equal(cleanTalkingPoint(id), id);
  assert.equal(cleanTalkingPoint('Ask how the exam went'), null);
  assert.equal(cleanTalkingPoint('see https://x.example'), null);
  assert.equal(cleanTalkingPoint(null), null);
  assert.equal(talkingPointText('coffee'), 'Suggest grabbing coffee or a meal.');
  assert.equal(talkingPointText('Ask how the exam went'), null); // an old free-text row never displays
});

test('model failure or garbage falls back to the conservative proposer; hard stops never reach the model', async () => {
  const failed = await reasonLive(ctx(), async () => { throw new Error('down'); });
  assert.equal(failed.source, 'fallback');
  assert.equal(failed.decision.mode, 'act', 'one uniquely named connection still works without the model');
  let called = false;
  const urgent = await reasonLive(ctx({ assessment: { intent: 'wants_space', risk: 'urgent_support', mentionedNames: [], excludedNames: [], preferredNames: [] } }),
    async () => { called = true; return model([proposal({})]); });
  assert.equal(called, false);
  assert.equal(urgent.decision.mode, 'abstain');
  const missing = await reasonLive(ctx({ assessment: null }), async () => { called = true; return model([proposal({})]); });
  assert.equal(called, false);
  assert.equal(missing.decision.mode, 'abstain');
});

test('fallback is never proactive toward unnamed people', () => {
  const none = fallbackProposals(ctx({ people: [{ ref: 'p-maya', mentionedAs: null, excluded: false, paused: false, presetRevoked: false }] }));
  assert.deepEqual(none.map(p => p.action), ['ABSTAIN']);
});

test('a deferred model decision keeps only the reassessment condition', async () => {
  const r = await reasonLive(ctx(), async () => model([proposal({ action: 'DEFER', targetRef: null, requestedMode: 'defer', supportMode: null,
    reassessMinutes: 90, reassessCondition: 'distress_still_relevant', evidence: [] })]));
  assert.equal(r.decision.mode, 'defer');
  assert.deepEqual(r.decision.reassess, { afterMinutes: 90, condition: 'distress_still_relevant' });
  assert.equal(r.decision.targetRef, undefined);
});
