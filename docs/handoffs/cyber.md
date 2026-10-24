# Current coordination update — Sumedh (Cyber)

Read your updated detailed plan in docs/roles/cyber.md and shared README.md phases. Task IDs are CYBER-P#; Cyber uses CYBER-P#. CS owns Apify ingestion; Nimisha matching; Adam bounded proposals; Sumedh disclosure/vault. Preserve existing work and review the main/role-branch status before selecting the first unmet phase. Forwardable message: docs/team-messages/cyber.md. This notice does not ACK or complete any pending implementation/contract review.

---

# CYBER handoff
Status: Milestone 1 implemented on `role/cyber-privacy`; offline-verified only. Nothing is published or live.

## Update at each handoff
- **UTC timestamp and branch/commit:** 2026-10-24T03:30Z, `role/cyber-privacy` @ `87faefc`, based on main @ `8e208df`.
- **Completed work and interface IDs (C6, C3, C5 views, C1 design):**
  - `@kinetic/contracts/policy` holds the production deterministic guards. They have no runtime dependencies, so they run inside SpacetimeDB reducers:
    - `guardApproval` (create C3)
    - `guardSignalUse` (each use: coordination, commit, delivery)
    - `guardSignalStanding` (no-clock variant for views)
    - `guardNudgeCommit` (C5 commit: source recheck, template ↔ approved mode, expiry clamp)
    - `payloadRevision` (exact-item binding)
    - `policyErrorCode`
    - constants `SIGNAL_LIFETIME_MS` (24h) and `DISCLOSURE_CONSENT_VERSION` (1)
  - `DisclosurePolicy` (`@kinetic/contracts`) is the real `DisclosurePolicyPort`. It does strict Zod parsing, compares field-for-field against the authoritative stored record, then calls `guardSignalUse`.
  - `approve_signal` is now authoritative. It checks:
    - JWT issuer and account
    - membership of an accepted pair
    - the caller's own assignment naming the other member
    - that the assigned preset is the caller's, unrevoked, unexpired and at the bound version
    - that every category is allowed (deny, never strip)
    - the consent-notice version
    - the exact payload revision
  - Recipient, policy id and expiry are derived server-side. Retries are idempotent per sender and never resurrect a revoked signal. Each approval writes an `approved` receipt.
  - Views: new `my_signals` (sender-only); `my_receipts` is now sender-only; `my_nudges` hides any nudge whose source lost standing, even without a suppression write.
  - Vault key/unlock/recovery design: `src/vault/DESIGN.md`. Guard docs and integration steps: `src/privacy/README.md`. Decision D017.
- **Verification (offline, actual results):**
  - `npm ci && npm run check:all` exits 0: contracts 40/40, generated schemas current, module tsc plus vitest 36/36, app typecheck clean, test:app 4/4.
  - `npx next build` succeeds; `npm audit` reports 0 vulnerabilities.
  - Coverage of the 20 new direct-reducer tests (`spacetimedb/tests/disclosure.test.ts`):
    - foreign issuer
    - no preset/assignment
    - third user returns `not_found` (also for unknown pair ids)
    - the other member reusing the owner's assignment
    - different presets give different permissions for the same input
    - blocked category, including the `no_preference` substitution
    - four altered-payload variants
    - unknown enums
    - stale preset, assignment and consent versions
    - a preview taken before a preset edit
    - pending and unlinked pairs
    - expired preset
    - idempotent replay, and replay after revoke (no resurrection)
    - revoke by a non-sender
    - revoke suppresses nudges
    - reassignment stales signals and previews
    - stale or revoked sources hidden without a suppression write
    - a misaddressed nudge is hidden
  - Mutation check: removing any one of the revision, category, revocation, preset-expiry, consent-version, membership, version or assignment checks makes both suites fail.
  - **Not verified:** a published SpacetimeDB module, the real Clerk JWT path, the bundle build via the `spacetime` CLI, or concurrency on a real host. The in-process harness is single-threaded, so the transactional race behaviour is only as strong as SpacetimeDB's serializable reducers, which has not been verified live.

## Review of CS module (requested)
1. **Fixed: receipts leaked to the recipient.** `my_receipts` showed `approved`/`revoked`/`suppressed` rows to the recipient, revealing disclosures that produced no nudge, and revocations.
2. **Open: JWT `aud` not checked (CS).** Any token from the allow-listed Clerk issuer is accepted, for example a token from another JWT template. Add an audience allow-list alongside `auth_config` and check `ctx.senderAuth.jwt.audience`.
3. **Open: no expiry enforcement in views.** `ViewCtx` has no timestamp. Needs a scheduled sweep reducer that revokes expired signals (`suppressed` receipt) and suppresses their nudges. Reducers already enforce expiry at use time.
4. **Answers to CS questions:**
   - Keep the internal-caller bypass for init/scheduled only. Internal callers have no `account` row, so `requireAccount` still blocks them.
   - Recipients should **not** see the preset kind assigned to them; keep it hidden.
   - 24h invite TTL and one active pair per user pair are OK.
5. **Fine as-is:**
   - Broadening a preset bumps the version without suppressing. Old signals then become stale through the guard and are hidden in views. Acceptable; no receipt is written for that path.
   - Non-members always get `not_found`.
   - The optimistic version checks on preset and assignment are correct.

## Consumer and exact next action
- **CS:**
  1. ACK D017.
  2. In the preview route, compute `payloadRevision({...})` with `consentVersion: DISCLOSURE_CONSENT_VERSION` and the counterpart hex, and pass it unchanged to `approve_signal`.
  3. Use `my_signals` for the privacy center.
  4. Regenerate bindings after publish (`approved_signal.client_request_id`, `my_signals`).
  5. ACK or adjust the proposed `VaultPort` additions (`state`, `create`, `recover`, `changePassphrase`, `destroy`) in `src/vault/DESIGN.md`.
  6. Add a JWT audience check.
  7. Publish the module and rerun `disclosure.test.ts` scenarios live with two Clerk test accounts.
- **AI:**
  1. In live mode, replace `FakeDisclosurePolicy` with `new DisclosurePolicy(reader, clock)`, where the reader loads authoritative state, not the handed envelope.
  2. Co-design a `commit_nudge` reducer callable only by an allow-listed worker identity, which calls `guardNudgeCommit`.
- **DS:** for no-action eval cases, assert the guard reason codes (`expired`, `revoked`, `unlinked`, `stale_policy`, `blocked_category`, `no_consent`).

## Blockers / unresolved contract decisions
- The `spacetime` CLI is not installed, so publish and bundle are untested. That includes whether the CLI bundler resolves `@kinetic/contracts/policy` from the workspace; it requires `npm run build -w @kinetic/contracts` first.
- D017 needs CS and AI ACK. The `VaultPort` additions need CS ACK.
- Recipient nudge opt-in and the recipient-preferences consent guard (D016 `RecipientSupportPreferences`) are not modelled in the module yet.

## Planned work (next)
1. Implement the vault crypto core and IndexedDB adapter (`src/vault/`) per DESIGN.md, with its verification plan.
2. `commit_nudge` and worker-identity guard with CS/AI.
3. Expiry sweep reducer.
4. Recipient opt-in consent guard.
5. Review D016 and Droid hardening.
6. Rate limiting and repeated-probe tests.
7. Log, error and analytics leak review.
