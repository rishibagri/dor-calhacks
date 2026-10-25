# Planning reset notice — current main d7285eb

Read `docs/roles/ds.md` and README **R0–R6** for current assignments. The historical implementation handoff below is preserved; statements such as “not merged” describe its original commit. Current status is in PROJECT_KNOWLEDGE.md. This notice is not a consumer ACK or evidence of live verification. New scope: existing connections + opted-in nearby public profiles + local-event introductions. One-time approximate location; no inherited pair consent. Forwardable update: `docs/team-messages/ds.md`.

---

# DS handoff — D044 consumer check + hosted `dor` status (2026-10-24, latest)
**Branch:** `role/ds-context` fast-forwarded to main `1b65c9e` (Cyber #52 D044 automatic nudges, AI #53 env/audience docs). Uncommitted, awaiting owner review.

**D044 (DS consumer item from `docs/features/AUTOMATIC_NUDGES.md`):** NEW `src/evaluation/__tests__/standing-consent.test.ts`, 7 tests over the 55 decision cases and 8 quiz profiles, using only `@dor/contracts` guards (`guardStandingRule`, `standingRuleStands`) and the pure DS/CS models:
- no loop, assessment or quiz output carries a rule;
- rule-granting fields are rejected by the strict schemas and never preview;
- quiz drafts can't satisfy the setup guard;
- a rule covers only its own pair, recipient and categories;
- revoke, replacement, expiry, preset change and pause-then-resume all stop a queued automatic approval;
- paused people never reach a preview.

Mutations 5/5 caught (revoke check, pause guard, recipient check, non-strict assessment, loop keeping an invalid candidate; all restored). Offline only: reducers, sweep and worker are Cyber's module tests. This is the DS ACK of D044 as a consumer; no DS fixture or label changed, and Core 1–4 still assume manual approval.

**Hosted `dor` (Nimisha owns the login; current facts in `docs/team-messages/maincloud.md`):** republished from main `3bf3e25`; issuer and audience (`dor-spacetimedb`) set; the only worker is Adam's `0xc200188a…`; hosted smoke 26/26 (Adam, non-owner). Owner steps left:
1. Confirm `SELECT * FROM auth_audience` shows only `dor-spacetimedb` (remove `kinetic-spacetimedb` if it's still there).
2. Decide with the team whether to republish from main (adds D044 tables and reducers; `npm run setup:module -- --server maincloud --run`, never `--reset` or `--delete-data`), then rerun the smoke.
3. `SMOKE_SERVER=maincloud node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts --sweep` (owner run); record the results.
4. D041/D043 live checks once CS ACKs the smoke extension.

---

# DS handoff — shared Maincloud database `dor` (2026-10-24T21:51Z, superseded by the entry above)
Deployed from main `53795c2` under Nimisha's `spacetime login` (owner of every admin reducer and module update). Fail closed until the Clerk issuer/audience are allow-listed. Connection details, per-role setup, live evidence (8/8 anonymous/worker denial checks) and what is still unverified: `docs/team-messages/maincloud.md`. Next owner steps, in order:
1. Put Rishi's `DOR_CLERK_ISSUER`, `DOR_AUTH_AUDIENCE`, `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE` in `.env.local`, plus `NEXT_PUBLIC_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com` and `NEXT_PUBLIC_SPACETIMEDB_MODULE=dor`.
2. `npm run setup:module -- --server maincloud --run` (no `--reset`).
3. `SMOKE_SERVER=maincloud node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts --sweep`; record the results.
4. D041/D043 live checks once CS ACKs the smoke extension. Share the worker token with Adam through a secret channel.

---

# DS handoff — Day 2, D039 compatibility + card report; core-first next
Status: PR #25 (open), `role/ds-context` merged with main `71c3b6a` (README core-first, CS Events page). **Under the new README, discovery and events are preserved extensions, not core gates: this PR is maintenance only** (a D039 disclosure fix, server alignment, keeping CS's `/events` working, Report). DS code runs inside `/discover` and `/events`, offline and on synthetic data only. The first DS-R3 cut (`90d789a`) is on main via PR #17; this PR replaces its event logic.

## Integrated vs synthetic (as of main 6093b2a)
| Piece | In the running app? | Evidence |
|---|---|---|
| `rankDiscoveryCards` + `DiscoveryResults` (nearby) | **Composed:** `/discover` (CS PR #22) ranks `discovery_cards` through the DS adapter and renders `DiscoveryResults` with invite/block. Offline only: module unpublished; cards labelled synthetic unless `NEXT_PUBLIC_DISCOVERY_SYNTHETIC=false` | `src/app/discover/page.tsx`, `src/components/feature/discover-model.ts` |
| Card-level Report (`onReport`) | DS prop added here; **CS still needs to pass `reportCard`** (one line) | `src/features/discovery/discovery-results.tsx` |
| `eligibleEvents` | **Composed:** CS's `/events` (`events-model.ts` `eventCards`) filters the catalogue with it, using CS's `toListing` shape, which PR #25 keeps accepting (regression test + CS's 4/4 test) | `src/components/feature/events-model.ts` |
| `rankEventCompanions`, `EventResults` | **No.** CS's Events page joins `event_companions` to cards itself (mutual only, ≤3); it doesn't use the DS ranker | — |
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
- **Evidence (merged with main `71c3b6a`):** DS suite 149 pass / 0 fail / 1 todo (a3); `tsc --noEmit` clean; `npm run check:all` exit 0 (contracts 116, module 143, app 244 + 1 todo); `npm run ai:check` exit 0 (agents 64, worker 21, integration 19); `next build --webpack` OK (`/discover`, `/events`); CS `events-model.test.ts` 4/4. Mutations: 16 on the D039 code (15 caught; the 16th exposed a redundant check, which was removed), 2 on the report allowlist and 4 on the CS-shape compatibility (all caught). The React component has no render test (`node --test` can't load TSX); its logic is tested through the view model.

## Messages to send (exact integration work)
**→ CS:**
0. `/events` keeps working with PR #25: `eligibleEvents` still accepts your `toListing` shape, which is regression-tested. Passing `catalogue_events` rows directly also works now.
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

## Core 1/2 status (2026-10-24T18:45Z, PR open)
- **Core 1 labels:** `src/evaluation/fixtures/decision-cases.json`, 24 synthetic cases. Each has an expected `no_action` / `needs_clarification` / `ready_for_preview` and forbidden-disclosure terms under six labels (`unapproved_recipient`, `private_activity`, `location`, `excuse`, `relationship_tension`, `timing_detail`). The labels come from the README rules and were written before any run; they are not relabeled to fit the code.
- **Core 2 paired scenarios** run against CS's `decide()` (`src/evaluation/decision-loop.ts`): general vs specific, explicit refusal, ambiguous timing, skipped question, changed answer, prompt injection, private party and no candidate, plus a 4-story noninterference check.
- **Result:** 22/24 match; missed 0; unsafe 2, both known gaps:
  - **r4 (AI):** a refusal written only in the entry still offers Alex, because no assessment feeds the loop.
  - **i2 (CS):** a malformed candidate reaches `ready_for_preview`; `previewDisclosure` then denies it.
- **Not covered:** model assessments (none exist), the durable pause / change-of-mind-during-generation case (needs Cyber's pause contract), and teammate ratings (Core 3).

## Core 1/2 v2 with D040 (2026-10-24T20:30Z, pushed to PR #32; not merged)
- **Pipeline:** `initialLoopState(candidate, assessment)` → owner taps → `decide(state, assessedRecipients(recipients, assessment))`.
- **Cases:** 44. 19 new `a*` cases reference all 10 cases in AI's reflection fixture by ID; the DS expectations were written before the run. The v1 labels are unchanged.
- **Results:** 42/44 expected; appropriate silence 18/19; missed 0/8; unsafe suggestions 1 (i2); excluded person surfaced 0; forbidden-disclosure findings 1 (r4m).
- **Open:**
  - **r4m (AI + CS):** a refusal is ignored when the assessment is missing.
  - **i2 (CS):** a malformed candidate reaches `ready_for_preview`.
- **r5 resolved by the DS owner:** an owner tap on an assessment-excluded person → `no_action: no_recipient` (v1 label `needs_clarification` kept in `labelHistory`). Preferred because the excluded person must not be contacted or substituted automatically and re-asking would invite a second choice; verified against PRIVATE_ASSESSMENT.md §3, README 'Deterministic exclusion', CS `decide()` and AI's assessment test. No other label changed.
- **Limits:** the AI fixture outputs are hand-written, not Claude, so a live run is still needed (Core 3).

## Core 3 status (2026-10-24T21:15Z, uncommitted; PR #32 open)
- **Baselines** (`decision-baselines.ts`), on the same 44 cases and labels:

  | System | Expected | Silence | Missed | Unsafe | Excluded surfaced | Forbidden (cases / terms) |
  |---|---|---|---|---|---|---|
  | `d040_loop` | 42/44 | 18/19 | 0/8 | 1 | 0 | 1 / 1 |
  | `loop_without_assessment` | 29/44 | 13/19 | 3/8* | 4 | 6 | 10 / 15 |
  | `preview_on_candidate` | 13/44 | 5/19 | 0/8 | 31 | 8 | 15 / 30 |

  *The 3 missed cases partly come from replaying D040's taps; see the report.
- **Ratings:** the workflow is ready (`rate.ts --sheets` / `--score`, blinded, 85 items, κ and DS-label agreement). **No ratings have been collected yet (0 of 2 raters).**
- **Team ask:** two teammates who didn't write the labels each fill one sheet in `src/evaluation/results/ratings/`, independently. DS then runs `node src/evaluation/rate.ts --score` and the report.
- **Unchanged:** r4m stays a todo pending D042; i2 stays a todo pending CS's candidate validation.

## Core 1–3 status (2026-10-25T00:30Z, PR pending)
- **Pipeline:** the evaluator replays CS's current `DecisionLoop` composition: pauses (D041) → unnamed-exclusion guard → assessment → `decide`. i2 was closed by CS (`1c452b9`).
- **Cases:** 55 (+11 audit cases: unnamed, duplicate names, pause, nickname).
- **Results:** 55 cases: 52/55, appropriate silence 22/22, missed 0/9, unsafe suggestions 0 (i2 closed by CS 1c452b9), excluded surfaced 0, forbidden-disclosure findings 3 cases (r4m, nn1, nn2).
- **Baselines:** `loop_without_assessment` 34/55, unsafe 3, excluded surfaced 8; `preview_on_candidate` 14/55, unsafe 41, excluded surfaced 12. Ratings are not collected (113 blinded items).
- **Open:**
  - **r4m:** resolved under D042 (see below).
  - **nn1/nn2:** nickname exclusions fail open (AI).
  - **Approval-timing row:** todo pending Cyber's `my_nudges` fix.
  - **f4 quiz "space":** resolved, see below.
  - **a3:** Cyber.

## f4 quiz-space relabel (2026-10-24T19:55Z, added to PR #36; not merged)
- **Decision (DS owner):** quiz Q1 "space" only leaves support out of the preset drafts (CS `427cd3f`, core3-audit.md item 3). It is neither a standing suppressor nor an authorization (README: the quiz never grants consent).
- **f4:** expected preview is now `preview {supportMode: encouraging_note}` (owner-only). The match stays `no_nudge: no_signal`. The v1 label is in `labelHistory`.
- **`matching.ts`:** `buildPreview` has no `prefersSpace` input and no `owner_prefers_space` reason. Per-entry `wants_space`, refusals, pauses, approval and recipient consent are unchanged; regression tests cover each path.
- **Results:** support baseline 29/30 (a3); decision loop 52/55; check:all and ai:check exit 0.
- **Follow-up:** the `quiz-profiles.json` space notes and the D042/r4m re-decision are done (see the next section).

## D042 + quiz profiles (2026-10-24T20:05Z, main 2624fbd merged; for PR #36, not merged)
- **D042:** the evaluator applies CS's `failClosedWithoutAssessment`, as `decision-loop.tsx` does. r4m was relabeled by the DS owner to `no_action: assessment_missing` (earlier label in `labelHistory`). The 25 DS cases written under "missing = ask normally" carry the neutral assessment `{unclear, [], []}`; their labels are unchanged, and a test proves the input is equivalent.
- **Quiz profiles:** `presetDrafts` (CS `draftCategoriesFor`) replaces the DS-only `supportAction`. The cases are checked against CS's real quiz functions.
- **Results:** decision loop 53/55; forbidden 2 (nn1, nn2); check:all and ai:check exit 0. The rater sheets were regenerated (114 items, blank).
- **Open:** D042 is not in `docs/DECISIONS.md`; the contract still marks `assessment` optional (Adam); nn1/nn2 (Adam); timing row and a3 (Sumedh).

## CI fix after AI #38 (2026-10-24T20:08Z, main 4135082 merged; PR #36 not merged)
- AI #38 closed the nickname exclusions, so nn1/nn2 meet their pre-run labels. Their `knownGap` markers are removed and the labels are unchanged.
- D042 is now in `docs/DECISIONS.md`, and the contract requires the assessment whenever there is a candidate.
- **Results:** decision loop 55/55; forbidden 0. Remaining todos: a3 (Sumedh) and the timing row. D043 (Cyber #39, main `f0f722c`) narrowed the real `my_nudges` row, so the timing todo now needs DS to mirror that row in `matching.ts` `buildNudge`. PR #36 CI passes against `f0f722c`.

## Core 4 (2026-10-24T20:28Z, PR #41 @ 87e4209, open)
- **What:** `results/core4.md`, generated by `node src/evaluation/core4.ts --write` from `fixtures/core4-examples.json`. It covers 19 existing synthetic cases chosen by reference (no copied labels): partners 6, friends 10, family 3, private party 3, including the README private-party no-action case `a9`.
- **Results:** 19/19 expected, 56/56 privacy checks. Each check has a negative control in `core4.test.ts`. The README "Core definition of done" items are reproduced offline.
- **Limitations:** small hand-picked synthetic sample; single annotator; hand-written AI outputs; simulated approval for decision-loop previews; nothing live; ratings not collected.
- **Timing (2026-10-24T21:04Z):** closed. Sumedh approved Option A, as reported to DS by the DS owner (Nimisha) on 2026-10-24. This was not independently verified from the repository: neither `docs/DECISIONS.md` nor `docs/updates/cyber.md` on main `71d1320` records it yet. Option A: the approval hour is an accepted D043 residual; the exact minute or second stays hidden. `recipientNudgeRow()` mirrors D043, and `sender_approval_timing` now asserts "at most the approval hour", with an approval sweep plus negative controls.
- **Still open:** a3 (Sumedh), ratings (team).

## Next for DS: core-first (README "Current direction", Core 1–4)
Discovery/event ranking work is paused. Don't expand it until the core passes live verification. The earlier "D038/D039 metrics cases" and "first-session recommendations" items are dropped.
1. **Core 1:** before any model evaluation, define the expected owner-side outcome (`no_action` / `needs_clarification` / `ready_for_preview`, still a proposed vocabulary) for support, avoid and uncertain recipient intent, plus the forbidden-disclosure labels (unapproved party, activity, location, excuse, tension, timing). Co-define them with Adam (assessment output) and Sumedh (recipient restriction).
2. **Core 2:** paired fixtures:
   - identical general availability but different recipient intent;
   - "not Alex tonight";
   - "I miss them, but not sure tonight";
   - a skipped question;
   - a changed answer;
   - prompt injection;
   - the private-party case.

   Plus a noninterference check: hold the approved inputs and delivery settings fixed, vary the private story, and confirm the recipient-visible content and scheduling are identical.
3. **Core 3:** two teammate ratings on eligible usefulness; report unsafe suggestions separately from missed ones; compare against the deterministic baseline (`matching.ts`).
4. **Core 4:** choose partner/friend/family examples plus the private-party no-action case, and record the real sample size and limitations. **Done offline** (see the Core 4 section above).

Existing assets to build on: the 30-case support set (`fixtures/evaluation-cases.json`, `matching.ts`, which already has forbidden-disclosure checks) and `src/lib/backend/__tests__/relationship-safety.test.ts` (CS, sick/party case).

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
