/**
 * Core 3 module bootstrap. PRINTS the ordered setup commands by default; runs them only with --run.
 *
 *   node scripts/bootstrap-module.ts [--server local|maincloud|<url>] [--extensions]
 *   node scripts/bootstrap-module.ts --run                     # execute (publish + owner config + bindings)
 *   node scripts/bootstrap-module.ts --run --reset --i-understand-this-deletes-data   # wipe and republish
 *
 * Reads DOR_CLERK_ISSUER, DOR_AUTH_AUDIENCE and NEXT_PUBLIC_SPACETIMEDB_MODULE from .env.local. Run under the
 * `spacetime login` that should own the module: the publisher becomes the owner of every admin reducer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { AREA_KEYS, DISCOVERY_TAGS } from '../src/lib/discovery/config.ts';
import { SOURCE_HOSTS } from '../src/lib/catalogue/feeds.ts';
import { bootstrapSteps, shellLine } from '../src/lib/setup/plan.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1]! : fallback; };
const reset = args.includes('--reset');
if (reset && !args.includes('--i-understand-this-deletes-data')) {
  console.error('--reset deletes every row in the database. Add --i-understand-this-deletes-data to confirm.');
  process.exit(1);
}
const issuer = process.env.DOR_CLERK_ISSUER?.trim(), audience = process.env.DOR_AUTH_AUDIENCE?.trim();
if (!issuer || !audience) {
  console.error('Set DOR_CLERK_ISSUER and DOR_AUTH_AUDIENCE in .env.local (run node scripts/doctor.ts).');
  process.exit(1);
}

const steps = bootstrapSteps({
  database: process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE?.trim() || 'dor', server: opt('--server', 'local'), issuer, audience,
  areas: AREA_KEYS, tags: DISCOVERY_TAGS, sourceHosts: SOURCE_HOSTS, enableExtensions: args.includes('--extensions'), deleteData: reset,
});

if (!args.includes('--run')) {
  steps.forEach((s, i) => console.log(`# ${i + 1}. ${s.title}\n${shellLine(s.argv)}\n`));
  console.log('# Then: node scripts/mint-worker-identity.ts (worker), and follow docs/RUNBOOK.md. Nothing was run.');
  process.exit(0);
}
for (const [i, s] of steps.entries()) {
  console.log(`\n==> ${i + 1}/${steps.length} ${s.title}`);
  execFileSync(s.argv[0]!, s.argv.slice(1), { stdio: 'inherit' });
}
console.log('\nModule bootstrapped. Next: node scripts/mint-worker-identity.ts, then docs/RUNBOOK.md "Start".');
