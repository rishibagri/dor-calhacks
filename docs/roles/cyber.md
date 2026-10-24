# Cyber — Sumedh: local vault and authoritative privacy enforcement

Branch: `role/cyber-privacy`

## Your outcome
Make the privacy promise hold when clients, models, workers or concurrent updates misbehave. Implement the encrypted local vault and real recipient/preset/consent guards, not only a review checklist.

## Owned implementation
`src/vault/`, `src/privacy/`, privacy tests, key lifecycle and provider/discovery disclosure reviews. Claim the exact guard/approval/suppression files inside `spacetimedb/` with CS before edits; CS owns module plumbing, you own authorization semantics. Shared schema edits require affected owners.

## Boundaries with other people
No journal content reaches Apify, shared state, peer agent prompts or Factory session history. CS implements source ingestion and UI, Adam provider/worker services, Nimisha preference/rank logic. You supply reusable rules plus direct reducer/view tests. Do not rewrite unrelated screens or remove honest placeholder refusal before a real guard is ready.

## Current starting point
`approve_signal` deliberately refuses on main. Existing module guards/views and suppression logic require your review, not a fresh module rewrite. Vault is a locked placeholder. The local app `VaultPort` includes profile and quiz-extra persistence. D015 fixture changes await your review.

## Latest role-branch evidence
Current branch status: remote role/cyber-privacy 129c31f reports real disclosure guards, authoritative approve_signal and vault key design (offline only). Preserve it; reconcile its policy implementation with main disclosure.ts/FLOWS.md and decision IDs, then focus on real VaultPort, worker commit/identity and consumer ACKs. Do not implement a second parallel policy.

## Your first action
Inspect `src/lib/backend/ports.ts`, `spacetimedb/src/guards.ts`, `reducers/signals.ts`, `views.ts`, `schema.ts` and CS handoff questions. Publish exact VaultPort and policy integration steps; resolve issuer/audience checks and internal-worker identity with CS/Adam.

## How to use these phases
Times are targets relative to the original 36-hour start, not a new 36-hour allocation. Check current main, your remote role branch, the shared dashboard and your existing handoff first. Preserve completed work and evidence; skip a phase only when its exit conditions are met. If the sprint is already underway, start at the first unmet gate. Report schedule risk rather than silently moving deadlines. Planning remains capped at the original 30 minutes.

Each phase has a named artifact, a check, and a consumer. Open small PRs every 2–3 hours. Log blockers within 15 minutes; continue independent work with explicit synthetic fixtures, never a production bypass. Each person owns their implementation, tests and run instructions. CS integrates the pieces; CS does not implement everyone else's logic.

## P0 · T+0–0:30 · Agree interfaces and claim work

- **Build:** Agree no-sharing defaults and key/unlock/recovery assumptions. Claim guard/approval files with CS and enumerate authoritative identity/consent inputs.
- **Exit evidence:** Every shared decision has a server/reducer enforcement location; no prompt-only or frontend-only authorization.
- **Hand off:** CS/Adam: required guard inputs/errors; all: review checklist for new fields.

## P1 · T+0:30–3 · Unblock the other three owners

- **Build:** Finalize vault threat/key design and policy interface; review current private tables/views and identity bypass questions. Review D015 and proposed discovery fields.
- **Exit evidence:** Key derivation/IV/unlock/lock/recovery behavior documented; unknown cases default deny; public catalogue cannot carry private search context.
- **Hand off:** CS: vault adapter signature and real caller requirements. Adam: worker authority limits.

## P2 · T+3–7 · Build the private-to-approved path

- **Build:** Implement IndexedDB/Web Crypto VaultPort: journals, profiles, extras, correct unlock/lock/errors. Implement guarded exact-preview approval with versions, expiry, identity and idempotency in coordinated reducer files.
- **Exit evidence:** Ciphertext persists without plaintext keys/data; no arbitrary payload approval, unsupported categories or identity spoofing.
- **Hand off:** CS: drop-in real vault and approval adapter; Adam: validated signal access.

## P3 · T+7–12 · Join the real two-user flow

- **Build:** Test direct reducer/subscription attempts, third-user access, preset/assignment changes and stale retries. Implement real worker-use and commit-time authorization checks with CS/Adam.
- **Exit evidence:** Bypassing Next.js cannot grant access; revocation during generation prevents stale result commit.
- **Hand off:** Adam: real DisclosurePolicyPort backed by authoritative data; CS: two-user security smoke steps.

