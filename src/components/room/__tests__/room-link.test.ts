import test from 'node:test';
import assert from 'node:assert/strict';
import { placeForHref } from '../room-nav.ts';

test('old routes and ?at= links become camera targets', () => {
  assert.equal(placeForHref('/journal'), 'notebook');
  assert.equal(placeForHref('/events'), 'window');
  assert.equal(placeForHref('/?at=pinboard'), 'pinboard');
  assert.equal(placeForHref('/'), null);
});

test('unknown places fall back to the whole room; other paths and origins stay ordinary links', () => {
  assert.equal(placeForHref('/?at=attic'), null);
  assert.equal(placeForHref('/api/voice'), undefined);
  assert.equal(placeForHref('https://example.com/journal'), undefined);
});
