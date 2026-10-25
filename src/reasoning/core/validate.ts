/**
 * Hand-written validators (no Zod in core). Unknown keys are rejected. Invalid episode input ends in `abstain`;
 * an invalid proposal is rejected on its own; an invalid decision is replaced by `abstain` in finalize().
 */
import {
  ACTION_SURFACE, CANDIDATE_ACTIONS, DELIVERY_MAPPING, LEVELS, REASON_CODES, REASONING_MODES, REASSESS_CONDITIONS, RISKS,
  TARGETED_ACTIONS,
} from './vocabulary.ts';
import type { CandidateProposal, ReasoningDecision, ReasoningEpisodeInput } from './types.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: Rec, keys: readonly string[]) => Object.keys(o).every(k => keys.includes(k));
const isIn = <T extends string>(xs: readonly T[], v: unknown): v is T => typeof v === 'string' && (xs as readonly string[]).includes(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && /T.*(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,80}$/.test(v);
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 50 && v.every(isId);
const isMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 60 * 24 * 30;

export function validateInput(x: unknown): x is ReasoningEpisodeInput {
  if (!isRec(x) || !onlyKeys(x, ['schemaVersion', 'episodeId', 'now', 'hardStops', 'explicitIntent', 'window', 'relationships', 'evidence'])) return false;
  if (x.schemaVersion !== 1 || !isId(x.episodeId) || !isTime(x.now) || !isIds(x.evidence)) return false;
  const h = x.hardStops, e = x.explicitIntent, w = x.window;
  if (!isRec(h) || !onlyKeys(h, ['risk', 'assessmentValid']) || !isIn(RISKS, h.risk) || typeof h.assessmentValid !== 'boolean') return false;
  if (!isRec(e) || !onlyKeys(e, ['wantsSpace', 'doesNotWantToTalk', 'excludedRefs', 'namedRefs']) ||
    typeof e.wantsSpace !== 'boolean' || typeof e.doesNotWantToTalk !== 'boolean' || !isIds(e.excludedRefs) || !isIds(e.namedRefs)) return false;
  if (!isRec(w) || !onlyKeys(w, ['startedAt', 'inferredMinutes', 'confidence', 'fallbackMinutes']) || !isTime(w.startedAt) ||
    !isIn(LEVELS, w.confidence) || !isMinutes(w.fallbackMinutes) || (w.inferredMinutes !== undefined && !isMinutes(w.inferredMinutes))) return false;
  if (!Array.isArray(x.relationships) || x.relationships.length > 50) return false;
  const refs = new Set<string>();
  for (const r of x.relationships) {
    if (!isRec(r) || !onlyKeys(r, ['ref', 'gates', 'conflict', 'sensitiveTopics']) || !isId(r.ref) || refs.has(r.ref)) return false;
    refs.add(r.ref);
    if (!isIn(['none', 'unresolved', 'unknown'] as const, r.conflict)) return false;
    if (r.sensitiveTopics !== 'unknown' && !isIds(r.sensitiveTopics)) return false;
    const g = r.gates;
    if (!isRec(g) || !onlyKeys(g, ['paused', 'optedOut', 'cooldownUntil', 'quietHoursNow', 'presetRevoked', 'presetCategories'])) return false;
    if (typeof g.paused !== 'boolean' || typeof g.presetRevoked !== 'boolean') return false;
    if (g.optedOut !== 'unknown' && typeof g.optedOut !== 'boolean') return false;
    if (g.quietHoursNow !== 'unknown' && typeof g.quietHoursNow !== 'boolean') return false;
    if (g.cooldownUntil !== undefined && !isTime(g.cooldownUntil)) return false;
    if (!Array.isArray(g.presetCategories) || !g.presetCategories.every(c => c === 'support_preference' || c === 'coarse_availability')) return false;
  }
  return true;
}

const PROPOSAL_KEYS = ['rank', 'action', 'targetRef', 'requestedMode', 'evidenceRefs', 'judgments', 'revealValue', 'topic',
  'timing', 'reassess', 'alternativeInterpretation', 'confidence', 'rationale', 'dismissed'];

/** Shape and internal consistency of one proposal (gates are applied separately). */
export function validateProposal(p: unknown): p is CandidateProposal {
  if (!isRec(p) || !onlyKeys(p, PROPOSAL_KEYS)) return false;
  if (typeof p.rank !== 'number' || !Number.isFinite(p.rank) || !isIn(CANDIDATE_ACTIONS, p.action) || !isIn(REASONING_MODES, p.requestedMode)) return false;
  if (!isIds(p.evidenceRefs) || !isIn(LEVELS, p.revealValue) || !isIn(LEVELS, p.confidence)) return false;
  if (!Array.isArray(p.rationale) || !p.rationale.every(c => isIn(REASON_CODES, c))) return false;
  if (p.dismissed !== undefined && !isIn(REASON_CODES, p.dismissed)) return false;
  if (p.alternativeInterpretation !== undefined && !isIn(REASON_CODES, p.alternativeInterpretation)) return false;
  if (p.topic !== undefined && !isId(p.topic)) return false;
  if (!isRec(p.judgments) || !Object.values(p.judgments).every(l => isIn(LEVELS, l))) return false;
  const t = p.timing;
  if (!isRec(t) || !onlyKeys(t, ['kind', 'delayMinutes']) || !isIn(['now', 'after_delay', 'not_now'] as const, t.kind) ||
    (t.delayMinutes !== undefined && !isMinutes(t.delayMinutes))) return false;
  if (p.reassess !== undefined && (!isRec(p.reassess) || !onlyKeys(p.reassess, ['afterMinutes', 'condition']) ||
    !isMinutes(p.reassess.afterMinutes) || !isIn(REASSESS_CONDITIONS, p.reassess.condition))) return false;
  // Action ↔ mode consistency.
  const a = p.action, m = p.requestedMode;
  if (a === 'ABSTAIN' && m !== 'abstain') return false;
  if (a === 'DEFER' && (m !== 'defer' || p.reassess === undefined || p.targetRef !== undefined)) return false;
  if (a !== 'DEFER' && p.reassess !== undefined) return false;
  if (a === 'ASK' && m !== 'ask') return false;
  if (TARGETED_ACTIONS.includes(a) && (m !== 'act' && m !== 'ask')) return false;
  if (TARGETED_ACTIONS.includes(a) && !isId(p.targetRef)) return false;
  if ((a === 'ABSTAIN') && p.targetRef !== undefined) return false;
  if (a === 'ASK' && p.targetRef !== undefined && !isId(p.targetRef)) return false;
  if (m === 'act' && t.kind === 'not_now') return false;
  return true;
}

/** Output invariants (REASONING.md §10): defer carries no action; abstain no target; recipient act has a mapping. */
export function validateDecision(d: ReasoningDecision): boolean {
  if (d.schemaVersion !== 1 || !isIn(REASONING_MODES, d.mode) || !isTime(d.contextExpiresAt) || d.summary.length > 200) return false;
  if (d.mode === 'defer' && (d.reassess === undefined || d.action !== undefined || d.targetRef !== undefined || d.deliveryMapping)) return false;
  if (d.mode !== 'defer' && d.reassess !== undefined) return false;
  if (d.mode === 'abstain' && (d.action !== undefined || d.targetRef !== undefined || d.deliveryMapping)) return false;
  if (d.deliveryMapping && !(d.mode === 'act' && d.action && ACTION_SURFACE[d.action] === 'recipient')) return false;
  if (d.mode === 'act' && d.action && ACTION_SURFACE[d.action] === 'recipient' &&
    (!d.deliveryMapping || DELIVERY_MAPPING[d.action]?.supportMode !== d.deliveryMapping.supportMode)) return false;
  if (d.mode === 'act' && d.evidenceRefs.length === 0) return false;
  const actions = new Set([d.action, ...d.rejected.map(r => r.action)]);
  if (d.mode !== 'abstain' && !actions.has('ABSTAIN')) return false;
  if (d.mode !== 'defer' && !actions.has('DEFER')) return false;
  return true;
}
