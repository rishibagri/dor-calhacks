/**
 * Developer-configured discovery launch config (CS-R2, C8). Public, non-sensitive lists only.
 *
 * The SAME `key` and tag lists must be loaded into the module with `set_discovery_config` ('areas', 'tags');
 * the module is the authority and rejects anything outside its own allowlist. These copies exist so the device can
 * coarsen a location sample to an area key without sending coordinates anywhere, and so the form only offers tags
 * the server will accept.
 */
import { validSlugAllowlist } from '@dor/contracts/policy';

export interface LaunchArea {
  /** Coarse area key sent to set_discovery_area. Never derived from coordinates on the server. */
  key: string;
  label: string;
  /** Inclusive bounding box used only on the device; deliberately large (campus/neighbourhood scale). */
  bounds: { south: number; west: number; north: number; east: number };
}

export const LAUNCH_AREAS: readonly LaunchArea[] = [
  { key: 'berkeley-campus', label: 'UC Berkeley campus', bounds: { south: 37.862, west: -122.27, north: 37.882, east: -122.248 } },
  { key: 'berkeley-downtown', label: 'Downtown Berkeley', bounds: { south: 37.86, west: -122.285, north: 37.875, east: -122.27 } },
  { key: 'sf-mission', label: 'Mission District, San Francisco', bounds: { south: 37.748, west: -122.428, north: 37.77, east: -122.405 } },
];

/** Interest tags offered in the profile form (same slugs as DS's ranker fixtures). */
export const DISCOVERY_TAGS: readonly string[] = [
  'board-games', 'hiking', 'coffee', 'live-music', 'cooking', 'running', 'film', 'books', 'photography', 'climbing',
];

export const AREA_KEYS: readonly string[] = LAUNCH_AREAS.map((a) => a.key);

export function areaLabel(key: string | null): string | null {
  return key === null ? null : LAUNCH_AREAS.find((a) => a.key === key)?.label ?? null;
}

/** Config self-check, run by tests: lists must pass the same slug rules the module enforces. */
export function launchConfigValid(): boolean {
  return validSlugAllowlist(AREA_KEYS, 'area') && validSlugAllowlist(DISCOVERY_TAGS, 'tag');
}
