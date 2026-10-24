/**
 * Configuration doctor (Core 3 prep). Offline: reads .env.local and the repo, prints which keys are missing or
 * malformed and whether local tooling is ready. Never prints a value, never calls a service.
 *
 *   node scripts/doctor.ts [--worker] [--extensions]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkEnv, type Finding } from '../src/lib/setup/plan.ts';

const args = process.argv.slice(2);
const mode = { worker: args.includes('--worker'), extensions: args.includes('--extensions') };
const findings: Finding[] = [];

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
else findings.push({ level: 'error', key: '.env.local', message: 'missing: copy .env.example to .env.local' });
findings.push(...checkEnv(process.env, mode));

try {
  const v = execFileSync('spacetime', ['--version'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)?.[0];
  findings.push({ level: v ? 'ok' : 'warn', key: 'spacetime', message: v ? `CLI ${v}` : 'CLI version unreadable' });
} catch {
  findings.push({ level: 'error', key: 'spacetime', message: 'CLI not on PATH (curl -sSf https://install.spacetimedb.com | sh)' });
}

const contractsBuilt = existsSync('contracts/dist/policy.js');
findings.push({ level: contractsBuilt ? 'ok' : 'warn', key: 'contracts/dist', message: contractsBuilt ? 'built' : 'not built: npm run build -w @dor/contracts' });

const dirs = ['src/lib/spacetime/module_bindings', 'worker/src/module_bindings'];
const listing = (d: string) => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : []);
const [client, worker] = dirs.map(listing);
const same = client!.length > 0 && client!.join() === worker!.join() &&
  client!.every((f) => !f.endsWith('.ts') || readFileSync(join(dirs[0]!, f), 'utf8') === readFileSync(join(dirs[1]!, f), 'utf8'));
findings.push({ level: same ? 'ok' : 'error', key: 'module_bindings', message: same ? 'client and worker bindings identical' : 'client and worker bindings differ: regenerate both' });

const icon = { ok: 'ok   ', warn: 'warn ', error: 'ERROR' } as const;
for (const f of findings) console.log(`${icon[f.level]} ${f.key}: ${f.message}`);
const errors = findings.filter((f) => f.level === 'error').length;
console.log(errors ? `\n${errors} error(s). Fix before Core 3 setup.` : '\nNo blocking configuration errors.');
process.exit(errors ? 1 : 0);
