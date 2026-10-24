# Deployed privacy verification runbook (Cyber, README D045 Phase 5)

**Status: prepared, NOT run.** Nothing is hosted yet (owner decision pending; `docs/RUNBOOK.md` "Hosted deploy"). Run this with CS on the fixed candidate revision, using three synthetic Clerk test accounts: A and B consenting, C denied (`+clerk_test` users as in `scripts/smoke-core3.ts`). Synthetic data only. Never print tokens or keys, and never start the worker while a test signal is standing. Record every result as **live-verified** only if observed on the deployed module, and list what was not run.

## 0. Preconditions (record each)
- [ ] Deployed revision (git sha), module name, server (maincloud?) and app URL.
- [ ] `set_auth_issuer` and `set_auth_audience` set to the Clerk issuer and template `aud`; the worker identity is allow-listed.
- [ ] `discovery_config`: `tags` (including transition tags; D046 refuses sensitive ones), `areas`, `source_hosts`; `enabled` is **on only for this run**, and turned off again after unless the team signs off Phase 5.
- [ ] Bindings match the deployed module (`npm run bindings:check -- --require`).
- [ ] The scheduler is healthy: no `unauthorized: scheduler only` in the module logs for 2+ minutes.

## 1. Identity and audience
| # | Action | Expected |
|---|---|---|
| 1.1 | Call any reducer with a garbage token, or anonymously | refused (`unauthenticated`) |
| 1.2 | A token from the same Clerk instance with a different `aud` | refused by reducers (`audience not allow-listed`). Views can't check `aud` (documented gap) |

## 2. Discovery (transition-first)
| # | Action | Expected |
|---|---|---|
| 2.1 | A and B publish (transition tag + interest), join the same area | each sees the other's card with exactly `card_ref, display_name, interest_tags, shared_tags, revision` |
| 2.2 | C registers and doesn't publish | C sees **0** cards and 0 companions |
| 2.3 | Try publishing a name with an email or phone, or a non-allowlisted tag | refused (`invalid:*`) |
| 2.4 | Owner tries `set_discovery_config tags ["rehab"]` | refused (`invalid: allowlist`, D046) |
| 2.5 | Inspect the browser network and storage after area capture | no coordinates sent or stored; only the area key |

## 3. Introduction and response
| # | Action | Expected |
|---|---|---|
| 3.1 | A sends an introduction to B's card | B's `my_introductions` shows it pending with A's name and shared tags |
| 3.2 | C calls respond, cancel, block or report with that `intro_id` | `not_found: introduction`; C's `my_introductions` is empty |
| 3.3 | B declines; A checks their view | A still sees **pending** until the original expiry (no decline oracle) |
| 3.4 | New pair of requests: B accepts | both see accepted; **no** pair, preset, signal or support row is created |
| 3.5 | A replays the original `client_request_id` after a decline | no new row |

## 4. Withdrawal, block, expiry
| # | Action | Expected |
|---|---|---|
| 4.1 | A withdraws while a request is pending | B's pending request disappears; accepting fails `stale: not_pending` |
| 4.2 | A blocks B by card | both disappear from each other's cards and introductions; B is told nothing |
| 4.3 | Publish with a 1-day expiry; after expiry wait ≤ 60 s for the sweep | the card disappears from views (proves the live scheduler fix) |

## 5. Events and plan (only if a real Apify record is ingested)
| # | Action | Expected |
|---|---|---|
| 5.1 | CS ingests the selected Actor (D028 conditions met) | `catalogue_events` shows the record with its `source_url` host on the allowlist and `fetched_at` |
| 5.2 | A and B mark the event; C doesn't | A and B see each other in `event_companions`; C sees nothing; the kind is never shown |
| 5.3 | The worker proposes a plan; A accepts, then A revokes their intent; B accepts | B is refused `stale: stale_source` |

## 6. Core path regression (support nudges)
| # | Action | Expected |
|---|---|---|
| 6.1 | A pauses B (D041) | B's views are unchanged except an already-seen nudge disappearing; approval to B is refused `unauthorized: recipient_paused` |
| 6.2 | B subscribes to `my_nudges` | rows are exactly `{id, pair_id, template_id, visible_until}`, with `visible_until` on a whole hour (D043) |
| 6.3 | A's `my_receipts` | only `approved` and `revoked` actions (D043) |

## 7. After the run
- [ ] Turn `discovery_config.enabled` off unless Phase 5 is signed off. Revoke test signals and withdraw test profiles.
- [ ] Record results (pass, fail, or not run, per row) in `docs/updates/cyber.md` and PROJECT_KNOWLEDGE.md as live-verified vs offline-only. Any failure blocks real-user mode.
