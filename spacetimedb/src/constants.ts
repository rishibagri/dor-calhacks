export { RELATIONSHIP_PRESET_KINDS as PRESET_KINDS, SHARING_CATEGORIES as CATEGORIES } from '@dor/contracts/policy';
export const INVITE_TTL_MICROS = 24n * 60n * 60n * 1_000_000n;
export const MAX_DISPLAY_NAME = 64;
export const MAX_SNOOZE_MICROS = 30n * 24n * 60n * 60n * 1_000_000n;
/** Expiry sweep period: the longest an expired row can remain visible in a clockless view. */
export const SWEEP_INTERVAL_MICROS = 60n * 1_000_000n;
