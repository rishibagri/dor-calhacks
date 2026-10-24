// DS support-signal pipeline over one evaluation-cases.json case (offline). Policy decisions come from the C6 fake
// (test-only): a pass is not security or live evidence. Shared by the 30-case tests and the Core 4 summary.
import { AgentAckSchema, ApprovedSignalSchema, RecipientPresetAssignmentSchema, RelationshipPresetSchema } from '@dor/contracts';
import type { PolicyResult } from '@dor/contracts';
import { FakeClock, FakeDisclosurePolicy } from '@dor/contracts/fakes';
import { buildNudge, buildPreview, matchSignal, type MatchResult, type PreviewResult } from './matching.ts';

export const SUPPORT_GROUPS = ['partners', 'friends', 'family', 'privacy_attack', 'no_action'];

export interface SupportRun { preview: PreviewResult; policy: PolicyResult | null; match: MatchResult; crossed: unknown[] }

export async function runSupportCase(data: { clock: string; cases: unknown[] }, c: any): Promise<SupportRun> {
  const now = new Date(data.clock);
  const preset = RelationshipPresetSchema.parse(c.preset);
  const assignment = RecipientPresetAssignmentSchema.parse(c.assignment);
  const preview = buildPreview({ candidate: c.candidate, preset, assignment, recipientId: c.deliverTo });
  const policy = c.submittedSignal === null ? null : await new FakeDisclosurePolicy({
    clock: new FakeClock(data.clock), linked: c.state.linked, revoked: c.state.revoked, preset, assignment,
    approved: c.approvedSignal,
  }).check(c.submittedSignal, c.deliverTo);
  const match = matchSignal({ signal: c.submittedSignal, policy, ack: c.ack, now,
    inQuietHours: c.delivery.inQuietHours, lastNudgeAt: c.delivery.lastNudgeAt });
  // What reaches the recipient side: the preview shown to the owner always; envelope and ACK only when allowed.
  const crossed: unknown[] = [preview];
  if (policy?.allowed) crossed.push(c.submittedSignal, c.ack);
  if (match.outcome === 'nudge') {
    crossed.push(buildNudge(ApprovedSignalSchema.parse(c.submittedSignal), AgentAckSchema.parse(c.ack), match,
      { id: `nudge-${SUPPORT_GROUPS.indexOf(c.group)}-${data.cases.indexOf(c)}`, now }));
  }
  return { preview, policy, match, crossed };
}

/** Forbidden terms that crossed to the recipient side (case-insensitive substring, as the 30-case suite checks). */
export function crossedTerms(crossed: unknown[], terms: string[]): string[] {
  const wire = JSON.stringify(crossed).toLowerCase();
  return terms.filter((t) => wire.includes(t.toLowerCase()));
}
