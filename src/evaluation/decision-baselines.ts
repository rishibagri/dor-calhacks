/**
 * DS Core 3: deterministic comparison systems for the decision loop. Evaluation only; nothing here ships.
 *
 * - `d040_loop`: the current pipeline (decision-loop.ts `d040Loop`).
 * - `loop_without_assessment`: CS's loop with the assessment dropped and without the D042 fail-closed guard (the
 *   pre-D040 path, where a missing assessment meant "ask normally"; pauses still apply). Historical comparison only:
 *   the app now ends such an entry in `no_action: assessment_missing`.
 *   Same owner taps.
 * - `preview_on_candidate`: DS's existing support baseline (`matching.ts` `buildPreview`) used as a generic
 *   "support match is enough" rule: whenever a candidate is shareable it previews for the person the owner picked,
 *   else the first connection. It ignores space, skip, exclusions, pauses and the assessment. README calls this insufficient;
 *   it is the strawman that shows what the loop prevents, never a candidate design.
 */
import { RecipientPresetAssignmentSchema, RelationshipPresetSchema } from '@dor/contracts';
import { decide, type Outcome } from '../components/feature/decision-loop-model.ts';
import { d040Loop, recipientsOf, replay, type DecisionSystem } from './decision-loop.ts';
import { buildPreview } from './matching.ts';

export const loopWithoutAssessment: DecisionSystem = (file, c) =>
  replay(file, c.story, c.candidate, c.recipients, c.steps, null, c.pauses, false).outcome;

export const previewOnCandidate: DecisionSystem = (file, c): Outcome => {
  const people = recipientsOf(file, c.recipients);
  const picked = [...c.steps].reverse().find((s): s is { who: string } => 'who' in s && s.who !== 'none');
  const recipient = people.find((r) => r.pairId === picked?.who) ?? people[0];
  if (!recipient) return { kind: 'no_action', reason: 'no_eligible_recipient' };
  const person = file.people[recipient.pairId]!;
  const preset = RelationshipPresetSchema.parse({
    schemaVersion: 1, policyId: 'baseline-policy', ownerId: file.ownerId, presetKind: 'friend', purpose: 'support_nudge',
    allowedCategories: ['support_preference', 'coarse_availability'], approvalMode: 'each_item', version: 1,
    expiresAt: '2100-01-01T00:00:00Z', revokedAt: null,
  });
  const assignment = RecipientPresetAssignmentSchema.parse({
    schemaVersion: 1, ownerId: file.ownerId, recipientId: person.recipientId, pairId: recipient.pairId,
    presetId: preset.policyId, assignmentVersion: 1,
  });
  const p = buildPreview({ candidate: c.candidate, preset, assignment, recipientId: person.recipientId });
  return p.kind === 'preview'
    ? { kind: 'ready_for_preview', recipient, candidate: p.fields }
    : decide({ candidate: null, company: null, chosen: null, excluded: [], asked: [] }, people);
};

export const DECISION_SYSTEMS: Record<string, DecisionSystem> = {
  d040_loop: d040Loop,
  loop_without_assessment: loopWithoutAssessment,
  preview_on_candidate: previewOnCandidate,
};
