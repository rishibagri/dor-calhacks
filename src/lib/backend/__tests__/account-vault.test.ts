import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { accountVaultName, openAccountVault } from '../account-vault.ts';
const secret = 'synthetic long test passphrase';
const opts = () => ({ factory: new IDBFactory(), lifecycle: new EventTarget(), vaultOptions: { unsafeTestIterations: 1000, idleLockMs: 0 } });

test('account vaults isolate journals; reopening an account requires unlock', async () => {
  const options = opts(), a = new AbortController(), b = new AbortController(), again = new AbortController();
  try {
    const alice = await openAccountVault('alice', a.signal, options);
    await alice.create(secret);
    await alice.saveJournal({ localId: 'entry-1', text: 'synthetic private text' });
    a.abort();
    assert.equal(alice.locked, true);
    const bob = await openAccountVault('bob', b.signal, options);
    assert.equal(bob.state, 'absent');
    await bob.create(secret);
    assert.deepEqual(await bob.listJournals(), []);
    const reopened = await openAccountVault('alice', again.signal, options);
    assert.equal(reopened.state, 'locked');
    await reopened.unlock(secret);
    assert.equal((await reopened.readJournal('entry-1')).text, 'synthetic private text');
    assert.notEqual(await accountVaultName('alice'), await accountVaultName('bob'));
    assert.equal((await accountVaultName('alice')).includes('alice'), false);
  } finally { a.abort(); b.abort(); again.abort(); }
});

test('pagehide locks; canceled initialization cannot publish a stale account vault', async () => {
  const options = opts(), controller = new AbortController();
  const vault = await openAccountVault('alice', controller.signal, options);
  await vault.create(secret);
  options.lifecycle.dispatchEvent(new Event('pagehide'));
  assert.equal(vault.locked, true);
  controller.abort();
  const canceled = new AbortController();
  const pending = openAccountVault('bob', canceled.signal, options);
  canceled.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
