'use client';

import { useState } from 'react';
import { INTRODUCTION_OPENER_COPY } from '@dor/contracts';
import type { IntroductionProposalView } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tagLabel } from '@/features/discovery/view-model';
import { runAction } from '@/features/privacy/introduction-model';
import { orThrow } from './introduction-actions';
import { newIntroductionRequestId } from './discover-model';

function openerText(p: IntroductionProposalView): string {
  const tag = p.sharedTags[0];
  return INTRODUCTION_OPENER_COPY[p.openerId].replace('{tag}', tag ? tagLabel(tag).toLowerCase() : 'the same interest');
}

/**
 * The viewer's own AI suggestions, shown only to them with fixed copy (no model-written text). A suggestion is
 * not a request: nothing is sent until the viewer taps Send. "Suggest someone" (D048) asks the worker for at most
 * one suggestion among the people the viewer can already see; it contacts nobody.
 */
export function IntroductionSuggestions() {
  const shared = useLiveShared();
  const proposals = shared.myIntroductionProposals();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    const err = await runAction(fn);
    setBusy(null);
    setMessage(err ?? done);
  };

  const askForSuggestion = () => void act('ask', () => orThrow(shared.requestIntroductionSuggestion(newIntroductionRequestId())),
    'Asked. If someone here shares your interests, a suggestion appears in this card. Nobody is contacted.');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested for you</CardTitle>
        <CardDescription>Only you see these. Nobody is contacted unless you choose to send a request.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {proposals.length === 0 && (
          <Button size="sm" variant="outline" disabled={busy === 'ask'} onClick={askForSuggestion}>Suggest someone for me</Button>
        )}
        <ul className="space-y-3">
          {proposals.map((p) => (
            <li key={p.proposalId} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm">{openerText(p)}</p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === p.proposalId}
                  onClick={() => void act(p.proposalId, () => orThrow(shared.sendIntroductionRequest(p.candidateRef, newIntroductionRequestId())), 'Request sent.')}>
                  Send request
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === p.proposalId}
                  onClick={() => void act(p.proposalId, () => orThrow(shared.dismissIntroductionProposal(p.proposalId)), 'Suggestion dismissed.')}>
                  Not now
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
