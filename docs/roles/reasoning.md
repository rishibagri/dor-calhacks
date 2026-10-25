# Reasoning — relational decision layer — implementation plan

**Owner:** Sumedh (separate workstream from Cyber). **Branch:** `role/reasoning`. **Baseline:** main `6cc56f1`. **Task IDs:** `RSN-R0` through `RSN-R5`. **Status:** role scaffolding only; no reasoning code exists yet. Proposed in D052; teammate ACKs open.

## Your outcome and owned files

Decide whether a meaningful opportunity for human connection exists right now, and if so which intervention fits, when, and whether to defer or abstain. Today these decisions are spread across CS's decision loop (`decision-loop-model.ts`), AI's private assessment (`assessment.ts`) and fixed D050 rules. Reasoning gives them one owner and one vocabulary, and grows into an agentic relational reasoning layer: Reasoning decides what to think about and what to do; AI provides the model/runtime connection used to do it. Architecture: [docs/features/REASONING.md](../features/REASONING.md).

**In scope:**
- **Opportunity detection:** is there a real reason to connect, or is silence correct?
- **Intervention comparison:** nudge an existing tie, suggest reconnecting, suggest a local event, suggest an introduction, ask the owner, or do nothing. Rank them with stated reasons, never a hidden score.
- **Timing:** act now, defer until a bounded time, or abstain. Respect existing cooldown, quiet hours, pause and expiry as hard floors.
- **Personal processing patterns:** how the owner tends to reflect (for example, needs time before reaching out, prefers company vs space), as owner-only local signals.
- **Relationship dynamics:** per-pair recency, reciprocity and recent outcomes from owner-visible history (relationship book, nudge outcomes), not from the other person's private state.
- **Context decay:** how quickly a reflection, assessment or outcome stops being a valid reason to act.
- **Memory model (later):** what the above remembers, for how long, and where it lives.

**Proposed owned files (claim in `docs/updates/reasoning.md` before creating):**
- `src/reasoning/core/**`: pure decision types, candidate evaluation, context decay, act / ask / defer / abstain semantics, deterministic gates. No provider or network dependency.
- `src/reasoning/runtime/**`: provider-agnostic orchestration, context/tool requests, multi-candidate generation, intervention comparison, reassessment scheduling decisions, structured reasoning summaries. Consumes context and the model only through ports; never imports SpacetimeDB bindings, vault storage or provider SDKs.
- `src/reasoning/**/__tests__/**`, `src/reasoning/fixtures/**` (synthetic only).
- `docs/features/REASONING.md`: architecture, ports, call sites, open interfaces; behavioral framework once supplied.

Reasoning owns what information the model requests, which tools it may use, how it compares actions and how it reaches a structured decision. AI owns vendor/provider adapters and transport (Claude API adapter, Factory SDK, Cartesia, credentials, retries).
- `docs/roles/reasoning.md`, `docs/handoffs/reasoning.md`, `docs/updates/reasoning.md`, `docs/team-messages/reasoning.md`.

New paths are assignments, not shipped code.

## Not owned — dependencies and consumers

| Role | Reasoning depends on | Reasoning provides | Do not touch without the owner |
|---|---|---|---|
| CS (Rishi) | App composition, bindings, decision-loop UI, relationship-book UI | A pure `decide…` port the decision loop can call | `src/components/feature/decision-loop*.ts(x)`, `src/lib/backend/**`, `src/app/**`, module/schema |
| AI (Adam) | C1 `PrivateReflection` + D040/D050 assessment, worker, `ReasoningModelPort` adapter (Claude/Factory transport, credentials, retries) | Decisions and intervention comparisons the worker coordinators can consume | `src/agents/**`, `worker/**`, `src/features/voice/**` |
| DS (Nimisha) | Decision-loop evaluation (55 cases), baselines, ranking, rater workflow | Decision vocabulary and new reasoning fixtures for DS to label and score | `src/evaluation/**`, `src/features/discovery/**` |
| Cyber (Sumedh) | Policy guards, D041 pause, D050 server rechecks, vault | Decisions that never bypass those gates; memory-model storage needs | `contracts/src/policy*`, `spacetimedb/src/reducers/**`, `src/vault/**`, `src/privacy/**` |

