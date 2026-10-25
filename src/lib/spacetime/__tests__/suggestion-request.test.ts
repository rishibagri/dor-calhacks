import test from 'node:test';
import assert from 'node:assert/strict';
import { readViews, VIEW_NAMES } from '../views.ts';
import type { LooseConnection, LooseRow } from '../bindings.ts';

const conn = (views: Record<string, LooseRow[]>): LooseConnection =>
  ({ db: Object.fromEntries(Object.entries(views).map(([k, rows]) => [k, { iter: () => rows }])), reducers: {} }) as unknown as LooseConnection;
const row = (status: string): LooseRow => ({
  request_id: 'req-1', status, created_at: '2026-10-24T10:00:00.000Z', expires_at: '2026-10-24T10:10:00.000Z',
});

test('the caller\'s own suggestion request is subscribed and read (D048, D049)', () => {
  assert.ok((VIEW_NAMES as readonly string[]).includes('my_introduction_suggestion_request'));
  assert.deepEqual(readViews(conn({ my_introduction_suggestion_request: [row('open')] })).suggestionRequest,
    { requestId: 'req-1', status: 'open', createdAt: '2026-10-24T10:00:00.000Z', expiresAt: '2026-10-24T10:10:00.000Z' });
  assert.equal(readViews(conn({ my_introduction_suggestion_request: [row('done')] })).suggestionRequest?.status, 'done');
  assert.equal(readViews(conn({})).suggestionRequest, null);
});

test('an unknown status is refused and counted, never shown as pending', () => {
  const v = readViews(conn({ my_introduction_suggestion_request: [row('considered-3-people')] }));
  assert.equal(v.suggestionRequest, null);
  assert.equal(v.unreadable.counts.my_introduction_suggestion_request, 1);
});
