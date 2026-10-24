# Activity-sharing consent boundary (C7) — Cyber definition, D027

Status: **proposed boundary; no activity sharing is implemented or permitted.**
- The executable part is limited to what may be sent to Apify and which source links may be shown (`contracts/src/catalogue.ts`, tested in `contracts/tests/catalogue.test.mjs`).
- Producer: Sumedh (Cyber). Consumers who must review: CS (ingestion, reducers, UI), Nimisha (matching), Adam (proposal workflow).
- Feature plan: `docs/features/ACTIVITY_DISCOVERY.md`.

## 1. Rules that hold before any C7 type exists
1. **Generic catalogue only.** Apify Actor input is built only through `guardPublicCatalogueQuery(input, ACTIVITY_TOPIC_ALLOWLIST)`:
   - developer-allowlisted topic slugs, `format`, `limit`, optional `locale`
   - every user gets the same input
   - rejected: unknown keys, user text, IDs, emails and phone-like strings

   The allowlist lives in server config and is validated by `validTopicAllowlist`.
2. **Never sent to Apify or in Actor/run metadata:**
   - journal text, transcripts, reflections or candidates
   - quiz answers or `LocalQuizExtras` (including Q5 activities and the free-text note)
   - detailed or derived calendar slots
   - relationship type or preset kind
   - person, pair, account, signal or Clerk identifiers
   - location, and anything a user typed
3. **Runs server-side only.** `APIFY_API_TOKEN` stays on the server, sent in a header, never in a query string, never logged and never `NEXT_PUBLIC_`.
4. **Catalogue records are public data, not permission.** Treat scraped text as untrusted:
   - strip markup and cap lengths
   - show links only via `safeCatalogueUrl(url, SOURCE_HOST_ALLOWLIST)`: https, allowlisted host, no credentials or ports
   - never fetch arbitrary record URLs server-side without an SSRF review
   - never feed scraped text to an agent as instructions
5. **Personalised ranking from private data stays on the device.** It works like the F3 preview: the device may rank the generic catalogue against local quiz extras and display that ranking. Nothing about that ranking leaves the device.
6. **No outbound personalised traces.** External links open with `rel="noopener noreferrer"` and carry no pair/user IDs or tracking parameters that we add.

## 2. Required before user-specific shared delivery (must land as reviewed contracts)
Existing `ApprovedSignal` v2 and its categories (`support_preference`, `coarse_availability`) **must not** carry activity data (D024).

| Element | Rule |
|---|---|
| New sharing category | `activity_interest`: a coarse public topic slug from the same developer allowlist. **Default blocked in every preset**: no partner/friend/family suggestion enables it. The owner must confirm the preset edit, which bumps the version. |
| Item consent record | A new `ActivityInterestApproval` (or ApprovedSignal v3 with a schemaVersion bump), never v2. Fields: exact topic slug(s), pair, named recipient, policy id/version, assignment version, `DISCLOSURE_CONSENT_VERSION`, expiry ≤ 24h and ≤ preset expiry. Approval uses `guardApproval`-equivalent checks plus a revision bound to the slugs. |
| Preview | Device-only, as in D016. The owner sees "*Name* may learn that you're interested in *topic*. A shared plan suggestion can reveal this." Blocked topics are omitted, never substituted. |
| Matching input | Only current approvals (`guardSignalUse`-equivalent at each use) and coarse windows the recipient consented to. No raw extras. |
| Proposal | `ActivityProposal {proposalId, pairId, revision, catalogueItemId, catalogueFetchedAt, safe source URL, coarse window, sourceApprovalIds[], sourceApprovalVersions[]}`, committed by a worker-only reducer. That reducer re-checks every source approval, catalogue freshness and the F5 gate (opt-in, quiet hours, cooldown), following the `commit_nudge` pattern. |
| Acceptance | Each participant accepts or declines their own copy, bound to `revision`. The proposal is final only when **both** accepted the same revision **and** every source approval still passes at finalize time. Any edit creates a new revision and clears both acceptances. |
| Invalidation | Revoke, unlink, preset tighten/broaden, reassignment, approval expiry, stale or expired catalogue item, or cancel by either participant: the proposal is suppressed and no finalization happens. |
| Visibility | Caller-filtered views. Each participant sees only their own acceptance state until both have accepted. Senders never see recipient preferences, quiet hours or decline reasons (see REVIEWS.md D021 #5). |
| Groups | Out of scope. Pair permissions are never reused for groups. |

## 3. Review checklist for the C7 PR
- [ ] No new field in ApprovedSignal v2; new types have their own `schemaVersion`.
- [ ] Every new category defaults to blocked; the quiz cannot enable it.
- [ ] Direct reducer tests cover: third user, wrong recipient, stale preset/assignment, revoke during proposal generation, worker replay, one-sided acceptance, revision change after acceptance, expired catalogue item.
- [ ] Apify adapter calls `guardPublicCatalogueQuery`, with a test that a pair/user ID and a journal string are refused.
- [ ] Catalogue rows carry no user or pair IDs, and catalogue tables are not joined to user rows in any public view.
