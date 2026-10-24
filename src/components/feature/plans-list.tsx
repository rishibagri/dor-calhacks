'use client';

import { useState } from 'react';
import type { PlanView } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PLAN_STATUS_COPY, planAcceptCopy, runEventAction } from '@/features/privacy/event-consent-model';
import { SOURCE_HOSTS } from '@/lib/catalogue/feeds';
import { safeCatalogueUrl } from '@dor/contracts';
import { orThrow } from './introduction-actions';
import { canAccept, canCancel, formatWhen, orderPlans } from './events-model';

function PlanRow({ plan }: { plan: PlanView }) {
  const shared = useLiveShared();
  const [message, setMessage] = useState<string | null>(null);
  const name = plan.counterpartName ?? 'your match';
  const link = plan.sourceUrl ? safeCatalogueUrl(plan.sourceUrl, SOURCE_HOSTS) : null;
  const act = async (fn: () => Promise<void>, done: string) => setMessage((await runEventAction(fn)) ?? done);

  return (
    <li><Card><CardContent className="space-y-2 pt-6 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{plan.eventTitle || 'A local event'} with {name}</p>
        <Badge variant={plan.status === 'confirmed' ? 'default' : 'secondary'}>{plan.status}</Badge>
      </div>
      <p className="text-muted-foreground">
        <time dateTime={plan.eventStartsAt}>{formatWhen(plan.eventStartsAt)}</time>
        {link && <> · <a className="underline" href={link} target="_blank" rel="noopener noreferrer nofollow">Event page</a></>}
      </p>
      <p>{PLAN_STATUS_COPY[plan.status] ?? PLAN_STATUS_COPY.closed}{plan.status === 'pending' && plan.myAcceptance ? '. You accepted.' : ''}</p>
      {canAccept(plan) && <p className="text-muted-foreground">{planAcceptCopy(name)}</p>}
      <div className="flex flex-wrap gap-2">
        {canAccept(plan) && <>
          <Button size="sm" onClick={() => void act(() => orThrow(shared.respondPlan(plan.planId, plan.revision, true)), 'Accepted.')}>Accept</Button>
          <Button size="sm" variant="outline" onClick={() => void act(() => orThrow(shared.respondPlan(plan.planId, plan.revision, false)), 'Declined.')}>Decline</Button>
        </>}
        {canCancel(plan) && !canAccept(plan) && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void act(() => orThrow(shared.cancelPlan(plan.planId)), 'Cancelled.')}>Cancel plan</Button>
        )}
      </div>
      {message && <p role="status" className="text-muted-foreground">{message}</p>}
    </CardContent></Card></li>
  );
}

/** The caller's own shared plans. A plan is an in-app agreement only: nothing is booked, bought or sent. */
export function PlansList() {
  const plans = orderPlans(useLiveShared().myPlans());
  return (
    <section aria-label="Plans" className="space-y-3">
      <h2 className="text-lg font-semibold">Plans</h2>
      {plans.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No plans yet. When you and someone you have been introduced to both mark the same event, a plan to go together can be suggested here.
        </p>
      )}
      <ul className="space-y-3">{plans.map((p) => <PlanRow key={p.planId} plan={p} />)}</ul>
    </section>
  );
}
