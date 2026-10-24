# AI — Adam: voice, private reflection and bounded coordination

Branch: `role/ai-voice`

## Your outcome
Deliver a useful voice reflection loop and a real bounded agent workflow that acts only on approved signals. Integrate Nimisha’s matching and CS’s public activity catalogue without leaking private journal context or granting agent authority.

## Owned implementation
`src/agents/`, `worker/`, provider adapters, mic/streaming client helpers, model prompts and orchestration tests. Claim authenticated Next.js reflection/voice route files with CS before writing in `src/app/api/`; CS owns session middleware and application wiring.

## Boundaries with other people
Sumedh supplies authoritative policy; your workflow rechecks it and cannot replace it. Nimisha supplies ranking; CS supplies catalogue, shared-state adapters and result reducers. Private reflection receives only selected disclosed text; Factory receives approved enums/data, not journals, private quiz extras, identity details or provider keys.

## Current starting point
Remote `role/ai-voice` at 5ccd4ba reports M1 adapters, worker and D016 contract proposals, offline tests and limited live Droid checks. These are branch-reported and not yet merged into the inspected main. Preserve this work; do not recreate it. The branch log reports Claude/Cartesia missing credentials and variable Droid latency. Review latest branch log/handoff before following these phases.

## Your first action
Compare your branch to latest main and preserve D016 work. Resolve shared ReflectionPort/PrivateReflection response and worker ports with CS, get Sumedh’s review of policy/recipient-preference consent, then complete authenticated routes and browser voice loop. Publish remaining credential/runtime blockers without secrets.

## How to use these phases
Times are targets relative to the original 36-hour start, not a new 36-hour allocation. Check current main, your remote role branch, the shared dashboard and your existing handoff first. Preserve completed work and evidence; skip a phase only when its exit conditions are met. If the sprint is already underway, start at the first unmet gate. Report schedule risk rather than silently moving deadlines. Planning remains capped at the original 30 minutes.

Each phase has a named artifact, a check, and a consumer. Open small PRs every 2–3 hours. Log blockers within 15 minutes; continue independent work with explicit synthetic fixtures, never a production bypass. Each person owns their implementation, tests and run instructions. CS integrates the pieces; CS does not implement everyone else's logic.

## P0 · T+0–0:30 · Agree interfaces and claim work

- **Build:** Inspect existing branch, logs and D016 rather than respiking completed work. Claim route/port files and map what is implemented, fixture-tested, live-tested and missing.
- **Exit evidence:** Consumers know which proposed interfaces are branch-only and which require review.
- **Hand off:** CS/Sumedh/Nimisha: exact D016 changes and required ACKs, no silent merge assumption.

## P1 · T+0:30–3 · Unblock the other three owners

- **Build:** Prove Cartesia input/output and transient Claude structured reflection when keys exist; document Factory deployed runtime/auth. Reuse existing Droid results but do not call them full live pipeline evidence.
- **Exit evidence:** Actual tested provider endpoints/versions identified; missing keys are explicit; sanitized provider processing map.
- **Hand off:** CS: service adapter and config needs. Sumedh: content/log/session boundary. Nimisha: candidate examples.

## P2 · T+3–7 · Build the private-to-approved path

- **Build:** Finish authenticated reflection/voice routes with CS and browser mic/start/stop/permission/error behavior. Return private reflection/candidate to vault; schema-validate all output.
- **Exit evidence:** No raw persistence in API/Factory; mic denied/network loss offers typed input; cancellation stops work/playback.
- **Hand off:** CS: working service factory and UI hooks. Sumedh: provider/error/log tests.

## P3 · T+7–12 · Join the real two-user flow

- **Build:** Wire real approved signals and current recipient preferences into bounded Factory workflow, Nimisha rank hook, and guarded result commit. Add dedupe, version recheck and timeout outcomes.
- **Exit evidence:** A real job completes at most two rounds; stale/revoked input cannot commit; no duplicate nudge on retry.
- **Hand off:** CS: traceable job outcome with sanitized status. Nimisha: observed decision vs expected result.

## P4 · T+12–17 · Complete all three relationship scenarios

- **Build:** Handle partner/friend/family differences, support-only signals, missing time, no compatible action and quiet hours. Use templates limited to approved reasons; respect recipient consent for ACK data.
- **Exit evidence:** No hidden-cause explanation or journal quote appears in shared output; no-action is an ordinary successful outcome.
- **Hand off:** Nimisha: failures and outputs for frozen evaluation. Sumedh: audited shared prompt/tool examples.

## P5 · T+17–22 · Validate quality, privacy and recovery

- **Build:** Measure >=10 representative runs, median/p95 voice/nudge latency, retries and failure categories. Compare with targets honestly; fix injection/unsafe text and cap token/tool/time budgets.
- **Exit evidence:** Publish actual measured timing and skipped providers; do not present an 8-second target as reliable when measurements disagree.
- **Hand off:** Team: performance report and concrete integration failures.

## P6 · T+22–27 · Finish activity discovery and selected depth

- **Build:** Consume CS’s normalized public activities and Nimisha’s ranking only after activity-consent contract review. Let agents propose bounded options/counters, then require human acceptance.
- **Exit evidence:** No arbitrary URL/tool execution from scraped content; no auto-booking; approved shared context only.
- **Hand off:** CS: activity proposal IDs/state; Sumedh: consent source/version links; Nimisha: ranking feedback.

## P7 · T+27–31 · Stabilize the release candidate

- **Build:** Harden runtime restart/replay, credentials, rate limits and cancellation against the release candidate. Maintain explicit fixture fallback labels.
- **Exit evidence:** Worker authenticates and has limited tools; restart/retry does not duplicate or resurrect work.
- **Hand off:** CS: deployment/runbook and tested health check, without secrets.

## P8 · T+31–34 · Freeze and document

- **Build:** Freeze prompts and tested model/Actor-independent adapter settings; exercise real provider flow on deployed revision with CS/Sumedh.
- **Exit evidence:** Provider credentials/availability and result provenance are documented; no untested path described as live.
- **Hand off:** Team: final tested workflow, latency and remaining constraints.

## P9 · T+34–36 · Release buffer and support

- **Build:** Support only release-blocking provider/worker defects; preserve logs without content and help reproduce failures.
- **Exit evidence:** Same reviewed workflow remains running; no last-minute unbounded agent capabilities.
- **Hand off:** Team: final provider status and follow-up bugs.

## Verification you own
- Existing branch `ai:check` and related scripts are branch-specific until merged; inspect package.json before invoking. Main has contract/module/app scripts.
- Selected-text-only provider requests, malicious-output rejection, typed fallback and stop/cancel behavior.
- Worker authenticated requests, no private-session data, bounded rounds/tools, replay/idempotency and live consent rechecks.
- Record current median/p95 and timeout/no-action rates; distinguish fixture-policy Droid tests from real end-to-end privacy validation.

## Completion and communication
Update `docs/updates/ai.md` and `docs/handoffs/ai.md` at each meaningful handoff with task ID (`AI-P#`), UTC timestamp, branch/commit, files/contracts, actual verification, next named consumer action and blockers. Log a consumer ACK when integration succeeds. Read all four update logs hourly and before shared interface changes. Refresh shared status only from verified or clearly attributed evidence. Do not overwrite another role’s history.

Read [the shared dependency plan](../PLAN.md) and [the Apify feature plan](../features/ACTIVITY_DISCOVERY.md). Demo/video production remains separate in docs/DEMO.md.
