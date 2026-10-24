/**
 * Recipient pause guards (Cyber, D041, implemented offline). `guardPauseRequest` and `pauseActive` are enforced by the
 * module's `pause_recipient` / `resume_recipient` / `pauseInForce`; `guardNotPaused`, `pauseInvalidates` and
 * `previewRecipients` are the same rules for clients and tests. Runtime-dependency-free (re-exported from
 * `@dor/contracts/policy`).
 *
 * Two owner-side restrictions, both NARROWING only (they never broaden a preset or create permission):
 *  - Episode exclusion: "not Alex" for the current private decision. Device-only, never stored on the server,
 *    never sent to a model or peer. The device simply never offers Alex a preview in this episode.
 *  - Recipient pause: an explicit, time-bounded server record ("pause sharing with Alex until …"). It refuses
 *    new approvals, kills every existing approval to that person at once (so neither expiry nor resume can bring
 *    one back), and is invisible to everyone except its owner. It stores no reason and has no free-text field.
 *
 * Callers pass the authenticated caller (ctx.sender), authoritative rows and `nowMs` from ctx.timestamp, or null
 * in clockless views (the expiry sweep marks lapsed pauses).
 */

/** Longest pause a single action can set. Longer or permanent separation is unlink, an existing action. */
export const PAUSE_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Shortest meaningful pause; also guards against an expiry that is already past by the time it lands. */
export const PAUSE_MIN_LIFETIME_MS = 15 * 60 * 1000;

export type PauseDenyReason = 'invalid_schema' | 'not_participant' | 'pair_not_accepted' | 'too_long' | 'too_short';
type Deny = { ok: false; reason: PauseDenyReason };
const no = (reason: PauseDenyReason): Deny => ({ ok: false, reason });

export interface PausePair { pairId: string; memberA: string; memberB: string | null; status: string }

/**
 * Owner sets a pause on the OTHER member of a pair they belong to. The target is derived from the pair, never
 * taken from the request, so a pause can't name a stranger or be used to probe identities.
 */
export function guardPauseRequest(input: { callerId: string; pair: PausePair | null; expiresAtMs: unknown; nowMs: number }):
  { ok: true; targetId: string; expiresAtMs: number } | Deny {
  const { callerId, pair, nowMs } = input;
  if (!pair || (pair.memberA !== callerId && pair.memberB !== callerId)) return no('not_participant');
  if (pair.status !== 'accepted' || !pair.memberB) return no('pair_not_accepted');
  if (!Number.isSafeInteger(input.expiresAtMs) || !Number.isFinite(nowMs)) return no('invalid_schema');
  const exp = input.expiresAtMs as number;
  if (exp < nowMs + PAUSE_MIN_LIFETIME_MS) return no('too_short');
  if (exp > nowMs + PAUSE_MAX_LIFETIME_MS) return no('too_long');
  return { ok: true, targetId: pair.memberA === callerId ? pair.memberB : pair.memberA, expiresAtMs: exp };
}

export interface RecipientPauseState {
  pauseId: string;
  ownerId: string;
  targetId: string;
  pairId: string;
  /** Bumped on every set, extend or resume for this owner + pair. */
  version: number;
  expiresAtMs: number;
  /** Ended early by the owner. */
  resumedAtMs: number | null;
  /** Set by the expiry sweep (clockless views). */
  expiredMarked: boolean;
}

/** Whether this pause is in force now. */
export function pauseActive(p: RecipientPauseState | null, nowMs: number | null): boolean {
  return Boolean(p && p.resumedAtMs === null && !p.expiredMarked && (nowMs === null || p.expiresAtMs > nowMs));
}

/**
 * The one check approval, use and commit all add: is `ownerId` currently pausing `recipientId` in this pair?
 * The refusal is deliberately `revoked`, the same reason a revoked approval gets, so the worker, its logs and
 * any outcome code cannot tell a pause from an ordinary revocation (pause metadata stays owner-only).
 */
export function guardNotPaused(pauses: readonly RecipientPauseState[], ownerId: string, recipientId: string, pairId: string,
  nowMs: number | null): { allowed: true } | { allowed: false; reason: 'revoked' } {
  const hit = pauses.some(p => p.ownerId === ownerId && p.targetId === recipientId && p.pairId === pairId && pauseActive(p, nowMs));
  return hit ? { allowed: false, reason: 'revoked' } : { allowed: true };
}

/**
 * What a new pause must invalidate in the same transaction: every standing approval from the owner to the target
 * in that pair (revoked, so expiry or resume can't restore it) and every nudge derived from them (suppressed).
 * Returns the ids; the reducer performs the writes.
 */
export function pauseInvalidates<S extends { signalId: string; senderId: string; recipientId: string; pairId: string; revokedAtMs: number | null },
  N extends { nudgeId: string; pairId: string; sourceSignalIds: readonly string[]; suppressed: boolean }>(
  pause: { ownerId: string; targetId: string; pairId: string }, signals: readonly S[], nudges: readonly N[],
): { revokeSignalIds: string[]; suppressNudgeIds: string[] } {
  const revokeSignalIds = signals.filter(s => s.senderId === pause.ownerId && s.recipientId === pause.targetId &&
    s.pairId === pause.pairId && s.revokedAtMs === null).map(s => s.signalId);
  const hit = new Set(signals.filter(s => s.senderId === pause.ownerId && s.recipientId === pause.targetId && s.pairId === pause.pairId)
    .map(s => s.signalId));
  const suppressNudgeIds = nudges.filter(n => !n.suppressed && n.pairId === pause.pairId && n.sourceSignalIds.some(id => hit.has(id)))
    .map(n => n.nudgeId);
  return { revokeSignalIds, suppressNudgeIds };
}

/**
 * Device-side recipient list for a share preview: drops anyone excluded in this episode or under an active pause.
 * Never substitutes another person: an excluded recipient simply isn't offered, and nothing picks someone else.
 */
export function previewRecipients<R extends { pairId: string; counterpartId: string }>(recipients: readonly R[], ownerId: string,
  episodeExcludedIds: ReadonlySet<string>, pauses: readonly RecipientPauseState[], nowMs: number): R[] {
  return recipients.filter(r => !episodeExcludedIds.has(r.counterpartId) &&
    guardNotPaused(pauses, ownerId, r.counterpartId, r.pairId, nowMs).allowed);
}
