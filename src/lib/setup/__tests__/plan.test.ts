import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapSteps, checkEnv, looksSecret, shellLine, workerIdentityStep } from '../plan.ts';

const base = {
  database: 'dor', server: 'local', issuer: 'https://x.clerk.accounts.dev', audience: 'dor-spacetimedb',
  areas: ['berkeley-campus'], tags: ['hiking'], sourceHosts: ['meetup.com'], enableExtensions: false, deleteData: false,
};

test('bootstrap order: build, publish, auth, allowlists, flag, bindings for both dirs; core keeps extensions off', () => {
  const steps = bootstrapSteps(base);
  assert.equal(steps[0]!.argv.join(' '), 'npm run build -w @dor/contracts');
  assert.equal(steps[1]!.argv[1], 'publish');
  assert.ok(!steps[1]!.argv.includes('--delete-data'));
  const calls = steps.filter((s) => s.argv[1] === 'call').map((s) => s.argv[5]);
  assert.deepEqual(calls, ['set_auth_issuer', 'set_auth_audience', 'set_discovery_config', 'set_discovery_config', 'set_discovery_config', 'set_discovery_config']);
  assert.deepEqual(steps.find((s) => s.argv.includes('"enabled"'))!.argv.at(-1), '["false"]');
  const gens = steps.filter((s) => s.argv[1] === 'generate').map((s) => s.argv[5]);
  assert.deepEqual(gens, ['src/lib/spacetime/module_bindings', 'worker/src/module_bindings']);
});

test('reset adds --delete-data only when asked; extensions flag only when asked', () => {
  assert.ok(bootstrapSteps({ ...base, deleteData: true })[1]!.argv.includes('--delete-data'));
  assert.equal(bootstrapSteps({ ...base, enableExtensions: true }).find((s) => s.argv.includes('"enabled"'))!.argv.at(-1), '["true"]');
});

test('worker identity step validates hex and uses the identity JSON form', () => {
  const s = workerIdentityStep(base, 'AB'.repeat(32));
  assert.equal(s.argv.at(-2), JSON.stringify({ __identity__: `0x${'ab'.repeat(32)}` }));
  assert.throws(() => workerIdentityStep(base, 'not-hex'));
});

test('shell line quotes JSON args', () => {
  assert.equal(shellLine(['spacetime', 'call', 'dor', 'x', '"a b"']), `spacetime call dor x '"a b"'`);
});

const goodEnv = {
  NEXT_PUBLIC_SPACETIMEDB_URI: 'ws://localhost:3000', NEXT_PUBLIC_SPACETIMEDB_MODULE: 'dor',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_' + 'a'.repeat(48), NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE: 'spacetimedb',
  CLERK_SECRET_KEY: 'sk_test_x', DOR_CLERK_ISSUER: 'https://x.clerk.accounts.dev', DOR_AUTH_AUDIENCE: 'dor-spacetimedb',
  ANTHROPIC_API_KEY: 'x', CARTESIA_API_KEY: 'x',
};
const errors = (env: Record<string, string>, mode = { worker: false, extensions: false }) =>
  checkEnv(env, mode).filter((f) => f.level === 'error').map((f) => f.key);

test('a complete core env has no errors; findings never contain values', () => {
  assert.deepEqual(errors(goodEnv), []);
  const all = JSON.stringify(checkEnv({ ...goodEnv, NEXT_PUBLIC_X: 'sk_live_secretvalue' }, { worker: true, extensions: true }));
  assert.doesNotMatch(all, /secretvalue|pk_test_a|sk_test_x/);
});

test('secrets in NEXT_PUBLIC_* and insecure remote ws are errors; publishable key is not a secret', () => {
  assert.deepEqual(errors({ ...goodEnv, NEXT_PUBLIC_LEAK: 'sk-ant-abc' }), ['NEXT_PUBLIC_LEAK']);
  assert.deepEqual(errors({ ...goodEnv, NEXT_PUBLIC_SPACETIMEDB_URI: 'ws://db.example.com' }), ['NEXT_PUBLIC_SPACETIMEDB_URI']);
  assert.equal(looksSecret('pk_live_' + 'b'.repeat(60)), false);
  assert.equal(looksSecret('eyJhbGciOi.eyJzdWIi.sig'), true);
});

test('issuer must be a bare https origin; worker mode requires matching module and a long shared secret', () => {
  assert.ok(errors({ ...goodEnv, DOR_CLERK_ISSUER: 'https://x.clerk.accounts.dev/' }).includes('DOR_CLERK_ISSUER'));
  const w = errors({ ...goodEnv, DOR_SPACETIME_URI: 'ws://localhost:3000', DOR_SPACETIME_MODULE: 'other', DOR_SPACETIME_WORKER_TOKEN: 't',
    DOR_WORKER_AUTH_TOKEN: 'short', DOR_WORKER_URL: 'http://localhost:8787', FACTORY_API_KEY: 'synthetic-factory-key' },
    { worker: true, extensions: false });
  assert.deepEqual(w.sort(), ['DOR_SPACETIME_MODULE', 'DOR_WORKER_AUTH_TOKEN']);
});

test('worker Droid transport: the SDK default requires FACTORY_API_KEY; cli only warns; unknown values are errors', () => {
  const worker = { worker: true, extensions: false };
  const findings = (env: Record<string, string>) => checkEnv({ ...goodEnv, ...env }, worker).filter(f => f.key.startsWith('FACTORY') || f.key === 'DOR_DROID_TRANSPORT');
  assert.deepEqual(findings({}).map(f => [f.level, f.key]), [['error', 'FACTORY_API_KEY']]);
  assert.deepEqual(findings({ DOR_DROID_TRANSPORT: 'sdk' }).map(f => [f.level, f.key]), [['error', 'FACTORY_API_KEY']]);
  assert.deepEqual(findings({ DOR_DROID_TRANSPORT: 'cli' }).map(f => [f.level, f.key]), [['warn', 'FACTORY_API_KEY']]);
  assert.deepEqual(findings({ FACTORY_API_KEY: 'synthetic-factory-key' }), []);
  assert.deepEqual(findings({ FACTORY_API_KEY: 'synthetic-factory-key', DOR_DROID_TRANSPORT: 'droid' }).map(f => [f.level, f.key]),
    [['error', 'DOR_DROID_TRANSPORT']]);
  assert.equal(JSON.stringify(checkEnv({ ...goodEnv, FACTORY_API_KEY: 'synthetic-factory-key' }, worker)).includes('synthetic-factory-key'), false,
    'findings name keys, never values');
});
