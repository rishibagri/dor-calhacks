/**
 * REFERENCE / TEST POLICY ONLY (REASONING.md §11). Not the final reasoning algorithm and not product behavior.
 *
 * Stands in for the agentic runtime so the deterministic core can be exercised end to end on synthetic scenarios.
 * It turns a synthetic context into ranked CandidateProposal[] with simple, readable rules. The production runtime
 * will compare contextual tradeoffs with a model; nothing here is a universal threshold.
 * Never imported by src/reasoning/core or production code.
 */
import type { CandidateAction, Level, ReasonCode } from '../core/vocabulary.ts';
import type { CandidateProposal, ReasoningEpisodeInput } from '../core/types.ts';

export type EventKind = 'academic_setback' | 'work_stress' | 'busy_period' | 'major_good_news' | 'silence' |
  'contact_spike' | 'conflict' | 'other';

export interface ReferencePattern {
  id: string;
  trigger: EventKind;
  behavior: 'alone_first' | 'distraction_company' | 'brief_contact_recharges';
  delayMinutes?: number;
  source: 'explicit' | 'inferred';
  confidence: Level;
  evidenceCount: number;
}

export interface ReferencePerson {
  ref: string;
  closeness: 'close' | 'medium' | 'distant';
  involvement: 'none' | 'some' | 'deep';
  goodAt: CandidateAction[];
  calendar: 'free_soon' | 'free_later' | 'busy' | 'unknown';
  receptive: boolean | 'unknown';
  /** Interaction baseline: contacts per 30 days and the share they initiate. */
  baseline?: { contactsPer30d: number; theirInitiationShare: number };
  recent?: { theirInitiations14d: number };
  silenceExplained?: boolean;
}

export interface ReferenceContext {
  event: { kind: EventKind; topic?: string };
  user: { distress: 'still' | 'recovered' | 'unknown'; withPeopleNow: boolean };
  patterns: ReferencePattern[];
  people: ReferencePerson[];
}

const proposal = (p: Partial<CandidateProposal> & Pick<CandidateProposal, 'rank' | 'action' | 'requestedMode'>): CandidateProposal => ({
  evidenceRefs: [], judgments: {}, revealValue: 'low', timing: { kind: 'now' }, confidence: 'medium', rationale: [], ...p,
});
const abstain = (rank: number, why: ReasonCode[]): CandidateProposal =>
  proposal({ rank, action: 'ABSTAIN', requestedMode: 'abstain', rationale: why, confidence: 'high' });

/** Pattern for this event: explicit beats inferred; weak patterns (low/unknown confidence or one observation) are ignored. */
function patternFor(ctx: ReferenceContext): ReferencePattern | undefined {
  const usable = ctx.patterns.filter(p => p.trigger === ctx.event.kind && (p.source === 'explicit' ||
    ((p.confidence === 'medium' || p.confidence === 'high') && p.evidenceCount >= 2)));
  return usable.find(p => p.source === 'explicit') ?? usable[0];
}

/** Baseline-relative: initiations in the last 14 days vs what this person normally does. */
function initiationVsBaseline(p: ReferencePerson): 'above' | 'normal' | 'unknown' {
  if (!p.baseline || !p.recent) return 'unknown';
  const expected = p.baseline.contactsPer30d * p.baseline.theirInitiationShare * (14 / 30);
  return p.recent.theirInitiations14d >= 2 && p.recent.theirInitiations14d >= 2 * Math.max(expected, 0.5) ? 'above' : 'normal';
}

