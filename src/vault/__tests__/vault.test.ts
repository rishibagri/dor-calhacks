// Real vault tests (Cyber): Node Web Crypto + fake-indexeddb exercising the real IndexedDB adapter.
// Synthetic content only. Proves at-rest properties offline; it does not prove browser auto-lock UX.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { LocalVault, VaultError } from '../local-vault.ts';
import { IndexedDbVaultStore } from '../store.ts';
import { PBKDF2_ITERATIONS, newDek, sealRecord } from '../crypto.ts';
import type { LocalConnectionProfile } from '@kinetic/contracts';
import type { LocalQuizExtras } from '../../lib/backend/ports.ts';

const PASS = 'correct horse battery staple';
const MARK = 'SYNTHETIC-PRIVATE-MARKER-7c1e';
const profile: LocalConnectionProfile = { schemaVersion: 1, communicationStyle: 'gentle', preferredSupportModes: ['short_call'],
  draftSharingCategories: ['support_preference'], rhythm: 'flexible', suggestionIntensity: 'quiet' };
const extras: LocalQuizExtras = { prefersSpace: false, activities: ['games', 'other'], activitiesNote: MARK + ' board games',
  scheduleSuggestions: 'only_after_review', reviewComfort: 'review_everything' };

function fresh(opts: Record<string, unknown> = {}) {
  const store = new IndexedDbVaultStore(new IDBFactory());
  const make = (o: Record<string, unknown> = {}) => new LocalVault({ store, idleLockMs: 0, unsafeTestIterations: 1000, ...opts, ...o });
  return { store, vault: make(), make };
}
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof VaultError ? e.code : String(e); } };

