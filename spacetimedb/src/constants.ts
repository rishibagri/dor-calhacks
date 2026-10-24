export const PRESET_KINDS = ['partner', 'friend', 'family'] as const;
export const CATEGORIES = ['support_preference', 'coarse_availability'] as const;
export const INVITE_TTL_MICROS = 24n * 60n * 60n * 1_000_000n;
export const MAX_DISPLAY_NAME = 64;
export const MAX_SNOOZE_MICROS = 30n * 24n * 60n * 60n * 1_000_000n;
