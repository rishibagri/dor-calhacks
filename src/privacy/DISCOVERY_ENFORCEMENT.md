# Discovery and introductions: enforcement matrix (Cyber, CYBER-R2, D038)

**Status: implemented and offline-verified in the in-process SpacetimeDB harness only.** Nothing is published. The harness does not prove deployed isolation, real Clerk JWT mapping, the real scheduler or concurrent transactions. Everything here sits behind `discovery_config.enabled` (default off) until CS, DS and AI ACK D035 and D038.

Guards live in `contracts/src/discovery.ts` (zod-free, re-exported from `@dor/contracts/policy`). Reducers are in `spacetimedb/src/reducers/{discovery,introductions}.ts`, cascades in `spacetimedb/src/discovery_effects.ts`, views in `spacetimedb/src/views.ts`.

## Who can do what (server-enforced)

| Action (reducer) | Caller | Server checks, in order | Refusals | Rate limit |
|---|---|---|---|---|
| `publish_discovery_profile` | account | flag; exact preview (allowlisted tags, name with no contact details, notice version, ≤ 7 d); `expected_revision` | `invalid:*`, `stale: stale_revision`, `unavailable: disabled` | 20/day |
| `set_discovery_area` | account | flag; configured coarse key only; 24 h | `invalid:*`, `rate_limited: area_change` | 4/day |
| `withdraw_discovery_profile` | account (works when flag off) | none needed; idempotent | none | none |
| `send_introduction_request` | account | flag; request id shape; idempotent replay; card visible now (both published, same area, no block); not already connected/pending; post-decline/lapse cooldown; ≤ 5 pending | `not_found: card`, `stale: already_requested`, `stale: already_connected`, `rate_limited: pending_limit`, `invalid: request_id_reused` | 10/day |
| `respond_introduction_request` | recipient only | participant; pending; unexpired; (accept) flag, no block, both publications standing, sender revision unchanged | `not_found: introduction`/`not_participant`, `stale: not_pending`/`expired`/`stale_revision` | none |
| `cancel_introduction_request` | sender only | participant; pending; unexpired | as above | none |
| `block_discovery_user` | account | card visible now (no probing) | `not_found: card` | 20/day (shared with the next row) |
| `block_introduction_participant` | either participant | participant | `not_found: introduction` | 20/day |
| `report_discovery_user` | account | reason in allowlist; card visible now, or caller is a participant; also blocks | `invalid: reason`/`target_kind`, `not_found:*` | 10/day |
| `commit_introduction_proposal` | allow-listed worker only | flag; ids; visibility now; both publication versions; tags ⊆ both current tags; `shared_interest` only; not already pending/connected; idempotent on `proposal_id` | `unauthorized: worker only`, `stale: stale_revision`, `not_found: blocked`/`area_mismatch`, `unauthorized: withdrawn`, `invalid:*`, `stale: already_connected` | none (worker) |
| `dismiss_introduction_proposal` | viewer only | owner of the proposal | `not_found: proposal` | none |

Limits are per caller identity, in one database (one module instance), counted on successful actions only: a failed reducer rolls back its counter. Refused probes are kept uninformative instead: every ref the caller cannot see gives the same `not_found`, and card refs are random UUIDs, not identities.

## What each person can see (views, caller-filtered)

| View | Rows | Fields | Never included |
|---|---|---|---|
| `discovery_cards` | other participants visible to the caller now, ≤ 50 | `card_ref, display_name, interest_tags, shared_tags, revision` | identity, area key, expiry, pair/preset/signal/preference, quiz, journal, location |
| `my_discovery_profile` | the caller's own | own publication, own area key and status | anyone else's |
| `my_introductions` | introductions the caller is in, unless blocked either way | `intro_id, direction, status, counterpart_name, shared_tags, created_at, expires_at` | identities, card refs, area; incoming pending shown only while the sender's profile stands unchanged; outgoing never shows a decline (accepted / pending / closed); recipient name only after acceptance |
| `my_introduction_proposals` | the caller's own AI suggestions, while the candidate is still visible and both revisions unchanged | `proposal_id, candidate_ref, reason_code, shared_tags, opener_id, decided_by, expires_at` | anything about the candidate beyond their card ref; candidates never see proposals about them |
| `discovery_report`, `discovery_block`, `rate_window`, `introduction`, `introduction_proposal` tables | private | none | no view reads reports, blocks or rate windows |

