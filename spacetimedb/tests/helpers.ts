import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';

export const ISSUER = 'https://kinetic-test.clerk.accounts.dev';
export { mod };

export function jwtAuth(sub: string, conn: bigint, issuer = ISSUER) {
  const payload = JSON.stringify({ iss: issuer, sub, aud: ['kinetic'] });
  return TestAuth.fromJwtPayload(payload, new ConnectionId(conn));
}

export function setup() {
  const h = createModuleTestHarness(mod.default, mod, { rngSeed: 7n });
  const admin = TestAuth.internal();
  h.withReducerTx(admin, ctx => mod.set_auth_issuer(ctx, { issuer: ISSUER, enabled: true }));
  const alice = jwtAuth('alice', 1n);
  const bob = jwtAuth('bob', 2n);
  const carol = jwtAuth('carol', 3n);
  const call = <T>(a: ReturnType<typeof jwtAuth>, fn: (c: Parameters<Parameters<typeof h.withReducerTx>[1]>[0]) => T) =>
    h.withReducerTx(a, fn);
  for (const [a, n] of [[alice, 'Alice'], [bob, 'Bob'], [carol, 'Carol']] as const) {
    call(a, ctx => mod.register_account(ctx, { display_name: n }));
  }
  return { h, admin, alice, bob, carol, call };
}

export type World = ReturnType<typeof setup>;

/** alice invites, bob accepts; returns ids. */
export function pairUp(w: World) {
  w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
  const invite = view<any>(w, w.alice, mod.my_invites)[0];
  w.call(w.bob, ctx => mod.accept_pair_invite(ctx, { invite_token: invite.invite_token }));
  return { pairId: invite.pair_id as string, token: invite.invite_token as string };
}

export const view = <T>(w: World, a: ReturnType<typeof jwtAuth>, v: unknown): T[] =>
  [...((v as any)(w.h.viewContext(a)) ?? [])] as T[];
