# Reasoning — relational decision layer

**Status:** architecture and behavioral specification, PROPOSED (D052). No source exists under `src/reasoning/`. Nothing here is implemented, deployed or live. §2 is the owner-supplied behavior; §8–§12 reconcile it with current code (reviewed against main `6cc56f1`) and plan v1.

**Owner:** Sumedh (Reasoning workstream, separate from Cyber). **Branch:** `role/reasoning`. **Plan:** [docs/roles/reasoning.md](../roles/reasoning.md).

## 1. Purpose and the split with AI

Reasoning decides **what to think about and what to do**: whether a meaningful opportunity for human connection exists, which intervention fits, and whether to act now, ask, defer or abstain.

AI provides **the model/runtime connection used to perform that reasoning**: the Claude API adapter, Factory Droid SDK plumbing, Cartesia, credentials, retries, rate limits and transport.

| Concern | Reasoning | AI |
|---|---|---|
| What context the model requests, and why | ✓ | |
| Which tools the model may call, and their arguments | ✓ | |
| Candidate generation and comparison of interventions | ✓ | |
| Structured decision and reasoning summary shape | ✓ | |
| Reassessment scheduling decisions (when to look again) | ✓ | |
| Prompt content for relational decisions | ✓ (proposed; see §7) | |
| Vendor SDKs, model IDs, credentials, retries, timeouts, transport | | ✓ |
| Running the worker process and its database adapters | | ✓ |
| Executing a scheduled reassessment | | CS / AI (see §7) |

## 2. Behavioral framework

Supplied by the owner on 2026-10-25. This is the normative behavior for Reasoning. Where it meets an existing hard stop or server gate, §8 says which one wins; no rule here weakens them.

### 2.1 Goal and default

> Given what is happening between these people right now, is there a meaningful relational action worth taking?

The default is **no action**. dor intervenes only when the expected relational value of acting is meaningfully greater than leaving the relationship alone.

### 2.2 Principles

| # | Principle |
|---|---|
| P1 | No action is a valid, successful decision. |
| P2 | Current state beats stale context. |
| P3 | Availability does not equal social receptiveness. |
| P4 | Interpret behavior relative to that person's own baseline. |
| P5 | Preserve meaningful human moments. |
| P6 | Closer relationships can sometimes need less automation, not more. |
| P7 | Knowing information does not mean dor should propagate it. |
| P8 | Conflict lowers automation: prefer helping the user act over acting for them. |
| P9 | Do not queue stale interventions. Reassess later from scratch. |
| P10 | Optimize for the right amount of connection, not maximum connection. |
| P11 | Explicit user intent outranks inferred patterns. |
| P12 | High uncertainty lowers automation. |
| P13 | Learn cautiously from outcomes; one accepted action does not create a permanent rule. |
| P14 | A useful intervention can expire. Preserve the question, not the stale nudge. |
| P15 | Create relational value, not merely activity. |

### 2.3 Reasoning dimensions

Every episode considers all nine. A dimension with no available input is **unknown**, and unknown counts as uncertainty (P12), never as a favorable value.

1. **Situation:** what happened, event type, emotional significance, freshness, shelf life (context decay), explicit user intent, uncertainty. Shelf life is a context window: the runtime infers the useful window, with a confidence, and the core falls back to a default window when confidence is low (§10 `ContextWindow`). No event type has a universal shelf life. Expiry is separate from reveal value: something can still be relevant and yet inappropriate to automate.
2. **Current user state:** current emotional state; whether the earlier issue is still relevant; whether the user appears recovered; workload; social energy; whether they are already with people; whether they appear to want connection.
3. **Personal processing patterns:** behaviors, not static labels ("after academic setbacks, prefers 1–2 hours alone", not "introvert"). Examples: crashes alone after stressful work; responds well to a family call when homesick; prefers casual company over "are you okay?" check-ins. Each learned pattern eventually carries **confidence, evidence count, recency and exceptions**.
4. **Relationship context**, per candidate relationship: closeness; normal contact frequency; normal initiation pattern; preferred interaction style; what the relationship tends to be useful for; recent time together; recent check-ins; conflict; sensitive topics; boundaries; whether this moment has high personal reveal value.
5. **Relationship dynamics:** deviations from baseline, not static closeness. A friend who rarely initiates checks in twice; a normally responsive friend goes quiet; unusual rise or fall in contact; who is initiating now; whether connection appears mutually desired. Two check-ins are not saturation until compared with that friend's normal behavior.
6. **Mutual availability:** both calendar availability **and** social receptiveness. Technically free is not the same as wanting contact.
7. **Human ownership / reveal value:** would automation take something meaningful away from the relationship? High-reveal moments: major good news, job or internship offers, deeply personal disclosures, apologies, conflict repair, important milestones.
8. **Relevance:** does this information materially help this relationship right now? dor never involves someone merely because it knows something.
9. **Conflict:** with unresolved interpersonal conflict, prefer `HELP_USER_REACH_OUT`, `ASK` or `ABSTAIN` over acting on the other person directly.

### 2.4 Candidate actions

Every episode can consider all ten. `DEFER` and `ABSTAIN` are always real competing candidates, never only fallbacks.

