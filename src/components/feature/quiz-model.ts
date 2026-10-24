import { LocalConnectionProfileSchema } from '@kinetic/contracts';
import type { LocalConnectionProfile, SharingCategory } from '@kinetic/contracts';

export type SupportMode = LocalConnectionProfile['preferredSupportModes'][number];

export interface QuizAnswers {
  afterLongDay: SupportMode[];
  friendQuiet: SupportMode[];
  tone: LocalConnectionProfile['communicationStyle'];
  rhythm: LocalConnectionProfile['rhythm'];
  overwhelmed: LocalConnectionProfile['suggestionIntensity'];
  categories: SharingCategory[];
}

export const EMPTY_ANSWERS: QuizAnswers = {
  afterLongDay: [], friendQuiet: [], tone: null, rhythm: null, overwhelmed: null, categories: [],
};

export const SUPPORT_LABELS: Record<SupportMode, string> = {
  short_call: 'A short call',
  encouraging_note: 'A kind note',
  shared_activity: 'A shared activity',
};

export const CATEGORY_LABELS: Record<SharingCategory, string> = {
  support_preference: 'Support preference (e.g. welcome a short call)',
  coarse_availability: 'Coarse availability (e.g. this week)',
};

const unique = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

/** Maps answers to the local-only profile and validates it at the boundary. */
export function buildProfile(a: QuizAnswers) {
  return LocalConnectionProfileSchema.safeParse({
    schemaVersion: 1,
    communicationStyle: a.tone,
    preferredSupportModes: unique([...a.afterLongDay, ...a.friendQuiet]),
    draftSharingCategories: a.categories,
    rhythm: a.rhythm,
    suggestionIntensity: a.overwhelmed,
  });
}

export function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? unique([...list, item]) : list.filter((x) => x !== item);
}

/** Number of the six questions with at least one answer (progress display only). */
export function countAnswered(a: QuizAnswers): number {
  return [a.afterLongDay.length > 0, a.friendQuiet.length > 0, a.tone !== null,
    a.rhythm !== null, a.overwhelmed !== null, a.categories.length > 0].filter(Boolean).length;
}
