import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { InvalidJobError, JobConflictError, JobLedger, runCoordinationJob, type JobDeps } from './jobs.js';

const MAX_BODY_BYTES = 4096;

/**
 * POST /jobs with `Authorization: Bearer <KINETIC_WORKER_AUTH_TOKEN>` and a CoordinationJob body.
 * Responds with sanitized outcome codes only. Bodies are never logged or echoed. Retries of the same job ID
 * are deduplicated by a JobLedger (one per handler unless supplied).
 */
export function createJobRequestHandler(deps: JobDeps & { authToken: string }) {
  if (deps.authToken.length < 32) throw new Error('Worker auth token must be at least 32 characters');
  const expected = digest(deps.authToken);
  const jobDeps: JobDeps = { ...deps, ledger: deps.ledger ?? new JobLedger() };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = randomUUID();
    const fail = (status: number, code: string, message: string) =>
      send(res, status, { error: { code, message, requestId } });
    if (req.method !== 'POST' || req.url !== '/jobs') return fail(404, 'not_found', 'Not found');
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!timingSafeEqual(digest(token), expected)) return fail(401, 'unauthenticated', 'Unauthenticated');
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      return (error as Error).message === 'too_large' ? fail(413, 'too_large', 'Body too large')
        : fail(422, 'invalid_job', 'Invalid coordination job');
    }
    let outcomes;
    try {
      outcomes = await runCoordinationJob(body, jobDeps);
    } catch (error) {
      if (error instanceof JobConflictError) return fail(409, 'job_conflict', 'Job ID reused with different contents');
      return error instanceof InvalidJobError ? fail(422, 'invalid_job', 'Invalid coordination job')
        : fail(503, 'coordination_unavailable', 'Coordination unavailable');
    }
    send(res, 200, { outcomes });
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
