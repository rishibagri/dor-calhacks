/**
 * Reasoning runtime for the live app (REASONING.md §3.2). Provider-agnostic: the model is reached only through the
 * `ReasoningModelPort` the caller injects (the app's /api/reasoning route); context arrives as plain LiveContext.
 *
 * Pipeline: model proposals (or the deterministic fallback) → episode input → deterministic core (finalize) → decision.
 * The core always has the last word; any model failure falls back, and the fallback itself never widens anything.
 */
import type { PrivateAssessment, SignalCandidate, SupportMode } from '@dor/contracts';
import { isTalkingPointId, type TalkingPointId } from '@dor/contracts/policy';
import { finalize } from '../core/finalize.ts';
import {
  ACTION_SUPPORT_MODES, CANDIDATE_ACTIONS, LEVELS, REASON_CODES, REASONING_MODES, REASSESS_CONDITIONS,
  type CandidateAction, type Level, type ReasonCode,
} from '../core/vocabulary.ts';
import type { CandidateProposal, ContextWindow, ReasoningDecision, ReasoningEpisodeInput } from '../core/types.ts';
import type { MemoryKind, MemoryUpdate } from './memory.ts';

/** One accepted connection as the owner's device sees it. `ref` is the pair id; names never leave the device. */
export interface LivePerson {
  ref: string;
  /** The literal name as written in the entry when it uniquely matched this connection, else null. */
  mentionedAs: string | null;
  excluded: boolean;
  paused: boolean;
  presetRevoked: boolean;
}

export interface LiveContext {
  now: string;
  episodeId: string;
  candidate: SignalCandidate | null;
  assessment: PrivateAssessment | null;
  people: LivePerson[];
  /** D056: ids of remembered facts the model was shown; it may cite them as `memory:<id>`. */
  memoryIds?: string[];
}

