import type { ApprovedSignal, Availability, RecipientSupportPreferences, SupportMode } from '@dor/contracts';

/** One ACK the recipient's own consent already permits; agents choose among these, never outside them. */
export interface AckOption { supportMode: SupportMode; availability?: Availability }

/** Narrower window wins; `no_preference` defers to the other side. */
export function intersectWindow(a: Availability, b: Availability): Availability {
  if (a === 'no_preference') return b;
  if (b === 'no_preference' || a === b) return a;
  return 'today';
}

/**
 * Deterministic intersection of the approved envelope with the recipient's consented preferences, in the
 * recipient's preference order. Availability is only matched when the recipient consented to share it.
 * An availability-only envelope has no nudge template, so it yields no options (FLOWS.md).
 */
export function eligibleOptions(signal: ApprovedSignal, prefs: RecipientSupportPreferences): AckOption[] {
  if (signal.supportMode === undefined) return [];
  const modes = prefs.supportModes.filter(mode => mode === signal.supportMode);
  if (signal.availability === undefined || prefs.availability.length === 0)
    return modes.map(supportMode => ({ supportMode }));
  const senderWindow = signal.availability;
  const windows = [...new Set(prefs.availability.map(w => intersectWindow(senderWindow, w)))];
  return modes.flatMap(supportMode => windows.map(availability => ({ supportMode, availability })));
}

export function sameOption(a: AckOption, b: AckOption): boolean {
  return a.supportMode === b.supportMode && a.availability === b.availability;
}
