'use client';

import { useState } from 'react';
import type { PrivateAssessment, SignalCandidate } from '@dor/contracts';
import { assessedRecipients, initialLoopState, leftOutByAssessment } from '@/features/voice/assessment';
import { useLiveShared } from '@/components/shell/use-live';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE, answerCompany, answerWho, applyUnnamedExclusionGuard, decide, excludeForNow, failClosedWithoutAssessment,
  type LoopState,
} from './decision-loop-model';
import { PAUSED_NOT_OFFERED, withoutPaused } from './pause-model';
import { shareRecipients } from './share-review-model';
import { ShareReview } from './share-review';

/**
 * Owner-only private decision step between a reflection and any sharing review (Core 2). Neutral questions about
 * the owner's own wishes; skip and "space" are first-class and end in silence. Choosing a person opens an exact-pair
 * review; a current D044 rule may skip per-item approval. Nothing here is stored or sent; the parent
 * unmounts it on lock, pagehide, sign-out and account switch.
 *
 * Claude's optional private assessment (AI, D040, docs/features/PRIVATE_ASSESSMENT.md) can only narrow this loop:
 * stop, skip the company question, leave named people out, or list preferred people first. It never chooses a person.
 * Recipients are re-filtered on every render, so a connection that loads later is still left out.
 */
export function DecisionLoop({ candidate, assessment, onDone }: {
  candidate: SignalCandidate | null; assessment?: PrivateAssessment; onDone: () => void;
}) {
  const shared = useLiveShared();
  const [s, setS] = useState<LoopState>(() => failClosedWithoutAssessment(initialLoopState(candidate, assessment), assessment));
  const [automaticPending, setAutomaticPending] = useState(false);
  const { eligible: unpaused, pausedCount } = withoutPaused(
    shareRecipients(shared.myPairs()).map(({ pairId, name, unnamed }) => ({ pairId, name, unnamed })),
    shared.myRecipientPauses(), new Date());
  const { kept, leftOutUnnamed } = applyUnnamedExclusionGuard(unpaused, (assessment?.excludedNames.length ?? 0) > 0);
  const recipients = assessedRecipients(kept, assessment);
  const leftOut = leftOutByAssessment(kept, assessment);
  const outcome = decide(s, recipients);

  if (outcome.kind === 'ready_for_preview') {
    return (
      <div className="space-y-3">
        <ShareReview candidate={outcome.candidate} recipientPairId={outcome.recipient.pairId} onClose={onDone} onAutomaticPendingChange={setAutomaticPending} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={automaticPending} onClick={() => setS(answerWho(s, 'none'))}>Actually, no one right now</Button>
          <Button size="sm" variant="ghost" disabled={automaticPending} onClick={() => setS(excludeForNow(s, outcome.recipient.pairId))}>
            Not {outcome.recipient.name} this time
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Just for you</CardTitle>
        <CardDescription>{QUESTION_NOTE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pausedCount > 0 && <p className="text-sm text-muted-foreground">{PAUSED_NOT_OFFERED}</p>}
        {leftOut.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Leaving out {leftOut.map((r) => r.name).join(', ')} for now, based on your entry.
          </p>
        )}
        {leftOutUnnamed.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Some connections without a name were left out because you mentioned someone to skip.
          </p>
        )}
        {outcome.kind === 'no_action' && <>
          <p className="text-sm" role="status">{NO_ACTION_COPY[outcome.reason]}</p>
          <div className="flex gap-2">
            {s.company !== null && outcome.reason !== 'nothing_to_share' && (
              <Button size="sm" variant="ghost" onClick={() => setS(answerCompany(s, 'company'))}>I changed my mind</Button>
            )}
            <Button size="sm" variant="outline" onClick={onDone}>Done</Button>
          </div>
        </>}
        {outcome.kind === 'needs_clarification' && outcome.question === 'company' && <>
          <p className="text-sm font-medium">{QUESTION_COPY.company}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setS(answerCompany(s, 'company'))}>Company would be nice</Button>
            <Button size="sm" variant="outline" onClick={() => setS(answerCompany(s, 'space'))}>I’d prefer some space</Button>
            <Button size="sm" variant="ghost" onClick={() => setS(answerCompany(s, 'skip'))}>Skip</Button>
          </div>
        </>}
        {outcome.kind === 'needs_clarification' && outcome.question === 'who' && <>
          <p className="text-sm font-medium">{QUESTION_COPY.who}</p>
          <ul className="space-y-2">
            {outcome.options.map((r) => (
              <li key={r.pairId} className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setS(answerWho(s, r.pairId))}>{r.name}</Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setS(excludeForNow(s, r.pairId))}>
                  Not {r.name} this time
                </Button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => setS(answerWho(s, 'none'))}>No one / not sure</Button>
        </>}
      </CardContent>
    </Card>
  );
}