| Action | Meaning | Surface |
|---|---|---|
| `DIRECT_CHECK_IN` | The other person checks in on the user | Recipient |
| `CASUAL_INVITE` | Low-pressure company (food, a walk) | Recipient |
| `SHARED_ACTIVITY` | A specific shared activity or event | Recipient |
| `CELEBRATE` | Mark good news together | Recipient |
| `PRACTICAL_HELP` | Concrete help with a task or problem | Recipient |
| `RECONNECT` | Low-pressure reconnection after a gap | Recipient |
| `HELP_USER_REACH_OUT` | Suggest that the user contact the person themselves | Owner only |
| `ASK` | Put a choice to the user | Owner only |
| `DEFER` | Look again later from scratch | None (reassessment condition only) |
| `ABSTAIN` | Do nothing | None |

"Recipient" actions reach the other person only through the existing D050 path and only where a delivery mapping exists (§9, C3). "Owner only" actions are shown to the user and contact no one.

### 2.5 Candidate comparison

Compare several plausible actions; never map one detected emotion straight to a nudge.

| Positive factors | Negative factors |
|---|---|
| Expected relational value | Awkwardness |
| Personal fit | Interruption cost |
| Relationship fit | Human-ownership cost |
| Timing quality | Notification fatigue |
| Mutual receptiveness | Relationship saturation |
| Past success | Uncertainty |
| Naturalness | Conflict risk |
| | Staleness |

These are contextual tradeoffs. **The agentic runtime (model) compares them**; there is no universal numeric threshold. Levels are descriptive (`none`…`high`, `unknown`), not calibrated probabilities, and are recorded per candidate for audit. The deterministic core does not weigh relational value; it applies hard gates, caps automation, enforces freshness and explicit intent, validates output and breaks exact ties (§3.1). v1 tests use a labeled reference policy in place of the runtime (§11).

### 2.6 Decision modes

| Mode | Meaning |
|---|---|
| `act` | A useful action exists now. |
| `ask` | A promising opportunity exists, but meaningful human choice is required. |
| `defer` | Acting may become useful later, but the current timing or context is wrong. |
| `abstain` | Not enough relational value to justify intervention. |

A **deferred decision never preserves an action.** It stores only a reassessment condition, for example "reassess in ~90 minutes if distress still appears relevant". At reassessment time, Reasoning starts again from current state; the earlier candidate is not replayed.

### 2.7 Reasoning loop

```
opportunity → current state → freshness → personal patterns → relationship context
→ relationship dynamics → mutual availability / receptiveness → human ownership → relevance
→ conflict / sensitivity → generate candidates → compare → ACT | ASK | DEFER | ABSTAIN
→ observe outcome → update patterns cautiously
```

### 2.8 Example behaviors (expected outcomes; become v1 fixtures)