## Cascades (take effect in the same transaction)

| Event | Effect |
|---|---|
| Withdraw | area participation ends; every pending request involving the caller closes; proposals naming the caller are deleted; accepted introductions remain |
| New publication revision | the owner's pending outgoing requests close (the recipient never accepts a profile they weren't shown); proposals naming the owner are deleted; incoming requests remain |
| Block or report (either path) | both people disappear from each other's cards, introductions and proposals; pending and accepted introductions between them end |
| Sweep (every 60 s) | pending requests past expiry become expired; a declined request becomes "closed" for its sender at the original expiry; expired proposals are deleted; expired publications/areas are marked so views drop them |

## Evidence (offline)

- `spacetimedb/tests/introductions.test.ts`: 29 direct reducer/view tests with a third account. They cover cross-user access, own-action authority, the decline oracle, replay, expiry, withdrawal/edit/block during a pending request and during AI generation, model-widened proposals, report privacy, each rate limit, and the flag-off behaviour.
- `contracts/tests/introductions.test.mjs`: 10 guard tests (ordering, cooldown anchoring, uniform messages, authority, proposal commit).
- `src/features/privacy/__tests__/introduction-model.test.ts`: 5 tests (fixed copy, no server text echoed, report reasons match the server).
- 20 of 20 mutations caught: removing each rate limit, cascade, decline mask, worker check, authority or version check, or a view recheck, fails a test.

## Not proven / open

- No deployed run, no real browser, no two real accounts. CYBER-R5 repeats these attacks live.
- Views can't check JWT `aud` (D035 gap) or the clock; expiry in views is bounded by the 60 s sweep.
- Rate limits are per database. A user with many accounts gets many budgets; account creation limits belong to Clerk.
- Reports are stored, but there is no moderator tooling yet, and a reported user is not suspended automatically.
- `same_event` proposals and event intents are CYBER-R3. Avatars are not supported (no approved media path).

---

# Events, intents, activity approvals and shared plans (CYBER-R3, D039)

Same status and flag as above: offline harness only, `discovery_config.enabled` off until the ACKs. Guards in `contracts/src/events-policy.ts`; D034 lifecycle in `contracts/src/plan-lifecycle.ts` (adopted as-is); reducers in `spacetimedb/src/reducers/events.ts`; loaders in `spacetimedb/src/event_state.ts`.

## Who can do what

