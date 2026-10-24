# CS — You: product, shared-state integration and Apify discovery

Branch: `role/cs-app`

## Your outcome
Make the four workstreams into a usable, deployed product. Own screens, account/connection flow, SpacetimeDB module plumbing, adapter wiring, deployment, and the new Apify activity catalogue. Deliver a real shared plan that both people choose, rather than just a generic reminder.

## Owned implementation
`src/app/`, `src/components/` UI and shell, `src/lib/backend/` app wiring, `src/lib/identity/`, `src/lib/spacetime/`, `spacetimedb/` module structure, `src/server/discovery/` (new), discovery API route and source-card UI, deployment configuration.

## Boundaries with other people
Sumedh owns authorization/vault semantics and implements the guarded approval logic in coordinated files; you own database plumbing and generated bindings. Adam owns reflection/voice services and worker execution; you own app wiring and session middleware. Nimisha owns quiz/ranking semantics; you render her outputs. Shared root dependencies, backend ports, database schema and worker routes need explicit file claims and consumer review. Never publish another agent’s unreviewed contract proposal as complete.

## Current starting point
M1 is already on main (082ab47; subsequent fixes through 8e208df): Next.js pages, eight-question quiz, app-side ports, private SpacetimeDB tables/reducers/views and client adapter exist. Module harness and app checks were reported offline. Generated bindings are placeholders; Clerk/SpacetimeDB are not live-verified in the inspected handoff; approval refuses until Cyber guards exist. Do not rebuild the shell.

## Your first action
Read docs/handoffs/cs.md and inspect `src/lib/backend/ports.ts`, `spacetimedb/src/reducers/signals.ts` and D015. Resolve preview/approval integration with Sumedh and reflection response shape with Adam, then connect/publish the real module and generated bindings when credentials/runtime are ready. In parallel, choose one Apify public source and document its Actor/input/output/cost; do not run paid jobs just to complete documentation.

## How to use these phases
Times are targets relative to the original 36-hour start, not a new 36-hour allocation. Check current main, your remote role branch, the shared dashboard and your existing handoff first. Preserve completed work and evidence; skip a phase only when its exit conditions are met. If the sprint is already underway, start at the first unmet gate. Report schedule risk rather than silently moving deadlines. Planning remains capped at the original 30 minutes.

Each phase has a named artifact, a check, and a consumer. Open small PRs every 2–3 hours. Log blockers within 15 minutes; continue independent work with explicit synthetic fixtures, never a production bypass. Each person owns their implementation, tests and run instructions. CS integrates the pieces; CS does not implement everyone else's logic.

## P0 · T+0–0:30 · Agree interfaces and claim work

- **Build:** Audit existing screens and ports; claim shared files; agree quiz, vault, reflection and policy adapter signatures. Add Apify discovery as your explicitly owned subtask.
- **Exit evidence:** An interface owner and consumer are named for every placeholder; no duplicate bootstrap work.
- **Hand off:** All three: exact app adapter paths, available scripts and missing interfaces.

## P1 · T+0:30–3 · Unblock the other three owners

- **Build:** Finish identity/module feasibility, replace placeholder bindings through the actual CLI generation path, document environment variables. For Apify, identify one public online-activity/event source, Actor ID/version and sample output; normalize a synthetic example first.
- **Exit evidence:** A browser identity can be mapped to the module, or a concrete blocker is logged. Source choice has a documented schema and cost model; no private data sent.
- **Hand off:** Sumedh: real caller/view context. Adam: authenticated service wiring seam. Nimisha: catalogue example.

## P2 · T+3–7 · Build the private-to-approved path

- **Build:** Wire Nimisha’s quiz model and Sumedh’s vault into existing screens. Complete invite acceptance, preset confirmation/assignment, named-person preview, approve/decline states and error display.
- **Exit evidence:** Skipping the quiz enables no sharing; exact preview matches approved fields; rejected policy remains visibly rejected.
- **Hand off:** Sumedh: route/reducer smoke steps. Adam: a real approved-signal retrieval path once guarded.

## P3 · T+7–12 · Join the real two-user flow

- **Build:** Connect guarded approval to real state and Adam’s bounded workflow; subscribe to own nudges/receipts. Implement server-side Apify adapter and bounded cached catalogue retrieval independently of private context.
- **Exit evidence:** Two distinct accounts complete approval → eligible nudge. Discovery returns normalized source-backed items or an explicitly unavailable/cached state.
- **Hand off:** Nimisha: normalized catalogue API and dedupe/freshness fields. Adam: work IDs and result commit interface.

