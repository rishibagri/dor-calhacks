'use client';

/**
 * Public event suggestions (DS). Props only. Titles are untrusted catalogue text rendered as plain text; links go
 * through Cyber's safeCatalogueUrl and carry nothing we add. No RSVP, booking or attendance is implied.
 */
import { safeCatalogueUrl } from '@kinetic/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ActivityItem, ActivityRankResult } from '../../evaluation/rank';
import { eventEmptyState, toEventCardViews } from './view-model';

export interface EventResultsProps {
  result: ActivityRankResult;
  items: ActivityItem[];
  /** CS source status; 'unavailable' overrides any result. */
  sourceStatus: 'ok' | 'unavailable';
  allowedSourceHosts: string[];
  now: Date;
  utcOffsetMinutes: number;
  /** Explicit user action: open the event to publish an intention or propose a plan (CS/C8). */
  onChoose?: (activityId: string) => void;
  synthetic?: boolean;
}

export function EventResults({ result, items, sourceStatus, allowedSourceHosts, now, utcOffsetMinutes, onChoose, synthetic }: EventResultsProps) {
  const cards = sourceStatus === 'ok' ? toEventCardViews(result, items, now, utcOffsetMinutes) : [];
  const urls = new Map(items.map((i) => [i.activityId, safeCatalogueUrl(i.sourceUrl, allowedSourceHosts)]));
  const empty = sourceStatus === 'unavailable' ? eventEmptyState('source_unavailable')
    : result.kind === 'no_suggestion' ? eventEmptyState(result.reason) : null;
  return (
    <section aria-label="Public events" className="space-y-3">
      <h2 className="text-lg font-semibold">Public events</h2>
      {synthetic && <p className="text-xs text-muted-foreground">Test data: these are synthetic listings, not live events.</p>}
      {empty || cards.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed p-6">
          <p className="font-medium">{empty?.title ?? 'Nothing to show'}</p>
          {empty && <p className="max-w-[65ch] text-sm text-muted-foreground">{empty.body}</p>}
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => {
            const url = urls.get(c.activityId) ?? null;
            return (
              <li key={c.activityId}><Card><CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-words">{c.title}</span>
                  <Badge variant="secondary">{c.format}</Badge>
                </div>
                <p className="text-sm">{c.when}{c.duration ? ` · ${c.duration}` : ''}</p>
                {c.reasons.length > 0 && <p className="text-sm text-foreground/80">{c.reasons.join(' · ')}</p>}
                <p className="text-xs text-muted-foreground">
                  {c.freshness} from {url ? <a className="underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer">{c.sourceSite}</a> : c.sourceSite}. Check the source for tickets and price.
                </p>
                {onChoose && <Button size="sm" variant="outline" onClick={() => onChoose(c.activityId)}>Choose this event</Button>}
              </CardContent></Card></li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
