import { createServer } from 'node:http';
import { loadBindings } from './bindings.js';
import { createLiveWorker } from './live.js';
import { SpacetimeWorkerConnection, type LooseBuilder } from './spacetime/connection.js';
import { spacetimeWorkerPorts } from './spacetime/adapters.js';
import { SignalWatcher } from './watcher.js';
import { PlanWatcher, runPlanJob } from './plans.js';
import { WorkerLoop } from './loop.js';
import { droidEnv, type DroidTransport } from './droid-proposer.js';
import { DroidSdkTransport, type CreateSdkSession } from './droid-sdk.js';

/**
 * Worker process: one SpacetimeDB connection as the allow-listed worker identity, the bounded coordinator over
 * Cyber's real DisclosurePolicy, event-driven sweeps (plus a fallback interval) that turn newly approved signals
 * into jobs, automatic reconnect that fails closed while disconnected, and POST /jobs.
 * Logs are codes and counts only.
 *
 * Env: DOR_WORKER_AUTH_TOKEN, DOR_SPACETIME_URI, DOR_SPACETIME_MODULE (default dor),
 * DOR_SPACETIME_WORKER_TOKEN, PORT (default 8787), DOR_WORKER_SWEEP_MS (fallback sweep, default 15000),
 * DOR_WORKER_MAX_OFFLINE_MS (default 120000),
 * DOR_DROID_MODEL / _PATH / _TIMEOUT_MS / _CONCURRENCY / _TRANSPORT (sdk default, cli). FACTORY_API_KEY for the
 * SDK transport and for droid on a deployed host.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
const numberEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const log = (event: string, data: Record<string, string | number> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

/**
 * Default: the SDK warm-session transport (droid-sdk.ts), which needs FACTORY_API_KEY. DOR_DROID_TRANSPORT=cli
 * selects the per-call `droid exec` CLI instead (works with a local CLI login). Without a key the worker refuses to
 * start rather than silently changing transport, cost and latency.
 */
async function droidTransport(): Promise<DroidTransport | undefined> {
  if (process.env.DOR_DROID_TRANSPORT === 'cli') return undefined;
  if (!process.env.FACTORY_API_KEY) throw new Error('not_configured: FACTORY_API_KEY (or set DOR_DROID_TRANSPORT=cli)');
  const specifier = '@factory/droid-sdk/node';
  let sdk: { createSession?: unknown };
  try {
    sdk = (await import(specifier)) as { createSession?: unknown };
  } catch {
    throw new Error('not_configured: @factory/droid-sdk is not installed');
  }
  if (typeof sdk.createSession !== 'function') throw new Error('not_configured: unexpected @factory/droid-sdk shape');
  return new DroidSdkTransport({
    createSession: sdk.createSession as CreateSdkSession, apiKey: process.env.FACTORY_API_KEY,
    model: process.env.DOR_DROID_MODEL || undefined, droidPath: process.env.DOR_DROID_PATH || undefined,
    env: droidEnv(process.env, { withKey: false }),
  });
}

async function main(): Promise<void> {
  const generated = (await loadBindings()) as unknown as { DbConnection?: { builder(): LooseBuilder } };
  if (typeof generated.DbConnection?.builder !== 'function') {
    throw new Error('worker bindings not generated: see worker/src/module_bindings/index.ts');
  }
  const connection = await SpacetimeWorkerConnection.connect({
    uri: required('DOR_SPACETIME_URI'), database: process.env.DOR_SPACETIME_MODULE ?? 'dor',
    token: required('DOR_SPACETIME_WORKER_TOKEN'), builder: () => generated.DbConnection!.builder(),
  });
  log('connected', { identityPrefix: connection.identityHex.slice(0, 8) });

  const transport = await droidTransport();
  log('droid_transport', { kind: transport ? 'sdk' : 'cli' });
  const worker = createLiveWorker({
    authToken: required('DOR_WORKER_AUTH_TOKEN'), ...spacetimeWorkerPorts(connection),
    droid: {
      model: process.env.DOR_DROID_MODEL || undefined, droidPath: process.env.DOR_DROID_PATH || undefined,
      timeoutMs: numberEnv('DOR_DROID_TIMEOUT_MS', 10_000), concurrency: numberEnv('DOR_DROID_CONCURRENCY', 2), transport,
      onUsage: u => log('droid_call', { model: u.model, durationMs: u.durationMs, credits: u.factoryCredits ?? -1,
        ...(u.outcome ? { outcome: u.outcome } : {}) }),
    },
  });
  const watcher = new SignalWatcher(connection, {
    run: job => worker.runJob(job),
    onOutcome: outcomes => { for (const o of outcomes) log('outcome', { outcome: o.outcome, rounds: o.rounds, decidedBy: o.decidedBy }); },
    onError: error => log('job_error', { code: error instanceof Error ? error.message.split(':')[0]!.slice(0, 40) : 'unknown' }),
  });
  // Shared plans (D039) run only when the bindings carry worker_plan_candidates + commit_plan_proposal.
  const clock = { now: () => new Date() };
  const plans = connection.planCandidates ? new PlanWatcher(connection, {
    run: basis => runPlanJob(basis, { source: connection, runner: worker.runner, clock }),
    onOutcome: o => log('plan_outcome', { outcome: o.outcome, rounds: o.rounds, modelCalls: o.modelCalls, decidedBy: o.decidedBy }),
    onError: error => log('plan_error', { code: error instanceof Error ? error.message.split(':')[0]!.slice(0, 40) : 'unknown' }),
  }) : null;
  log('plans', { enabled: plans ? 1 : 0 });
  // Event-driven: new worker-view rows trigger a sweep at once; the interval is only a safety net. Nothing runs
  // while the connection is down, and a lost connection that will not come back exits so the supervisor restarts.
  const loop = new WorkerLoop(connection, {
    sweeps: [() => watcher.sweep(), ...(plans ? [() => plans.sweep()] : [])],
    fallbackIntervalMs: numberEnv('DOR_WORKER_SWEEP_MS', 15_000),
    maxOfflineMs: numberEnv('DOR_WORKER_MAX_OFFLINE_MS', 120_000),
    onFatal: () => shutdown(1),
    log,
  });
  loop.start();

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      // 503 while the database connection is down, so a supervisor or load balancer sees the real state.
      res.writeHead(connection.isAlive ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: connection.isAlive }));
      return;
    }
    void worker.handler(req, res);
  });
  const port = numberEnv('PORT', 8787);
  server.listen(port, () => log('listening', { port }));

  function shutdown(code = 0): void {
    log('shutdown', { code });
    loop.stop();
    server.close();
    connection.close();
    void worker.close().finally(() => process.exit(code));
  }
  process.once('SIGTERM', () => shutdown(0));
  process.once('SIGINT', () => shutdown(0));
}

main().catch(error => {
  log('fatal', { code: error instanceof Error ? error.message.slice(0, 80) : 'unknown' });
  process.exit(1);
});
