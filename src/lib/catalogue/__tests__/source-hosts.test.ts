import test from 'node:test';
import assert from 'node:assert/strict';
import { guardCatalogueEvent, safeCatalogueUrl, validHostAllowlist } from '@dor/contracts/policy';
import { SOURCE_HOSTS } from '../feeds.ts';
import { SOURCE_HOST_FOR } from '../../../server/discovery/normalize.ts';
import { AREA_KEYS, DISCOVERY_TAGS } from '../../discovery/config.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const H = 60 * 60 * 1000;
// What upsert_catalogue_event checks against: the module's 'source_hosts' row is loaded from SOURCE_HOSTS.
const allow = { tags: DISCOVERY_TAGS, areas: AREA_KEYS, hosts: SOURCE_HOSTS };
const event = (sourceUrl: string | null) => ({
  eventId: 'evt-luma-1', title: 'Board game night', startsAtMs: NOW + 50 * H, endsAtMs: NOW + 52 * H, status: 'scheduled',
  fetchedAtMs: NOW, topics: ['board-games'], format: 'in_person', areaKey: 'berkeley-campus', sourceUrl,
});

test('source_hosts covers every host the Apify normalizer emits, so normalized rows are not refused at upsert', () => {
  assert.equal(validHostAllowlist(SOURCE_HOSTS), true);
  for (const [source, hosts] of Object.entries(SOURCE_HOST_FOR))
    for (const h of hosts) assert.ok(SOURCE_HOSTS.includes(h), `${source} host ${h} missing from SOURCE_HOSTS`);
});

test('legitimate Luma links (lu.ma and luma.com) are accepted by the link check and the upsert guard', () => {
  for (const url of ['https://lu.ma/abc123', 'https://luma.com/abc123', 'https://LUMA.com/abc123', 'https://www.luma.com/abc123']) {
    assert.ok(safeCatalogueUrl(url, SOURCE_HOSTS), url);
    const g = guardCatalogueEvent(event(url), allow, NOW);
    assert.equal(g.ok, true, url);
  }
  const g = guardCatalogueEvent(event('https://luma.com/abc123?ref=x#frag'), allow, NOW);
  assert.ok(g.ok && g.event.sourceUrl === 'https://luma.com/abc123?ref=x');
});

test('lookalike and unsafe Luma URLs are still refused', () => {
  for (const bad of [
    'https://luma.com.evil.com/x', 'https://lu.ma.evil.com/x', 'https://evilluma.com/x', 'https://notluma.com/x',
    'https://luma.co/x', 'https://luma.comm/x', 'https://luma-com.evil.com/x', 'https://luma.com@evil.com/x',
    'https://evil.com/luma.com', 'https://evil.com?u=https://luma.com', 'https://evil.com#luma.com',
    'https://xn--lma-joa.com/x', 'http://luma.com/x', 'https://luma.com:8443/x', 'https://user:pw@luma.com/x',
    '//luma.com/x', 'javascript:alert(1)//luma.com',
  ]) {
    assert.equal(safeCatalogueUrl(bad, SOURCE_HOSTS), null, bad);
    const g = guardCatalogueEvent(event(bad), allow, NOW);
    assert.ok(!g.ok && g.reason === 'unsafe_source_url', bad);
  }
});