| Action (reducer) | Caller | Server checks | Refusals | Limit |
|---|---|---|---|---|
| `upsert_catalogue_event` | module owner or allow-listed worker | strict field set; allowlisted topics, coarse area (in-person only), source host; sanitized title; fetch not in the future or older than the stored one; ≤ 60 days ahead | `unauthorized: ingester only`, `invalid:*`, `stale: older_fetch` | none (server) |
| `publish_event_intent` | account, flag on | kind allowlist; event scheduled, fresh ≤ 48 h, not started; `expected_version` | `not_found: event_not_found`, `stale: event_cancelled`/`source_stale`/`event_started`/`stale_revision`, `invalid: invalid_schema` | 30/day |
| `revoke_event_intent` | owner (works with flag off) | idempotent; bumps version | none | none |
| `approve_activity_interest` | pair member | accepted pair; owner's preset for this pair includes `activity_interest`, previewed versions; assignment names the counterpart; allowlisted topics; notice version; idempotent id | `not_found: pair`, `unauthorized: no_preset_category`, `stale: stale_revision`, `invalid:*` | 20/day |
| `revoke_activity_interest` | owner | owner of the approval | `not_found: approval` | none |
| `commit_plan_proposal` | allow-listed worker, flag on | basis current (accepted introduction / accepted pair); participants from the basis; no block; both bound intents current at the bound versions; pair basis: both C7 approvals current, naming each other, covering the event; usable event; ≥ 1 h lead; one live plan per pair and event; idempotent | `unauthorized: worker only`, `stale: basis_not_current`/`intent_not_current`/`approval_not_current`/`lead_time`/`already_planned`, `not_found: blocked`, `invalid:*` | none |
| `revise_plan_proposal` | allow-listed worker | pending plan, `expected_revision`, sources current at the new catalogue time; clears both acceptances | `stale:*`, `not_found: plan` | none |
| `respond_plan` | participant only | D034 `applyPlanAction` with a check recomputed now: fresh scheduled event at the bound start, both bound intents, basis (incl. approvals), no block, not expired, same revision | `not_found: plan`, `stale: stale_source`/`stale_revision`/`expired`/`closed`/`already_accepted`, `unavailable: disabled` (accept only) | none |
| `cancel_plan` | participant only | allowed even when the plan is stale | `not_found: plan`, `stale: closed`/`expired` | none |

## What each person can see

| View | Rows | Never included |
|---|---|---|
| `catalogue_events` | registered callers; scheduled records not started or stale (sweep), ≤ 200 | any user row, intent, count or plan |
| `my_event_intents` | own, not lapsed (withdrawn ones with `active = false`, so the client knows the version) | anyone else's |
| `event_companions` | (card_ref, event_id) where the caller can see the card now AND both intend the same usable event | the kind (interested/going), intents for events the caller didn't mark, anyone not visible |
| `my_activity_approvals` | own standing approvals | the counterpart never sees the topic list outside a plan |
| `my_plans` | own plans, live status | the other's acceptance before "confirmed"; who declined/cancelled (others see "closed"); plans between blocked people |
| `worker_plan_candidates` | worker only: basis, event, intent ids/versions, approval ids, topics, times | names, identities, titles, source text |

## Finalization rule
A plan is confirmed only when both participants accepted the same revision, and at the moment of the second acceptance all of these hold: the event is scheduled at the bound start time, our copy is ≤ 48 h old, both bound intents stand at their bound versions, the basis stands (an accepted introduction, or an accepted pair with both C7 approvals standing against unchanged presets), there's no block, and the plan hasn't expired. Revoke, unlink, re-publish, preset tightening, block, cancellation, a moved start or a stale copy after the first acceptance all refuse the second. Nothing books, RSVPs, buys or messages.

## Evidence (offline)
- `spacetimedb/tests/events.test.ts`: 24 direct reducer/view tests with a third account. They cover wrong event, user and revision, one-sided acceptance, revoke-after-first-accept (intent, approval, re-publish), block, cancelled and stale catalogue, moved events, decline privacy, C7 off-by-default and preset tightening.
- `contracts/tests/events.test.mjs`: 11 guard tests.
- `src/features/privacy/__tests__/event-consent-model.test.ts`: 6 copy and model tests.
- 23 of 23 mutations caught.

## Venue tags review (optional public venue tags)
Verdict: **not added.** Venue lives only in the public catalogue record's title/source link, never in an intent, profile, card or plan field. There is no visit history: intents expire with the event and carry no venue, no cross-event aggregation is exposed, and `event_companions` is per event and mutual only. A future venue tag must be a catalogue attribute from a developer allowlist, never derived from a person's intents, and never shown as "regular at".

## Not proven / open
- No live Apify source: catalogue tests use synthetic records written through the ingester reducer. CS-R3 must call `upsert_catalogue_event` from the real, D028-guarded ingestion.
- Views have no clock; started, stale and expired states reach them through the 60 s sweep.
- Group plans are out of scope; pair permissions are never reused for groups.
