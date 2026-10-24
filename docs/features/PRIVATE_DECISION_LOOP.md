# Private decision loop — CS composition (Core 2)

Status: **implemented offline in CS UI, not a shared contract.** Outcome names (`no_action`, `needs_clarification`, `ready_for_preview`) are the README's proposed design vocabulary, kept local to `src/components/feature/decision-loop-model.ts`. Nothing here is persisted, logged or sent.

## Journey (journal)
1. Reflection returns the C1 `PrivateReflection` (AI). A null candidate ends the episode with no questions.
2. "Review what to share" opens **Just for you**: one neutral question at a time, maximum two distinct questions.
   - "Would company feel good right now, or would you prefer some space?" → *Company would be nice* / *I'd prefer some space* / *Skip*.
   - "Is there someone you would feel comfortable hearing from?" → one accepted connection, *Not X this time* (episode exclusion), or *No one / not sure*.
3. Only after a person is chosen does the existing exact-recipient `ShareReview` open, pinned to that one person (no picker, no default). Approval is still separate and binds `payloadRevision` + a request ID.

## Rules the model enforces (tests: `decision-loop-model.test.ts`)
- An answer narrows or stops, never authorizes. Skip, space, no one, an unresolved or vanished recipient, and the question cap → no action.
- *Not X this time* removes X for the rest of the episode. A later answer cannot re-add X or fall through to someone else automatically.
- Changing the first answer clears the chosen person.
- Question and no-action copy is fixed; it never mentions events, timing, other people, a request or queued work (private-party case).
- State lives in one component keyed per reflection. It is dropped on Done, a new reflection, pagehide, vault lock, sign-out and account switch.

## Seams for other roles
- **AI (Adam):** if the private assessment returns an outcome or suggested exclusions, map it into `LoopState` before `decide()` (for example, start at `no_action` on refusal or timeout, or pre-exclude a named recipient). The model may veto or ask; it may never set `chosen`. Mismatched or invalid output → no action.
- **Cyber (Sumedh):** the episode exclusion is client-only and lasts one reflection. A durable person-specific pause (server-enforced at approval, use and commit) is not built here; CS will add owner controls once the reviewed contract lands.
- **DS (Nimisha):** paired scenarios (company generally vs this friend, explicit refusal, skip, changed answer) can run against `decide()` directly.

## Core-first separation
`NEXT_PUBLIC_DOR_EXTENSIONS` (default off) hides Discover and Events from navigation. Their pages show a short notice but keep safety controls: introduction controls on Discover, plans on Events, and discovery/event withdrawal on Privacy whenever the user still has something to withdraw. The module's own discovery flag and guards are unchanged and stay authoritative.