## P4 · T+12–17 · Complete all three relationship scenarios

- **Build:** Complete local journal delete/derived-signal revocation, unlink, affected-preset invalidation and minimized receipts. Review all three scenarios and provider log behavior.
- **Exit evidence:** Local deletion mapping stays local; existing pending proposals are suppressed; receipts have no journal identifiers or reasons.
- **Hand off:** CS: privacy UI states; all: precise privacy copy/limitations.

## P5 · T+17–22 · Validate quality, privacy and recovery

- **Build:** Run adversarial suite: malicious transcript, encoded extra fields, stale versions, wrong recipient, race, XSS-risk rendering and leaked provider bodies/logs. Audit source URL fetching and key exposure.
- **Exit evidence:** All fixed deterministic privacy tests pass; live auth/subscription evidence is separate from in-process harness results.
- **Hand off:** Team: explicit acceptance/fail list; launch blockers are named, not waived.

## P6 · T+22–27 · Finish activity discovery and selected depth

- **Build:** Review C7 activity/proposal consent extension: approved activity tags/windows, both-person acceptance, membership, cancellation and external-link boundary. No activity interest export until schema/reducer reviews land.
- **Exit evidence:** Provider searches never contain a journal/quiz answer; group audiences remain out of scope; changing one preset invalidates all affected pending use.
- **Hand off:** CS/Nimisha/Adam: exact permitted fields, approved preview wording and versions.

## P7 · T+27–31 · Stabilize the release candidate

- **Build:** Review release configuration, provider retention claims and revalidation behavior. Retest changed boundaries only; no broad redesign without a concrete defect.
- **Exit evidence:** No known cross-user leak; no claim of E2E inference or recalling already-viewed information.
- **Hand off:** CS: security release conditions; team: residual risks.

## P8 · T+31–34 · Freeze and document

- **Build:** Record final privacy evidence, local key-loss/recovery behavior, provider caveats and actual deletion semantics. Verify deployed configuration with CS.
- **Exit evidence:** A user can understand vault limitations and exactly what is shared; real checks support release claims.
- **Hand off:** Team: final privacy acceptance and blocked claims.

## P9 · T+34–36 · Release buffer and support

- **Build:** Support release-blocking fixes; validate security-sensitive changes and preserve evidence.
- **Exit evidence:** No last-minute auth bypass, globally public table or plaintext persistence fallback.
- **Hand off:** Team: final boundary status and follow-up owner.

## Verification you own
- Use existing module harness plus real caller/view/subscription smoke checks once deployment exists; fake policy tests alone are insufficient.
- Wrong key, fresh IV, lock/unlock, corrupted ciphertext, failed migration and device/account switch tests for the real vault.
- Exact payload/recipient/preset version/assignment/consent binding; expiry, retries and revoke-during-generation cases.
- No raw journal identifiers in shared tables, external catalogue inputs, logs, analytics or screenshots.

## Completion and communication
Update `docs/updates/cyber.md` and `docs/handoffs/cyber.md` at each meaningful handoff with task ID (`CYBER-P#`), UTC timestamp, branch/commit, files/contracts, actual verification, next named consumer action and blockers. Log a consumer ACK when integration succeeds. Read all four update logs hourly and before shared interface changes. Refresh shared status only from verified or clearly attributed evidence. Do not overwrite another role’s history.

Read [the shared dependency plan](../PLAN.md) and [the Apify feature plan](../features/ACTIVITY_DISCOVERY.md). Demo/video production remains separate in docs/DEMO.md.

## Latest main flow baseline — preserve this work
Main through d4cc763 includes `contracts/src/disclosure.ts` and `contracts/specs/FLOWS.md`: reuse/review `previewDisclosure`, `nudgeDelivery`, `SignalCandidateSchema` and `templateForSignal`. Main D016–D020 are the canonical flow decisions; Adam's branch independently used D016 for different proposed contracts, so reconcile by schema/commit. Preview is device-only; opt-in defaults off per connection; quiet hours/cooldown apply at coordination and commit. Space/no need yields no candidate; availability-only approval produces no nudge. These helpers are drafted/offline-tested, not yet wired authoritative guards. Sumedh ACK remains pending.
