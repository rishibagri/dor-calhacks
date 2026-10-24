import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApprovedSignalSchema, NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import { BoundedCoordinator, AckProposalSchema } from '@dor/agents';
const scenarios = JSON.parse(await readFile(new URL('../../../../contracts/fixtures/scenarios.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(await readFile(new URL('../../../agents/fixtures/coordination.synthetic.json', import.meta.url), 'utf8'));
const signal = scenarios.find((s: { scenario: string }) => s.scenario === 'partners').approvedSignal;
const privateContext = 'I told my friend I was sick but went to a party Friday night.';

test('sick/party scenario: private context is rejected at the approved signal boundary', () => {
  for (const field of ['journal', 'reason', 'event', 'suggestedQuestion']) {
    assert.equal(ApprovedSignalSchema.safeParse({ ...signal, [field]: privateContext }).success, false);
  }
  assert.equal(AckProposalSchema.safeParse({ decision: 'compatible', optionIndex: 0,
    text: 'Ask your friend what they did Friday night.' }).success, false);
});

test('a model cannot add a Friday-night question to an authorized relationship nudge', async () => {
  const seen: unknown[] = [];
  const coordinator = new BoundedCoordinator({
    clock: { now: () => new Date('2026-10-24T00:00:00Z') },
    policy: { check: async () => ({ allowed: true, reason: 'ok' }) },
    preferences: { current: async () => fixture.preferences.partners },
    delivery: { current: async () => ({ delivery: fixture.defaultDelivery, lastNudgeAt: null }) },
    proposer: { propose: async input => { seen.push(input); return { decision: 'compatible', optionIndex: 0,
      text: 'Ask your friend what they did Friday night.' }; } },
  });
  const result = await coordinator.coordinate([signal], 'synthetic-relational-safety');
  assert.ok(seen.length > 0);
  for (const input of seen) assert.deepEqual(Object.keys(input as object).sort(), ['approved', 'options', 'round']);
  assert.equal(JSON.stringify(seen).includes(privateContext), false);
  // A configured deterministic fallback may still produce a consented generic invitation; never model copy.
  for (const nudge of result.proposedNudges) {
    const copy = NUDGE_TEMPLATE_COPY[nudge.templateId];
    assert.ok(copy);
    assert.doesNotMatch(copy, /Friday|party|sick|what they did/i);
    assert.equal('text' in nudge, false);
  }
  assert.doesNotMatch(JSON.stringify(result), /Friday|party|sick|what they did/i);
});
