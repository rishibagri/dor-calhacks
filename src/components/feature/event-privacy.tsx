'use client';

import { useLiveShared } from '@/components/shell/use-live';
import { EventPrivacyControls } from '@/features/privacy/event-privacy-controls';
import { orThrow } from './introduction-actions';

/** Composes Cyber's EventPrivacyControls (D039) over the caller's own intents and C7 approvals. */
export function EventPrivacy() {
  const shared = useLiveShared();
  const titles = new Map(shared.catalogueEvents().map((e) => [e.eventId, e.title]));
  const names = new Map(shared.myPairs().map((p) => [p.pairId, p.counterpartDisplayName ?? undefined]));
  return (
    <EventPrivacyControls
      intents={shared.myEventIntents().map((i) => ({ ...i, expiresAt: new Date(i.expiresAt) }))}
      approvals={shared.myActivityApprovals().map((a) => ({ ...a, expiresAt: new Date(a.expiresAt) }))}
      eventTitle={(id) => titles.get(id)}
      pairName={(id) => names.get(id)}
      actions={{
        revokeIntent: (id) => orThrow(shared.revokeEventIntent(id)),
        revokeApproval: (id) => orThrow(shared.revokeActivityInterest(id)),
      }}
    />
  );
}
