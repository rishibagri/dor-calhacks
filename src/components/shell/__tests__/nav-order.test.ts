import test from 'node:test';
import assert from 'node:assert/strict';
import { orderNav } from '../nav-order.ts';

const D = [{ href: '/discover', label: 'Discover' }, { href: '/events', label: 'Events' }];
const O = ['Connections', 'Journal', 'Nudges', 'Privacy'].map((label) => ({ href: `/${label.toLowerCase()}`, label }));
const navItemsFor = (on: boolean) => orderNav(D, O, on);

test('discovery on: Discover then Events lead, six tabs in order', () => {
  assert.deepEqual(navItemsFor(true).map((i) => i.label), ['Discover', 'Events', 'Connections', 'Journal', 'Nudges', 'Privacy']);
});

test('discovery off hides Discover and Events only', () => {
  assert.deepEqual(navItemsFor(false).map((i) => i.href), ['/connections', '/journal', '/nudges', '/privacy']);
});
