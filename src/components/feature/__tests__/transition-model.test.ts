import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePref, readPref, writePref, type PrefStorage } from '../transition-model.ts';

const mem = (): PrefStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test('round-trips a valid transition and area', () => {
  const s = mem();
  writePref(s, { transition: 'college', areaKey: 'berkeley-campus' });
  assert.deepEqual(readPref(s), { transition: 'college', areaKey: 'berkeley-campus' });
});

test('unknown values and corrupt storage fall back to empty', () => {
  assert.deepEqual(normalizePref({ transition: 'lonely', areaKey: 'mars' }), { transition: null, areaKey: null });
  const s = mem(); s.setItem('dor:transition-pref', '{nope');
  assert.deepEqual(readPref(s), { transition: null, areaKey: null });
  assert.deepEqual(readPref(null), { transition: null, areaKey: null });
});

test('extra fields are dropped before storage', () => {
  const s = mem();
  writePref(s, { transition: 'new-job', areaKey: 'berkeley-downtown', note: 'x' } as never);
  assert.deepEqual(JSON.parse([...s.data.values()][0]!), { transition: 'new-job', areaKey: 'berkeley-downtown' });
});
