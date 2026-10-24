'use client';

/**
 * Discover results (DS). Receives authorized data via props only; it never fetches, subscribes or sends anything.
 * Inviting, blocking and reporting are explicit user actions passed back to the page (CS), which calls the guarded
 * reducers. Report sends nothing until the person picks an allowlisted reason and confirms.
 */
import { useId, useState } from 'react';
import type { DiscoveryReportReason } from '@dor/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { DiscoveryCandidate, DiscoveryShortlist } from './types';
import { emptyState, REPORT_NOTICE, REPORT_REASON_LABEL, REPORT_REASONS, toCardViews, type CardView, type EmptyAction } from './view-model';

export interface DiscoveryResultsProps {
  shortlist: DiscoveryShortlist;
  /** The same authorized candidate page the shortlist was ranked from. */
  candidates: DiscoveryCandidate[];
  /** Event mode: the public catalogue title, shown in the reason line. */
  eventTitle?: string;
  onInvite: (ref: string) => void;
  onBlock: (ref: string) => void;
  /** Card-level report (D038, `report_discovery_user` with kind `card`). Omitted ⇒ no Report button. */
  onReport?: (ref: string, reason: DiscoveryReportReason) => void;
  onEmptyAction?: (action: Exclude<EmptyAction, null>) => void;
  /** Refs with an invitation already sent or in flight. */
  invitedRefs?: ReadonlySet<string>;
  /** Shown when CS's query is still synthetic so nobody mistakes seeded people for neighbours. */
  synthetic?: boolean;
}

const ACTION_LABEL: Record<Exclude<EmptyAction, null>, string> = {
  publish_profile: 'Set up discovery profile',
  add_interests: 'Add interests',
  publish_event_intent: 'Mark interest in this event',
  browse_events: 'Browse public events',
};

function ReportForm({ onReport, onCancel }: { onReport: (reason: DiscoveryReportReason) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<DiscoveryReportReason>('spam');
  const id = useId();
  return (
    <form className="grid gap-2 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); onReport(reason); }}>
      <Label htmlFor={id}>Why are you reporting?</Label>
      <select id={id} className="h-9 rounded-md border bg-background px-2 text-sm" value={reason}
        onChange={(e) => setReason(e.target.value as DiscoveryReportReason)}>
        {REPORT_REASONS.map((r) => <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>)}
      </select>
      <p className="text-sm text-muted-foreground">{REPORT_NOTICE}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="destructive">Report and block</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PersonCard({ card, invited, onInvite, onBlock, onReport }: {
  card: CardView; invited: boolean; onInvite: () => void; onBlock: () => void; onReport?: (reason: DiscoveryReportReason) => void;
}) {
  const [reporting, setReporting] = useState(false);
  return (
    <li className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"><Card><CardContent className="space-y-3 pt-6">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">{card.initials}</span>
        <span className="font-medium break-words">{card.displayName}</span>
      </div>
      <ul aria-label="Published interests" className="flex flex-wrap gap-1.5">
        {card.tags.map((t) => <li key={t.slug}><Badge variant={t.shared ? 'default' : 'outline'}>{t.label}</Badge></li>)}
      </ul>
      <ul className="space-y-1 text-sm text-foreground/80">{card.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onInvite} disabled={invited}>{invited ? 'Invitation sent' : 'Send introduction request'}</Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onBlock}>Block</Button>
        {onReport && !reporting && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setReporting(true)}>Report</Button>
        )}
      </div>
      {onReport && reporting && (
        <ReportForm onReport={(reason) => { setReporting(false); onReport(reason); }} onCancel={() => setReporting(false)} />
      )}
    </CardContent></Card></li>
  );
}

export function DiscoveryResults({ shortlist, candidates, eventTitle, onInvite, onBlock, onReport, onEmptyAction, invitedRefs, synthetic }: DiscoveryResultsProps) {
  const cards = toCardViews(shortlist, candidates, eventTitle);
  const heading = shortlist.mode === 'event' ? 'People interested in this event' : 'People in your selected area';
  return (
    <section aria-label={heading} className="space-y-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      {synthetic && <p className="text-xs text-muted-foreground">Test data: these are synthetic profiles, not real people.</p>}
      {shortlist.kind === 'none' || cards.length === 0 ? (() => {
        const empty = emptyState(shortlist.kind === 'none' ? shortlist.reason : 'no_fit', shortlist.mode);
        return (
          <div className="space-y-3 rounded-lg border border-dashed p-6">
            <p className="font-medium">{empty.title}</p>
            <p className="max-w-[65ch] text-sm text-muted-foreground">{empty.body}</p>
            {empty.action && onEmptyAction && (
              <Button size="sm" variant="outline" onClick={() => onEmptyAction(empty.action!)}>{ACTION_LABEL[empty.action]}</Button>
            )}
          </div>
        );
      })() : (
        <>
          <p className="max-w-[65ch] text-sm text-muted-foreground">
            These people chose to be discoverable. They only see that you reached out if you send a request, and nothing else about you is shared.
          </p>
          <ul className="space-y-3">
            {cards.map((c) => (
              <PersonCard key={c.ref} card={c} invited={invitedRefs?.has(c.ref) ?? false}
                onInvite={() => onInvite(c.ref)} onBlock={() => onBlock(c.ref)}
                onReport={onReport ? (reason) => onReport(c.ref, reason) : undefined} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
