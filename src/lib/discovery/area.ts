/**
 * One-time, explicit area capture (CS-R2). The coordinate sample exists only inside `captureAreaOnce` and is
 * reduced to a configured area key (or nothing) before it returns: it is never stored, logged, rendered or sent.
 * No watchPosition, no background refresh; renewing the area is a new user action.
 */
import { LAUNCH_AREAS, type LaunchArea } from './config.ts';

export type AreaCapture =
  | { kind: 'area'; areaKey: string }
  | { kind: 'outside' }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

/** Pure: the configured area whose box contains the point, first match wins; null outside every area. */
export function coarsenToArea(lat: number, lng: number, areas: readonly LaunchArea[] = LAUNCH_AREAS): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hit = areas.find(({ bounds: b }) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east);
  return hit?.key ?? null;
}

const CAPTURE_TIMEOUT_MS = 15_000;
const SAMPLE_MAX_AGE_MS = 10 * 60 * 1000;

interface GeoLike {
  getCurrentPosition(
    ok: (p: { coords: { latitude: number; longitude: number } }) => void,
    err: (e: { code: number }) => void,
    opts: { enableHighAccuracy: boolean; timeout: number; maximumAge: number },
  ): void;
}

const PERMISSION_DENIED = 1;

/** Asks the browser once (low accuracy). Resolves with an area key or a reason; never with coordinates. */
export function captureAreaOnce(geo: GeoLike | undefined = globalThis.navigator?.geolocation): Promise<AreaCapture> {
  if (!geo) return Promise.resolve({ kind: 'unavailable' });
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      ({ coords }) => {
        const areaKey = coarsenToArea(coords.latitude, coords.longitude);
        resolve(areaKey ? { kind: 'area', areaKey } : { kind: 'outside' });
      },
      (e) => resolve({ kind: e.code === PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: false, timeout: CAPTURE_TIMEOUT_MS, maximumAge: SAMPLE_MAX_AGE_MS },
    );
  });
}
