'use client';

/**
 * Places that host one or two existing feature components unchanged (spec, "Existing components hosted inside the
 * room"). Eligibility, consent and delivery stay in those components; only the framing is new.
 */
import { useState } from 'react';
import { useLiveShared } from '@/components/shell/use-live';
import { discoverStage } from '@/components/feature/discover-model';
import { DiscoveryProfile } from '@/components/feature/discovery-profile';
import { DiscoveryArea } from '@/components/feature/discovery-area';
import { AccountInvites } from '@/components/feature/account-invites';
import { PlansList } from '@/components/feature/plans-list';
import { introductionActions, toControlRows } from '@/components/feature/introduction-actions';
import { readPref, sessionStore } from '@/components/feature/transition-model';
import { IntroductionControls } from '@/features/privacy/introduction-controls';
import { cn } from '@/lib/utils';
import { navigateRoom } from '../room-link';
import { placeById, type PlaceId } from '../layout';
import { AboutYou } from './about-you';

function PlaceHeader({ title, note }: { title: string; note: string }) {
  return (
    <header className="space-y-2">
      <h2 className="place-title">{title}</h2>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{note}</p>
    </header>
  );
}

export function PinboardPlace() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const stage = discoverStage(me, Date.now());
  return (
    <div className="space-y-6">
      <PlaceHeader title="Your pinboard" note="Only the cards you pin are shown, and only after you flip the sign to “Visible nearby”. Taking it down hides it right away." />
      <DiscoveryProfile me={me} isLive={stage === 'ready' || stage === 'needs_area'} />
    </div>
  );
}

export function MatPlace() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const isDiscoverable = Boolean(me?.published && !me.withdrawn && !me.expired);
  return (
    <div className="space-y-6">
      <PlaceHeader title="Under the door" note="Introductions slide in here. Accept, not now, or block — not now and block are silent; they never learn which." />
      <IntroductionControls introductions={toControlRows(shared.myIntroductions())} discoverable={isDiscoverable} actions={introductionActions(shared)} />
    </div>
  );
}

export function CalendarPlace() {
  return (
    <div className="space-y-6">
      <PlaceHeader title="Desk calendar" note="A plan lands here only after both of you accept the same version. Any change needs both of you again." />
      <PlansList />
    </div>
  );
}

const DESK_ITEMS: readonly PlaceId[] = ['notebook', 'calendar', 'tray', 'drawer'];

export function DeskPlace() {
  return (
    <div className="space-y-6">
      <PlaceHeader title="Desk" note="Your notebook stays on this device. Nothing here goes anywhere unless you send it yourself." />
      <ul className="grid grid-cols-2 gap-3">
        {DESK_ITEMS.map((id) => {
          const p = placeById(id)!;
          return (
            <li key={id}>
              <button type="button" onClick={() => navigateRoom(id)} className="paper-tile">
                <span className="block font-hand text-2xl leading-none">{p.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{p.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const BOXES = [
  { id: 'landed', label: 'Where you’ve landed' },
  { id: 'about', label: 'About you' },
  { id: 'home', label: 'From home' },
] as const;
type BoxId = (typeof BOXES)[number]['id'];

export function BoxesPlace() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const stage = discoverStage(me, Date.now());
  const [open, setOpen] = useState<BoxId>('landed');
  return (
    <div className="space-y-6">
      <PlaceHeader title="Moving boxes" note="Open them in any order, or skip them. Nothing in a box is shared until you choose to share it." />
      <div role="tablist" aria-label="Moving boxes" className="grid grid-cols-3 gap-2">
        {BOXES.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={open === b.id} aria-controls={`box-${b.id}`} onClick={() => setOpen(b.id)}
            className={cn('box-tab', open === b.id && 'box-tab-open')}>
            <span className="font-marker">{b.label}</span>
          </button>
        ))}
      </div>
      <div id={`box-${open}`} role="tabpanel" className="sheet-enter" key={open}>
        {open === 'landed' && (
          stage === 'disabled'
            ? <p className="text-sm text-muted-foreground">Discovery isn&apos;t switched on for this area yet.</p>
            : <DiscoveryArea me={me} isAreaLive={stage === 'ready'} initialAreaKey={readPref(sessionStore()).areaKey} />
        )}
        {open === 'about' && <AboutYou />}
        {open === 'home' && <AccountInvites />}
      </div>
    </div>
  );
}