| Scenario | Inputs | Expected |
|---|---|---|
| **Failed exam, friend free soon** | "I bombed my exam. I don't want to talk about it." Pattern: distraction after academic setbacks. Close friend is good at casual company and free soon | `act` or `ask` `CASUAL_INVITE` after a short delay; `DIRECT_CHECK_IN` rejected (user doesn't want to talk) |
| **Failed exam, friend free only tomorrow** | Same, friend unavailable until tomorrow | `defer` with condition "reassess in ~N min if distress still relevant", **no** queued invite for tomorrow; or `abstain` |
| **Great news, best friend deeply involved** | Major internship/job; best friend helped extensively | `ask`/`HELP_USER_REACH_OUT` (preserve personal delivery); automated `CELEBRATE` rejected for high reveal value |
| **Great news, medium-distance friend with some involvement** | Same news | v1: `ask` (no recipient `CELEBRATE` template yet). Once a celebration action exists, may become `act` when context supports it |
| **Busy week / new city** | Busy week; recovery style known | Follows recovery style: recharges alone → `abstain`/`defer`; brief contact helps → `CASUAL_INVITE`. "Busy" alone never means wait |
| **Parent pressure** | Mom asking about interviews is stressful | Interview/progress topics are sensitive for that relationship; even good news → `ask`, never automatic |
| **Two weeks of silence** | No contact for two weeks | No distress inferred. Silence explained (schedules, travel, workload, normal cadence) → `abstain`; natural mutual opening → low-pressure `RECONNECT` |
| **Repeated contact from a rarely-initiating friend** | Friend who rarely initiates reaches out twice | Read as possible mutual demand, not saturation; compare with that friend's baseline |
| **Rough week, now at dinner** | Rough week earlier; user is now happily at dinner with classmates | `abstain`: don't tell the best friend about the dinner or revive the stale rough-week support opportunity (P2, P7, relevance) |

### 2.9 Structured output (requirements)

Each decision carries at least: final mode; candidate action, if any; target relationship reference, if already supplied and eligible; authorized evidence references; situation freshness; timing rationale; alternative interpretation; uncertainty/confidence; context expiry; reassessment condition, if deferred; a concise factual decision summary; rejected candidate actions with short reason codes. Proposed shape in §10.

**No hidden chain-of-thought is exposed or stored.** Only the concise summary, reason codes and evidence references are kept.

### 2.10 Memory categories (conceptual only)

Storage is designed separately after this behavior is agreed. The future memory model needs:

- personal processing patterns;
- relationship-specific patterns;
- interaction baselines (contact frequency, initiation share);
- recent interventions (what dor did, when, for whom);
- explicit preferences (stated by the user; outrank inferred ones, P11);
- outcome observations;
- confidence and recency metadata on all of the above (P13).

## 3. Architecture: deterministic core and agentic runtime

```
 context / memory ports ──► agentic runtime ──► model port (AI adapter)
                              │  ▲
     ranked CandidateProposal[]│  │ tool/context requests
                              ▼  │
                 deterministic core (gates, caps, freshness, explicit intent, validation, tie-break)
                              │
                              ▼
               ACT | ASK | DEFER | ABSTAIN  ──► call site
```

The runtime is the reasoning intelligence: it generates and compares candidates. The core is the constraint and validation foundation: it never decides relational value, and it has the last word on what is allowed.

### 3.1 `src/reasoning/core/**` — deterministic core

- Pure decision types: `ReasoningDecision` with outcome `act | ask | defer | abstain`, intervention kind, reason codes, and an optional `reassessAt`.
- Candidate evaluation: validates proposals and applies deterministic gates and automation caps; it does not score relational value.
- Context expiry enforcement from the window the runtime infers (with fallback).
- Explicit-intent enforcement and deterministic tie-breaks.
- Deterministic gates that every decision passes through, whatever produced it.
- **Dependencies:** `@dor/contracts` types only. No provider, network, database, vault, React or Node-only APIs. Runs identically in the browser, the worker and tests.

### 3.2 `src/reasoning/runtime/**` — agentic reasoning runtime

- Provider-agnostic orchestration of a reasoning episode.
- Context and tool requests: the model asks for named context; the runtime checks the request against an allowlist and fetches it through a port.
- Multi-candidate generation, then comparison of interventions.
- Reassessment scheduling decisions, returned as data (the runtime does not run timers).
- Structured reasoning summaries for the owner and for evaluation.
- **Dependencies:** `src/reasoning/core`, `@dor/contracts`, and the ports in §4. No direct import of SpacetimeDB bindings, `src/vault`, `@anthropic-ai/*`, `@factory/*` or any provider SDK.

### 3.3 Composition rules

1. Every runtime output passes through the core gates before it reaches a call site. A model result that fails validation becomes `abstain`.
2. Without a runtime there are no proposals, and the core returns `abstain`; the existing loop stays in charge until the runtime ships. The reference policy (§11) is test-only and is never wired into production.
3. A provider error, timeout, malformed output or unavailable context port ends in `abstain`.
4. Ports are injected at the composition root by CS (app) or AI (worker). Tests use fakes; production never wires a fake.
5. Reasoning may be more restrained **or more proactive** than today's loop. It never bypasses or weakens an existing hard authorization or safety gate; any extra automation must be justified by current evidence and still pass the authoritative gates. Server checks, D050 safety stops and recipient controls stay authoritative (§5).

## 4. Proposed ports (names provisional; shapes defined with each producer)

| Port | Direction | Implemented by | Purpose |
|---|---|---|---|
| `ReasoningModelPort` | runtime → model | AI | Send a structured request (instructions, allowed tools, context) and receive structured output. Hides vendor, model ID, retries and transport. |
| `ReasoningContextPort` (one per source) | runtime → context | CS, AI, Cyber, DS (per source) | Answer named, allowlisted context requests. Each source returns only what it already permits the caller to see. |
| `ReasoningToolPolicy` | core | Reasoning | Which context/tool requests a given episode may make, and their limits. |
| `ReasoningClock` | core/runtime | caller | Injected time for decay and scheduling; deterministic in tests. |
| `ReassessmentPort` | runtime → scheduler | CS (app) or AI (worker) | Accept a `reassessAt` request and re-invoke Reasoning later; Reasoning only decides the time. |
| `ReasoningDecision` / summary types | core → call sites | Reasoning | Output consumed by the decision loop, worker coordinators and DS evaluation. Exported via `@dor/contracts` if they cross a workstream boundary. |

Candidate context sources, to be confirmed with each owner: the current reflection's assessment (AI, C1), accepted connections and preset (CS), pause/quiet hours/cooldown/opt-out state (Cyber/CS views), relationship-book interaction history (CS UI over Cyber's vault), discovery shortlist and event eligibility (DS), catalogue events (CS).

## 5. Existing constraints that bind both layers

These are current team decisions, restated so Reasoning code does not contradict them. They are not new policy.

- D050: missing/malformed assessments fail closed; `interpersonal_conflict` suppresses the nudge path; `urgent_support` shows resources and never contacts a connection.
- D040/D042/D050: assessment names and risk stay in the owner's context and are never persisted or sent to peers.
- D041 pause, quiet hours, cooldown, recipient opt-out, signal lifetime: Reasoning may defer or abstain within them, never shorten or extend them.
- Current authoritative server gates (main `6cc56f1`, after `7b3b695` "Loosen automation gates"); §8 L4 lists them. Presets fall back to a default; recipient support preferences personalize the coordinator and are not an authorization gate.
- Existing coordinators keep their round caps (`MAX_ROUNDS`, `INTRO_MAX_ROUNDS`, `PLAN_MAX_ROUNDS`) and no free-form agent chat.
- No message is sent as the user; introductions and plans still require the other person's acceptance.

