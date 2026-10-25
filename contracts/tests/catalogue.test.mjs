// Proposed C7 boundary (D028): what may be sent to Apify and which source links may be shown. Synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardPublicCatalogueQuery, safeCatalogueUrl, validTopicAllowlist } from '../dist/index.js';

const TOPICS = ['board-games', 'online-music', 'book-club', 'cooking-class'];
const ok = { format: 'online', topics: ['board-games'], limit: 20 };

test('a generic allowlisted query passes and is copied, not passed through', () => {
  const input = { ...ok, locale: 'en-US' };
  const d = guardPublicCatalogueQuery(input, TOPICS);
  assert.equal(d.ok, true);
  assert.deepEqual(d.query, input);
  assert.notEqual(d.query, input);
});

test('private context cannot ride along: unknown fields are rejected', () => {
  for (const extra of [{ journalText: 'synthetic' }, { quizExtras: { activitiesNote: 'x' } }, { pairId: 'p1' },
    { userId: 'u1' }, { relationship: 'partner' }, { calendar: [{ start: '2026-10-24T10:00:00Z' }] }, { search: 'free text' }]) {
    assert.equal(guardPublicCatalogueQuery({ ...ok, ...extra }, TOPICS).reason, 'unknown_field', JSON.stringify(extra));
  }
});

test('topics must come from the developer allowlist; user free text is rejected', () => {
  assert.equal(guardPublicCatalogueQuery({ ...ok, topics: ['feeling lonely after exam'] }, TOPICS).reason, 'topic_not_allowlisted');
  assert.equal(guardPublicCatalogueQuery({ ...ok, topics: ['hiking'] }, TOPICS).reason, 'topic_not_allowlisted');
});

test('identifiers are rejected even if an allowlist is misconfigured to contain them', () => {
  const uuid = '3f2b8c1e-9a7d-4e2f-b1c3-5d6e7f8a9b0c';
  assert.equal(validTopicAllowlist([...TOPICS, uuid]), false);
  assert.equal(guardPublicCatalogueQuery({ ...ok, topics: [uuid] }, [uuid]).reason, 'topic_not_allowlisted');
  assert.equal(guardPublicCatalogueQuery({ ...ok, topics: ['c'.repeat(64)] }, TOPICS).reason, 'looks_like_identifier');
  assert.equal(guardPublicCatalogueQuery({ ...ok, topics: ['me@example.com'] }, TOPICS).reason, 'looks_like_identifier');
  assert.equal(guardPublicCatalogueQuery({ ...ok, topics: ['5551234567'] }, TOPICS).reason, 'looks_like_identifier');
});

test('malformed shapes and bounds are rejected', () => {
  for (const bad of [null, [], 'board-games', { ...ok, format: 'near-me' }, { ...ok, limit: 0 }, { ...ok, limit: 101 },
    { ...ok, limit: 2.5 }, { ...ok, topics: [] }, { ...ok, topics: ['board-games', 'board-games'] },
    { ...ok, topics: Array(11).fill('board-games') }, { ...ok, locale: 'english' }, { ...ok, topics: [{ $ne: 1 }] }]) {
    assert.equal(guardPublicCatalogueQuery(bad, TOPICS).ok, false, JSON.stringify(bad));
  }
});

test('catalogue links: https + allowlisted host only; credentials, ports, other schemes rejected', () => {
  const hosts = ['events.example.org'];
  assert.equal(safeCatalogueUrl('https://events.example.org/e/1?x=1#frag', hosts), 'https://events.example.org/e/1?x=1');
  assert.equal(safeCatalogueUrl('https://sub.events.example.org/e/1', hosts), 'https://sub.events.example.org/e/1');
  for (const bad of ['http://events.example.org/e', 'javascript:alert(1)', 'data:text/html,x', 'https://evil.example.com/e',
    'https://events.example.org.evil.com/e', 'https://user:pw@events.example.org/e', 'https://events.example.org:8443/e',
    'https://169.254.169.254/latest', 'not a url', 42]) {
    assert.equal(safeCatalogueUrl(bad, hosts), null, String(bad));
  }
});

test('safeCatalogueUrl works without a URL global (the SpacetimeDB module runtime has none)', () => {
  const hosts = ['meetup.com', 'lu.ma', 'events.example.org'];
  const saved = globalThis.URL;
  try {
    delete globalThis.URL; // as in the module runtime: typeof URL === 'undefined'
    assert.equal(typeof globalThis.URL, 'undefined');
    assert.equal(safeCatalogueUrl('https://www.meetup.com/synthetic-games/events/1', hosts), 'https://www.meetup.com/synthetic-games/events/1');
    assert.equal(safeCatalogueUrl('https://lu.ma/hike?ref=x#frag', hosts), 'https://lu.ma/hike?ref=x');
    assert.equal(safeCatalogueUrl('HTTPS://LU.MA/Hike', hosts), 'https://lu.ma/Hike');
    assert.equal(safeCatalogueUrl('https://lu.ma', hosts), 'https://lu.ma/');
    assert.equal(safeCatalogueUrl('https://lu.ma?x=1', hosts), 'https://lu.ma/?x=1');
    for (const bad of ['http://lu.ma/x', 'https://lu.ma:8443/x', 'https://user:pw@lu.ma/x', 'https://lu.ma@evil.com/x',
      'https://lu.ma.evil.com/x', 'https://evil.com/lu.ma', 'https://evil.com#lu.ma', 'https://127.0.0.1/x', 'https://[::1]/x',
      'https://lu.ma\\@evil.com/x', 'https://lu.ma/a/../b', 'https://lu.ma/./x', 'https://lu.ma/café', 'https://lu.ma/x y',
      'https://lu.ma/%zz', 'https://lu.ma./x', 'https://-lu.ma/x', '//lu.ma/x', 'javascript:alert(1)', 'not a url']) {
      assert.equal(safeCatalogueUrl(bad, hosts), null, bad);
    }
  } finally {
    globalThis.URL = saved;
  }
});

test('safeCatalogueUrl gives the same answer as WHATWG URL for every case URL accepts unchanged', () => {
  const hosts = ['meetup.com', 'lu.ma', 'eventbrite.com'];
  for (const u of ['https://www.meetup.com/g/1', 'https://lu.ma/hike?ref=x', 'https://www.eventbrite.com/e/synthetic-hike-7',
    'https://sub.lu.ma/a/b/c?x=1&y=2', 'https://lu.ma/x#f']) {
    const viaUrl = (() => { const p = new URL(u); p.hash = ''; return p.toString(); })();
    assert.equal(safeCatalogueUrl(u, hosts), viaUrl, u);
  }
});