Moving existing logic (for example, extracting `decide()` rules from CS's model into `src/reasoning/`) needs the current owner's ACK in the same PR. Until then, Reasoning wraps or mirrors, never edits.

## Rules the layer must keep

- **Never bypass a gate.** Reasoning may be more restrained or more proactive than today's loop. It never bypasses or weakens an existing hard authorization or safety gate, and never extends a lifetime, cooldown or preset ceiling. Extra automation must be justified by current evidence and still pass the authoritative server gates. Whether it may act toward a connection the user did not name is open (REASONING.md §9 C1b).
- D050 safety stops are inputs, not suggestions: `interpersonal_conflict` and `urgent_support` end the nudge path before Reasoning runs.
- Every runtime (model) output passes the core's deterministic gates; missing, malformed or stale inputs and provider failures mean abstain.
- Context arrives only through explicit ports; each source returns only what it already permits the caller to see. Persisted memory waits for an agreed storage design with Cyber.

## RSN-R0 · Freeze vocabulary and seams

**Implement:** `docs/features/REASONING.md` (architecture and owner-supplied behavioral framework written 2026-10-25): core/runtime split, outcomes `act | ask | defer | abstain`, proposed ports, current call sites, open interfaces per role.

**Exit evidence:** owner approves the core plan (§12); CS, AI, DS and Cyber ACK the ports and call-site list; no shared file edited.

**Next consumer:** DS (labels), CS (call site), AI (input shape).

## RSN-R1 · Deterministic core, offline

**Implement:** `src/reasoning/core/` (REASONING.md §12): the constraint and validation foundation, not the reasoning intelligence. Gates, automation caps, context-window expiry, explicit intent, output validation, tie-breaks. Plus a labeled test-only reference policy in `src/reasoning/reference/` standing in for the runtime.

**Exit evidence:** focused tests; 16 synthetic scenarios (REASONING.md §11) meet pre-written labels; invariants I1–I9; no hard-gate violation on DS's 55 decision cases, with every automation difference reported with its evidence; mutation checks on each gate.

**Next consumer:** CS wires it behind the existing loop; DS adds it as a system in `decision-baselines.ts`.

## RSN-R2 · Agentic runtime and intervention comparison

**Implement:** `src/reasoning/runtime/` against a fake `ReasoningModelPort` and fake context ports: allowlisted context/tool requests, multi-candidate generation, comparison of interventions, structured summaries; every output through the core gates. AI supplies the real adapter.

**Exit evidence:** paired cases where the same reflection leads to different interventions for different relationship states; malformed model output and provider failure abstain; no option outside existing consent paths.

## RSN-R3 · Relationship dynamics, context decay and reassessment

**Implement:** relationship-dynamics and decay inputs per the behavioral spec; `reassessAt` decisions handed to `ReassessmentPort`.

**Exit evidence:** expired context never acts; the runtime's inferred window and confidence drive expiry, with the fallback window when confidence is low; delivered signals never outlive server lifetimes.

## RSN-R4 · Memory model design

**Implement:** design only first: what is remembered, retention, deletion, account switch and lock behavior; storage through a port, designed with Cyber.

**Exit evidence:** reviewed design before any persistence code.

## RSN-R5 · Evaluation and handoff

**Implement:** with DS, compare Reasoning to the current loop and baselines; report missed vs unsafe suggestions separately.

**Exit evidence:** reproducible offline report; synthetic vs live stated.

## Verification and handoff

Run focused tests for changed files plus root `npm run check`. Docs-only changes need no broad suite. Append each task to `docs/updates/reasoning.md` (format in that file) and refresh `docs/handoffs/reasoning.md`. Read all five role logs before starting, before interface changes and hourly. Raise blocked interfaces within 15 minutes.