## 6. Current call sites that will eventually consume Reasoning

None are changed by this document. Each migration needs the listed owner's ACK in the same PR.

| Call site | Owner | Decides today | Eventual relation |
|---|---|---|---|
| `src/components/feature/decision-loop-model.ts` (`startLoop`, `decide`, `failClosedWithoutAssessment`, `applyUnnamedExclusionGuard`) | CS | Journal episode: no action / clarify / preview | Calls the Reasoning core (and optionally runtime) for the outcome; CS keeps the UI and copy |
| `src/components/feature/decision-loop.tsx` | CS | Composes the loop with recipients and assessment (legacy room UI, `NEXT_PUBLIC_DOR_UI=room`) | Composition root that injects Reasoning ports |
| `src/components/live/bridge.ts` (`reflect()`, `marginYes`, `stampIt`) | AI-authored, labelled "CS seam" | **Primary live path** (home page `LiveRoom`): reflection → same `decide` / `uniquelyPreferredRecipient` helpers → `prepareShare` → owner confirms in the margin → "stamp" calls `approve_signal` | Second composition root; must call the same Reasoning entry point as the CS loop (§7 shared entry point, §9 C12) |
| `src/features/voice/assessment.ts` (`initialLoopState`, `assessedRecipients`, `suggestsNothing`, `requiresImmediateSupport`) | AI | Narrowing from the assessment; safety fallback | Supplies assessment context to Reasoning; safety fallback stays a hard pre-gate |
| `src/agents/src/reflection/{claude,prompt}.ts`, `src/app/api/reflections/route.ts` | AI | Reflection + private assessment from Claude | Input producer; whether relational-decision prompt content moves to Reasoning is open (§7) |
| `src/agents/src/coordination/coordinator.ts` (`BoundedCoordinator`) | AI | Two-agent nudge ACK proposals | Candidate consumer of Reasoning's intervention comparison and timing |
| `src/agents/src/introductions/coordinator.ts`, `worker/src/introductions.ts` (D048) | AI | Which introduction to suggest | Candidate consumer of intervention comparison |
| `src/agents/src/plans/coordinator.ts`, `worker/src/plans.ts` | AI | Shared-plan proposals | Candidate consumer for event interventions |
| `src/agents/src/network/opener.ts`, `src/app/api/network/opener/route.ts` | AI / CS | Friend-of-friend opener draft | Possible consumer for timing/whether to suggest; drafting stays AI |
| `src/evaluation/{decision-loop,decision-baselines}.ts`, `fixtures/decision-cases.json` | DS | Evaluation of the loop (55 cases) | Evaluates Reasoning as a new system; regression benchmark |
| `src/evaluation/rank.ts` (`rankAckOptions`), discovery rankers | DS | Ranking of options and candidates | Context source for Reasoning; ranking stays DS |

## 7. Open interfaces needed

**From AI (Adam):**
1. `ReasoningModelPort`: structured request/response, tool-call support, per-call budget and timeout semantics, usage metadata (no content).
2. Agree where relational-decision prompt content lives: Reasoning (proposed) with AI owning only transport, or shared.
3. How coordinators (`BoundedCoordinator`, `IntroductionCoordinator`, `PlanCoordinator`) would call Reasoning without changing their round caps.
4. Which assessment fields Reasoning may read, and in which process (browser vs worker).

**From CS (Rishi):**
1. Call site in the decision loop and composition root for port injection.
2. Context ports over accepted connections, presets and relationship-book history as exposed to the UI.
3. Whether `ReassessmentPort` is app-side, worker-side, or both.

**From DS (Nimisha):**
1. Add Reasoning as a system in `decision-baselines.ts` and replay the 55 decision cases.
2. Labels for new cases once §2 exists; unsafe and missed suggestions reported separately.
3. Read access to rankers as context sources, packaged so Reasoning does not import `src/evaluation/` internals.

**From Cyber (Sumedh, Cyber role):**
1. Confirm which caller-filtered views a context port may expose to the worker vs the browser.
2. Storage design for the memory model before any persistence.
3. Review of `ReasoningToolPolicy` allowlists when they cross a boundary.

**Shared:**
1. Whether `ReasoningDecision` is exported from `@dor/contracts` (needed once a second workstream consumes it).
2. **One shared Reasoning entry point** for the reflection episode. Today the same decision path is assembled twice: in CS's `decision-loop.tsx` and in `src/components/live/bridge.ts`. Proposal: a single pure function (for example `decideReflectionEpisode(input, proposals, clock)`) that both call, so the two UIs cannot drift. Who owns the adapter that builds `ReasoningEpisodeInput` from app state (CS or AI) needs CS + AI agreement.
3. Template vs action at delivery (§9 C11): how Reasoning's chosen action survives to the delivered template.

## 8. Reconciliation with D050 and existing gates

Reasoning runs **inside** the existing safety envelope. The order is fixed:

