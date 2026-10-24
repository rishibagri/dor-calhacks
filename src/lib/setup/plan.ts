/**
 * Core 3 setup planning (CS). Pure: builds the ordered SpacetimeDB bootstrap commands and checks configuration
 * shape. It never reads secrets' values into its output, never calls the network and never runs anything; the
 * scripts in `scripts/` print these steps by default and execute them only when asked.
 */

export interface SetupEnv { readonly [key: string]: string | undefined }

export interface BootstrapOptions {
  database: string;
  /** CLI server nickname or URL (`spacetime server list`), e.g. "local" or "maincloud". */
  server: string;
  issuer: string;
  audience: string;
  areas: readonly string[];
  tags: readonly string[];
  sourceHosts: readonly string[];
  /** Enable the discovery/event extension flag in the module (core release: false). */
  enableExtensions: boolean;
  /** Wipe the database on publish (reset). */
  deleteData: boolean;
}

export interface Step { title: string; argv: string[]; note?: string }

const json = (v: unknown) => JSON.stringify(v);
const call = (o: BootstrapOptions, reducer: string, ...args: unknown[]): string[] =>
  ['spacetime', 'call', '-s', o.server, o.database, reducer, ...args.map(json)];

/**
 * Ordered, idempotent steps. The CLI identity that publishes becomes the module owner (init reducer), so every
 * owner-only call below must run under that same `spacetime login`.
 */
export function bootstrapSteps(o: BootstrapOptions): Step[] {
  const publish = ['spacetime', 'publish', '-s', o.server, '--module-path', 'spacetimedb', '-y', o.database];
  if (o.deleteData) publish.splice(2, 0, '--delete-data');
  return [
    { title: 'Build shared contracts (the module bundles @dor/contracts/policy)', argv: ['npm', 'run', 'build', '-w', '@dor/contracts'] },
    { title: o.deleteData ? 'Publish module and DELETE all existing data' : 'Publish module', argv: publish },
    { title: 'Allow-list the Clerk issuer', argv: call(o, 'set_auth_issuer', o.issuer, true) },
    { title: 'Allow-list the JWT audience (must equal the Clerk template `aud`)', argv: call(o, 'set_auth_audience', o.audience, true) },
    { title: 'Load discovery area allowlist', argv: call(o, 'set_discovery_config', 'areas', o.areas) },
    { title: 'Load interest/topic allowlist', argv: call(o, 'set_discovery_config', 'tags', o.tags) },
    { title: 'Load catalogue source-host allowlist', argv: call(o, 'set_discovery_config', 'source_hosts', o.sourceHosts) },
    {
      title: o.enableExtensions ? 'Enable discovery/event extensions' : 'Keep discovery/event extensions OFF (core release)',
      // The module accepts exactly ['true'] (on) or [] (off).
      argv: call(o, 'set_discovery_config', 'enabled', o.enableExtensions ? ['true'] : []),
    },
    {
      title: 'Generate client bindings',
      argv: ['spacetime', 'generate', '--lang', 'typescript', '--out-dir', 'src/lib/spacetime/module_bindings', '--module-path', 'spacetimedb', '-y'],
    },
    {
      title: 'Generate worker bindings',
      argv: ['spacetime', 'generate', '--lang', 'typescript', '--out-dir', 'worker/src/module_bindings', '--module-path', 'spacetimedb', '-y'],
    },
  ];
}

/** Worker allow-listing, after its identity exists (see scripts/mint-worker-identity.ts). */
export function workerIdentityStep(o: Pick<BootstrapOptions, 'database' | 'server'>, identityHex: string): Step {
  if (!/^(0x)?[0-9a-f]{64}$/i.test(identityHex)) throw new Error('worker identity must be 64 hex characters');
  const hex = identityHex.toLowerCase().replace(/^0x/, '');
  return {
    title: 'Allow-list the worker identity',
    argv: ['spacetime', 'call', '-s', o.server, o.database, 'set_worker_identity', json({ __identity__: `0x${hex}` }), json(true)],
    note: 'Identity SATS-JSON form; confirm against the CLI on first use.',
  };
}