## P4 · T+12–17 · Complete all three relationship scenarios

- **Build:** Complete journal history UI, privacy receipts/revoke/unlink, all three seeded experiences. Build activity cards with source links, timezones, format, freshness and separate user accept/decline controls.
- **Exit evidence:** Partner/friend/family flows respect different confirmed presets. No external booking or message is sent automatically.
- **Hand off:** All: stable preview URL, revision and exact reproduction steps; Cyber reviews shared-plan audience.

## P5 · T+17–22 · Validate quality, privacy and recovery

- **Build:** Exercise reload/reconnect/identity switch, stale approvals, timeout, provider unavailable, empty catalogue and expired activity. Fix integration defects; publish source freshness visibly.
- **Exit evidence:** No cross-account stale cache; a revoked signal cannot produce a new visible proposal; catalogue failure preserves core journaling.
- **Hand off:** Nimisha: frozen build for evaluation. Sumedh: reproducible live authorization cases.

## P6 · T+22–27 · Finish activity discovery and selected depth

- **Build:** Integrate consent-approved activity matching and both-person proposal acceptance after the new activity contract is reviewed. Add bounded refresh/deduping; select at most two already-approved polish tasks.
- **Exit evidence:** A selected public activity becomes a shared proposal only under current audience approvals; acceptance is distinct for both people.
- **Hand off:** Adam/Nimisha: stable catalogue IDs and proposal state. Sumedh: exact new fields and mutations.

## P7 · T+27–31 · Stabilize the release candidate

- **Build:** Freeze source and Actor configuration; fix blocking UI/deployment issues; document synthetic reset and real-provider distinctions.
- **Exit evidence:** Stable release revision; core flow works even if Apify times out; no fake-as-live status.
- **Hand off:** All: release candidate ID and environment, without credentials.

## P8 · T+31–34 · Freeze and document

- **Build:** Feature freeze; deploy verified build, run account/pair/nudge/discovery smoke checks, document rollback and configuration.
- **Exit evidence:** Build and actual deployment smoke pass; unresolved limitations are listed.
- **Hand off:** All: runbook and release revision; no additional broad feature work.

## P9 · T+34–36 · Release buffer and support

- **Build:** Reserve time for deployment/submission failures; support teammate verification and only release-blocking fixes.
- **Exit evidence:** Same reviewed revision is running; source links and freshness labels work.
- **Hand off:** Team: final status, unresolved risks and next maintenance owner.

## Verification you own
- Existing `npm run check:all`, `npm run build:app`; live browser checks supplement offline harnesses.
- Two-account invite/approve/revoke flow plus third-account denial and identity-change cache clearing.
- Apify fixture normalization, bad/expired URL/timezone handling, duplicate removal, rate-limit/timeout response and stale-cache label.
- Inspect browser bundles/network for provider secrets and private fields; Sumedh reviews policy changes.

## Completion and communication
Update `docs/updates/cs.md` and `docs/handoffs/cs.md` at each meaningful handoff with task ID (`CS-P#`), UTC timestamp, branch/commit, files/contracts, actual verification, next named consumer action and blockers. Log a consumer ACK when integration succeeds. Read all four update logs hourly and before shared interface changes. Refresh shared status only from verified or clearly attributed evidence. Do not overwrite another role’s history.

Read [the shared dependency plan](../PLAN.md) and [the Apify feature plan](../features/ACTIVITY_DISCOVERY.md). Demo/video production remains separate in docs/DEMO.md.

## Latest main flow baseline — preserve this work
Main through d4cc763 includes `contracts/src/disclosure.ts` and `contracts/specs/FLOWS.md`: reuse/review `previewDisclosure`, `nudgeDelivery`, `SignalCandidateSchema` and `templateForSignal`. Main D016–D020 are the canonical flow decisions; Adam's branch independently used D016 for different proposed contracts, so reconcile by schema/commit. Preview is device-only; opt-in defaults off per connection; quiet hours/cooldown apply at coordination and commit. Space/no need yields no candidate; availability-only approval produces no nudge. These helpers are drafted/offline-tested, not yet wired authoritative guards. Sumedh ACK remains pending.
