/**
 * Core 3: create the worker's own SpacetimeDB identity (never a user account) and allow-list it.
 *
 *   node scripts/mint-worker-identity.ts                       # print the plan only
 *   node scripts/mint-worker-identity.ts --run [--server local] # mint, save token, allow-list
 *
 * --run POSTs to `<host>/v1/identity` (host from DOR_SPACETIME_URI or NEXT_PUBLIC_SPACETIMEDB_URI). The token is
 * written to .cache/worker-token (mode 600, gitignored) and NEVER printed; copy it into DOR_SPACETIME_WORKER_TOKEN
 * on the worker host yourself. The public identity hex is printed so it can be audited.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { shellLine, workerIdentityStep } from '../src/lib/setup/plan.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const args = process.argv.slice(2);
const server = (() => { const i = args.indexOf('--server'); return i >= 0 && args[i + 1] ? args[i + 1]! : 'local'; })();
const database = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE?.trim() || 'dor';
const wsUri = (process.env.DOR_SPACETIME_URI || process.env.NEXT_PUBLIC_SPACETIMEDB_URI || '').trim();
const httpBase = wsUri.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');

if (!args.includes('--run')) {
  console.log(`# 1. Mint a fresh identity on the database host\ncurl -s -X POST ${httpBase || '<host>'}/v1/identity   # returns {identity, token}`);
  console.log('# 2. Store the token ONLY in the worker host env as DOR_SPACETIME_WORKER_TOKEN');
  console.log(`# 3. ${shellLine(workerIdentityStep({ database, server }, '0'.repeat(64)).argv).replace('0'.repeat(64), '<identity-hex>')}`);
  console.log('# Nothing was run. Use --run to do all three (token saved to .cache/worker-token, not printed).');
  process.exit(0);
}
if (!/^https?:\/\/[^\s/]+/.test(httpBase)) {
  console.error('Set DOR_SPACETIME_URI or NEXT_PUBLIC_SPACETIMEDB_URI (ws:// or wss://) in .env.local.');
  process.exit(1);
}
const res = await fetch(`${httpBase}/v1/identity`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
if (!res.ok) { console.error(`identity request failed: HTTP ${res.status}`); process.exit(1); }
const body = (await res.json()) as { identity?: unknown; token?: unknown };
if (typeof body.identity !== 'string' || typeof body.token !== 'string') { console.error('unexpected identity response'); process.exit(1); }
mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/worker-token', body.token, { mode: 0o600 });
chmodSync('.cache/worker-token', 0o600);
console.log(`Worker identity: ${body.identity}\nToken saved to .cache/worker-token (600). Set it as DOR_SPACETIME_WORKER_TOKEN on the worker host.`);
const step = workerIdentityStep({ database, server }, body.identity);
console.log(`\n==> ${step.title}`);
execFileSync(step.argv[0]!, step.argv.slice(1), { stdio: 'inherit' });
console.log('Worker allow-listed. It must never be registered as a user account.');