/** Shell-quoted display form of a step (for printing only). */
export function shellLine(argv: readonly string[]): string {
  return argv.map((a) => (/^[A-Za-z0-9_./:@=-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`)).join(' ');
}

// ---------------------------------------------------------------- configuration checks

export type Level = 'ok' | 'warn' | 'error';
export interface Finding { level: Level; key: string; message: string }

const set = (env: SetupEnv, k: string) => (env[k]?.trim() ?? '') !== '';
const val = (env: SetupEnv, k: string) => env[k]?.trim() ?? '';

/** Secret-looking values (provider keys, Clerk secret, JWTs, long tokens). Used to keep them out of NEXT_PUBLIC_*. */
export function looksSecret(v: string): boolean {
  if (/^pk_(test|live)_/.test(v)) return false; // Clerk publishable keys are public by design
  return /^(sk_|sk-|rk_|whsec_|apify_api_)/.test(v) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) || /^[A-Za-z0-9_-]{40,}$/.test(v);
}

const MODULE_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Checks shape and presence only. Messages name keys, never values. `mode` selects which parts must be complete:
 * core = app + module + auth; worker adds the worker; extensions adds the catalogue source.
 */
export function checkEnv(env: SetupEnv, mode: { worker: boolean; extensions: boolean }): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, key: string, message: string) => out.push({ level, key, message });
  const need = (key: string, why: string, level: Level = 'error') => { if (!set(env, key)) add(level, key, `missing: ${why}`); };

  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('NEXT_PUBLIC_') && v && looksSecret(v.trim())) add('error', k, 'looks like a secret but is browser-visible; move it to a server-only variable');
  }

  need('NEXT_PUBLIC_SPACETIMEDB_URI', 'browser SpacetimeDB host');
  if (set(env, 'NEXT_PUBLIC_SPACETIMEDB_URI') && !/^wss?:\/\/[^\s/]+/.test(val(env, 'NEXT_PUBLIC_SPACETIMEDB_URI'))) {
    add('error', 'NEXT_PUBLIC_SPACETIMEDB_URI', 'must start with ws:// (local) or wss:// (hosted)');
  }
  if (val(env, 'NEXT_PUBLIC_SPACETIMEDB_URI').startsWith('ws://') && !/^ws:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(val(env, 'NEXT_PUBLIC_SPACETIMEDB_URI'))) {
    add('error', 'NEXT_PUBLIC_SPACETIMEDB_URI', 'plain ws:// is only acceptable for localhost; use wss:// for any other host');
  }
  const mod = val(env, 'NEXT_PUBLIC_SPACETIMEDB_MODULE') || 'dor';
  if (!MODULE_RE.test(mod)) add('error', 'NEXT_PUBLIC_SPACETIMEDB_MODULE', 'not a valid database name');
  for (const k of ['NEXT_PUBLIC_SPACETIMEDB_MODULE', 'DOR_SPACETIME_MODULE']) {
    if (/kinetic/i.test(val(env, k))) add('warn', k, 'pre-rename database name; the module and docs now use "dor"');
  }

  need('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'Clerk sign-in');
  if (set(env, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY') && !/^pk_(test|live)_/.test(val(env, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'))) {
    add('error', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'expected a pk_test_/pk_live_ key');
  }
  need('CLERK_SECRET_KEY', 'server-side Clerk (routes)');
  if (set(env, 'CLERK_SECRET_KEY') && !/^sk_(test|live)_/.test(val(env, 'CLERK_SECRET_KEY'))) add('error', 'CLERK_SECRET_KEY', 'expected a sk_test_/sk_live_ key');
  if (!set(env, 'NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE')) add('warn', 'NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE', 'unset: defaults to "spacetimedb"');

  need('DOR_CLERK_ISSUER', 'issuer to allow-list in the module (Clerk Frontend API URL)');
  if (set(env, 'DOR_CLERK_ISSUER') && !/^https:\/\/[^\s/]+$/.test(val(env, 'DOR_CLERK_ISSUER'))) {
    add('error', 'DOR_CLERK_ISSUER', 'must be the bare https:// origin, no path or trailing slash');
  }
  need('DOR_AUTH_AUDIENCE', 'audience to allow-list; must equal the Clerk JWT template `aud`');
  if (/kinetic/i.test(val(env, 'DOR_AUTH_AUDIENCE'))) {
    add('warn', 'DOR_AUTH_AUDIENCE', 'still uses the pre-rename name; fine if the Clerk template matches, but consider renaming both');
  }

  need('ANTHROPIC_API_KEY', 'private reflection (Claude)', 'warn');
  need('CARTESIA_API_KEY', 'voice capture and read-aloud (Cartesia); typed journaling still works', 'warn');

  if (mode.worker) {
    need('DOR_SPACETIME_URI', 'worker SpacetimeDB host');
    if (set(env, 'DOR_SPACETIME_URI') && set(env, 'NEXT_PUBLIC_SPACETIMEDB_URI') && val(env, 'DOR_SPACETIME_URI') !== val(env, 'NEXT_PUBLIC_SPACETIMEDB_URI')) {
      add('warn', 'DOR_SPACETIME_URI', 'differs from NEXT_PUBLIC_SPACETIMEDB_URI; app and worker must reach the same database');
    }
    if ((val(env, 'DOR_SPACETIME_MODULE') || 'dor') !== mod) add('error', 'DOR_SPACETIME_MODULE', 'must equal NEXT_PUBLIC_SPACETIMEDB_MODULE');
    need('DOR_SPACETIME_WORKER_TOKEN', 'worker identity token (scripts/mint-worker-identity.ts)');
    need('DOR_WORKER_AUTH_TOKEN', 'shared secret between app routes and worker');
    if (set(env, 'DOR_WORKER_AUTH_TOKEN') && val(env, 'DOR_WORKER_AUTH_TOKEN').length < 32) add('error', 'DOR_WORKER_AUTH_TOKEN', 'use at least 32 random characters');
    need('DOR_WORKER_URL', 'where app routes reach the worker');
    need('FACTORY_API_KEY', 'Droid on a deployed host', 'warn');
  }

  if (mode.extensions) {
    if (val(env, 'NEXT_PUBLIC_DOR_EXTENSIONS') !== 'true') add('warn', 'NEXT_PUBLIC_DOR_EXTENSIONS', 'extensions requested but the UI flag is not "true"');
    need('APIFY_API_TOKEN', 'catalogue ingestion', 'warn');
    need('APIFY_TASK_ID', 'reviewed Apify task holding the regional source', 'warn');
  } else if (val(env, 'NEXT_PUBLIC_DOR_EXTENSIONS') === 'true') {
    add('warn', 'NEXT_PUBLIC_DOR_EXTENSIONS', 'extensions UI is on for a core setup');
  }
  return out;
}
