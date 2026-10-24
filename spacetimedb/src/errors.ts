import { SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import type { spacetimedb } from './schema';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
/** Mirrors ReducerErrorCode in src/lib/backend/ports.ts. */
export type ErrorCode =
  | 'unauthenticated' | 'unauthorized' | 'not_found' | 'stale'
  | 'invalid' | 'rate_limited' | 'unavailable';

export function fail(code: ErrorCode, message: string): never {
  throw new SenderError(`${code}: ${message}`);
}

export type AccountRow = NonNullable<ReturnType<Ctx['db']['account']['identity']['find']>>;
export type PairRow = NonNullable<ReturnType<Ctx['db']['pair']['pair_id']['find']>>;
