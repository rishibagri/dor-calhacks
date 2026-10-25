/**
 * Live-demo pair diagnosis and setup (Reasoning/Cyber, 2026-10-25). Acts as two existing Clerk users of the team's dev
 * instance, the same way scripts/smoke-core3.ts acts as its synthetic users. READ-ONLY unless --apply is passed.
 * Never prints secrets or tokens.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/demo-pair.ts --find adam
 *   node --env-file=.env.local --experimental-strip-types scripts/demo-pair.ts --a <clerkUserId> --b <clerkUserId>
 *   ... same with --apply   (writes the printed plan, then prints state again)
 *
 * For each direction X → Y of their accepted pair, the plan makes a nudge deliverable without widening anything:
 *   X: a current "friend" preset with both C3 categories, assigned to the pair (works with old and new module versions);
 *   Y: nudges on for the pair (no quiet hours) and standard support styles (all modes and windows, 30 days).
 * It never resumes a pause, never touches discovery, and never approves or sends a signal.
 * Needs: npm run ai:build (contracts + worker bindings).
 */
import { DbConnection } from '../worker/dist/module_bindings/index.js';

const env = (k: string): string => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const CLERK = 'https://api.clerk.com/v1';
const URI = process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? env('DOR_SPACETIME_URI');
const DB = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? env('DOR_SPACETIME_MODULE');
const TEMPLATE = env('NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE');
const mask = (s: string) => s.split(env('CLERK_SECRET_KEY')).join('***').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes('--apply');
const DAY = 86_400_000;
const MODES = ['short_call', 'encouraging_note', 'shared_activity'];
const WINDOWS = ['today', 'this_week', 'no_preference'];
const CATEGORIES = ['support_preference', 'coarse_availability'];

async function clerk(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(CLERK + path, {
    method, headers: { authorization: `Bearer ${env('CLERK_SECRET_KEY')}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(mask(`Clerk ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`));
  return text ? JSON.parse(text) : {};
}
const label = (u: any) => `${u.id}  ${[u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)'}  <${u.email_addresses?.[0]?.email_address ?? '?'}>`;

const VIEWS = ['my_account', 'my_pairs', 'my_presets', 'my_preset_assignments', 'my_signals', 'my_receipts', 'my_nudges',
  'my_support_preferences', 'my_nudge_delivery', 'my_recipient_pauses'];
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const hexOf = (v: any): string => (v && typeof v.toHexString === 'function' ? v.toHexString() : String(v));
const iso = (v: any): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v.microsSinceUnixEpoch === 'bigint') return new Date(Number(v.microsSinceUnixEpoch / 1000n)).toISOString();
  return String(v);
};

interface Conn { name: string; hex: string; rows(v: string): any[]; call(r: string, a: unknown): Promise<string | null>; close(): void }

async function connect(name: string, userId: string): Promise<Conn> {
  const sessions = await clerk('GET', `/sessions?user_id=${userId}&status=active`);
  const sessionId = (Array.isArray(sessions) && sessions[0]?.id) || (await clerk('POST', '/sessions', { user_id: userId })).id;
  const token = (await clerk('POST', `/sessions/${sessionId}/tokens/${TEMPLATE}`, {})).jwt as string;
  const c: any = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 10000);
    DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(token)
      .onConnect((conn: any, id: any) => { clearTimeout(t); conn.__hex = id.toHexString(); resolve(conn); })
      .onConnectError((_c: any, e: any) => { clearTimeout(t); reject(new Error(mask(String(e?.message ?? e)))); }).build();
  });
  await new Promise<void>((resolve, reject) => {
    c.subscriptionBuilder().onApplied(() => resolve()).onError((ctx: any) => reject(new Error(`subscription error ${ctx?.event?.message ?? ''}`)))
      .subscribe(VIEWS.map((v) => `SELECT * FROM ${v}`));
  });
  return {
    name, hex: c.__hex,
    rows: (v) => [...c.db[camel(v)].iter()],
    call: async (r, a) => { try { await c.reducers[camel(r)](a); return null; } catch (e: any) { return mask(String(e?.message ?? e)); } },
    close: () => c.disconnect(),
  };
}