test('create → unlocked; recovery code is 160-bit base32 in 8 groups; listeners fire', async () => {
  const { vault } = fresh();
  assert.equal(await vault.refresh(), 'absent');
  let notified = 0; vault.subscribe(() => notified++);
  const { recoveryCode } = await vault.create(PASS);
  assert.match(recoveryCode, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  assert.equal(vault.state, 'unlocked'); assert.equal(vault.locked, false);
  assert.ok(notified >= 1 && vault.getVersion() >= 2);
});

test('lock drops access; wrong passphrase fails; right passphrase restores; persists across instances', async () => {
  const { vault, make } = fresh();
  await vault.create(PASS);
  await vault.saveJournal({ localId: 'e1', text: 'synthetic entry' });
  vault.lock();
  assert.equal(vault.state, 'locked');
  assert.equal(await code(vault.readJournal('e1')), 'vault_locked');
  assert.equal(await code(vault.listJournals()), 'vault_locked');
  assert.equal(await code(vault.saveProfile(profile)), 'vault_locked');
  assert.equal(await code(vault.unlock('wrong passphrase!!')), 'wrong_secret');
  assert.equal(await code(vault.unlock('')), 'wrong_secret');
  const other = make(); // e.g. after reload, or another account in the same browser profile
  assert.equal(await other.refresh(), 'locked');
  assert.equal(await code(other.readJournal('e1')), 'vault_locked');
  await other.unlock(PASS);
  assert.equal((await other.readJournal('e1')).text, 'synthetic entry');
});

test('nothing private is stored in plaintext: journal, reflection, profile, extras, passphrase, recovery code', async () => {
  const { vault, store } = fresh();
  const { recoveryCode } = await vault.create(PASS);
  await vault.saveJournal({ localId: 'e1', text: `${MARK} journal text` });
  await vault.saveReflection('e1', `${MARK} reflection`);
  await vault.saveProfile(profile);
  await vault.saveQuizExtras(extras);
  const dump: unknown[] = [await store.getMeta()];
  for (const s of ['journal', 'reflection', 'profile', 'quizExtras'] as const) dump.push(...await store.list(s));
  const bytes = JSON.stringify(dump, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
  for (const secret of [MARK, PASS, recoveryCode, recoveryCode.replaceAll('-', ''), 'gentle', 'short_call', 'board games', 'review_everything'])
    assert.equal(bytes.includes(secret), false, `plaintext found: ${secret}`);
  const meta = (await store.getMeta())!;
  assert.deepEqual(Object.keys(meta).sort(), ['format', 'kdf', 'recoverySalt', 'vaultId', 'wraps']);
  assert.ok(meta.wraps.passphrase.ct.length === 48 && meta.wraps.recovery.ct.length === 48); // 32B key + 16B GCM tag
});

test('session key is non-extractable after unlock', async () => {
  const { vault } = fresh();
  await vault.create(PASS); vault.lock(); await vault.unlock(PASS);
  const dek = (vault as unknown as { dek: CryptoKey }).dek;
  assert.equal(dek.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', dek));
});

test('tampered, swapped or cross-store ciphertext is rejected as vault_corrupt', async () => {
  const { vault, store } = fresh();
  await vault.create(PASS);
  await vault.saveJournal({ localId: 'a', text: 'synthetic A' });
  await vault.saveJournal({ localId: 'b', text: 'synthetic B' });
  await vault.saveReflection('a', 'synthetic reflection');
  const a = (await store.get('journal', 'a'))!, b = (await store.get('journal', 'b'))!;
  const flipped = new Uint8Array(a.ct); flipped[0] ^= 1;
  await store.put('journal', { ...a, ct: flipped });
  assert.equal(await code(vault.readJournal('a')), 'vault_corrupt');
  await store.put('journal', { ...b, id: 'a' }); // b's ciphertext under a's id
  assert.equal(await code(vault.readJournal('a')), 'vault_corrupt');
  const r = (await store.get('reflection', 'a'))!;
  await store.put('journal', { ...r }); // reflection ciphertext moved into the journal store
  assert.equal(await code(vault.readJournal('a')), 'vault_corrupt');
  assert.equal(await code(vault.listJournals()), 'vault_corrupt');
});

test('records from another vault cannot be decrypted (vault id is bound into AAD)', async () => {
  const one = fresh(), two = fresh();
  await one.vault.create(PASS); await two.vault.create(PASS);
  await one.vault.saveJournal({ localId: 'x', text: 'synthetic' });
  await two.store.put('journal', (await one.store.get('journal', 'x'))!);
  assert.equal(await code(two.vault.readJournal('x')), 'vault_corrupt');
});

test('every encryption uses a fresh IV (2000 seals, no repeats)', async () => {
  const dek = await newDek();
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(Buffer.from((await sealRecord(dek, 'v', 'journal', 'same', 'same')).iv).toString('hex'));
  assert.equal(seen.size, 2000);
});

test('tampered key wrap or metadata fails closed (wrong_secret), never opens', async () => {
  const { vault, store, make } = fresh();
  await vault.create(PASS);
  const meta = (await store.getMeta())!;
  const ct = new Uint8Array(meta.wraps.passphrase.ct); ct[5] ^= 0x80;
  await store.putMeta({ ...meta, wraps: { ...meta.wraps, passphrase: { ...meta.wraps.passphrase, ct } } });
  assert.equal(await code(make().unlock(PASS)), 'wrong_secret');
  await store.putMeta({ ...meta, vaultId: 'other-vault' }); // AAD mismatch
  assert.equal(await code(make().unlock(PASS)), 'wrong_secret');
});

test('recovery: code unlocks, forces a new passphrase, rotates the code; old secrets stop working', async () => {
  const { vault, make } = fresh();
  const { recoveryCode } = await vault.create(PASS);
  await vault.saveJournal({ localId: 'e1', text: 'synthetic' });
  vault.lock();
  const v2 = make();
  assert.equal(await code(v2.recover('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'brand new passphrase')), 'wrong_secret');
  assert.equal(await code(v2.recover('not a code', 'brand new passphrase')), 'wrong_secret');
  assert.equal(await code(v2.recover(recoveryCode, 'short')), 'weak_passphrase');
  const { recoveryCode: next } = await v2.recover(recoveryCode.toLowerCase().replaceAll('-', ' '), 'brand new passphrase');
  assert.notEqual(next, recoveryCode);
  assert.equal((await v2.readJournal('e1')).text, 'synthetic');
  const v3 = make();
  assert.equal(await code(v3.unlock(PASS)), 'wrong_secret');
  assert.equal(await code(v3.recover(recoveryCode, 'another passphrase!')), 'wrong_secret');
  await v3.unlock('brand new passphrase');
  const v4 = make(); await v4.recover(next, 'third passphrase ok');
});

test('change passphrase requires the current one and keeps data readable', async () => {
  const { vault, make } = fresh();
  const { recoveryCode } = await vault.create(PASS);
  await vault.saveJournal({ localId: 'e1', text: 'synthetic' });
  assert.equal(await code(vault.changePassphrase('not the passphrase', 'next passphrase here')), 'wrong_secret');
  assert.equal(await code(vault.changePassphrase(PASS, 'too short')), 'weak_passphrase');
  await vault.changePassphrase(PASS, 'next passphrase here');
  const v = make();
  assert.equal(await code(v.unlock(PASS)), 'wrong_secret');
  await v.unlock('next passphrase here');
  assert.equal((await v.readJournal('e1')).text, 'synthetic');
  await make().recover(recoveryCode, 'recovery still works'); // recovery wrap unaffected
});

test('destroy crypto-shreds: meta and records gone, old passphrase useless, new vault possible', async () => {
  const { vault, store, make } = fresh();
  await vault.create(PASS);
  await vault.saveJournal({ localId: 'e1', text: 'synthetic' });
  await vault.saveProfile(profile);
  await vault.destroy();
  assert.equal(vault.state, 'absent');
  assert.equal(await store.getMeta(), null);
  assert.equal((await store.list('journal')).length + (await store.list('profile')).length, 0);
  assert.equal(await code(make().unlock(PASS)), 'vault_absent');
  await vault.create('a different passphrase');
  assert.equal(await code(vault.readJournal('e1')), 'not_found');
});

test('lifecycle guards: weak passphrase, double create, absent vault', async () => {
  const { vault } = fresh();
  assert.equal(await code(vault.unlock(PASS)), 'vault_absent');
  for (const weak of ['', 'short', '           x', 42 as unknown as string]) assert.equal(await code(vault.create(weak)), 'weak_passphrase');
  await vault.create(PASS);
  assert.equal(await code(vault.create(PASS)), 'vault_exists');
});

test('journals: list newest first, edit keeps createdAt, delete also removes reflection, strict ids', async () => {
  const { vault } = fresh();
  await vault.create(PASS);
  await vault.saveJournal({ localId: 'old', text: 'synthetic 1' });
  await new Promise(r => setTimeout(r, 5));
  await vault.saveJournal({ localId: 'new', text: 'synthetic 2' });
  assert.deepEqual((await vault.listJournals()).map(j => j.localId), ['new', 'old']);
  const before = await vault.readJournal('old');
  await vault.saveJournal({ localId: 'old', text: 'synthetic 1 edited' });
  const after = await vault.readJournal('old');
  assert.equal(after.createdAt, before.createdAt); assert.equal(after.text, 'synthetic 1 edited');
  await vault.saveReflection('old', 'synthetic reflection');
  assert.equal(await vault.readReflection('old'), 'synthetic reflection');
  await vault.deleteJournal('old');
  assert.equal(await code(vault.readJournal('old')), 'not_found');
  assert.equal(await vault.readReflection('old'), null);
  for (const bad of ['', '../x', 'a/b', 'x'.repeat(129), '<script>'])
    assert.equal(await code(vault.saveJournal({ localId: bad, text: 't' })), 'invalid_input');
  assert.equal(await code(vault.saveJournal({ localId: 'ok', text: '' })), 'invalid_input');
  assert.equal(await code(vault.saveReflection('ok', 'x'.repeat(2001))), 'invalid_input');
});

test('profile and quiz extras round-trip; malformed or extra fields are rejected', async () => {
  const { vault } = fresh();
  await vault.create(PASS);
  assert.equal(await vault.loadProfile(), null);
  assert.equal(await vault.loadQuizExtras(), null);
  await vault.saveProfile(profile);
  await vault.saveQuizExtras(extras);
  assert.deepEqual(await vault.loadProfile(), profile);
  assert.deepEqual(await vault.loadQuizExtras(), extras);
  assert.equal(await code(vault.saveProfile({ ...profile, journalText: 'x' } as never)), 'invalid_input');
  for (const bad of [{ ...extras, sharedWith: 'everyone' }, { ...extras, activitiesNote: 'x'.repeat(201) },
    { ...extras, activities: ['skydiving'] }, { ...extras, activities: ['games', 'games'] }, { ...extras, activitiesNote: '' }])
    assert.equal(await code(vault.saveQuizExtras(bad as never)), 'invalid_input');
});

test('idle auto-lock drops the key', async () => {
  const { make } = fresh();
  const vault = make({ idleLockMs: 30 });
  await vault.create(PASS);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(vault.locked, true);
  assert.equal(vault.state, 'locked');
});

test('errors carry only a constant code, never content', async () => {
  const { vault } = fresh();
  await vault.create(PASS);
  try { await vault.saveJournal({ localId: '../' + MARK, text: MARK }); assert.fail(); }
  catch (e) { assert.equal((e as Error).message, 'invalid_input'); assert.equal(String(e).includes(MARK), false); }
});

test('production default uses 600k PBKDF2 iterations', async () => {
  const store = new IndexedDbVaultStore(new IDBFactory());
  const vault = new LocalVault({ store, idleLockMs: 0 });
  await vault.create(PASS);
  assert.equal((await store.getMeta())!.kdf.iterations, PBKDF2_ITERATIONS);
  assert.equal(PBKDF2_ITERATIONS, 600_000);
});
