/**
 * Core 3 live smoke: two accounts (A, B) + a denied third (C) against the REAL Clerk dev instance
 * and a local or hosted SpacetimeDB. SYNTHETIC DATA ONLY (dor-smoke-{a,b,c}[-SMOKE_TAG]+clerk_test@example.com).
 * Any teammate can run it: the private-table reads (allow-list print, --sweep marker) need the module owner's
 * CLI login and are skipped, and reported as skipped, for everyone else.
 * Never prints secrets or tokens. Never calls paid providers. Does not run the worker, so nudge
 * delivery (commit_nudge) is NOT exercised.
 *
 * Run (from repo root):
 *   node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts
 * Needs: local `spacetime start`, module published as DOR_SPACETIME_MODULE, `spacetime` CLI server
 * alias `dor-local` (override with SMOKE_SERVER), contracts built (npm run build -w @dor/contracts),
 * worker bindings built (worker/dist/module_bindings). Re-runnable: it unlinks a stale A<->B pair first.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { payloadRevision, DISCLOSURE_CONSENT_VERSION } from '../contracts/dist/index.js';
import { DbConnection } from '../worker/dist/module_bindings/index.js';

const env = (k: string): string => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const CLERK = 'https://api.clerk.com/v1';
const URI = process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? env('DOR_SPACETIME_URI');
const DB = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? env('DOR_SPACETIME_MODULE');
const SERVER = process.env.SMOKE_SERVER ?? 'dor-local';
const TEMPLATE = env('NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE');
const mask = (s: string) => s.split(env('CLERK_SECRET_KEY')).join('***').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Clerk ----------------------------------------------------------------
async function clerk(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(CLERK + path, {
    method, headers: { authorization: `Bearer ${env('CLERK_SECRET_KEY')}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(mask(`Clerk ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`));
  return text ? JSON.parse(text) : {};
}
// SMOKE_TAG gives each teammate their own A/B/C users, so runs against a shared database never collide.
const SMOKE_TAG = process.env.SMOKE_TAG ?? '';
if (!/^[a-z0-9]{0,16}$/.test(SMOKE_TAG)) throw new Error('SMOKE_TAG: lowercase letters/digits only, at most 16');
async function ensureUser(tag: string): Promise<string> {
  const email = `dor-smoke-${tag}${SMOKE_TAG && `-${SMOKE_TAG}`}+clerk_test@example.com`;
  const found = await clerk('GET', `/users?email_address=${encodeURIComponent(email)}`);
  if (Array.isArray(found) && found[0]) return found[0].id;
  const made = await clerk('POST', '/users', {
    email_address: [email], first_name: `Smoke${tag.toUpperCase()}`, skip_password_requirement: true,
  });
  return made.id;
}
interface Acct { tag: string; userId: string; sessionId: string }
const mint = async (a: Acct): Promise<string> => (await clerk('POST', `/sessions/${a.sessionId}/tokens/${TEMPLATE}`, {})).jwt;
const claims = (jwt: string): any => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

// ---- SpacetimeDB ------------------------------------------------------------
const VIEWS = ['my_account', 'my_pairs', 'my_invites', 'my_presets', 'my_preset_assignments', 'my_signals',
  'my_receipts', 'my_nudges', 'my_support_preferences', 'my_nudge_delivery'];
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
interface Conn { c: any; hex: string; rows(view: string): any[]; call(name: string, args: unknown): Promise<string | null>; close(): void }

async function connect(token: string | undefined, subscribe = true): Promise<Conn> {
  const c: any = await new Promise((resolve, reject) => {
    let b = DbConnection.builder().withUri(URI).withDatabaseName(DB);
    if (token) b = b.withToken(token);
    const t = setTimeout(() => reject(new Error('connect timeout')), 8000);
    b.onConnect((conn: any, id: any) => { clearTimeout(t); conn.__hex = id.toHexString(); resolve(conn); })
      .onConnectError((_c: any, e: any) => { clearTimeout(t); reject(new Error(String(e?.message ?? e))); }).build();
  });
  if (subscribe) {
    await new Promise<void>((resolve, reject) => {
      c.subscriptionBuilder().onApplied(() => resolve()).onError((ctx: any) => reject(new Error(`subscription error ${ctx?.event?.message ?? ''}`)))
        .subscribe(VIEWS.map((v) => `SELECT * FROM ${v}`));
    });
  }
  return {
    c, hex: c.__hex,
    rows: (v) => [...c.db[camel(v)].iter()],
    // Returns null on success, else the exact error string.
    call: async (name, args) => { try { await c.reducers[camel(name)](args); return null; } catch (e: any) { return String(e?.message ?? e); } },
    close: () => c.disconnect(),
  };
}
async function waitFor(fn: () => boolean, ms = 4000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (fn()) return true;
  return fn();
}
const idHex = (v: any): string => (v && typeof v.toHexString === 'function' ? v.toHexString() : String(v));

// ---- reporting --------------------------------------------------------------
const results: { n: string; step: string; expected: string; actual: string; pass: boolean }[] = [];
function rec(n: string, step: string, expected: string, actual: string, pass: boolean) {
  results.push({ n, step, expected, actual: mask(actual), pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${n} ${step} | expected ${expected} | actual ${mask(actual)}`);
}
const skipped: string[] = [];
function skip(n: string, step: string, why: string) {
  skipped.push(n);
  console.log(`SKIP ${n} ${step} | ${why}`);
}
const ok = (n: string, step: string, err: string | null) => rec(n, step, 'ok', err ?? 'ok', err === null);
const denied = (n: string, step: string, err: string | null) => rec(n, step, 'rejected', err ?? 'ACCEPTED (unexpected)', err !== null);

/** Private tables are readable only by the module owner's CLI login; anyone else gets null and the owner-only checks are skipped. */
function ownerSql(q: string): string | null {
  try {
    return execFileSync('spacetime', ['sql', DB, q, '-s', SERVER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

// Opt-in: set a short-lived consent, wait for the 60 s sweep to mark it, then restore normal consent.
async function sweepStep(b: Conn, pairId: string, normalExp: string): Promise<void> {
  const stamp = () => new Date().toISOString();
  const cur = b.rows('my_support_preferences').find((p) => p.pairId === pairId);
  const shortExp = new Date(Date.now() + 8000).toISOString();
  ok('10a', `B set_support_preferences expiring ${shortExp}`, await b.call('set_support_preferences', {
    pairId, supportModes: ['short_call'], availability: ['today'], expiresAt: shortExp, expectedVersion: cur?.consentVersion ?? 0 }));
  await waitFor(() => b.rows('my_support_preferences').some((p) => p.pairId === pairId && p.consentVersion === (cur?.consentVersion ?? 0) + 1));
  const row = b.rows('my_support_preferences').find((p) => p.pairId === pairId);
  rec('10b', 'B my_support_preferences row visible, active', 'row, not revoked', row ? `row v${row.consentVersion} revoked=${!!row.revokedAt}` : 'none', !!row && !row.revokedAt);
  const id: string = row?.consentId ?? '';
  if (ownerSql('SELECT kind FROM expired_record') === null) {
    skip('10c', 'sweep inserted expired_record kind=preference for B consent', 'expired_record is private: run with the module owner CLI login');
  } else {
    const marked = () => (ownerSql('SELECT kind, record_key FROM expired_record') ?? '').split('\n').some((l) => l.includes('preference') && l.includes(id));
    console.log(`${stamp()} sweep: expiry set for ${shortExp}; polling expired_record every 5s (max 150s)`);
    let found = false;
    for (const end = Date.now() + 150000; Date.now() < end; await sleep(5000)) { if (marked()) { found = true; break; } }
    console.log(`${stamp()} sweep: marker ${found ? 'PRESENT' : 'absent'}`);
    rec('10c', 'sweep inserted expired_record kind=preference for B consent', 'marker present', found ? 'marker present' : 'absent after 150s', found);
  }
  const after = b.rows('my_support_preferences').find((p) => p.pairId === pairId);
  console.log(`${stamp()} sweep: my_support_preferences still returns row=${!!after} (owner view is raw; expiry is enforced by loadPreference/commit_nudge, not hidden in this view)`);
  const latest = b.rows('my_support_preferences').find((p) => p.pairId === pairId);
  ok('10d', 'B restore normal support preferences', await b.call('set_support_preferences', {
    pairId, supportModes: ['short_call'], availability: ['today'], expiresAt: normalExp, expectedVersion: latest?.consentVersion ?? 0 }));
}

async function main() {
  // ---- tokens + allow-list check (stop on mismatch) ----
  const accts: Acct[] = [];
  for (const tag of ['a', 'b', 'c']) {
    const userId = await ensureUser(tag);
    const sess = await clerk('POST', '/sessions', { user_id: userId });
    accts.push({ tag, userId, sessionId: sess.id });
  }
  console.log('clerk users:', accts.map((a) => `${a.tag}=${a.userId}`).join(' '));
  const [A, B, C] = accts;
  const tok = { a: await mint(A), b: await mint(B), c: await mint(C) };
  const cl = claims(tok.a);
  const aud = Array.isArray(cl.aud) ? cl.aud : [cl.aud];
  console.log(`token iss=${cl.iss} aud=${JSON.stringify(aud)} | env DOR_CLERK_ISSUER=${process.env.DOR_CLERK_ISSUER} DOR_AUTH_AUDIENCE=${process.env.DOR_AUTH_AUDIENCE}`);
  // The allow-list tables are private. Without the owner login, step 1 proves them instead: register_account
  // fails with "issuer/audience not allow-listed" unless both are allow-listed.
  const cfg = ownerSql('SELECT * FROM auth_config'); const audTable = ownerSql('SELECT * FROM auth_audience');
  const tables = cfg !== null && audTable !== null;
  console.log(tables ? 'module auth_config:\n' + cfg + '\nmodule auth_audience:\n' + audTable
    : 'module allow-list tables: not readable (not the owner CLI login); step 1 checks them');
  const issOk = cl.iss === process.env.DOR_CLERK_ISSUER && (!tables || cfg!.includes(cl.iss));
  const audOk = aud.includes(process.env.DOR_AUTH_AUDIENCE) && (!tables || aud.some((x: string) => audTable!.includes(x)));
  rec('0', `token iss/aud match env${tables ? ' + module allow-lists' : ''}`, 'match', `issuer ${issOk ? 'ok' : 'MISMATCH'}, audience ${audOk ? 'ok' : 'MISMATCH'}`, issOk && audOk);
  if (!issOk || !audOk) { console.log('STOP: allow-list mismatch (finding); reducer phase skipped'); return; }

  const a = await connect(tok.a), b = await connect(tok.b), c = await connect(tok.c);

  // 1 register
  for (const [n, who, name] of [['1a', a, 'Smoke A'], ['1b', b, 'Smoke B'], ['1c', c, 'Smoke C']] as const) {
    const err = await who.call('register_account', { displayName: name });
    ok(n, `register_account ${name}`, err);
    if (err?.includes('not allow-listed')) { console.log('STOP: module allow-list missing the Clerk issuer/audience (owner: set_auth_issuer / set_auth_audience)'); return; }
  }
  // Re-run hygiene: unlink stale accepted A<->B pairs.
  await waitFor(() => a.rows('my_account').length === 1);
  for (const p of a.rows('my_pairs')) if (p.status === 'accepted' && idHex(p.counterpartIdentity) === b.hex) await a.call('unlink_pair', { pairId: p.pairId });

  // 2 invite / accept / third accept
  ok('2a', 'A create_pair_invite', await a.call('create_pair_invite', {}));
  const hadInvite = await waitFor(() => a.rows('my_invites').length > 0);
  const invite = a.rows('my_invites')[0];
  rec('2b', 'A sees own invite via my_invites', 'one invite', hadInvite ? 'one invite' : 'none', hadInvite);
  ok('2c', 'B accept_pair_invite', await b.call('accept_pair_invite', { inviteToken: invite.inviteToken }));
  denied('2d', 'C accept same invite after B', await c.call('accept_pair_invite', { inviteToken: invite.inviteToken }));
  await waitFor(() => a.rows('my_pairs').some((p) => p.pairId === invite.pairId && p.status === 'accepted'));
  const pairId: string = invite.pairId;

  // 3 presets + assignment (A is the sender; mirrors preset-editor / ShareReview)
  const exp = new Date(Date.now() + 7 * 864e5).toISOString();
  const curPreset = a.rows('my_presets').find((p) => p.presetKind === 'friend');
  ok('3a', 'A set_relationship_preset friend', await a.call('set_relationship_preset', {
    presetKind: 'friend', allowedCategories: ['support_preference', 'coarse_availability'], expectedVersion: curPreset?.version ?? 0, expiresAt: exp }));
  const curAssign = a.rows('my_preset_assignments').find((x) => x.pairId === pairId);
  ok('3b', 'A assign_relationship_preset', await a.call('assign_relationship_preset', {
    pairId, presetKind: 'friend', expectedAssignmentVersion: curAssign?.assignmentVersion ?? 0 }));
  await waitFor(() => a.rows('my_preset_assignments').some((x) => x.pairId === pairId));

  // 4 recipient B: nudge opt-in + support-preference consent
  ok('4a', 'B set_nudge_delivery opted_in', await b.call('set_nudge_delivery', {
    pairId, optedIn: true, quietStartMinute: undefined, quietEndMinute: undefined, utcOffsetMinutes: -new Date().getTimezoneOffset() }));
  ok('4b', 'B set_support_preferences', await b.call('set_support_preferences', {
    pairId, supportModes: ['short_call'], availability: ['today'], expiresAt: exp, expectedVersion: 0 }));
  await waitFor(() => b.rows('my_nudge_delivery').length > 0 && b.rows('my_support_preferences').length > 0);

  // 5 approve (payloadRevision exactly as share-review-model.ts)
  const preset = a.rows('my_presets').find((p) => p.presetKind === 'friend');
  const assign = a.rows('my_preset_assignments').find((x) => x.pairId === pairId);
  const draft = { pairId, supportMode: 'short_call', availability: 'today',
    recipientPolicyVersion: preset.version, presetAssignmentVersion: assign.assignmentVersion, consentVersion: DISCLOSURE_CONSENT_VERSION };
  const rev = payloadRevision({ pairId, recipientId: b.hex, supportMode: draft.supportMode, availability: draft.availability,
    recipientPolicyVersion: draft.recipientPolicyVersion, presetAssignmentVersion: draft.presetAssignmentVersion, consentVersion: draft.consentVersion });
  const reqId = randomUUID();
  ok('5a', 'A approve_signal (correct payloadRevision)', await a.call('approve_signal', { ...draft, payloadRevision: rev, clientRequestId: reqId }));
  const seen = await waitFor(() => a.rows('my_signals').some((s) => s.pairId === pairId));
  const sig = a.rows('my_signals').find((s) => s.pairId === pairId);
  rec('5b', 'A sees signal in my_signals', '1 row', seen ? '1 row' : '0 rows', seen);
  await sleep(500);
  rec('5c', 'B and C my_signals/my_receipts empty', '0 rows', `B signals=${b.rows('my_signals').length} receipts=${b.rows('my_receipts').length}; C signals=${c.rows('my_signals').length} receipts=${c.rows('my_receipts').length}`,
    [b, c].every((x) => x.rows('my_signals').length === 0 && x.rows('my_receipts').length === 0));

  // 6 denied third + stale revision
  denied('6a', 'C approve_signal on A<->B pair', await c.call('approve_signal', { ...draft, payloadRevision: rev, clientRequestId: randomUUID() }));
  denied('6b', "C revoke A's signal", await c.call('revoke_signal', { signalId: sig?.signalId ?? 'x' }));
  const leak = VIEWS.filter((v) => v !== 'my_account').map((v) => `${v}=${c.rows(v).length}`);
  rec('6c', 'C reads pair/signal/nudge/receipt/invite/preset views', 'all 0 rows', leak.join(' '), leak.every((s) => s.endsWith('=0')));
  denied('6d', 'A approve_signal stale/wrong payloadRevision', await a.call('approve_signal', { ...draft, payloadRevision: (rev + 1) >>> 0, clientRequestId: randomUUID() }));
  denied('6e', 'B (recipient) revoke A signal', await b.call('revoke_signal', { signalId: sig?.signalId ?? 'x' }));

  // 7 revoke + replay
  ok('7a', 'A revoke_signal', await a.call('revoke_signal', { signalId: sig.signalId }));
  const rv = await waitFor(() => a.rows('my_signals').some((s) => s.signalId === sig.signalId && s.revokedAt));
  rec('7b', 'my_signals shows revoked', 'revokedAt set', rv ? 'revokedAt set' : 'not revoked', rv);
  const replay = await a.call('approve_signal', { ...draft, payloadRevision: rev, clientRequestId: reqId });
  await sleep(500);
  const still = a.rows('my_signals').filter((s) => s.pairId === pairId);
  rec('7c', 'replay same client_request_id does not resurrect', 'no new/unrevoked signal', `replay=${replay ?? 'ok(no-op)'}; signals=${still.length}, active=${still.filter((s) => !s.revokedAt).length}`,
    still.length === 1 && still.every((s) => s.revokedAt));

  // 8 reconnect A with a fresh token
  a.close(); await sleep(500);
  const a2 = await connect(await mint(A));
  const consistent = await waitFor(() => a2.rows('my_pairs').some((p) => p.pairId === pairId && p.status === 'accepted') && a2.rows('my_signals').some((s) => s.signalId === sig.signalId && s.revokedAt));
  rec('8', 'A reconnect (fresh token): pair present, signal revoked', 'consistent', consistent ? `consistent; same identity=${a2.hex === a.hex}` : 'inconsistent', consistent && a2.hex === a.hex);

  // 9 bad auth
  let garbage = 'connected(unexpected)';
  try { const g = await connect('garbage.token.value', false); garbage = (await g.call('register_account', { displayName: 'x' })) ?? 'ACCEPTED'; g.close(); } catch (e: any) { garbage = `connect rejected: ${e.message}`; }
  rec('9a', 'garbage token', 'connect or reducer rejected', garbage, garbage.startsWith('connect rejected') || (garbage !== 'ACCEPTED' && garbage !== 'connected(unexpected)'));
  let anon = 'ACCEPTED';
  try { const g = await connect(undefined, false); anon = (await g.call('register_account', { displayName: 'x' })) ?? 'ACCEPTED'; g.close(); } catch (e: any) { anon = `connect rejected: ${e.message}`; }
  rec('9b', 'no token (anonymous)', 'reducer rejected', anon, anon !== 'ACCEPTED');

  // 10 (opt-in, --sweep) positive proof that the scheduled sweep marks an expired preference.
  if (process.argv.includes('--sweep')) await sweepStep(b, pairId, exp);

  console.log('NUDGE DELIVERY (commit_nudge / worker): not run (worker requires paid provider)');
  [a2, b, c].forEach((x) => x.close());
}

main().then(() => {
  const fails = results.filter((r) => !r.pass);
  console.log(`\n${results.length - fails.length}/${results.length} PASS${skipped.length ? ` (${skipped.length} owner-only skipped: ${skipped.join(', ')})` : ''}`);
  process.exit(fails.length ? 1 : 0);
}).catch((e) => { console.error('smoke aborted:', mask(String(e?.stack ?? e))); process.exit(2); });
