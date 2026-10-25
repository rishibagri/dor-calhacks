import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMemoryUpdate, memoryForModel, readMemory, saveMemory, type MemoryItem } from '../memory.ts';

const NOW = new Date('2026-10-25T18:00:00Z');
const store = () => { let v: string | null = null; return { read: () => v, write: (x: string) => { v = x; } }; };
let n = 0;
const id = () => `m${++n}`;

test('memory carries across entries and expires', () => {
  const s = store();
  const first = applyMemoryUpdate([], { add: [{ kind: 'goal', text: 'wants to reach out to friends more', ref: null, ttlDays: 30 }], expire: [] }, NOW, id, new Set());
  saveMemory(s, first);
  const later = new Date(NOW.getTime() + 2 * 86_400_000);
  const read = readMemory(s, later);
  assert.equal(read[0]?.text, 'wants to reach out to friends more');
  assert.equal(memoryForModel(read, later)[0]?.daysAgo, 2);
  assert.deepEqual(readMemory(s, new Date(NOW.getTime() + 31 * 86_400_000)), []);
});

test('updates dedupe, expire stale ids, drop unknown refs, clip text and TTL', () => {
  const base: MemoryItem[] = [{ id: 'old', kind: 'event', text: 'exam on friday', ref: null, createdAt: NOW.toISOString(), expiresAt: '2099-01-01T00:00:00Z' }];
  const out = applyMemoryUpdate(base, { add: [
    { kind: 'event', text: 'Exam on Friday', ref: null, ttlDays: 3 },
    { kind: 'person', text: 'Sam helped with studying', ref: 'p-sam', ttlDays: 999 },
    { kind: 'person', text: 'someone else', ref: 'p-ghost', ttlDays: 5 },
    { kind: 'weird' as never, text: 'nope', ref: null, ttlDays: 5 },
  ], expire: ['old'] }, NOW, id, new Set(['p-sam']));
  assert.deepEqual(out.map(m => m.text), ['Exam on Friday', 'Sam helped with studying', 'someone else']);
  assert.equal(out[1]?.ref, 'p-sam');
  assert.equal(out[2]?.ref, null);
  assert.ok(Date.parse(out[1]!.expiresAt) - NOW.getTime() <= 60 * 86_400_000);
});

test('corrupt storage reads as empty', () => {
  assert.deepEqual(readMemory({ read: () => '{bad', write: () => undefined }, NOW), []);
});
