/**
 * Concise factual decision summaries from fixed templates (REASONING.md §2.9). No names, no free text, no model
 * chain-of-thought: only codes rendered as short phrases.
 */
import type { CandidateAction, ReasonCode, ReasoningMode } from './vocabulary.ts';

const ACTION_PHRASE: Record<CandidateAction, string> = {
  DIRECT_CHECK_IN: 'a check-in', CASUAL_INVITE: 'a casual invite', SHARED_ACTIVITY: 'a shared activity',
  CELEBRATE: 'a celebration', PRACTICAL_HELP: 'practical help', RECONNECT: 'a low-pressure reconnect',
  HELP_USER_REACH_OUT: 'reaching out yourself', ASK: 'a choice for you', DEFER: 'waiting', ABSTAIN: 'no action',
};

const REASON_PHRASE: Partial<Record<ReasonCode, string>> = {
  hard_stop: 'a safety stop applies', invalid_input: 'the input could not be read', explicit_intent: 'you said so',
  context_expired: 'the moment has passed', conflict: 'there is unresolved tension', sensitive_topic: 'the topic is sensitive here',
  high_reveal_value: 'this is yours to share', low_confidence: 'dor is not sure enough', unnamed_target: 'you did not name them',
  no_delivery_path: 'dor cannot send this kind of note yet', already_with_people: 'you are already with people',
  recovered: 'things look better now', pattern_prefers_alone: 'you usually recharge alone first',
  pattern_prefers_company: 'company usually helps you', unavailable: 'they are not free soon', not_receptive: 'they may not want contact now',
  saturated_vs_baseline: 'you are already in touch as usual', above_baseline: 'they are reaching out more than usual',
  explained_silence: 'the quiet has a clear reason', mutual_opening: 'there is a natural opening',
  preserve_personal_delivery: 'this is yours to tell', no_relational_value: 'it would not add much now',
  distress_still_relevant: 'it may still matter later',
};

export function summarize(mode: ReasoningMode, action: CandidateAction | undefined, reasons: readonly ReasonCode[]): string {
  const why = reasons.map(r => REASON_PHRASE[r]).filter(Boolean).slice(0, 2).join('; ');
  const head =
    mode === 'act' ? `Suggest ${ACTION_PHRASE[action ?? 'ABSTAIN']} now` :
    mode === 'ask' ? `Ask you about ${ACTION_PHRASE[action ?? 'ASK']}` :
    mode === 'defer' ? 'Look again later from scratch' : 'No action';
  return (why ? `${head}: ${why}.` : `${head}.`).slice(0, 200);
}
