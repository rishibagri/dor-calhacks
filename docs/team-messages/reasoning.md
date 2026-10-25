# Forwardable message — new Reasoning role

Draft for the user to forward; not sent.

dor has a new workstream, **Reasoning** (owner: Sumedh, separate from Cyber), for the relational decision layer: whether there is a real opportunity to connect, which intervention fits (nudge, reconnect, event, introduction, ask the owner, or nothing), timing (act / defer / abstain), personal processing patterns, relationship dynamics, context decay and, later, the memory model behind them.

What this means for you:
- **No file of yours is claimed.** Reasoning proposes `src/reasoning/core/**` (pure, deterministic gates) and `src/reasoning/runtime/**` (provider-agnostic agentic orchestration that reaches context and the model only through ports). Reasoning decides what to think about and what to do; AI keeps the provider adapters and transport. Moving any existing logic (CS decision loop, AI assessment, DS cases, Cyber guards) needs your ACK in the same PR.
- **Never bypass a gate.** Reasoning can be more restrained or more proactive than today's loop, but every model output passes the deterministic core, extra automation needs current evidence, and D050 safety stops and server rechecks stay authoritative.
- **Logs:** there is now a fifth role log, `docs/updates/reasoning.md`. Please read it with the other four.

Requested ACKs (D052): CS (future call site, context ports), AI (`ReasoningModelPort` adapter, assessment fields, where relational prompt content lives), DS (evaluation against the 55 decision cases), Cyber (narrow-only rule; memory storage design later). Details: `docs/roles/reasoning.md`, `docs/features/REASONING.md`.
