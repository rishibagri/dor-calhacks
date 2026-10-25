# dor

### Make human connection easier during life's transitions

Starting college, moving, beginning a job or graduating can disrupt a person's support network. dor helps people find local communities, activities and people to meet. Existing relationships and private reflection remain part of the product; dor helps prepare a reason to connect without replacing human conversation.

**Journey:** choose a new chapter and broad area → opt in to selected profile details → discover people and real activities → choose an introduction → the other person decides whether to accept.

## Product and privacy

- Nearby discovery uses one-time approximate location and opted-in public profile fields. Journal data and private quiz answers do not enter discovery.
- Each accepted relationship can have a private book for owner-selected device photos, call logs and interaction feedback; it uses the encrypted local vault, not Apify or AI sharing.
- Apify collects a generic, developer-configured public event catalogue. It never receives journal text, private quiz answers, relationship IDs, personal attendance intent or device-derived location.
- Existing-connection nudges run automatically for accepted pairs under the current preset and server checks. Recipients can opt out per connection; pauses, quiet hours and cooldown still apply. Journal text is never shared. Conflict risk suppresses nudging; serious mental-health distress shows support resources immediately and never contacts a connection.
- Product, architecture and role phases: [INSTRUCTIONS.md](INSTRUCTIONS.md). Normative boundaries: [contracts/README.md](contracts/README.md), [D050 automatic-nudge specification](docs/features/AUTOMATIC_NUDGES.md), [relationship books](docs/features/RELATIONSHIP_BOOKS.md), [Apify source guide](docs/features/APIFY_SOURCE.md).

## Current status

- **D050:** implemented on this branch and offline-verified; PR pending, not live-verified. Accepted pairs use default-on in-app nudges under their assigned preset, with recipient per-pair opt-out, pause, configured quiet hours and cooldown. Private conflict suppresses nudges; serious-distress terms show a local U.S. 988 resource card and never contact a connection. D044 backend remains for compatibility.
- **Apify:** live-verified 2026-10-25. Luma events, Google Maps places and Google Events go through pinned Actor builds, server-side normalization and the ingester-only reducers. Maincloud holds 170 places and 51 events from those runs. Refreshes are manual for now (`scripts/ingest-catalogue.ts --google` / `--fetch`, which spend credits). Sources and limits: [APIFY_SOURCES.md](docs/features/APIFY_SOURCES.md).
- **Live app:** the Claude Design room ([frontend/](frontend/)) driven by the real backend through `src/components/live`, served at live.doratcalhacks.site during live sessions (`scripts/live-session.sh`).
- **Live notebook (D056):** tap to talk and tap again to stop; then **Keep talking** (one follow-up question, read aloud by Cartesia) or **Send** (private reflection + Reasoning); **Start over** clears everything. Verified in the live app with typed input and one real follow-up call; real speech on a phone is still to be checked. See [LIVE_NOTEBOOK.md](docs/features/LIVE_NOTEBOOK.md).
- **Discovery:** UI and guarded state paths are implemented; live candidate/event density and full newcomer journey still require verification.
- **Friend-of-friend connections (D045, CS branch):** bounded 2–3-hop matching through dor's accepted links, gated by both users' active public discovery profile and coarse-area participation. Cards use opaque publication references and show no candidate identity until an invitation is accepted. Requests remain user-initiated; the local sill preview uses fictional Berkeley data and disables actions. Offline-verified only; Cyber/DS/AI review and live DB verification remain open.

See [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md) for the evidence ledger. Implemented, deployed and live-verified are tracked separately.

## Stack

Next.js, React and TypeScript; Tailwind and shadcn/ui; SpacetimeDB reducers and caller-filtered views; Claude; Factory Droid SDK; Cartesia; Zod; IndexedDB/Web Crypto; Apify; Clerk.

## Local development

```sh
npm ci
npm run dev
```

Set local values in `.env.local` using [.env.example](.env.example). Never commit keys. `npm run typecheck`, `npm run test:app` and `npm run build:app` are useful offline checks; they do not prove provider access, deployment or live database behavior. See [docs/RUNBOOK.md](docs/RUNBOOK.md) for setup and reset steps.

## Team ownership

| Role | Owner | Focus |
|---|---|---|
| CS | Rishi | App, SpacetimeDB integration, Apify ingestion and release |
| DS | Nimisha | Ranking, discovery quality and evaluation |
| AI | Adam | Voice, constrained reasoning and worker |
| Cyber | Sumedh | Authorization, consent and privacy review |
| Reasoning | Sumedh (D052, proposed) | Relational decision layer: whether, how and when to suggest a connection |

Read [AGENTS.md](AGENTS.md) before working. Start with [INSTRUCTIONS.md](INSTRUCTIONS.md), then your role plan and handoff. Shared contracts live on `main`; role updates are in `docs/updates/`.

## Sponsor targets

Meta/Facebook: AI that brings people together. Anthropic: Best use of Claude. Factory: Best use of Droid SDK. Cartesia: Best use of Cartesia. SpacetimeDB: core state and authorization. Apify: public event catalogue. Tool use alone does not establish prize eligibility; evidence and exact criteria are tracked in [INSTRUCTIONS.md](INSTRUCTIONS.md).

Demo/video planning stays separate in [docs/DEMO.md](docs/DEMO.md).
