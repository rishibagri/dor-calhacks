// D048 (PROPOSED, AI; Cyber review requested): viewer-initiated AI introduction suggestions. The viewer asks; the
// allow-listed worker reads open requests through worker_introduction_requests, may commit one suggestion through
// commit_introduction_proposal (which rechecks visibility, versions, overlap and blocks itself), then closes the
// request. Nobody is contacted, and the request grants nothing: it only says "suggest someone for me now".
import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import {
  INTRODUCTION_SUGGESTION_REQUEST_LIFETIME_MS, discoveryErrorCode, discoveryParticipantDenial, validClientRequestId,
} from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { newId } from '../ids';
import { fromMs, loadDiscoveryParty, toMs } from '../policy_state';
import { consumeRate, requireDiscovery } from '../discovery_effects';

/**
 * Viewer asks for one suggestion. Needs a current publication and area (the same own-state check discovery_cards
 * makes). Idempotent on (viewer, client_request_id), and while an earlier request is still open a new one is a
 * no-op, so a burst of taps is one worker job.
 */
export const request_introduction_suggestion = spacetimedb.reducer(
  { client_request_id: t.string() },
  (ctx, { client_request_id }) => {
    requireDiscovery(ctx);
    if (!validClientRequestId(client_request_id)) fail('invalid', 'client_request_id');
    const nowMs = toMs(ctx.timestamp);
    const mine = [...ctx.db.introduction_suggestion_request.viewer.filter(ctx.sender)];
    if (mine.some(r => r.client_request_id === client_request_id)) return;
    if (mine.some(r => r.status === 'open' && toMs(r.expires_at) > nowMs)) return;
    const me = loadDiscoveryParty(ctx.db, ctx.sender);
    const denied = discoveryParticipantDenial(me, nowMs);
    if (denied) fail(discoveryErrorCode(denied), denied);
    consumeRate(ctx, 'introduction_suggestion');
    ctx.db.introduction_suggestion_request.insert({
      request_id: newId(ctx), viewer: ctx.sender, client_request_id, viewer_revision: me.publication!.revision,
      status: 'open', created_at: ctx.timestamp, expires_at: new Timestamp(fromMs(nowMs + INTRODUCTION_SUGGESTION_REQUEST_LIFETIME_MS)),
    });
  }
);

/** Worker-only: the request was handled (a suggestion committed, nothing to suggest, or lapsed). Idempotent. */
export const close_introduction_suggestion_request = spacetimedb.reducer(
  { request_id: t.string() },
  (ctx, { request_id }) => {
    if (!ctx.db.worker_identity.identity.find(ctx.sender)) fail('unauthorized', 'worker only');
    const r = ctx.db.introduction_suggestion_request.request_id.find(request_id);
    if (!r) fail('not_found', 'request');
    if (r.status !== 'done') ctx.db.introduction_suggestion_request.request_id.update({ ...r, status: 'done' });
  }
);
