import type { ApprovedSignal, Availability, Nudge, RecipientSupportPreferences, SupportMode } from '@kinetic/contracts';

/** One ACK the recipient's own consent already permits; agents choose among these, never outside them. */
export interface AckOption { supportMode: SupportMode; availability?: Availability }

export const TEMPLATE_BY_MODE: Record<SupportMode, Nudge['templateId']> = {
  short_call: 'offer_short_call', encouraging_note: 'offer_note', shared_activity: 'offer_shared_activity',
};

/** Narrower window wins; `no_preference` defers to the other side. */
export function intersectWindow(a: Availability, b: Availability): Availability {
  if (a === 'no_preference') return b;
  if (b === 'no_preference' || a === b) return a;
  return 'today';
}

/**
 * Deterministic intersection of the approved envelope with the recipient's consented preferences, in the
 * recipient's preference order. Availability is only matched when the recipient consented to share it.
 */
export function eligibleOptions(signal: ApprovedSignal, prefs: RecipientSupportPreferences): AckOption[] {
  const modes = signal.supportMode === undefined ? prefs.supportModes
    : prefs.supportModes.filter(mode => mode === signal.supportMode);
  if (signal.availability === undefined || prefs.availability.length === 0)
    return modes.map(supportMode => ({ supportMode }));
  const senderWindow = signal.availability;
  const windows = [...new Set(prefs.availability.map(w => intersectWindow(senderWindow, w)))];
  return modes.flatMap(supportMode => windows.map(availability => ({ supportMode, availability })));
}

export function sameOption(a: AckOption, b: AckOption): boolean {
  return a.supportMode === b.supportMode && a.availability === b.availability;
}