export function referenceProposals(input: ReasoningEpisodeInput, ctx: ReferenceContext): CandidateProposal[] {
  const out: CandidateProposal[] = [];
  const ev = (...refs: string[]) => refs.filter(r => input.evidence.includes(r));

  // Current state beats stale context (P2): with people and no longer distressed → nothing to add.
  if (ctx.user.withPeopleNow && ctx.user.distress !== 'still') {
    out.push(abstain(1, ['already_with_people', 'recovered']));
    return out;
  }

  const pattern = patternFor(ctx);
  switch (ctx.event.kind) {
    case 'academic_setback':
    case 'work_stress':
    case 'busy_period': {
      if (pattern?.behavior === 'alone_first') {
        out.push(abstain(1, ['pattern_prefers_alone']));
        break;
      }
      if (!pattern) { out.push(abstain(1, ['low_confidence'])); break; }
      for (const person of ctx.people.filter(x => x.goodAt.includes('CASUAL_INVITE'))) {
        const base = { action: 'CASUAL_INVITE' as const, targetRef: person.ref, evidenceRefs: ev(`pattern:${pattern.id}`, `person:${person.ref}`) };
        // Availability is not receptiveness (P3).
        if (person.receptive === false) { out.push(proposal({ ...base, rank: 9, requestedMode: 'act', dismissed: 'not_receptive' })); continue; }
        if (person.calendar !== 'free_soon') {
          // Do not queue the invite for later (P9); preserve only the question (P14).
          out.push(proposal({ ...base, rank: 9, requestedMode: 'act', dismissed: 'unavailable' }));
          out.push(proposal({ rank: 1, action: 'DEFER', requestedMode: 'defer', rationale: ['unavailable', 'distress_still_relevant'],
            reassess: { afterMinutes: 90, condition: 'distress_still_relevant' }, confidence: 'medium' }));
          continue;
        }
        out.push(proposal({ ...base, rank: 1, requestedMode: 'act', confidence: person.receptive === true ? 'high' : 'low',
          timing: pattern.delayMinutes ? { kind: 'after_delay', delayMinutes: pattern.delayMinutes } : { kind: 'now' },
          rationale: ['pattern_prefers_company'], judgments: { personal_fit: 'high', relationship_fit: 'high', mutual_receptiveness: 'high' } }));
      }
      if (!out.some(p => p.rank === 1)) out.push(abstain(1, ['no_relational_value']));
      break;
    }
    case 'major_good_news': {
      for (const person of ctx.people) {
        const base = { targetRef: person.ref, topic: ctx.event.topic, evidenceRefs: ev('assessment:event', `person:${person.ref}`) };
        if (person.involvement === 'deep' && person.closeness === 'close') {
          // Preserve the human moment (P5, P6): help the user tell them personally.
          out.push(proposal({ ...base, rank: 1, action: 'HELP_USER_REACH_OUT', requestedMode: 'act', revealValue: 'high',
            confidence: 'high', rationale: ['preserve_personal_delivery'] }));
          out.push(proposal({ ...base, rank: 9, action: 'CELEBRATE', requestedMode: 'act', revealValue: 'high', dismissed: 'high_reveal_value' }));
        } else if (person.involvement === 'some') {
          out.push(proposal({ ...base, rank: 2, action: 'CELEBRATE', requestedMode: 'act', revealValue: 'medium', confidence: 'medium' }));
        }
      }
      out.push(abstain(5, ['no_relational_value']));
      break;
    }
    case 'silence': {
      for (const person of ctx.people) {
        const base = { action: 'RECONNECT' as const, targetRef: person.ref, evidenceRefs: ev(`person:${person.ref}`) };
        if (person.silenceExplained) {
          // Silence is not distress; an explained gap needs nothing.
          out.push(proposal({ ...base, rank: 9, requestedMode: 'act', dismissed: 'explained_silence' }));
        } else if (person.calendar === 'free_soon' && person.receptive === true) {
          out.push(proposal({ ...base, rank: 1, requestedMode: 'act', confidence: 'medium', rationale: ['mutual_opening'] }));
        }
      }
      out.push(abstain(2, [ctx.people.some(p => p.silenceExplained) ? 'explained_silence' : 'no_relational_value']));
      break;
    }
    case 'contact_spike': {
      for (const person of ctx.people) {
        const base = { action: 'CASUAL_INVITE' as const, targetRef: person.ref, evidenceRefs: ev(`person:${person.ref}`, `book:${person.ref}`) };
        // Two check-ins mean different things for different friends (P4).
        if (initiationVsBaseline(person) === 'above' && person.calendar === 'free_soon') {
          out.push(proposal({ ...base, rank: 1, requestedMode: 'act', confidence: 'high', rationale: ['above_baseline'] }));
        } else {
          out.push(proposal({ ...base, rank: 9, requestedMode: 'act', dismissed: 'saturated_vs_baseline' }));
        }
      }
      out.push(abstain(2, ['saturated_vs_baseline']));
      break;
    }
    case 'conflict': {
      // Conflict lowers automation (P8): help the user act, never act on the other person.
      for (const person of ctx.people) {
        out.push(proposal({ rank: 1, action: 'HELP_USER_REACH_OUT', targetRef: person.ref, requestedMode: 'ask',
          evidenceRefs: ev('assessment:risk', `person:${person.ref}`), confidence: 'medium', rationale: ['preserve_personal_delivery'] }));
      }
      out.push(abstain(2, ['no_relational_value']));
      break;
    }
    default:
      out.push(abstain(1, ['no_relational_value']));
  }
  if (!out.some(p => p.action === 'ABSTAIN')) out.push(abstain(50, ['no_relational_value']));
  return out;
}
