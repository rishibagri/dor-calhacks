import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT_MARGIN, PLACES, ROOM_H, ROOM_W, ROUTE_TARGETS, arcBetween, boxRect, cameraFor, hotspotRect, levelOf, parentOf,
  pathTo, placeById, toTransform,
} from '../layout.ts';

const PHONE = { w: 390, h: 844 };

test('every place box sits inside the room and every child names a real parent', () => {
  for (const p of PLACES) {
    const [u0, v0, u1, v1] = p.box;
    assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1 && u0 < u1 && v0 < v1, p.id);
    if (p.parent) assert.ok(placeById(p.parent), `${p.id} parent`);
  }
});

test('old routes all map to a place', () => {
  for (const [route, id] of Object.entries(ROUTE_TARGETS)) assert.ok(placeById(id), route);
  assert.equal(ROUTE_TARGETS['/journal'], 'notebook');
});

test('levels and back: close-up → place → room', () => {
  assert.equal(levelOf(null), 0);
  assert.equal(levelOf('window'), 1);
  assert.equal(levelOf('notebook'), 2);
  assert.equal(parentOf('notebook'), 'desk');
  assert.equal(parentOf('desk'), null);
  assert.deepEqual(pathTo('drawer'), ['desk', 'drawer']);
  assert.deepEqual(pathTo(null), []);
});

test('home camera fits the whole room inside the stage', () => {
  const t = toTransform(cameraFor(null, PHONE));
  assert.equal(t.scale, 1);
  assert.equal(t.x, 0);
  assert.equal(t.y, 0);
  const wide = toTransform(cameraFor(null, { w: 800, h: 844 }));
  assert.equal(wide.scale, 1);
  assert.equal(wide.x, 205); // centred horizontally
});

test('a place fills the top frame with a 16 px margin and stays centred in it', () => {
  for (const p of PLACES) {
    const cam = cameraFor(p.id, PHONE);
    const r = boxRect(p.id);
    const t = toTransform(cam);
    const left = t.x + r.x * t.scale;
    const top = t.y + r.y * t.scale;
    const right = left + r.w * t.scale;
    const bottom = top + r.h * t.scale;
    const frameH = Math.round(PHONE.h * 0.4);
    assert.ok(left >= FIT_MARGIN - 0.01 && right <= PHONE.w - FIT_MARGIN + 0.01, `${p.id} horizontal`);
    assert.ok(top >= FIT_MARGIN - 0.01 && bottom <= frameH - FIT_MARGIN + 0.01, `${p.id} vertical`);
    assert.ok(Math.abs((left + right) / 2 - PHONE.w / 2) < 0.01, `${p.id} centred`);
  }
});

test('neighbour moves arc out ~20 %; moves across levels do not', () => {
  const a = cameraFor('window', PHONE);
  const b = cameraFor('pinboard', PHONE);
  const mid = arcBetween(a, b, 'window', 'pinboard');
  assert.ok(mid);
  assert.ok(Math.abs(mid.z - Math.min(a.z, b.z) * 0.8) < 1e-9);
  assert.equal(arcBetween(a, cameraFor('notebook', PHONE), 'window', 'notebook'), null);
  assert.equal(arcBetween(cameraFor(null, PHONE), a, null, 'window'), null);
  assert.ok(arcBetween(cameraFor('notebook', PHONE), cameraFor('tray', PHONE), 'notebook', 'tray'));
});

test('hotspots are at least 44 px at the home zoom and stay centred on their box', () => {
  for (const p of PLACES) {
    const h = hotspotRect(p.id, 1);
    const r = boxRect(p.id);
    assert.ok(h.w >= 44 && h.h >= 44, p.id);
    assert.ok(Math.abs(h.x + h.w / 2 - (r.x + r.w / 2)) < 1e-9);
  }
  assert.equal(ROOM_W / ROOM_H, 390 / 844);
});

test('camera interpolation hits both ends exactly and passes near the arc midpoint', async () => {
  const { cameraAt } = await import('../layout.ts');
  const a = cameraFor('window', PHONE);
  const b = cameraFor('pinboard', PHONE);
  const mid = arcBetween(a, b, 'window', 'pinboard');
  for (const k of ['cx', 'cy', 'z'] as const) {
    assert.ok(Math.abs(cameraAt(a, mid, b, 0)[k] - a[k]) < 1e-9);
    assert.ok(Math.abs(cameraAt(a, mid, b, 1)[k] - b[k]) < 1e-9);
  }
  // Zoom dips below both ends halfway through the arc (eases out, then back in).
  assert.ok(cameraAt(a, mid, b, 0.5).z < Math.min(a.z, b.z));
  // Without an arc, log-space zoom stays between the ends.
  const home = cameraFor(null, PHONE);
  const half = cameraAt(home, null, a, 0.5).z;
  assert.ok(half > home.z && half < a.z);
});
