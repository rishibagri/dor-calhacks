'use client';

import { useState } from 'react';
import type { SignalCandidate } from '@dor/contracts';
import { useLiveShared } from '@/components/shell/use-live';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE, answerCompany, answerWho, decide, excludeForNow, startLoop,
  type LoopState,
} from './decision-loop-model';
import { shareRecipients } from './share-review-model';
import { ShareReview } from './share-review';

/**
 * Owner-only private decision step between a reflection and any sharing preview (Core 2). Neutral questions about
 * the owner's own wishes; skip and "space" are first-class and end in silence. Choosing a person only opens the
 * existing exact-recipient preview, which still needs its own approval. Nothing here is stored or sent; the parent
 * unmounts it on lock, pagehide, sign-out and account switch.
 */
export function DecisionLoop({ candidate, onDone }: { candidate: SignalCandidate | null; onDone: () => void }) {
  const shared = useLiveShared();
  const [s, setS] = useState<LoopState>(() => startLoop(candidate));
  const recipients = shareRecipients(shared.myPairs()).map(({ pairId, name }) => ({ pairId, name }));
  const outcome = decide(s, recipients);

  if (outcome.kind === 'ready_for_preview') {
    return (
      <div className="space-y-3">
        <ShareReview candidate={outcome.candidate} recipientPairId={outcome.recipient.pairId} onClose={onDone} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setS(answerWho(s, 'none'))}>Actually, no one right now</Button>
          <Button size="sm" variant="ghost" onClick={() => setS(excludeForNow(s, outcome.recipient.pairId))}>
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