| Layer | Owner | What it does | Can Reasoning change it? |
|---|---|---|---|
| L0 Hard stops | AI (assessment), CS (app) | `urgent_support` (or the local term fallback) → resource card, never contact a connection. Missing/malformed assessment or provider failure → no nudge | **No.** Reasoning does not run for `urgent_support`. Invalid input → `abstain` |
| L1 Conflict stop | AI/CS (D050) | `interpersonal_conflict` suppresses the reflection's whole nudge path; no reason is revealed | **No** for recipient-facing actions. Reasoning may only return owner-only `ASK`, `HELP_USER_REACH_OUT` or `ABSTAIN` (P8), with fixed copy that reveals nothing to anyone. Whether owner-only `HELP_USER_REACH_OUT` is allowed under conflict needs CS + Cyber ACK as a D050 clarification (§9, C1) |
| L2 Explicit intent | Owner | "Not Alex", "don't want to talk about it", exclusions, D041 pause | **No.** Explicit intent outranks every inferred pattern (P11); exclusions are removed before candidates are generated |
| L3 Reasoning | Reasoning | §2 behavior: may hold back an automatic opportunity (`ask`, `defer`, `abstain`) or find one the current loop misses, within L0–L2 and L4 | — |
| L4 Server gates | Cyber/CS (module) | **`approve_signal`:** account, accepted pair, D041 pause, idempotency, effective preset (the owner's assigned preset, or the **default preset allowing both categories** when none is assigned or it lapsed; only an explicit revocation stops sharing); fields outside the preset are dropped, not refused; server records its own versions. **`commit_nudge` / `my_nudges`:** every source signal still stands (not revoked or expired, same accepted pair and recipient, effective preset allows ≥ 1 category), D041 pause, D044 standing rule if one was used, recipient opt-out, configured quiet hours, 24 h cooldown; expiry = min(sources, one cooldown window). **Not gates:** recipient support-style preferences and consent versions (personalization only, used by the coordinator); template ↔ signal-mode match | **No.** Reasoning can be stricter (e.g. a shorter context expiry, a baseline-aware "too soon"), never looser. A server refusal is final for that episode; Reasoning does not retry it |

Consequences:
- `act` is a **request** to the existing D050 path, not an authorization. It carries only the existing enum signal; no evidence, summary, pattern or reason leaves the owner's context.
- Reasoning can be more restrained or more proactive than today's loop. Extra automation must cite current evidence and pass every gate above; nothing in L3 can weaken L0–L2 or L4 (§11 invariant I1).
- Because the server no longer checks recipient support styles or template match, Reasoning's core caps (reveal value, sensitive topic, low confidence, conflict, expiry) carry more of the restraint. They stay hard in core.
- Recipient-side receptiveness can only come from what the other person already shares (their delivery settings, support-style preferences as personalization, quiet hours). Reasoning never reads another person's journal, assessment or private state (INSTRUCTIONS "never compare different people's journals").

## 9. Contradictions with current CS / AI / DS behavior

None of these are changed by this document. Each needs the listed owner.

| # | Current behavior | Conflicts with | Proposed resolution | Owner |
|---|---|---|---|---|
| C1 | One literal name matching one accepted connection picks the recipient. In the legacy CS loop this goes straight to `ShareReview` automatically. In the **live room** (`bridge.ts`), it prepares the approval and the owner confirms in the margin ("yes" → stamp) before `approve_signal`. Either way the choice is name-driven, not context-driven. | P5, P7, relevance, reveal value: "I got the job, Sam helped me prep" still offers Sam a nudge; "rough week, now at dinner" still offers the best friend | Insert Reasoning between the assessment and recipient preparation. Reasoning `ask` maps onto the live room's existing margin confirmation; `defer`/`abstain` end quietly as today; `act` keeps the owner's confirm tap in the live room unless CS/AI decide otherwise. Changes D050's "automatically starts" text → D050 amendment. **C1b:** today only a *named* connection is ever offered. Reasoning acting toward an unnamed connection (e.g. `RECONNECT`) stays **offline/test-only in v1**; enabling it in the app needs CS + Cyber (and AI for the live room) | CS + AI (call sites), Cyber review |
| C2 | Reflection produces one `SignalCandidate` (supportMode + availability) per entry. | §2.5: compare multiple candidates; `DEFER`/`ABSTAIN` must compete | v1: Reasoning builds the candidate set itself from inputs and treats the AI candidate as one input. Later: runtime asks the model for several candidates through `ReasoningModelPort` | AI |
| C3 | Delivery vocabulary is three support offers (`short_call`, `encouraging_note`, `shared_activity` → `offer_*` templates), framed as the user wanting support. | `CELEBRATE`, `PRACTICAL_HELP`, `RECONNECT` have no template; `DIRECT_CHECK_IN` vs `CASUAL_INVITE` are not distinct | v1 mapping: `CASUAL_INVITE`/`SHARED_ACTIVITY` → `shared_activity`; `DIRECT_CHECK_IN` → `short_call` or `encouraging_note`. The other three are owner-only (`ask` / `HELP_USER_REACH_OUT`) until new templates go through a C3/C5 contract change. The mapping is the *intended* template; delivery can differ today (C11) | Cyber + CS + AI |
| C4 | Approved signals live 24 h (`SIGNAL_LIFETIME_MS`) and a committed nudge stays visible until `visible_until` (~24 h). Nothing models context shelf life. | P9, P14 (exam case: a today-signal can still surface tomorrow) | Reasoning computes `contextExpiresAt` from the inferred window (fallback when confidence is low). A signal it triggers should expire at min(context expiry, signal lifetime); honoring that needs a sender-side revoke at expiry or a server-enforced expiry field; both are open | CS + Cyber |
| C5 | No reassessment mechanism exists; `prefers_space`/`skipped` end the episode. | `DEFER` semantics | `ReassessmentPort` hosts a fresh episode later; v1 core only emits the condition | CS (app) or AI (worker) |
| C6 | `BoundedCoordinator` defaults `fallbackOnProposerFailure: true`: proposer failure sends the top-ranked option with a fixed template. | P12 and §3.3 rule 3 (failure → abstain) | Recipient-side coordinator; propose `false` for Reasoning-originated signals, or leave and document why it is acceptable | AI |
| C7 | Assessment `intent` is 3-valued (`wants_connection`/`unclear`/`wants_space`) plus names and risk. | §2.3 needs event type, significance, timing, "doesn't want to talk", reveal value | v1 fixtures supply these directly. Live use needs an owner-only C1 extension produced by AI, never sent to peers | AI + Cyber |
| C8 | DS decision labels are `no_action`/`needs_clarification`/`ready_for_preview`; the 55 cases have no defer label and lack most §2.3 inputs. | Mode vocabulary | DS keeps its frozen labels; on them Reasoning is scored for hard-gate safety (excluded surfaced = 0, forbidden disclosures = 0) and every difference in automation is reported with its evidence; new §2.8 cases get new labels | DS |
| C9 | No calendar, receptiveness, workload, "already with people" or contact-baseline data exists. The relationship book has manual calls and nudge outcomes, local only. | Dimensions 2, 4–6 | Unknown → uncertainty → lower automation. v1 demonstrates behavior with synthetic inputs and says so | Reasoning; data sources later |
| C10 | The 24 h cooldown is fixed per pair. | P4 (baseline-relative saturation) | No conflict: cooldown is a server floor. Reasoning may additionally treat contact as saturated relative to baseline, never as permission to bypass cooldown | — |
| C11 | Since `7b3b695`, `commit_nudge` no longer requires the template to match the approved signal's `supportMode`, and recipient support styles are not rechecked. The coordinator picks among options filtered by the recipient's preferences. | Reasoning's chosen action (e.g. `CASUAL_INVITE` → `shared_activity`) can be delivered as a different template (e.g. `offer_note`) | Integration issue, not a gate: Reasoning sets the signal's `supportMode`; the coordinator should prefer the matching template when the recipient's preferences allow it, and otherwise decline or fall back to a documented choice. Reasoning records an intended template; DS checks action/template agreement in evaluation | AI (coordinator), CS |
| C12 | The reflection → decision path is assembled in two places: `decision-loop.tsx` (CS) and `bridge.ts` (live room). | One behavior, one place | Shared Reasoning entry point (§7 Shared 2) that both call; neither UI composes the steps itself | CS + AI |

## 10. Proposed v1 type plan (not created)

Types live in `src/reasoning/core/types.ts` while only Reasoning uses them. When CS or AI first consumes `ReasoningDecision`, it moves to `@dor/contracts` (proposed `contracts/src/reasoning.ts`, interface **C9**) with producer/consumer review, generated schema and fixtures, per contracts/README. No Zod in core (root has no direct `zod` dependency); hand-written validators.

The central seam is **`CandidateProposal[]` in, `ReasoningDecision` out**. Whoever compares candidates (the agentic runtime in production; the reference policy in v1 tests) produces ranked proposals with their contextual judgments. The core never scores relational value itself.

```ts
// Vocabulary (as const arrays → union types)
ReasoningMode     = 'act' | 'ask' | 'defer' | 'abstain'                   // automation order: abstain < defer < ask < act
CandidateAction   = 'DIRECT_CHECK_IN' | 'CASUAL_INVITE' | 'SHARED_ACTIVITY' | 'CELEBRATE' | 'PRACTICAL_HELP'
                  | 'RECONNECT' | 'HELP_USER_REACH_OUT' | 'ASK' | 'DEFER' | 'ABSTAIN'
ActionSurface     = 'recipient' | 'owner' | 'none'
Level             = 'none' | 'low' | 'medium' | 'high' | 'unknown'       // descriptive, never summed
ReasonCode        = 'hard_stop' | 'invalid_input' | 'explicit_intent' | 'excluded' | 'gate_paused' | 'gate_opted_out'
                  | 'gate_cooldown' | 'gate_quiet_hours' | 'gate_preset' | 'no_delivery_path' | 'context_expired'
                  | 'conflict' | 'sensitive_topic' | 'high_reveal_value' | 'not_receptive' | 'unavailable'
                  | 'saturated_vs_baseline' | 'already_with_people' | 'recovered' | 'pattern_prefers_alone'
                  | 'low_confidence' | 'unsupported_by_evidence' | 'outranked' | 'no_relational_value'

// Context window (revision 3): inferred by the runtime, enforced by the core
ContextWindow     = { inferredMinutes?: number; confidence: Level; fallbackMinutes: number; startedAt: string }
// effective = inferredMinutes when present and confidence ≥ medium, else fallbackMinutes.
// Expiry is independent of reveal value: an opportunity can be in-window and still inappropriate to automate.

// Mirror of the current L4 gates (§8), read from the owner's caller-filtered views. A mirror lets the core refuse
// early and explain why; the server stays the authority and may still refuse.
GateMirror        = { paused: boolean; optedOut: boolean | 'unknown'; cooldownUntil?: string; quietHoursNow: boolean | 'unknown'
                    ; presetRevoked: boolean; presetCategories: SharingCategory[] }   // default preset ⇒ both categories
// Recipient personalization (not a gate): may inform the runtime's receptiveness judgment.
RecipientPersonalization = { supportModes?: SupportMode[]; availability?: Availability[] } | 'unknown'

// Episode input: every contextual field is Known<T> | 'unknown'
Known<T>          = { value: T; evidence: EvidenceRef[]; observedAt: string }
EvidenceRef       = string   // opaque, owner-local: 'assessment:intent', 'pattern:<id>', 'book:<id>', 'pref:<id>'
ReasoningEpisodeInput = {
  schemaVersion: 1; episodeId; now
  hardStops: { risk: 'none' | 'interpersonal_conflict' | 'urgent_support'; assessmentValid: boolean }
  explicitIntent: { wantsSpace?: boolean; doesNotWantToTalk?: boolean; excludedRefs: string[] }   // owner's own words/taps
  window: ContextWindow
  relationships: { ref; gates: GateMirror
                 ; conflict: Known<'none' | 'unresolved'> | 'unknown'; sensitiveTopics: Known<string[]> | 'unknown' }[]
  context: SituationContext   // event, user state, patterns, relationship context/dynamics, availability (§2.3);
                              // read by the runtime/reference policy, not scored by the core
}

// Proposal (from runtime or reference policy)
CandidateProposal = {
  rank: number                          // proposer's preference order; core never re-ranks by score
  action: CandidateAction; targetRef?: string; requestedMode: ReasoningMode
  evidenceRefs: EvidenceRef[]           // must exist in the input
  judgments: Partial<Record<PositiveFactor | NegativeFactor, Level>>   // §2.5, recorded for audit, not summed
  revealValue: Level                    // separate from window/expiry
  timing: { kind: 'now' | 'after_delay' | 'not_now'; delayMinutes?: number }
  reassess?: { afterMinutes: number; condition: ReassessCondition }
  alternativeInterpretation?: ReasonCode; confidence: Level
}

// Output (§2.9)
ReasoningDecision = {
  schemaVersion: 1; episodeId; mode: ReasoningMode
  action?: CandidateAction; targetRef?: string; surface?: ActionSurface
  deliveryMapping?: { supportMode: SupportMode; intendedTemplate: Nudge['templateId'] }   // only act + recipient surface; template is intent, not guaranteed (§9 C11)
  evidenceRefs: EvidenceRef[]; freshness: 'fresh' | 'aging' | 'expired'
  timing: 'now' | 'after_delay' | 'not_now' | 'n/a'; timingDelayMinutes?: number
  alternativeInterpretation?: ReasonCode; confidence: Level
  contextExpiresAt: string
  reassess?: { afterMinutes: number; condition: 'distress_still_relevant' | 'still_wants_connection'
             | 'target_available' | 'situation_unchanged' }   // never carries an action (P9, P14)
  capped?: { from: ReasoningMode; by: ReasonCode }   // when a gate lowered the proposer's requested mode
  summary: string                                    // templated from codes; ≤ 200 chars; no names
  rejected: { action: CandidateAction; targetRef?: string; reason: ReasonCode }[]
}
```

Rules the validator enforces: `defer` ⇒ `reassess` present and no action/target/delivery mapping; `abstain` ⇒ no action or target; `act` + recipient surface ⇒ `deliveryMapping` present, the action has a mapping (§9 C3), and `presetCategories` includes `support_preference` (the category that carries `supportMode`); no proposal may target a paused, opted-out, in-cooldown or revoked-preset relationship; evidence refs must exist in the input; `summary` only from templates. The decision stays in the owner's context; only `deliveryMapping.supportMode` (already a C3 field) may reach the D050 path. Recipient support-style preferences are not checked as a gate in core, matching the server.

## 11. Smallest convincing v1

**What v1 is:** the deterministic core, the **constraint and validation foundation** for the later agentic runtime. It is not the reasoning intelligence. The eventual pipeline is:

```
context / memory → agentic Reasoning runtime → candidate generation / comparison
→ deterministic Reasoning core (gates, caps, freshness, explicit intent, validation, tie-break)
→ ACT | ASK | DEFER | ABSTAIN
```

v1 builds the last two stages and a **reference policy** that stands in for the runtime in synthetic tests.

**Reference policy (test-only, labeled):** `src/reasoning/reference/`. It turns synthetic fixture context into ranked `CandidateProposal[]` with simple, readable rules for the §2.8 scenarios. It exists so the core can be exercised end to end; it is **not** the final reasoning algorithm, is never imported by `core/` or production code, and its rules are not product behavior. No universal score threshold.

**Scenarios:** 16 synthetic fixtures. 12 from §2.8 (exam ×2, great news ×2, busy week ×2, silence explained vs natural opening, repeated contact from a rarely- vs frequently-initiating friend, parent pressure, rough week → dinner) plus 4 safety cases (`urgent_support`, `interpersonal_conflict`, missing assessment, excluded person). Labels are written before the code runs. Medium-friend great news expects **`ask`** in v1 (no recipient `CELEBRATE` template; becomes eligible for `act` once one exists, §9 C3). Two scenarios are deliberately **more proactive** than today's loop (natural-opening `RECONNECT` with no name in the entry; exam `CASUAL_INVITE` with the friend unnamed) to show the core admits justified extra automation when it passes every gate. **These are offline/test-only in v1** (§9 C1b); nothing in v1 enables unnamed-connection actions in either UI.

**Invariants as tests:**
- **I1** Reasoning never bypasses or weakens a hard authorization or safety gate. Any automation beyond today's loop must cite current evidence refs and still pass every authoritative gate (§8 L0–L2, L4 mirrors).
- **I2** hard stop or invalid input ⇒ `abstain`.
- **I3** `interpersonal_conflict` ⇒ no recipient surface.
- **I4** `defer` never carries an action.
- **I5** `ABSTAIN` and `DEFER` appear in every decision record (chosen or rejected).
- **I6** expired context ⇒ no `act`; the expiry is computed from the window, never extended by the core.
- **I7** monotonic gates: adding a restriction (exclusion, pause, opt-out, conflict, sensitive topic, lower confidence, expiry) never raises the mode.
- **I8** determinism: same input, proposals and clock ⇒ identical output.
- **I9** an `act` without evidence refs, or with refs absent from the input, is rejected (`unsupported_by_evidence`).

**Not in v1:** the runtime or any model call, memory persistence or learning, CS wiring, new templates, contract export, reassessment execution.

## 12. `src/reasoning/core/**` implementation plan (approved with revisions; source not written)

All new files. No existing file, `package.json` or `tsconfig.json` change: `test:app` already runs `src/**/__tests__/*.test.ts` and `tsconfig` already includes `src/**`. Core imports `@dor/contracts` types/enums only.

| File | Contents |
|---|---|
| `core/vocabulary.ts` | `as const` arrays for modes, actions, surfaces, levels, reason codes, reassess conditions; action → surface table; action → `SupportMode` delivery mapping (§9 C3: `CELEBRATE`, `PRACTICAL_HELP`, `RECONNECT` have none yet) |
| `core/types.ts` | §10 types |
| `core/validate.ts` | Input, proposal and output validators; unknown keys rejected; evidence refs must resolve; invalid input → `abstain` |
| `core/window.ts` | `effectiveWindow(window)`: inferred when confidence ≥ medium, else fallback; `contextExpiresAt`, `freshnessOf`. Optional fallback defaults per event kind, labeled as defaults, overridable by the runtime. Independent of reveal value |
| `core/gates.ts` | Ordered gates: hard stops → explicit intent/exclusions → server-gate mirrors (`GateMirror`: pause, opt-out, cooldown, quiet hours, preset revoked, preset categories) → delivery path → context expiry → conflict (no recipient surface) → evidence check. Each gate rejects with a `ReasonCode` or caps the mode. No relational scoring |
| `core/caps.ts` | Automation caps from proposer-reported facts: high reveal value or sensitive topic on a recipient action ⇒ at most `ask`; low/unknown confidence ⇒ at most `ask`. Caps lower, never raise |
| `core/select.ts` | Takes the proposer's ranked, gated proposals; ensures `DEFER` and `ABSTAIN` are present; picks the best surviving rank; deterministic tie-break on equal rank (`abstain > defer > ask > act`, then target ref); no proposals ⇒ `abstain` |
| `core/finalize.ts` | `finalize(input, proposals, clock): ReasoningDecision`: validate → window → gates → caps → select → build and validate the decision |
| `core/summary.ts` | Fixed templates from codes; no names, no free text |
| `core/index.ts` | Public exports |
| `core/__tests__/{window,gates,caps,select,finalize,invariants}.test.ts` | Unit tests and I1–I9 |
| `reference/reference-policy.ts` | **Test/reference policy only** (§11); fixture context → `CandidateProposal[]` |
| `reference/__tests__/scenarios.test.ts` | 16 scenarios through reference policy + core |
| `fixtures/scenarios.synthetic.json` | Scenario inputs and pre-written expected mode, action, target, required rejection codes |

Removed from the earlier plan: `compare.ts` (numeric scoring, ABSTAIN margin), `baseline.ts` and `patterns.ts` as core modules. Baseline deviation and pattern interpretation are contextual judgments for the runtime; the reference policy handles them simply for fixtures.

**Order:** vocabulary/types/validate → window → gates/caps → select/finalize/summary → invariants → fixtures + reference policy + scenarios → mutation pass. **Verification:** `node --test "src/reasoning/**/__tests__/*.test.ts"` and `npm run typecheck`; no broad suite, no paid calls.

**Decided for v1:** unnamed-connection actions are offline/test-only (§9 C1b). **Integration later (not v1):** shared entry point (C12) and template/action agreement (C11).

## 13. Not in scope

- Runtime, ports or any call-site change.
- Choosing a model or vendor; adapters stay with AI.
- New server reducers, schema, views or templates.
- Memory storage design (§2.10 lists categories only).
