import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAreaOnce, coarsenToArea } from '../area.ts';
import { AREA_KEYS, LAUNCH_AREAS, launchConfigValid } from '../config.ts';

test('launch config passes the same slug rules the module enforces', () => {
  assert.equal(launchConfigValid(), true);
  assert.equal(new Set(AREA_KEYS).size, AREA_KEYS.length);
});

test('a point inside a configured box coarsens to that key; outside or non-finite to null', () => {
  assert.equal(coarsenToArea(37.8719, -122.2585), 'berkeley-campus');
  assert.equal(coarsenToArea(37.759, -122.415), 'sf-mission');
  assert.equal(coarsenToArea(40.7128, -74.006), null);
  assert.equal(coarsenToArea(Number.NaN, -122.26), null);
  assert.equal(coarsenToArea(37.87, Number.POSITIVE_INFINITY), null);
});

test('box edges are inclusive and first match wins', () => {
  const b = LAUNCH_AREAS[0].bounds;
  assert.equal(coarsenToArea(b.south, b.west), LAUNCH_AREAS[0].key);
  assert.equal(coarsenToArea(b.north, b.east), LAUNCH_AREAS[0].key);
});

const geo = (outcome: { lat: number; lng: number } | { code: number }) => {
  const calls: unknown[] = [];
  return {
    calls,
    getCurrentPosition(ok: (p: { coords: { latitude: number; longitude: number } }) => void, err: (e: { code: number }) => void, opts: unknown) {
      calls.push(opts);
      if ('code' in outcome) err(outcome);
      else ok({ coords: { latitude: outcome.lat, longitude: outcome.lng } });
    },
  };
};

test('capture resolves with an area key only: no coordinate survives in the result', async () => {
  const g = geo({ lat: 37.8719, lng: -122.2585 });
  const r = await captureAreaOnce(g);
  assert.deepEqual(r, { kind: 'area', areaKey: 'berkeley-campus' });
  assert.ok(!JSON.stringify(r).includes('37.87') && !JSON.stringify(r).includes('122.25'));
  assert.equal(g.calls.length, 1);
  assert.deepEqual(g.calls[0], { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
});

test('capture outcomes: outside, denied, other errors, no geolocation', async () => {
  assert.deepEqual(await captureAreaOnce(geo({ lat: 0, lng: 0 })), { kind: 'outside' });
  assert.deepEqual(await captureAreaOnce(geo({ code: 1 })), { kind: 'denied' });
  assert.deepEqual(await captureAreaOnce(geo({ code: 3 })), { kind: 'unavailable' });
  assert.deepEqual(await captureAreaOnce(undefined), { kind: 'unavailable' });
});
