/**
 * Bindings drift check. Regenerates the SpacetimeDB TypeScript bindings from spacetimedb/src
 * into a temp dir and compares them with both committed copies. The generator's
 * "generated using spacetimedb cli version" stamp is ignored. Never calls a service.
 *
 *   npm run bindings:check              skips (exit 0) when the spacetime CLI is missing
 *   npm run bindings:check -- --require fails (exit 1) when the CLI is missing
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMMITTED = ['src/lib/spacetime/module_bindings', 'worker/src/module_bindings'];
const STAMP = /^\/\/ This was generated using spacetimedb cli version .*$/;
const require = process.argv.includes('--require');

function listFiles(root: string, rel = ''): string[] {
  if (!existsSync(join(root, rel))) return [];
  return readdirSync(join(root, rel)).flatMap((name) => {
    const next = join(rel, name);
    return statSync(join(root, next)).isDirectory() ? listFiles(root, next) : [next];
  });
}

function normalized(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !STAMP.test(line))
    .join('\n');
}

function diffDirs(generated: string, committed: string): string[] {
  const names = new Set([...listFiles(generated), ...listFiles(committed)]);
  return [...names].sort().flatMap((name) => {
    const a = join(generated, name);
    const b = join(committed, name);
    if (!existsSync(b)) return [`${name} (missing from committed)`];
    if (!existsSync(a)) return [`${name} (not generated; stale committed file)`];
    return normalized(a) === normalized(b) ? [] : [`${name} (content differs)`];
  });
}

const probe = spawnSync('spacetime', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log('bindings:check skipped: spacetime CLI not installed');
  process.exit(require ? 1 : 0);
}

const tmp = mkdtempSync(join(tmpdir(), 'dor-bindings-'));
try {
  const gen = spawnSync(
    'spacetime',
    ['generate', '--lang', 'typescript', '--out-dir', tmp, '--module-path', 'spacetimedb', '-y'],
    { encoding: 'utf8' },
  );
  if (gen.status !== 0) {
    console.error(`bindings:check: spacetime generate failed\n${gen.stdout}${gen.stderr}`);
    process.exit(1);
  }
  let drift = false;
  for (const dir of COMMITTED) {
    const diffs = diffDirs(tmp, dir);
    if (diffs.length === 0) continue;
    drift = true;
    console.error(`DRIFT in ${dir}:\n${diffs.map((d) => `  - ${d}`).join('\n')}`);
  }
  if (drift) {
    console.error('\nRegenerate with:');
    for (const dir of COMMITTED) {
      console.error(`  spacetime generate --lang typescript --out-dir ${dir} --module-path spacetimedb -y`);
    }
    process.exit(1);
  }
  console.log('bindings:check ok: both committed binding dirs match spacetimedb/src');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
