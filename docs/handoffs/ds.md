# Planning reset notice — current main d7285eb

Read `docs/roles/ds.md` and README **R0–R6** for current assignments. The historical implementation handoff below is preserved; statements such as “not merged” describe its original commit. Current status is in PROJECT_KNOWLEDGE.md. This notice is not a consumer ACK or evidence of live verification. New scope: existing connections + opted-in nearby public profiles + local-event introductions. One-time approximate location; no inherited pair consent. Forwardable update: `docs/team-messages/ds.md`.

---

# DS handoff — Day 2, D039 compatibility + card report (latest)
Status: on `role/ds-context`, based on main `6093b2a` (after CS PR #22). These changes are **uncommitted, awaiting owner review**. The first DS-R3 cut (`90d789a`) is on main via PR #17; this change replaces its event logic. DS nearby code now runs inside CS's Discover page, but only offline and on synthetic data.

## Integrated vs synthetic (as of main 6093b2a)
| Piece | In the running app? | Evidence |
|---|---|---|
| `rankDiscoveryCards` + `DiscoveryResults` (nearby) | **Composed:** `/discover` (CS PR #22) ranks `discovery_cards` through the DS adapter and renders `DiscoveryResults` with invite/block. Offline only: module unpublished; cards labelled synthetic unless `NEXT_PUBLIC_DISCOVERY_SYNTHETIC=false` | `src/app/discover/page.tsx`, `src/components/feature/discover-model.ts` |
| Card-level Report (`onReport`) | DS prop added here; **CS still needs to pass `reportCard`** (one line) | `src/features/discovery/discovery-results.tsx` |
| `rankEventCompanions`, `eligibleEvents`, `EventResults` | **No.** No event page yet (CS-R3) | — |
| Event view bindings (`catalogue_events`, `my_event_intents`, `event_companions`) | Generated in PR #22; field names match the DS row interfaces; CS has no event mappers yet | `src/lib/spacetime/module_bindings/*_table.ts` |
| C8/D038/D039 reducers and views | Module code + in-process tests only; unpublished, discovery flag off | Cyber/CS logs |
| `alreadyConnected` | **Half closed:** `discovery_cards` now hides accepted introductions (CS `4844ae6`), not existing pairs. The DS adapter stays `false` | `spacetimedb/src/views.ts` |
| Regional event feed | Not wired; `fixtures/event-listings.json` is synthetic | — |
| Rankers in the worker | No | — |
| Eval numbers | Synthetic labels from one DS annotator; no human ratings | `results/latest.md` (metrics unchanged) |

## What changed (D039 / D038 compatibility)
- **Privacy (D039 "the kind is never shown to others").** `ShortlistEntry.theirIntent` is removed, and so is the card line "(they said: planning to go)". The line now reads "You both marked {event}." for either kind. `DiscoveryCandidate.eventIntents` (other people's kind and expiry) is replaced by `sharedEventIds`: mutual event IDs taken only from `event_companions`. `rankNearby` rejects a card that carries `eventIntents` or `theirIntent`. The candidate fixture was converted the same way; ranking results and eval metrics are unchanged.
- **Companions come from the server.** `rankEventCompanions({viewer, viewerAreaKey, catalogue, myIntents, cards, companions, allowedTags, now})` reads:
  - `catalogue_events`, the public catalogue;
  - `my_event_intents`, the viewer's own intents;
  - `discovery_cards`, through the strict adapter;
  - `event_companions`, mutual `(cardRef, eventId)` pairs.

  DS no longer decides who intends what; it only narrows. A companion row is withheld, and reported in `withheld`, when it:
  - has any extra field, such as a leaked `kind` (`invalid_companion`);
  - is for an event the viewer doesn't currently intend here (`not_mutual_here`);
  - has no visible card (`card_not_visible`).

  It returns `{events: [{eventId, viewerIntent (own), companions ≤3}], candidates, eligibility, withheld}`, or `none` with one of: `not_published`, `no_active_area`, `no_eligible_event`, `viewer_no_event_intent`, `no_companions`.
- **Alignment with the backend.**
  - Freshness is now the contracts `CATALOGUE_MAX_SOURCE_AGE_MS` (48 h, the server's intent rule), down from 72 h.
  - Area keys use Cyber's rule via `validSlugAllowlist([key], 'area')`, and a test proves it equals `guardAreaKey`.
  - Event IDs use the server's shape.
  - Catalogue rows must have exactly the view's keys; a `status`, `venue` or other extra field rejects the row.
  - A duplicated event ID now withholds every copy instead of picking one.
- **D038.** `forIntroductionProposals(entries)` (`src/features/discovery/adapters.ts`) withholds entries the server's `commit_introduction_proposal` would refuse (`same_event`-only, or no shared tag). It passes the rest on as `shared_interest` with at most 3 tags. The "no decline oracle" copy test is added.
- **Card report (PR #22 ask).** `DiscoveryResults` gains an optional `onReport(ref, reason)`. It shows a Report button, which opens a picker limited to the contract `DISCOVERY_REPORT_REASONS` (same wording as Cyber's introduction form) with the D038 notice "Reporting also blocks them. They are not told who reported or why." Nothing is sent until the person confirms "Report and block"; without the prop, no button appears.
- **Tag allowlist (PR #22 ask): confirmed.** `src/lib/discovery/config.ts` `DISCOVERY_TAGS` equals the DS fixture allowlist (10 non-sensitive slugs).
- **Evidence (on main `6093b2a` + these changes):** DS suite 147 pass / 0 fail / 1 todo (a3); `tsc --noEmit` clean; `npm run check:all` exit 0 (contracts 116, module 143, app 228 + 1 todo); `npm run ai:check` exit 0 (agents 64, worker 21, integration 19); `next build --webpack` OK with `/discover` prerendered. Mutations: 16 tried on the D039 code (15 caught; the 16th exposed a redundant check, which was removed), and 2 on the report allowlist (both caught). The React component itself has no render test (`node --test` can't load TSX); its logic is tested through the view model.

## Messages to send (exact integration work)
**→ CS:**
1. In `src/app/discover/page.tsx`, pass `onReport={(ref, reason) => void runAction(() => reportCard(shared, ref, reason))}` to `<DiscoveryResults>`.
2. CS-R3 events: add mappers for `catalogue_events`, `my_event_intents` and `event_companions` (camelCase, ISO times, `null` for empty optionals; your `plain()` already does this). Call `rankEventCompanions({viewer, viewerAreaKey, catalogue, myIntents, cards, companions, allowedTags: DISCOVERY_TAGS, now})`, with `viewerAreaKey` only while `areaActive`. Render each event's companions with `<DiscoveryResults shortlist={{kind: 'shortlist', mode: 'event', entries: companions, excluded: [], truncated: false}} candidates={result.candidates} eventTitle=… />`.
3. Invite, block and report go through guarded reducers only.
4. Decide the ranker import path for the worker.

**→ Sumedh (Cyber):**
1. Ack that DS consumes `event_companions` only and never shows another person's kind.
2. `alreadyConnected` is half closed: CS's `4844ae6` hides accepted introductions in `discovery_cards`. Existing partner/friend/family pairs still appear, and are refused only at `send_introduction_request`. Please filter linked pairs too, or add a flag.
3. Please export an event-ID validator from `@dor/contracts/policy`, so DS stops mirroring `EVENT_ID_RE`.
4. a3.

**→ Adam (AI):**
1. `src/agents/src/introductions/coordinator.ts:116` builds `reasonCode: 'same_event'` proposals, but D038's `guardIntroductionProposalCommit` refuses anything except `shared_interest`. Run shortlist entries through `forIntroductionProposals` first, or drop `same_event` until Cyber enables it.
2. Map `EventCompanions` entries to `IntroductionShortlist` with `publicationVersion` from `result.candidates`.
3. Agree the import path with CS.

## Next for DS
- D038/D039 cases in the metrics report (DS-R4 needs ≥12 new nearby/event cases with a baseline); human ratings; first-session recommendations.

---

# DS handoff — R phases (DS-R0–R2)
Status at `role/ds-context` @ `b077a1e` + docs commit, on main `4fe469a`. **Merged to main via PR #9 @ `fab86d6`.** Everything is offline and synthetic. Nothing is live, and the components are not yet composed into a real page.

## Delivered (DS-R0–R2)
- **Consumer proposal:** `src/features/discovery/types.ts` defines the C8 shapes DS needs (`DiscoveryCandidate`, `DiscoveryViewer`, `PublishedEventIntent`, `DiscoveryMode`, `ReasonCode`, `DiscoveryShortlist`). These are not contract types; swap them for reviewed `@dor/contracts` C8 exports when they land.
- **`rankNearby(input)`** (`src/evaluation/nearby.ts`): a pure shortlist returning at most 3 entries.
  - **Removes:** self, blocked (either direction), withdrawn, expired publication, already connected, duplicates, rows over the 50-row cap (reported as `truncated`), and in event mode anyone without a current intent for that event.
  - **Rejects as `invalid_card`:** any card with a field outside the projection, or with an unallowlisted tag.
  - **Scores:** shared published tags, plus 2 for a shared current event intent, plus 1 when the event's topic is a shared tag. Tie-break is the opaque ref.
  - **Outputs:** `ref`, `reasons`, `sharedTags`, `sharedEventId` (`theirIntent` was removed in the Day 2 D039 change). Display names are never read.
  - **No-shortlist reasons:** `not_published`, `viewer_has_nothing_published` (cold start), `viewer_no_event_intent`, `empty_area`, `no_fit`.
- **Components** (`src/features/discovery/`): `DiscoveryResults` and `EventResults` take props only and render honest empty states. Labels come from the pure `view-model.ts`; it never shows a percentage, distance or attendance claim, and intent reads "Interested" or "Planning to go".
- **`rankActivities`:** links now go through contracts `safeCatalogueUrl`; `allowInPerson` (default false) enables local in-person events.

## Results (actual, `src/evaluation/results/latest.md` @ b077a1e)
| Set | Metric | DS | Baseline |
|---|---|---|---|
| Nearby/event, 15 cases | Top-1 relevant | 6/6 | 4/6 (most tags) |
| | Cases with a false match | 0/15 | 8/15 (16 people) |
| | Correct no-action | 9/9 | 3/9 |
| Activities, 12 cases | Top-1 / false / no-action | 6/6 / 0/12 / 6/6 | 1/6 / 9/12 / 3/6 |
| Support, 30 cases | Expected outcome | 29/30 (a3 known gap) | — |

The labels come from one DS annotator, who also designed the rankers, so these numbers are optimistic. No human ratings yet; `results/ratings-template.md` is ready for two raters.

## Consumer and exact next action
- **CS:**
  - On the Discover page, render `<DiscoveryResults shortlist candidates onInvite onBlock onEmptyAction invitedRefs synthetic />` with `shortlist = rankNearby({viewer, candidates, mode, allowedTags, now})`, where `candidates` is your authorized page (≤50 rows, area/audience filtered server-side).
  - For events, render `<EventResults result items sourceStatus allowedSourceHosts now utcOffsetMinutes onChoose />`.
  - Invite/block handlers must call the guarded reducers; the component never sends anything itself.
  - Sanitize or flag instruction-like titles.
  - Decide how rankers get packaged for the worker (root `package.json`).
- **Adam:** the introduction workflow receives at most 3 entries; prompts may contain reason codes and shared tag slugs only. Zero entries means no model call.
- **Sumedh:** confirm the projection in `types.ts` is the full permitted field set; the ranker's flag checks are defensive, while the server's are authoritative.
- **Team:** two independent raters fill in the ratings template.

## Blockers
- No C8 schema, candidate query or guards yet, so discovery runs only on fixtures.
- The rankers live in `src/evaluation`, which the worker cannot import without a packaging decision.
- D027 Q2 copy is still unapplied (CS).

## Run
```sh
npm run check:all
node --test "src/evaluation/__tests__/*.test.ts" "src/features/discovery/__tests__/*.test.ts"
node src/evaluation/report.ts --write
```

---

# Current coordination update — Nimisha (DS)

Read your updated detailed plan in docs/roles/ds.md and shared README.md phases. Task IDs are DS-P#; Cyber uses CYBER-P#. CS owns Apify ingestion; Nimisha matching; Adam bounded proposals; Sumedh disclosure/vault. Preserve existing work and review the main/role-branch status before selecting the first unmet phase. Forwardable message: docs/team-messages/ds.md. This notice does not ACK or complete any pending implementation/contract review.

---

# DS handoff
Status: rank hook, activity ranking, 12 labeled activity cases + baseline report and the 30-case support evaluation are committed on `role/ds-context` and verified offline with synthetic data. Nothing here is live: no catalogue source, provider, deployment or real policy wiring was exercised.

## Update at each handoff
- 2026-10-24T03:55Z, `role/ds-context` @ `af2fb9b` (code) on top of main `9096f81`, plus a docs commit.
- **DS-P2/P3 delivered:**
  - `src/evaluation/rank.ts`
    - `rankAckOptions(options, signal) → options`: AI coordinator `rank` hook. It is pure and only reorders or drops: duplicates, other modes, windows broader than the approved one, or a window when the sender approved none. Ordering is `today` → `this_week` → `no_preference` → none, keeping the recipient's order on ties. Inputs are the approved envelope and consented options only.
    - `rankActivities(input) → { kind: 'ranked', suggestions: [{activityId, score, rationale[]}], excluded } | { kind: 'no_suggestion', reason, excluded }`. Input: `agreed` (option both sides agreed to, or null), `catalogue` (untrusted rows), `approvedInterests` (`{sender, recipient}` from reviewed C7 consent; null today), `now`, `utcOffsetMinutes` (recipient's, from delivery state), `allowedSourceSites`, `limit` (default 3).
    - Exclusion reasons: `invalid_item`, `unsafe_url`, `source_not_allowed`, `format_out_of_scope` (in-person; online-only increment), `expired_source` (>72h or `expired`), `duplicate`, `time_unverified`, `already_started`, `starts_too_soon` (<30 min), `outside_window`. "Today" ends at the recipient's local midnight; `this_week` is 7 days; none/`no_preference` is a 14-day horizon.
    - No-suggestion reasons: `no_agreed_option`, `not_shared_activity`, `empty_catalogue`, `no_eligible_activity`, `no_strong_match` (score < 2).
    - Rationale codes: `scheduled_moment` +2, `on_demand` +1, `short_duration` (≤90 min) +1, `mutual_interest` +3 (both sides), `cached_source` −1.
  - `ActivityItem` (in rank.ts) is a DS consumer proposal for C7: `activityId, sourceUrl (https, host = sourceSite), sourceSite, title, summary, format, categories[ACTIVITY_CATEGORIES], schedule {scheduled startAt/endAt | on_demand | unknown}, durationMinutes|null, fetchedAt, freshness`. It is not a contract type.
  - Fixtures: `activity-catalogue.json` (17 synthetic rows), `activity-cases.json` (12 cases, labels written before runs). `metrics.ts` + `report.ts` → `src/evaluation/results/latest.md`.
- **Mapping questions resolved (D027):** DS-Q2 keeps the mapping and changes only the Q2 copy (CS edit). DS-Q3: `no_preference` = no scheduling information; family fixture kept. Q5 `activities` remains local and never reaches the ranker.

## Results (actual, `results/latest.md` @ af2fb9b)
| Case set | Metric | DS | Baseline |
|---|---|---|---|
| Support, 30 cases (`matching.ts`) | Expected outcome | 29/30 | — |
| Support | False nudges | 1 (a3, known gap) | — |
| Support | Correct no-action | 22/23 | — |
| Activities, 12 cases | Top-1 relevant | 6/6 | 1/6 (soonest-first) |
| Activities | Mean precision@3 | 0.78 | 0.36 |
| Activities | Cases with false suggestion | 0/12 | 9/12 |
| Activities | Correct no-action | 6/6 | 3/6 |

Caveats: one annotator (DS), who also designed the ranker, so the activity numbers are optimistic. Teammate 1–5 usefulness ratings have not been collected, so no usefulness mean exists. The precision@3 loss is `act-injection-text`, a valid listing with an instruction-like title that ranks 2nd in ac1/ac3/ac10/ac12. The text is inert (tested), but it should not be shown: CS sanitize/flag defect.

## Consumer and exact next action
- **AI (Adam):** Construct `BoundedCoordinator` with `rank: rankAckOptions`. Scratchpad check at af2fb9b: 13/13 AI fixture cases give the same outcome with the hook, and the two-window friends case orders `today` first. Agree an import path (`src/evaluation` is app-side; options: move `rankAckOptions` into contracts, or a small `@dor/ranking` workspace). For activity proposals, call `rankActivities` only after a compatible ACK, and send only `activityId` + rationale codes to the proposal step.
- **CS:** (1) Q2 copy in `src/app/onboarding/page.tsx`: "2. When you've gone quiet for a while, what would you like from a friend?" (2) Compare C7 `ActivityCatalogueItem` with `ActivityItem` fields; DS needs `format`, normalized `categories`, a `schedule` that distinguishes on-demand from unknown, `durationMinutes|null`, `fetchedAt` and `freshness`. (3) Sanitize or flag instruction-like titles before display. (4) Still open: test looping `quiz-profiles.json`; `LocalQuizExtras` runtime validation.
- **Cyber (Sumedh):** Review D027(d). Propose an `activity_interest` consent category whose record fills `approvedInterests`; until then it stays null. Pure-guard opaque signalId check would let case a3 pass offline.
- **Team:** Rate the top-3 of ac1, ac2, ac3, ac10, ac11 and ac12 on a 1–5 scale (2 raters) and record the ratings in `results/`.

## Blockers
- No C7 schema or activity-interest consent: person-specific activity delivery is blocked (catalogue read-only per PLAN.md G6).
- No live catalogue (CS-P0/P1 Actor not yet selected), so every activity result is synthetic.
- a3 stays a todo offline (mitigated in `approve_signal` via server `newId`, harness-only).

## Run
```sh
npm ci
npm run check:all                                   # includes DS tests via test:app
npm run build && node --test "src/evaluation/__tests__/*.test.ts"
node src/evaluation/report.ts --write              # regenerates results/latest.md
```
