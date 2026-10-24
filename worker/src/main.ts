import { createServer } from 'node:http';
import * as bindings from './module_bindings/index.js';
import { createLiveWorker } from './live.js';
import { SpacetimeWorkerConnection, type LooseBuilder } from './spacetime/connection.js';
import { spacetimeWorkerPorts } from './spacetime/adapters.js';
import { SignalWatcher } from './watcher.js';

/**
 * Worker process: one SpacetimeDB connection as the allow-listed worker identity, the bounded coordinator over
 * Cyber's real DisclosurePolicy, a periodic sweep that turns newly approved signals into jobs, and POST /jobs.
 * Logs are codes and counts only.
 *
 * Env: KINETIC_WORKER_AUTH_TOKEN, KINETIC_SPACETIME_URI, KINETIC_SPACETIME_MODULE (default kinetic),
 * KINETIC_SPACETIME_WORKER_TOKEN, PORT (default 8787), KINETIC_WORKER_SWEEP_MS (default 5000),
 * KINETIC_DROID_MODEL / _PATH / _TIMEOUT_MS / _CONCURRENCY. FACTORY_API_KEY for droid on a deployed host.
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

async function main(): Promise<void> {
  const generated = bindings as unknown as { DbConnection?: { builder(): LooseBuilder } };
  if (typeof generated.DbConnection?.builder !== 'function') {
    throw new Error('worker bindings not generated: see worker/src/module_bindings/index.ts');
  }
  const connection = await SpacetimeWorkerConnection.connect({
    uri: required('KINETIC_SPACETIME_URI'), database: process.env.KINETIC_SPACETIME_MODULE ?? 'kinetic',
    token: required('KINETIC_SPACETIME_WORKER_TOKEN'), builder: () => generated.DbConnection!.builder(),
  });
  log('connected', { identityPrefix: connection.identityHex.slice(0, 8) });

  const worker = createLiveWorker({
    authToken: required('KINETIC_WORKER_AUTH_TOKEN'), ...spacetimeWorkerPorts(connection),
    droid: {
      model: process.env.KINETIC_DROID_MODEL || undefined, droidPath: process.env.KINETIC_DROID_PATH || undefined,
      timeoutMs: numberEnv('KINETIC_DROID_TIMEOUT_MS', 10_000), concurrency: numberEnv('KINETIC_DROID_CONCURRENCY', 2),
      onUsage: u => log('droid_call', { model: u.model, durationMs: u.durationMs, credits: u.factoryCredits ?? -1 }),
    },
  });
  const watcher = new SignalWatcher(connection, {
    run: job => worker.runJob(job),
    onOutcome: outcomes => { for (const o of outcomes) log('outcome', { outcome: o.outcome, rounds: o.rounds, decidedBy: o.decidedBy }); },
    onError: error => log('job_error', { code: error instanceof Error ? error.message.split(':')[0]!.slice(0, 40) : 'unknown' }),
  });
  const timer = setInterval(() => { void watcher.sweep().catch(() => log('sweep_error')); },
    numberEnv('KINETIC_WORKER_SWEEP_MS', 5000));

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"ok":true}');
      return;
    }
    void worker.handler(req, res);
  });
  const port = numberEnv('PORT', 8787);
  server.listen(port, () => log('listening', { port }));

  const shutdown = () => {
    log('shutdown');
    clearInterval(timer);
    server.close();
    connection.close();
    void worker.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch(error => {
  log('fatal', { code: error instanceof Error ? error.message.slice(0, 80) : 'unknown' });
  process.exit(1);
});
