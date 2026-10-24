# Core 1/2 update from Adam (AI): Claude's private assessment, durable pause, worker key

**TL;DR:**
- Claude can now tell "wants company" from "wants *this person's* company" and catch "but not Alex tonight". That result only makes the journal's private "Just for you" step ask less or stop; it never picks a person or sends anything.
- **Sumedh:** please build the durable recipient pause (D041) from the requirements doc linked below.
- **CS:** please review the small edits I made in your files.
- **Nimisha:** please evaluate the new cases.
- **Everyone running the worker:** it now needs `FACTORY_API_KEY`.

## What changed (PR from `role/ai-voice`; offline-verified only, not live)

**1. Claude private assessment (D040, proposed).**
- `/api/reflections` still makes one Claude call. It now also returns an optional, owner-only `assessment`:
  - `intent`: `wants_connection`, `unclear` or `wants_space`
  - `excludedNames`: people the owner explicitly says they don't want contact with right now
  - `preferredNames`: people the owner explicitly says they would like to hear from
- It stays in memory on the owner's device. It's never saved to the vault, never logged, and never sent to SpacetimeDB, Factory or anyone else.
- In CS's decision loop it can only:
  - stop: `wants_space` or an unusable assessment means nothing is suggested;
  - skip the "would company feel good?" question: `wants_connection`;
  - leave named people out for this episode, with an owner-only note "Leaving out Alex for now, based on your entry";
  - list preferred people first.
- The owner still picks the person, and approval is still the separate exact-recipient preview.
- Claude never sees your contact list; names are matched on the device. It never infers avoidance from events or excuses: the private-party case comes out as `unclear`, with no names.
- Spec: [docs/features/PRIVATE_ASSESSMENT.md](../features/PRIVATE_ASSESSMENT.md)

**2. Worker needs `FACTORY_API_KEY`.** Since #27 the worker uses the Factory Droid SDK and refuses to start without the key. `npm run setup:doctor -- --worker` now reports a missing key as an error. Use `DOR_DROID_TRANSPORT=cli` only as a fallback. See [docs/RUNBOOK.md](../RUNBOOK.md).

## What I need from each of you

| Who | Ask | Read |
|---|---|---|
| **Sumedh (Cyber)** | Build the **durable, person-specific pause** (D041): owner-only, reason-free, blocks approval, worker reads, `commit_nudge` and visibility; no resurrection on resume; silent to the counterpart. Also review D040's boundary. | [docs/features/RECIPIENT_PAUSE.md](../features/RECIPIENT_PAUSE.md), [PRIVATE_ASSESSMENT.md](../features/PRIVATE_ASSESSMENT.md) §1 and §3 |
| **CS** | Review my edits in your files: `decision-loop.tsx` (applies the assessment before `decide()`), `journal/page.tsx` (episode carries the assessment), `src/lib/setup/plan.ts` + test (Factory key check), `docs/RUNBOOK.md`. After D041 lands, add pause/resume controls. | [PRIVATE_DECISION_LOOP.md](../features/PRIVATE_DECISION_LOOP.md) "Seams", [RECIPIENT_PAUSE.md](../features/RECIPIENT_PAUSE.md) "What CS consumes" |
| **Nimisha (DS)** | Evaluate the 6 synthetic assessment cases (positive Sam, not Alex, unsure, private party, wants space, crisis) and your paired scenarios through `initialLoopState` → `assessedRecipients` → `decide`. Report appropriate silence separately from missed suggestions. | [PRIVATE_ASSESSMENT.md](../features/PRIVATE_ASSESSMENT.md) §5 |

## Good to know

- **Worker and pause:** if paused pairs' signals drop out of `worker_signal_context` and `commit_nudge` rechecks the pause, the worker needs **no change**. The coordinator already re-reads policy after the model runs and before any commit, including the fixed-template fallback.
- **Evidence so far:** keyless offline checks only.
  - `check:all`: contracts 117, module 143, app 273
  - `ai:check`: agents 69, worker 42, integration 36
  - app build passes; 4/4 safety mutations caught
  - live Claude results come later, with an approved run
- Please don't put real journal text or names in issues, logs or PR comments. The fixtures are synthetic.
