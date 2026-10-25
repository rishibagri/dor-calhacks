import test from 'node:test';
import assert from 'node:assert/strict';
import { begin, recentActivity, tracked } from '../activity.ts';

test('activity log: in-flight calls show as running, then finish with outcome and duration; newest first', async () => {
  const end = begin('claude', 'journal reflection', 'user_a');
  assert.equal(recentActivity()[0]!.status, 'running');
  end('ok');
  const done = recentActivity()[0]!;
  assert.equal(done.status, 'ok');
  assert.ok(done.durationMs !== null && done.endedAt !== null);
  await tracked('cartesia', 'voice session', null, async () => new Response('x', { status: 500 }));
  assert.deepEqual([recentActivity()[0]!.tool, recentActivity()[0]!.status], ['cartesia', 'error']);
  await assert.rejects(tracked('apify', 'live catalogue refresh', null, async () => { throw new Error('boom'); }));
  assert.equal(recentActivity()[0]!.status, 'error');
});

test('activity log stores metadata only and stays bounded', () => {
  for (let n = 0; n < 250; n++) begin('claude', 'reasoning decision', null)('ok');
  const all = recentActivity();
  assert.ok(all.length <= 200);
  assert.deepEqual(Object.keys(all[0]!).sort(), ['action', 'durationMs', 'endedAt', 'id', 'startedAt', 'status', 'tool', 'userId']);
});
