/**
 * D057 demo reset: remove test accounts, keep the named real ones. DRY RUN unless --apply. Never prints tokens.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/purge-test-accounts.ts --keep a@x.com,b@y.com [--db dor --server maincloud] [--clerk] [--apply]
 *
 * --db <name>   SpacetimeDB step (module owner's CLI login only): lists `account` rows via `spacetime sql`, and for every
 *               account whose Clerk subject is not a keeper calls the owner-only `admin_purge_account`, which deletes the
 *               account and every row tied to it (its pairs, signals, nudges, settings, discovery, introductions, plans).
 * --clerk       Clerk step (needs CLERK_SECRET_KEY): deletes every Clerk user whose email is not a keeper. By default only
 *               synthetic test users (`+clerk_test` emails) are eligible; add --include-real to also delete other emails.
 * Run --db first (it needs the keepers' Clerk ids), then --clerk.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes('--apply');
const keepEmails = (value('--keep') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (keepEmails.length === 0) throw new Error('--keep <email,email,...> is required');
const secret = process.env.CLERK_SECRET_KEY;
if (!secret) throw new Error('missing env CLERK_SECRET_KEY');
const mask = (s: string) => s.split(secret).join('***').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***');

async function clerk(method: string, path: string): Promise<any> {
  const res = await fetch('https://api.clerk.com/v1' + path, { method, headers: { authorization: `Bearer ${secret}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(mask(`Clerk ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`));
  return text ? JSON.parse(text) : {};
}
const emailOf = (u: any): string => (u.email_addresses?.[0]?.email_address ?? '').toLowerCase();
const label = (u: any) => `${[u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)'} <${emailOf(u)}> ${u.id}`;

async function main() {
  const users: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerk('GET', `/users?limit=100&offset=${offset}&order_by=created_at`);
    users.push(...page);
    if (page.length < 100) break;
  }
  const keepers = users.filter((u) => keepEmails.includes(emailOf(u)));
  const missing = keepEmails.filter((e) => !keepers.some((u) => emailOf(u) === e));
  console.log(`Clerk users: ${users.length}. Keeping ${keepers.length}:`);
  keepers.forEach((u) => console.log(`  keep  ${label(u)}`));
  if (missing.length) throw new Error(`keeper emails not found in Clerk: ${missing.join(', ')} (stopping, nothing changed)`);
  const keepSubjects = new Set(keepers.map((u) => u.id as string));

  const db = value('--db');
  if (db) {
    const server = value('--server') ?? 'maincloud';
    const out = execFileSync('spacetime', ['sql', '-s', server, db, 'SELECT identity, display_name, subject FROM account'], { encoding: 'utf8' });
    const rows = out.split('\n').map((l) => ({ hex: /0x[0-9a-f]{64}/i.exec(l)?.[0], subject: /user_[A-Za-z0-9]+/.exec(l)?.[0], line: l.trim() }))
      .filter((r): r is { hex: string; subject: string | undefined; line: string } => Boolean(r.hex));
    const purge = rows.filter((r) => !r.subject || !keepSubjects.has(r.subject));
    console.log(`\nSpacetimeDB ${db}@${server}: ${rows.length} accounts; keep ${rows.length - purge.length}, purge ${purge.length}:`);
    purge.forEach((r) => console.log(`  purge ${r.line}`));
    if (APPLY) {
      for (const r of purge) {
        execFileSync('spacetime', ['call', '-s', server, db, 'admin_purge_account', JSON.stringify({ __identity__: r.hex })], { stdio: ['ignore', 'ignore', 'inherit'] });
        console.log(`  purged ${r.hex.slice(0, 12)}…`);
      }
    }
  }

  if (args.includes('--clerk')) {
    const includeReal = args.includes('--include-real');
    const remove = users.filter((u) => !keepSubjects.has(u.id) && (includeReal || emailOf(u).includes('+clerk_test')));
    const spared = users.filter((u) => !keepSubjects.has(u.id) && !remove.includes(u));
    console.log(`\nClerk: delete ${remove.length}${spared.length ? `, leave ${spared.length} non-test user(s) (use --include-real to delete them)` : ''}:`);
    remove.forEach((u) => console.log(`  delete ${label(u)}`));
    spared.forEach((u) => console.log(`  leave  ${label(u)}`));
    if (APPLY) for (const u of remove) { await clerk('DELETE', `/users/${u.id}`); console.log(`  deleted ${u.id}`); }
  }
  if (!APPLY) console.log('\nDRY RUN: nothing changed. Re-run with --apply.');
}

main().catch((e) => { console.error(mask(String(e?.stack ?? e))); process.exit(1); });