const now = () => Date.now();
const live = (exp: any) => { const t = iso(exp); return t !== null && Date.parse(t) > now(); };

function pairWith(x: Conn, y: Conn) {
  return x.rows('my_pairs').find((p) => p.counterpartIdentity && hexOf(p.counterpartIdentity) === y.hex);
}

function report(x: Conn, y: Conn): void {
  const acct = x.rows('my_account')[0];
  const pair = pairWith(x, y);
  console.log(`\n== ${x.name} (${acct ? `registered as "${acct.displayName ?? ''}"` : 'NOT REGISTERED'}, identity ${x.hex.slice(0, 10)}…)`);
  console.log(`  pairs: ${x.rows('my_pairs').length}; with ${y.name}: ${pair ? `${pair.pairId} status=${pair.status}` : 'NONE'}`);
  if (!pair) return;
  const pid = pair.pairId;
  const presets = x.rows('my_presets');
  console.log(`  presets: ${presets.map((p) => `${p.presetKind} v${p.version} [${p.allowedCategories}] ${p.revokedAt ? 'REVOKED' : live(p.expiresAt) ? 'current' : 'EXPIRED'}`).join('; ') || 'none (server default preset applies on the new module)'}`);
  const asg = x.rows('my_preset_assignments').find((a) => a.pairId === pid);
  console.log(`  assignment for ${y.name}: ${asg ? `${asg.presetKind} v${asg.assignmentVersion}` : 'none'}`);
  const pause = x.rows('my_recipient_pauses').find((p) => p.pairId === pid);
  console.log(`  pause on ${y.name}: ${pause ? `${pause.active ? 'ACTIVE' : 'inactive'} until ${iso(pause.expiresAt)}` : 'none'}`);
  const del = x.rows('my_nudge_delivery').find((d) => d.pairId === pid);
  console.log(`  nudges from ${y.name} → ${x.name}: ${del ? (del.optedIn ? 'on' : 'OFF') : 'default (on)'}${del?.quietStartMinute != null ? ` quiet ${del.quietStartMinute}-${del.quietEndMinute} (utc${del.utcOffsetMinutes})` : ''}`);
  const pref = x.rows('my_support_preferences').find((p) => p.pairId === pid);
  console.log(`  support styles as recipient: ${pref ? `v${pref.consentVersion} [${pref.supportModes}] [${pref.availability}] ${pref.revokedAt ? 'REVOKED' : live(pref.expiresAt) ? 'current' : 'EXPIRED'}` : 'none (worker uses standard styles)'}`);
  const sigs = x.rows('my_signals').filter((s) => s.pairId === pid)
    .sort((a, b) => String(iso(b.expiresAt)).localeCompare(String(iso(a.expiresAt)))).slice(0, 5);
  for (const s of sigs) console.log(`  signal → ${y.name}: mode=${s.supportMode ?? '-'} avail=${s.availability ?? '-'} ${s.revokedAt ? 'REVOKED' : live(s.expiresAt) ? 'active' : 'expired'} (expires ${iso(s.expiresAt)})`);
  if (sigs.length === 0) console.log(`  signals → ${y.name}: none`);
  const recs = x.rows('my_receipts').slice(-5);
  for (const r of recs) console.log(`  receipt: ${r.action ?? '?'} at ${iso(r.createdAt)}`);
  const nudges = x.rows('my_nudges').filter((n) => n.pairId === pid);
  console.log(`  nudges visible to ${x.name} in this pair: ${nudges.length}${nudges.map((n) => ` [${n.templateId} until ${iso(n.visibleUntil)}]`).join('')}`);
}

interface Step { who: Conn; reducer: string; args: unknown; why: string }

