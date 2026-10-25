import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { requireAccount, requireAcceptedPair } from '../guards';
import { newId } from '../ids';

// Mirrors src/reasoning/core/vocabulary.ts (the module bundle cannot import app code). Codes only, never content.
const MODES = ['act', 'ask', 'defer', 'abstain'];
const SURFACES = ['recipient', 'owner', 'none'];
const SOURCES = ['model', 'fallback'];
const OUTCOMES = ['sent', 'asked', 'owner_prompt', 'deferred', 'quiet', 'failed'];
const ACTION = /^[A-Z_]{2,30}$/;
const CODE = /^[a-z_]{2,40}$/;
const REJECTED = /^[A-Z_]{2,30}:[a-z_]{2,40}$/;
const KEEP_PER_OWNER = 100;

/**
 * Records the owner's own Reasoning decision (D052/D053) after the deterministic core decided on their device.
 * Content-free by construction: enum codes, an optional own pair id, and timing. Authorizes nothing; nothing reads it
 * except the owner's my_reasoning_decisions view and the demo observer view.
 */
export const record_reasoning_decision = spacetimedb.reducer(
  {
    episode_id: t.string(),
    pair_id: t.option(t.string()),
    mode: t.string(),
    action: t.option(t.string()),
    surface: t.option(t.string()),
    reasons: t.array(t.string()),
    rejected: t.array(t.string()),
    reassess_after_minutes: t.option(t.u32()),
    source: t.string(),
    outcome: t.string(),
  },
  (ctx, a) => {
    requireAccount(ctx);
    if (!/^[A-Za-z0-9:_-]{1,80}$/.test(a.episode_id)) fail('invalid', 'episode_id');
    if (!MODES.includes(a.mode) || !SOURCES.includes(a.source) || !OUTCOMES.includes(a.outcome)) fail('invalid', 'codes');
    if (a.action !== undefined && !ACTION.test(a.action)) fail('invalid', 'action');
    if (a.surface !== undefined && !SURFACES.includes(a.surface)) fail('invalid', 'surface');
    if (a.reasons.length > 8 || !a.reasons.every(r => CODE.test(r))) fail('invalid', 'reasons');
    if (a.rejected.length > 16 || !a.rejected.every(r => REJECTED.test(r))) fail('invalid', 'rejected');
    if (a.reassess_after_minutes !== undefined && a.reassess_after_minutes > 60 * 24 * 14) fail('invalid', 'reassess');
    if (a.pair_id !== undefined) requireAcceptedPair(ctx, a.pair_id);
    ctx.db.reasoning_decision.insert({
      decision_id: `${ctx.timestamp.microsSinceUnixEpoch}-${newId(ctx)}`, owner: ctx.sender, episode_id: a.episode_id, pair_id: a.pair_id, mode: a.mode, action: a.action,
      surface: a.surface, reasons: a.reasons, rejected: a.rejected, reassess_after_minutes: a.reassess_after_minutes,
      source: a.source, outcome: a.outcome, created_at: ctx.timestamp,
    });
    const mine = [...ctx.db.reasoning_decision.owner.filter(ctx.sender)]
      .sort((x, y) => Number(x.created_at.microsSinceUnixEpoch - y.created_at.microsSinceUnixEpoch));
    for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_PER_OWNER))) ctx.db.reasoning_decision.decision_id.delete(old.decision_id);
  }
);
