// Privacy controls over the REAL LocalVault + IndexedDbVaultStore (fake-indexeddb). Synthetic secrets only.
// Proves the control flow offline; it does not prove browser rendering, pagehide or on-disk IndexedDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { LocalVault } from '../../../vault/local-vault.ts';
import { IndexedDbVaultStore } from '../../../vault/store.ts';
import { DESTROY_CONFIRMATION, MESSAGES, VaultControlsController } from '../vault-controller.ts';

const PASS = 'correct horse battery staple';
const NEXT = 'another long synthetic passphrase';

function fresh() {
  const store = new IndexedDbVaultStore(new IDBFactory());
  const vault = new LocalVault({ store, idleLockMs: 0, lockOnPageHide: false, unsafeTestIterations: 1000 });
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  return { vault, clock, c: new VaultControlsController(vault, clock.now) };
}
const lastGroup = (code: string) => code.split('-').at(-1)!;

async function created() {
  const f = fresh();
  await f.c.start();
  await f.c.create(PASS, PASS);
  const code = f.c.snapshot().recoveryCode!;
  f.c.acknowledgeRecovery(lastGroup(code));
  return { ...f, code };
}

test('new device: create validates the passphrase, then shows the recovery code once', async () => {
  const { c, vault } = fresh();
  let renders = 0; c.subscribe(() => renders++);
  await c.start();
  assert.equal(c.snapshot().screen, 'create');
  await c.create(PASS, PASS + 'x');
  assert.equal(c.snapshot().error, MESSAGES.mismatch);
  await c.create('short', 'short');
  assert.equal(c.snapshot().error, MESSAGES.weak_passphrase);
  assert.equal(vault.state, 'absent'); // nothing created by invalid input
  await c.create(PASS, PASS);
  const v = c.snapshot();
  assert.equal(v.screen, 'confirm_recovery');
  assert.match(v.recoveryCode!, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  assert.ok(renders > 0);
});

test('recovery code is dropped from memory only after the user retypes its last group', async () => {
  const { c } = fresh();
  await c.start(); await c.create(PASS, PASS);
  const code = c.snapshot().recoveryCode!;
  c.acknowledgeRecovery('WRONG');
  assert.equal(c.snapshot().error, MESSAGES.recovery_check);
  assert.equal(c.snapshot().recoveryCode, code);
  c.acknowledgeRecovery(lastGroup(code).toLowerCase());
  assert.equal(c.snapshot().screen, 'unlocked');
  assert.equal(c.snapshot().recoveryCode, null);
  assert.equal(JSON.stringify(c.snapshot()).includes(code), false);
});

test('lock then unlock with the real vault; a wrong passphrase gets the shared constant message', async () => {
  const { c, vault } = await created();
  c.lock();
  assert.equal(vault.locked, true);
  assert.equal(c.snapshot().screen, 'unlock');
  await c.unlock('not the passphrase at all');
  assert.equal(c.snapshot().error, MESSAGES.wrong_secret);
  await c.unlock(PASS);
  assert.equal(c.snapshot().screen, 'unlocked');
  assert.equal(vault.locked, false);
});

test('repeated failures back off (UI friction), then succeed after waiting', async () => {
  const { c, clock } = await created();
  c.lock();
  for (let i = 0; i < 3; i++) await c.unlock('wrong passphrase ' + i);
  assert.ok(c.snapshot().retryInMs > 0);
  await c.unlock(PASS); // refused without even trying
  assert.equal(c.snapshot().error, MESSAGES.too_soon);
  assert.equal(c.snapshot().screen, 'unlock');
  clock.advance(c.snapshot().retryInMs);
  await c.unlock(PASS);
  assert.equal(c.snapshot().screen, 'unlocked');
});

test('recover with the code: wrong code is indistinguishable from a wrong passphrase; success rotates the code', async () => {
  const { c, code, vault } = await created();
  c.lock(); c.showRecover();
  assert.equal(c.snapshot().screen, 'recover');
  await c.recover('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', NEXT, NEXT);
  assert.equal(c.snapshot().error, MESSAGES.wrong_secret);
  await c.recover(code, NEXT, NEXT);
  const fresh = c.snapshot().recoveryCode!;
  assert.equal(c.snapshot().screen, 'confirm_recovery');
  assert.notEqual(fresh, code);
  c.acknowledgeRecovery(lastGroup(fresh));
  c.lock();
  await c.unlock(PASS);
  assert.equal(c.snapshot().error, MESSAGES.wrong_secret); // old passphrase replaced
  await c.unlock(NEXT);
  assert.equal(vault.locked, false);
  vault.lock();
  await assert.rejects(vault.recover(code, PASS)); // old recovery code no longer works
});

test('change passphrase requires the current one and keeps the vault usable', async () => {
  const { c, vault } = await created();
  c.showChangePassphrase();
  await c.changePassphrase('wrong current passphrase', NEXT, NEXT);
  assert.equal(c.snapshot().error, MESSAGES.wrong_secret);
  await c.changePassphrase(PASS, NEXT, NEXT);
  assert.equal(c.snapshot().screen, 'unlocked');
  vault.lock();
  await vault.unlock(NEXT);
  assert.equal(vault.locked, false);
});

test('delete needs the typed confirmation, then crypto-shreds the device vault', async () => {
  const { c, vault } = await created();
  await vault.saveJournal({ localId: '11111111-1111-4111-8111-111111111111', text: 'synthetic entry' });
  c.showDestroy();
  await c.destroy('delete');
  assert.equal(c.snapshot().error, MESSAGES.confirm_destroy);
  assert.equal(vault.state, 'unlocked');
  await c.destroy(DESTROY_CONFIRMATION);
  assert.equal(c.snapshot().screen, 'create');
  assert.equal(await vault.refresh(), 'absent');
});

test('a lock the vault initiates (idle timeout, pagehide, identity change) moves the UI off unlocked screens', async () => {
  const { c, vault } = await created();
  c.showChangePassphrase();
  vault.lock(); // not through the controller
  assert.equal(c.snapshot().screen, 'unlock');
  c.stop();
});

test('an unavailable browser shows the unavailable screen and creates nothing', async () => {
  const c = new VaultControlsController(new LocalVault({ lockOnPageHide: false })); // Node has no global indexedDB
  await c.start();
  assert.equal(c.snapshot().screen, 'unavailable');
});

test('start → stop → start (React StrictMode) keeps following vault-initiated locks', async () => {
  const { c, vault } = await created();
  c.stop();
  await c.start();
  vault.lock();
  assert.equal(c.snapshot().screen, 'unlock');
});
