/**
 * Introduction and discovery safety controls model (Cyber, CYBER-R2). UI-free so it runs under node --test;
 * `introduction-controls.tsx` renders it. CS supplies rows from the `my_introductions` view and an actions
 * port over the generated reducer bindings (README.md). The server decides everything; this file only groups
 * rows and turns `code: reason` refusals into fixed copy, never echoing server text.
 */
import { DISCOVERY_REPORT_REASONS, type DiscoveryReportReason } from '@dor/contracts';

/** One `my_introductions` row (camelCase bindings). No identities or card refs by design. */
export interface IntroductionView {
  introId: string;
  direction: 'incoming' | 'outgoing';
  /** incoming: pending | accepted | declined | closed. outgoing: pending | accepted | closed (a decline is never shown). */
  status: string;
  counterpartName?: string | null;
  sharedTags: readonly string[];
  expiresAt?: Date | null;
}

/** Reducer calls (generated bindings). Each rejects with the reducer's `code: reason` message on refusal. */
export interface IntroductionActionsPort {
  respond(introId: string, accept: boolean): Promise<void>;
  cancel(introId: string): Promise<void>;
  block(introId: string): Promise<void>;
  report(introId: string, reason: DiscoveryReportReason): Promise<void>;
  /** withdraw_discovery_profile: stop being discoverable now. */
  withdraw(): Promise<void>;
}

export interface IntroductionGroups {
  incoming: IntroductionView[];
  outgoing: IntroductionView[];
  connected: IntroductionView[];
}

/** Pending incoming, pending outgoing and accepted; closed/declined rows are history and are not shown. */
export function groupIntroductions(rows: readonly IntroductionView[]): IntroductionGroups {
  const g: IntroductionGroups = { incoming: [], outgoing: [], connected: [] };
  for (const r of rows) {
    if (r.status === 'accepted') g.connected.push(r);
    else if (r.status === 'pending') (r.direction === 'incoming' ? g.incoming : g.outgoing).push(r);
  }
  return g;
}

export const REPORT_REASON_LABELS: Record<DiscoveryReportReason, string> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or unwanted contact',
  impersonation: 'Pretending to be someone else',
  inappropriate_profile: 'Inappropriate name or interests',
  other: 'Something else',
};
export const REPORT_REASONS: readonly DiscoveryReportReason[] = DISCOVERY_REPORT_REASONS;

export const ACTION_MESSAGES = {
  already_requested: 'You have already asked this person recently.',
  not_pending: 'This request is no longer open.',
  expired: 'This request has expired.',
  stale_revision: 'Their profile changed, so this request is no longer open.',
  rate_limited: 'You have reached today\'s limit for this action. Try again tomorrow.',
  unavailable: 'Discovery is switched off right now.',
  not_found: 'This is no longer available.',
  generic: 'That didn\'t work. Please try again.',
} as const;

/** Fixed copy for a refusal. Unknown or malformed errors get the generic line; server text is never shown. */
export function messageForError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const m = /^([a-z_]+): ([a-z_]+)$/.exec(raw);
  if (!m) return ACTION_MESSAGES.generic;
  const [, code, reason] = m;
  if (reason && reason in ACTION_MESSAGES) return ACTION_MESSAGES[reason as keyof typeof ACTION_MESSAGES];
  if (code === 'rate_limited' || code === 'unavailable' || code === 'not_found') return ACTION_MESSAGES[code];
  return ACTION_MESSAGES.generic;
}

/** Runs one action; returns null on success or the fixed message to show. Never throws. */
export async function runAction(fn: () => Promise<void>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return messageForError(e); }
}