function plan(x: Conn, y: Conn): Step[] {
  const pair = pairWith(x, y);
  if (!pair || pair.status !== 'accepted') return [];
  const pid = pair.pairId, steps: Step[] = [];
  const friend = x.rows('my_presets').find((p) => p.presetKind === 'friend');
  const presetOk = friend && !friend.revokedAt && live(friend.expiresAt) && CATEGORIES.every((c) => friend.allowedCategories.includes(c)) &&
    Date.parse(iso(friend.expiresAt)!) > now() + 7 * DAY;
  if (!presetOk) steps.push({ who: x, reducer: 'set_relationship_preset', why: `${x.name}: current friend preset with both categories`,
    args: { presetKind: 'friend', allowedCategories: CATEGORIES, expectedVersion: friend?.version ?? 0, expiresAt: new Date(now() + 180 * DAY).toISOString() } });
  const asg = x.rows('my_preset_assignments').find((a) => a.pairId === pid);
  if (!asg || asg.presetKind !== 'friend') steps.push({ who: x, reducer: 'assign_relationship_preset', why: `${x.name}: assign friend preset to ${y.name}`,
    args: { pairId: pid, presetKind: 'friend', expectedAssignmentVersion: asg?.assignmentVersion ?? 0 } });
  const yPair = pairWith(y, x);
  if (yPair) {
    const del = y.rows('my_nudge_delivery').find((d) => d.pairId === yPair.pairId);
    if (!del || !del.optedIn || del.quietStartMinute != null) steps.push({ who: y, reducer: 'set_nudge_delivery', why: `${y.name}: nudges from ${x.name} on, no quiet hours`,
      args: { pairId: yPair.pairId, optedIn: true, quietStartMinute: undefined, quietEndMinute: undefined, utcOffsetMinutes: -420 } });
    const pref = y.rows('my_support_preferences').find((p) => p.pairId === yPair.pairId);
    const prefOk = pref && !pref.revokedAt && live(pref.expiresAt) && MODES.every((m) => pref.supportModes.includes(m)) &&
      Date.parse(iso(pref.expiresAt)!) > now() + 2 * DAY;
    if (!prefOk) steps.push({ who: y, reducer: 'set_support_preferences', why: `${y.name}: standard support styles from ${x.name}`,
      args: { pairId: yPair.pairId, supportModes: MODES, availability: WINDOWS, expiresAt: new Date(now() + 29 * DAY).toISOString(), expectedVersion: pref?.consentVersion ?? 0 } });
  }
  return steps;
}

async function main() {
  const find = arg('--find');
  if (find) {
    const users = await clerk('GET', `/users?query=${encodeURIComponent(find)}&limit=20`);
    console.log(users.length ? users.map(label).join('\n') : 'no Clerk users match');
    return;
  }
  const aId = arg('--a'), bId = arg('--b');
  if (!aId || !bId) throw new Error('usage: --find <text> | --a <clerkUserId> --b <clerkUserId> [--apply]');
  const [ua, ub] = [await clerk('GET', `/users/${aId}`), await clerk('GET', `/users/${bId}`)];
  const nameA = ua.first_name || 'A', nameB = ub.first_name || 'B';
  console.log(`database ${DB} at ${URI}\nA = ${label(ua)}\nB = ${label(ub)}`);
  const a = await connect(nameA, aId), b = await connect(nameB, bId);
  try {
    report(a, b); report(b, a);
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const pause = x.rows('my_recipient_pauses').find((p) => p.active && pairWith(x, y)?.pairId === p.pairId);
      if (pause) console.log(`\nNOTE: ${x.name} has an ACTIVE pause on ${y.name}. Not changed by this script; resume it in the app if intended.`);
    }
    const steps = [...plan(a, b), ...plan(b, a)];
    console.log(`\nPLAN (${steps.length} step${steps.length === 1 ? '' : 's'}):`);
    for (const s of steps) console.log(`  - ${s.why}  [${s.who.name}: ${s.reducer}]`);
    if (!pairWith(a, b)) console.log(`  (no pair between ${nameA} and ${nameB}: one of them must invite the other in the app first)`);
    if (!APPLY) { console.log('\nDRY RUN: nothing written. Re-run with --apply to perform the plan.'); return; }
    for (const s of steps) {
      const err = await s.who.call(s.reducer, s.args);
      console.log(`${err ? 'FAIL' : 'ok  '} ${s.why}${err ? ` → ${err}` : ''}`);
      await sleep(400);
    }
    await sleep(1500);
    console.log('\nAFTER:');
    report(a, b); report(b, a);
  } finally { a.close(); b.close(); }
}

main().catch((e) => { console.error(mask(String(e?.stack ?? e))); process.exit(1); });