export const EVENT_KINDS = ['academic_setback', 'work_stress', 'busy_period', 'major_good_news', 'milestone', 'homesick',
  'silence', 'contact_spike', 'conflict', 'social_moment', 'everyday', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** What the model returns (validated server-side by the route, re-validated here). Refs only, never names. */
export interface ModelReasoning {
  situation: {
    eventKind: EventKind;
    topic: string | null;
    windowMinutes: number;
    windowConfidence: Level;
    doesNotWantToTalk: boolean;
  };
  people: { ref: string; sensitiveTopics: string[] }[];
  proposals: {
    rank: number;
    action: CandidateAction;
    targetRef: string | null;
    requestedMode: (typeof REASONING_MODES)[number];
    supportMode: SupportMode | null;
    revealValue: Level;
    confidence: Level;
    timing: 'now' | 'after_delay' | 'not_now';
    delayMinutes: number | null;
    reassessMinutes: number | null;
    reassessCondition: (typeof REASSESS_CONDITIONS)[number] | null;
    rationale: ReasonCode[];
    evidence: string[];
    /** D056: what the friend should bring up when they reach out ("ask how the exam went"), or null. */
    /** D058: an id from TALKING_POINTS (generic conversation starters), never free text. */
    talkingPoint?: string | null;
  }[];
  /** D056: facts worth remembering for later entries, and remembered facts this entry makes stale. */
  memory?: { add: { kind: MemoryKind; text: string; ref: string | null; ttlDays: number }[]; expire: string[] };
}

/** The model port. Returns null when unavailable; the runtime then uses the deterministic fallback. */
export type ReasoningModelPort = (request: { people: { ref: string; mentionedAs: string | null; excluded: boolean; paused: boolean }[] }) =>
  Promise<ModelReasoning | null>;

/** At most this many friends are nudged from one entry. */
export const MAX_AUTO_TARGETS = 3;

const FALLBACK_WINDOW_MINUTES = 180;
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const isIn = <T extends string>(xs: readonly T[], v: unknown): v is T => typeof v === 'string' && (xs as readonly string[]).includes(v);

export function evidenceFor(ctx: LiveContext): string[] {
  return ['entry:text', 'assessment:intent', 'assessment:names', ...(ctx.candidate ? ['candidate:mode'] : []),
    ...(ctx.memoryIds ?? []).map(id => `memory:${id}`), ...ctx.people.map(p => `person:${p.ref}`)];
}

export function buildLiveEpisode(ctx: LiveContext, model: ModelReasoning | null): ReasoningEpisodeInput {
  const a = ctx.assessment;
  const sens = new Map((model?.people ?? []).map(p => [p.ref, p.sensitiveTopics.map(slug).filter(Boolean).slice(0, 10)]));
  const window: ContextWindow = {
    startedAt: ctx.now, fallbackMinutes: FALLBACK_WINDOW_MINUTES,
    confidence: model ? model.situation.windowConfidence : 'low',
    ...(model ? { inferredMinutes: Math.max(15, Math.min(model.situation.windowMinutes, 60 * 24 * 14)) } : {}),
  };
  return {
    schemaVersion: 1, episodeId: ctx.episodeId, now: ctx.now,
    hardStops: { risk: a?.risk ?? 'none', assessmentValid: a !== null },
    explicitIntent: {
      wantsSpace: a?.intent === 'wants_space',
      doesNotWantToTalk: model?.situation.doesNotWantToTalk ?? false,
      excludedRefs: ctx.people.filter(p => p.excluded).map(p => p.ref),
      namedRefs: ctx.people.filter(p => p.mentionedAs !== null).map(p => p.ref),
    },
    window,
    relationships: ctx.people.map(p => ({
      ref: p.ref,
      gates: { paused: p.paused, optedOut: 'unknown', quietHoursNow: 'unknown', presetRevoked: p.presetRevoked,
        presetCategories: ['support_preference', 'coarse_availability'] },
      conflict: 'none', sensitiveTopics: sens.get(p.ref) ?? [],
    })),
    evidence: evidenceFor(ctx),
  };
}

/** Model output → CandidateProposal[]; anything malformed is dropped here and re-checked by the core. */
export function proposalsFromModel(model: ModelReasoning, ctx: LiveContext): CandidateProposal[] {
  const known = new Set(evidenceFor(ctx));
  const topic = model.situation.topic ? slug(model.situation.topic) || undefined : undefined;
  const out: CandidateProposal[] = [];
  for (const m of model.proposals.slice(0, 8)) {
    if (!isIn(CANDIDATE_ACTIONS, m.action) || !isIn(REASONING_MODES, m.requestedMode)) continue;
    const modes = ACTION_SUPPORT_MODES[m.action] ?? [];
    out.push({
      rank: Number.isFinite(m.rank) ? m.rank : 9,
      action: m.action,
      ...(m.targetRef && m.action !== 'DEFER' && m.action !== 'ABSTAIN' ? { targetRef: m.targetRef } : {}),
      requestedMode: m.requestedMode,
      evidenceRefs: m.evidence.filter(e => known.has(e)).slice(0, 10),
      judgments: {},
      revealValue: isIn(LEVELS, m.revealValue) ? m.revealValue : 'unknown',
      ...(m.supportMode && modes.includes(m.supportMode) ? { supportMode: m.supportMode } : {}),
      ...(topic ? { topic } : {}),
      timing: { kind: m.timing, ...(m.timing === 'after_delay' && m.delayMinutes ? { delayMinutes: Math.min(m.delayMinutes, 720) } : {}) },
      ...(m.action === 'DEFER' && m.reassessMinutes && m.reassessCondition
        ? { reassess: { afterMinutes: Math.max(15, Math.min(m.reassessMinutes, 720)), condition: m.reassessCondition } } : {}),
      confidence: isIn(LEVELS, m.confidence) ? m.confidence : 'unknown',
      rationale: m.rationale.filter(r => isIn(REASON_CODES, r)).slice(0, 4),
    });
  }
  return out;
}

const ACTION_FOR_MODE: Record<SupportMode, CandidateAction> = {
  short_call: 'DIRECT_CHECK_IN', encouraging_note: 'DIRECT_CHECK_IN', shared_activity: 'CASUAL_INVITE',
};

/**
 * Deterministic fallback proposer: used when the model is unavailable. Conservative: it acts only toward one
 * named connection (as D050 does today), otherwise abstains. Never proactive toward unnamed people.
 */
export function fallbackProposals(ctx: LiveContext): CandidateProposal[] {
  const abstain: CandidateProposal = { rank: 3, action: 'ABSTAIN', requestedMode: 'abstain', evidenceRefs: [], judgments: {},
    revealValue: 'none', timing: { kind: 'now' }, confidence: 'high', rationale: ['no_relational_value'] };
  const a = ctx.assessment;
  if (!a || !ctx.candidate || a.intent === 'wants_space' || a.risk !== 'none') return [{ ...abstain, rank: 1 }];
  const named = ctx.people.filter(p => p.mentionedAs !== null && !p.excluded);
  const mode: SupportMode = ctx.candidate.supportMode ?? 'encouraging_note';
  const base = (p: LivePerson, rank: number, requestedMode: 'act' | 'ask'): CandidateProposal => ({
    rank, action: ACTION_FOR_MODE[mode], targetRef: p.ref, requestedMode, supportMode: mode,
    evidenceRefs: ['entry:text', 'assessment:names', 'candidate:mode', `person:${p.ref}`], judgments: {}, revealValue: 'low',
    timing: { kind: 'now' }, confidence: a.intent === 'wants_connection' ? 'high' : 'medium', rationale: [],
  });
  if (named.length === 1) return [base(named[0]!, 1, 'act'), abstain];
  // D056: several named people are all nudged (capped later); the fallback is still never proactive toward unnamed ones.
  if (named.length > 1) return [...named.map((p, n) => base(p, n + 1, 'act')), { ...abstain, rank: named.length + 1 }];
  return [abstain];
}

export interface LiveDecision {
  decision: ReasoningDecision;
  /** D056: every friend to nudge (≤ MAX_AUTO_TARGETS), primary first; empty unless `decision.mode` is act. */
  actions: { decision: ReasoningDecision; talkingPoint: TalkingPointId | null }[];
  memory: MemoryUpdate | null;
  source: 'model' | 'fallback';
  input: ReasoningEpisodeInput;
}

/** D058: a talking point is an id from the fixed generic list (TALKING_POINTS), never free text; anything else is dropped. */
export function cleanTalkingPoint(raw: string | null | undefined): TalkingPointId | null {
  return isTalkingPointId(raw) ? raw : null;
}

/**
 * D056: one decision per distinct target the model wants to act toward. Each runs through finalize() on its own (with
 * the shared ABSTAIN), so every gate and cap applies per person; only `act` results are kept.
 */
function autonomousActions(input: ReasoningEpisodeInput, proposals: CandidateProposal[], model: ModelReasoning | null,
  primary: ReasoningDecision): LiveDecision['actions'] {
  if (primary.mode !== 'act' || !primary.targetRef) return [];
  const hooks = new Map<string, TalkingPointId | null>();
  for (const m of model?.proposals ?? []) if (m.targetRef && !hooks.has(m.targetRef)) hooks.set(m.targetRef, cleanTalkingPoint(m.talkingPoint));
  const abstain = proposals.filter(p => p.action === 'ABSTAIN');
  const out: LiveDecision['actions'] = [{ decision: primary, talkingPoint: hooks.get(primary.targetRef) ?? null }];
  const seen = new Set([primary.targetRef]);
  for (const p of [...proposals].sort((a, b) => a.rank - b.rank)) {
    if (out.length >= MAX_AUTO_TARGETS) break;
    if (!p.targetRef || seen.has(p.targetRef) || p.requestedMode !== 'act') continue;
    seen.add(p.targetRef);
    const d = finalize(input, [{ ...p, rank: 0 }, ...abstain], { allowUnnamedTargets: true, autonomous: true });
    if (d.mode === 'act' && d.targetRef === p.targetRef) out.push({ decision: d, talkingPoint: hooks.get(p.targetRef) ?? null });
  }
  return out;
}

export async function reasonLive(ctx: LiveContext, model: ReasoningModelPort | null): Promise<LiveDecision> {
  let out: ModelReasoning | null = null;
  // Hard stops never reach the model: urgent support, conflict and a missing assessment are decided by the core.
  const stop = !ctx.assessment || ctx.assessment.risk === 'urgent_support';
  if (model && !stop) {
    try { out = await model({ people: ctx.people.map(({ ref, mentionedAs, excluded, paused }) => ({ ref, mentionedAs, excluded, paused })) }); }
    catch { out = null; }
  }
  const input = buildLiveEpisode(ctx, out);
  const proposals = out ? proposalsFromModel(out, ctx) : fallbackProposals(ctx);
  // Owner chose proactive behavior (REASONING.md §9 C1b) and, with D056, autonomous delivery: no "ask" outcome.
  const decision = finalize(input, proposals, { allowUnnamedTargets: out !== null, autonomous: true });
  const memory = out?.memory ? { add: out.memory.add ?? [], expire: out.memory.expire ?? [] } : null;
  return { decision, actions: autonomousActions(input, proposals, out, decision), memory, source: out ? 'model' : 'fallback', input };
}
