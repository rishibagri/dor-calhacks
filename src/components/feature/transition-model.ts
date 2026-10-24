/**
 * Local-only "what's changing" preference (D045). Never sent to the server or a model and not a contract field:
 * it only preselects the area on this device for the session. Storage is injected so this stays pure and testable.
 */
import { AREA_KEYS } from '../../lib/discovery/config.ts';

export const TRANSITIONS = [
  { id: 'college', label: 'Starting college' },
  { id: 'new-city', label: 'Moving to a new city' },
  { id: 'new-job', label: 'Starting a new job' },
  { id: 'graduating', label: 'Graduating' },
] as const;
export type TransitionId = (typeof TRANSITIONS)[number]['id'];

export interface TransitionPref { transition: TransitionId | null; areaKey: string | null }
export interface PrefStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const KEY = 'dor:transition-pref';
const EMPTY: TransitionPref = { transition: null, areaKey: null };

export function normalizePref(raw: unknown): TransitionPref {
  if (typeof raw !== 'object' || raw === null) return EMPTY;
  const r = raw as Record<string, unknown>;
  const transition = TRANSITIONS.find((t) => t.id === r.transition)?.id ?? null;
  const areaKey = typeof r.areaKey === 'string' && AREA_KEYS.includes(r.areaKey) ? r.areaKey : null;
  return { transition, areaKey };
}

export function readPref(storage: PrefStorage | null): TransitionPref {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? normalizePref(JSON.parse(raw)) : EMPTY;
  } catch { return EMPTY; }
}

export function writePref(storage: PrefStorage | null, pref: TransitionPref): void {
  try { storage?.setItem(KEY, JSON.stringify(normalizePref(pref))); } catch { /* storage blocked: preference is optional */ }
}

export function sessionStore(): PrefStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
