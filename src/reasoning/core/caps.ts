/**
 * Automation caps (REASONING.md §12). A cap lowers a recipient-facing `act` to `ask`; it never raises a mode.
 * Caps encode the parts of the behavior that must hold whatever the proposer concluded: preserve high-reveal moments,
 * respect sensitive topics, lower automation under uncertainty, keep unnamed targets offline-only, and never deliver
 * an action that has no template.
 */
import { ACTION_SURFACE, DELIVERY_MAPPING, atLeastMedium, type ReasonCode, type ReasoningMode } from './vocabulary.ts';
import type { CandidateProposal, FinalizeOptions, ReasoningEpisodeInput } from './types.ts';

export interface CapResult { mode: ReasoningMode; by?: ReasonCode; /** D055 autonomous: drop instead of asking. */ reject?: ReasonCode }

export function capProposal(p: CandidateProposal, input: ReasoningEpisodeInput, opts: FinalizeOptions): CapResult {
  if (p.requestedMode !== 'act' || ACTION_SURFACE[p.action] !== 'recipient') return { mode: p.requestedMode };
  const rel = input.relationships.find(r => r.ref === p.targetRef);
  const ask = (by: ReasonCode): CapResult => (opts.autonomous ? { mode: p.requestedMode, reject: by } : { mode: 'ask', by });
  // P5: automation would take the moment away from the person. In autonomous mode the friend reaches out instead and
  // the owner still shares the news themselves, so the moment stays theirs (D055).
  if (p.revealValue === 'high' && !opts.autonomous) return ask('high_reveal_value');
  if (p.topic !== undefined && rel && (rel.sensitiveTopics === 'unknown' || rel.sensitiveTopics.includes(p.topic))) return ask('sensitive_topic');
  // P12: high uncertainty lowers automation.
  if (!atLeastMedium(p.confidence)) return ask('low_confidence');
  // §9 C1b: acting toward a connection the user did not name is offline/test-only in v1.
  if (!opts.allowUnnamedTargets && p.targetRef !== undefined && !input.explicitIntent.namedRefs.includes(p.targetRef)) return ask('unnamed_target');
  // §9 C3: no recipient template for this action yet.
  if (!DELIVERY_MAPPING[p.action]) return ask('no_delivery_path');
  return { mode: 'act' };
}
