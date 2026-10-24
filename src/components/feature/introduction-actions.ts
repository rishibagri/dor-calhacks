/**
 * Adapts SharedStatePort results to Cyber's IntroductionActionsPort, which rejects with the reducer's
 * `code: reason` text so `messageForError` can map it to fixed copy (server text is never shown).
 */
import type { IntroductionActionsPort, IntroductionView as ControlRow } from '../../features/privacy/introduction-model.ts';
import type { IntroductionView, ReducerResult, SharedStatePort } from '../../lib/backend/ports.ts';

export async function orThrow(result: Promise<ReducerResult>): Promise<void> {
  const r = await result;
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
}

export function introductionActions(shared: SharedStatePort): IntroductionActionsPort {
  return {
    respond: (id, accept) => orThrow(shared.respondIntroductionRequest(id, accept)),
    cancel: (id) => orThrow(shared.cancelIntroductionRequest(id)),
    block: (id) => orThrow(shared.blockIntroductionParticipant(id)),
    report: (id, reason) => orThrow(shared.reportDiscoveryUser({ kind: 'introduction', ref: id }, reason)),
    withdraw: () => orThrow(shared.withdrawDiscoveryProfile()),
  };
}

/** my_introductions rows in the shape Cyber's controls render (expiry as a Date). */
export function toControlRows(rows: readonly IntroductionView[]): ControlRow[] {
  return rows.map((r) => ({ ...r, expiresAt: r.expiresAt ? new Date(r.expiresAt) : null }));
}
