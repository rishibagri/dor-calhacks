import { LocalConnectionProfileSchema, SharingCategorySchema } from '@dor/contracts';
import type { LocalConnectionProfile, SharingCategory } from '@dor/contracts';
import type { ConnectActivity, LocalQuizExtras } from '@/lib/backend/ports';

export type SupportMode = LocalConnectionProfile['preferredSupportModes'][number];
/** Q1 choice: a contract support mode, or "space" (no support mode; local only). */
export type LongDayChoice = SupportMode | 'space';

export const QUESTION_COUNT = 8;
const ACTIVITIES_NOTE_MAX = 200;

export interface QuizAnswers {
  afterLongDay: LongDayChoice[];
  friendQuiet: SupportMode[];
  tone: LocalConnectionProfile['communicationStyle'];
  rhythm: LocalConnectionProfile['rhythm'];
  overwhelmed: LocalConnectionProfile['suggestionIntensity'];
  activities: ConnectActivity[];
  activitiesNote: string;
  scheduleSuggestions: LocalQuizExtras['scheduleSuggestions'];
  categories: SharingCategory[];
  reviewComfort: LocalQuizExtras['reviewComfort'];
}

export const EMPTY_ANSWERS: QuizAnswers = {
  afterLongDay: [], friendQuiet: [], tone: null, rhythm: null, overwhelmed: null,
  activities: [], activitiesNote: '', scheduleSuggestions: null, categories: [], reviewComfort: null,
};

export const LONG_DAY_LABELS: Record<LongDayChoice, string> = {
  short_call: 'A short call',
  encouraging_note: 'A kind note',
  shared_activity: 'A shared activity',
  space: 'Some space',
};

export const ACTIVITY_LABELS: Record<ConnectActivity, string> = {
  talking: 'Talking',
  games: 'Games',
  watching_together: 'Watching something together',
  creating: 'Making or creating',
  other: 'Something else',
};

export const CATEGORY_LABELS: Record<SharingCategory, string> = {
  support_preference: 'Support preference (e.g. welcome a short call)',
  coarse_availability: 'Coarse availability (e.g. this week)',
};

const unique = <T,>(xs: T[]): T[] => Array.from(new Set(xs));
const isSupportMode = (c: LongDayChoice): c is SupportMode => c !== 'space';

/**
 * Maps answers to the local-only profile and validates it at the boundary.
 * "space" contributes no support mode: choosing only space yields no preferred
 * mode, which downstream treats as a no-action case.
 */
export function buildProfile(a: QuizAnswers) {
  return LocalConnectionProfileSchema.safeParse({
    schemaVersion: 1,
    communicationStyle: a.tone,
    preferredSupportModes: unique([...a.afterLongDay.filter(isSupportMode), ...a.friendQuiet]),
    draftSharingCategories: a.categories,
    rhythm: a.rhythm,
    suggestionIntensity: a.overwhelmed,
  });
}

/** Answers with no profile field. Local vault only; never shared or used for authorization. */
export function buildQuizExtras(a: QuizAnswers): LocalQuizExtras {
  const note = a.activities.includes('other') ? a.activitiesNote.trim().slice(0, ACTIVITIES_NOTE_MAX) : '';
  return {
    prefersSpace: a.afterLongDay.includes('space'),
    activities: a.activities,
    activitiesNote: note.length > 0 ? note : null,
    scheduleSuggestions: a.scheduleSuggestions,
    reviewComfort: a.reviewComfort,
  };
}

export function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? unique([...list, item]) : list.filter((x) => x !== item);
}

/** Number of the eight questions with an answer (progress display only). */
export function countAnswered(a: QuizAnswers): number {
  return [a.afterLongDay.length > 0, a.friendQuiet.length > 0, a.tone !== null || a.rhythm !== null,
    a.overwhelmed !== null, a.activities.length > 0, a.scheduleSuggestions !== null,
    a.categories.length > 0, a.reviewComfort !== null].filter(Boolean).length;
}

/**
 * Unsaved preset draft (D015: the quiz nominates, the owner confirms). A saved preset always wins; otherwise the
 * profile's draft categories, valid keys only. With no preferred support mode (e.g. "space" only) there is nothing
 * to nominate for support_preference. Never grants consent; the owner still saves and assigns.
 */
export function draftCategoriesFor(
  saved: { allowedCategories: readonly SharingCategory[] } | null | undefined,
  profile: Pick<LocalConnectionProfile, 'draftSharingCategories' | 'preferredSupportModes'> | null,
): { categories: SharingCategory[]; suggested: boolean } {
  if (saved) return { categories: [...saved.allowedCategories], suggested: false };
  if (!profile) return { categories: [], suggested: false };
  const valid = unique(profile.draftSharingCategories.filter((c) => SharingCategorySchema.safeParse(c).success));
  const categories = profile.preferredSupportModes.length > 0 ? valid : valid.filter((c) => c !== 'support_preference');
  return { categories, suggested: categories.length > 0 };
}
