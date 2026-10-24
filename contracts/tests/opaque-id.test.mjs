// a3 (proposed D047): the server-minted signal id shape. Helper only; not enforced anywhere yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isServerMintedId } from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

test('accepts exactly the lowercase UUID v4 the module mints', () => {
  assert.equal(zodFree.isServerMintedId, isServerMintedId);
  assert.equal(isServerMintedId('f93d2f21-fe99-4366-b705-d3f78054d6c2'), true); // captured from ctx.newUuidV4()
});

test('rejects readable, semantic, wrong-version or malformed ids', () => {
  for (const bad of ['exam-friday-panic', 'sig-1', 'minted-by-agent', 'F93D2F21-FE99-4366-B705-D3F78054D6C2',
    'f93d2f21-fe99-1366-b705-d3f78054d6c2', 'f93d2f21-fe99-4366-c705-d3f78054d6c2', 'f93d2f21fe994366b705d3f78054d6c2',
    ' f93d2f21-fe99-4366-b705-d3f78054d6c2', '', null, 42]) {
    assert.equal(isServerMintedId(bad), false, String(bad));
  }
});
