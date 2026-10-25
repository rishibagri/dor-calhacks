# Reasoning handoff — current

## D054 live Reasoning + D053 backstage (2026-10-25)

- **Status:** implemented and offline-verified on `role/reasoning` (uncommitted). Not live until merged, republished and the live session restarted.
- **Live path:** reflection → `/api/reasoning` (one Claude call, refs only) → deterministic core → act sends without a tap; ask uses the margin; owner moments send nothing; defer reassesses in-session; abstain is quiet. Fallback proposer when the model fails.
- **Backstage:** `/backstage` (by URL only since D060). Observer-gated module views; tools and activity via `/api/backstage/activity`.
- **Owner steps after merge:** (1) Nimisha: `npm run setup:module -- --server maincloud --run` (additive: 2 tables, 2 reducers, 13 views). (2) Nimisha: `spacetime call -s maincloud dor set_observer_identity '{"__identity__":"0x<hex from /backstage>"}' true`. (3) Adam: restart `scripts/live-session.sh` and the worker from merged main; optional `scripts/deploy-demo.sh` for the guide copy.
- **Live data changed (approved):** Adam↔Rishi delivery on, Rishi's quiet hours removed, both accept all support styles (29 days), via `scripts/demo-pair.ts --apply`.
- **Not verified:** a live Claude `/api/reasoning` call (paid, not run), browser behavior of the live room, backstage against Maincloud (needs the republish).

## Main merged, renumbered to D052, REASONING.md aligned with current gates (2026-10-25)

