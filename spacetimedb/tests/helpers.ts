import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';
import { DISCLOSURE_CONSENT_VERSION, payloadRevision } from '@kinetic/contracts/policy';

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

export const FUTURE = '2099-01-01T00:00:00Z';

/** Configure + assign a confirmed preset for `owner` in `pairId` (owner must be a member). */
export function confirmPreset(w: World, owner: ReturnType<typeof jwtAuth>, pairId: string, kind: string, cats: string[]) {
  const cur = view<any>(w, owner, mod.my_presets).find(p => p.preset_kind === kind);
  w.call(owner, ctx => mod.set_relationship_preset(ctx, { preset_kind: kind, allowed_categories: cats, expected_version: cur?.version ?? 0, expires_at: FUTURE }));
  const asg = view<any>(w, owner, mod.my_preset_assignments).find(a => a.pair_id === pairId);
  w.call(owner, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: kind, expected_assignment_version: asg?.assignment_version ?? 0 }));
}

/**
 * Call OUTSIDE w.call(): it reads views, and opening a view context inside a reducer tx traps the harness.
 * Build approve_signal args the way the preview route does: from the caller's own views plus
 * the canonical C6 payload revision. `over` lets tests tamper after the "preview".
 */
export function approveArgs(w: World, owner: ReturnType<typeof jwtAuth>, pairId: string,
  payload: { support_mode?: string; availability?: string }, requestId = 'req-1', over: Record<string, unknown> = {}) {
  const pair = view<any>(w, owner, mod.my_pairs).find(p => p.pair_id === pairId);
  const asg = view<any>(w, owner, mod.my_preset_assignments).find(a => a.pair_id === pairId);
  const preset = asg && view<any>(w, owner, mod.my_presets).find(p => p.policy_id === asg.preset_id);
  const base = {
    pair_id: pairId, support_mode: payload.support_mode, availability: payload.availability,
    recipient_policy_version: preset?.version ?? 1, preset_assignment_version: asg?.assignment_version ?? 1,
    consent_version: DISCLOSURE_CONSENT_VERSION, client_request_id: requestId,
  };
  const payload_revision = payloadRevision({
    pairId, recipientId: pair?.counterpart_identity?.toHexString() ?? 'none',
    supportMode: base.support_mode, availability: base.availability,
    recipientPolicyVersion: base.recipient_policy_version, presetAssignmentVersion: base.preset_assignment_version,
    consentVersion: base.consent_version,
  });
  return { ...base, payload_revision, ...over } as Parameters<typeof mod.approve_signal>[1] & Record<string, any>;
}

export const allSignals = (w: World) => w.h.withReducerTx(w.admin, ctx => [...ctx.db.approved_signal.iter()]);
