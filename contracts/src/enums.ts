// Runtime-dependency-free enum values. schemas.ts (Zod) and policy.ts (reducer-safe guards)
// both derive from these so the two layers cannot drift.
export const SUPPORT_MODES = ['short_call', 'encouraging_note', 'shared_activity'] as const;
export const AVAILABILITIES = ['today', 'this_week', 'no_preference'] as const;
export const SHARING_CATEGORIES = ['support_preference', 'coarse_availability'] as const;
export const RELATIONSHIP_PRESET_KINDS = ['partner', 'friend', 'family'] as const;
export const NUDGE_TEMPLATE_IDS = ['offer_short_call', 'offer_note', 'offer_shared_activity'] as const;
export const DISCLOSURE_PURPOSE = 'support_nudge' as const;
