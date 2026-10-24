import type { Ctx } from './errors';

/** Random opaque id from the module RNG (deterministic under replay, unguessable in prod). */
export function newId(ctx: Ctx): string {
  return ctx.newUuidV4().toString();
}

/** ~244 bits of randomness for invite tokens. */
export function newToken(ctx: Ctx): string {
  return (ctx.newUuidV4().toString() + ctx.newUuidV4().toString()).replaceAll('-', '');
}