- **Branch/commit:** `role/reasoning` fast-forwarded to main `6cc56f1` (no merge commit, no conflicts); Reasoning docs uncommitted, not pushed. No source.
- **Renumbered:** D051 → D052 in every Reasoning doc and shared-doc line (Adam's places/live-bridge proposal already cites D051).
- **REASONING.md:** §8 L4 lists the post-`7b3b695` gates (default preset fallback; support styles are personalization; no template↔mode check); §10 `GateMirror` replaces `presetModes`, `deliveryMapping` carries an intended template; §6 adds `src/components/live/bridge.ts`; §9 C1 revised for the live-room confirm step, new C11 (template/action mismatch) and C12 (shared entry point); §7 shared entry point; unnamed-connection actions offline/test-only in v1.
- **Next:** owner go-ahead for `src/reasoning/core/` source.

## Core plan approved with revisions (2026-10-25)

- **Branch/commit:** `role/reasoning` on main `f89d0bf`; uncommitted, not pushed. Docs only; no source.
- **Revisions applied to `docs/features/REASONING.md`, the role doc and D052:**
  1. "Never more automated than the current loop" removed. New I1: never bypass or weaken a hard gate; extra automation needs current evidence and must pass every authoritative gate.
  2. No numeric scoring engine in core. The runtime compares contextual tradeoffs; the core gates, caps, enforces expiry and explicit intent, validates and breaks ties. Seam: ranked `CandidateProposal[]` → `finalize()` → `ReasoningDecision`. v1 uses a labeled test-only reference policy (`src/reasoning/reference/`).
  3. Context expiry = inferred window + confidence + fallback window; fallbacks are defaults only; expiry is separate from reveal value.
  4. Medium-friend great news → `ask` in v1 until a recipient `CELEBRATE` action exists.
  5. v1 is the constraint/validation foundation, not the reasoning intelligence.
- **Plan (§12):** `core/{vocabulary,types,validate,window,gates,caps,select,finalize,summary,index}.ts` + tests; `reference/reference-policy.ts` + scenarios; `fixtures/scenarios.synthetic.json`. `compare.ts`, `baseline.ts`, `patterns.ts` dropped from core.
- **Open:** §9 C1b (act toward an unnamed connection) for CS + Cyber.
- **Next:** owner approval of the revised plan, then source.

## Behavioral spec in REASONING.md; core plan awaiting approval (2026-10-25)

- **Branch/commit:** `role/reasoning` on main `f89d0bf`; uncommitted, not pushed. Docs only; no source.
- **Done:** `docs/features/REASONING.md` §2 (owner's behavioral spec: default no action, P1–P15, nine dimensions, ten candidate actions, comparison factors, act/ask/defer/abstain, loop, example behaviors, output requirements, memory categories); §8 layering with D050 (hard stops and server gates win; Reasoning narrows only); §9 ten contradictions C1–C10 with owners; §10 v1 type plan (local first, later `@dor/contracts` C9); §11 v1 subset (16 scenarios, invariants I1–I8); §12 `src/reasoning/core/**` file plan.
- **Waiting on owner:** resolved in the revision above.
- **Key cross-role items:** C1 D050 auto path (CS + Cyber), C3 delivery vocabulary (Cyber + CS + AI), C4 context expiry vs 24 h lifetime (CS + Cyber), C6 coordinator fallback (AI), C7 richer owner-only assessment (AI), C8 DS scoring.

## Owner + architecture revision; REASONING.md (2026-10-25)

- **Branch/commit:** `role/reasoning` on main `f89d0bf`; uncommitted, not pushed, no PR. Docs only.
- **Owner:** Sumedh (separate workstream from Cyber).
- **Architecture:** `src/reasoning/core/**` (pure, deterministic gates, no provider/network) + `src/reasoning/runtime/**` (provider-agnostic agentic orchestration through ports). Reasoning decides what to think about and what to do; AI provides the model/runtime connection. Outcomes `act | ask | defer | abstain`.
- **New:** `docs/features/REASONING.md`: core/runtime split, proposed ports (`ReasoningModelPort`, context ports, `ReasoningToolPolicy`, `ReasoningClock`, `ReassessmentPort`), 10 current call sites, open interfaces per role. §2 behavioral framework is a placeholder awaiting the owner's spec.
- **Not done:** no source, no port types, no behavior.
- **Next (Reasoning):** receive the behavioral spec, fill §2, then show the planned `src/reasoning/core/` changes before writing code.
- **Consumers next:** AI: `ReasoningModelPort` shape and where relational prompt content lives (REASONING.md §7). CS: decision-loop call site, context ports, reassessment host. DS: Reasoning as a system in `decision-baselines.ts`. Cyber: worker vs browser context exposure; memory storage.
- **Blockers:** behavioral spec; D052 ACKs.

## RSN-R0 scaffold (2026-10-25, superseded above)

## RSN-R0 scaffold (2026-10-25)

- **Branch/commit:** `role/reasoning` on main `f89d0bf`; uncommitted, not pushed, no PR.
- **Status:** role documentation only. No reasoning engine, types, fixtures or tests exist. Nothing is implemented, deployed or live.
- **Owner:** Sumedh (set later the same day).
- **Interfaces:** none yet. Proposed claim: `src/reasoning/**` (pure, on-device, dependency-free) and `docs/features/REASONING.md`. Decision vocabulary (`act | defer | ask_owner | abstain`) is a proposal for RSN-R0 review.
- **Boundaries:** see `docs/roles/reasoning.md` § "Not owned". Reasoning can only narrow; existing CS, AI, DS and Cyber files stay with their owners.
- **Next (Reasoning):** write `docs/features/REASONING.md` mapping each current decision point (CS `decision-loop-model.ts`, AI `assessment.ts`, D050 rules, DS `decision-cases.json`) to own / consume / leave.
- **Consumers next:**
  - CS: ACK that the decision loop may later call a Reasoning port; no change now.
  - AI: confirm the assessment fields Reasoning may read (names, intent, risk).
  - DS: ACK that Reasoning outputs are evaluated with the existing 55 cases.
  - Cyber: ACK the "narrow only" rule; co-design memory storage before any persistence.
- **Blockers:** owner assignment; D052 ACKs.
