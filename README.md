# dor

### Make human connection easier during life's transitions

Starting college, moving, beginning a job or graduating can disrupt a person's support network. dor helps people find local communities, activities and people to meet. Existing relationships and private reflection remain part of the product; dor helps prepare a reason to connect without replacing human conversation.

**Journey:** choose a new chapter and broad area → opt in to selected profile details → discover people and real activities → choose an introduction → the other person decides whether to accept.

## Product and privacy

- Nearby discovery uses one-time approximate location and opted-in public profile fields. Journal data and private quiz answers do not enter discovery.
- Apify collects a generic, developer-configured public event catalogue. It never receives journal text, private quiz answers, relationship IDs, personal attendance intent or device-derived location.
- Existing-connection nudges retain recipient opt-in, quiet hours, pauses and server rechecks. D044 allows automatic approval only for one named pair, selected categories and an explicit expiring rule. Manual review remains the default; journal text is never auto-shared.
- Product, architecture and role phases: [INSTRUCTIONS.md](INSTRUCTIONS.md). Normative boundaries: [contracts/README.md](contracts/README.md), [D044 specification](docs/features/AUTOMATIC_NUDGES.md), [Apify source guide](docs/features/APIFY_SOURCE.md).

## Current status

- **D044:** backend reducers/views are in the repository; the team reports the backend is live on Maincloud. This PR adds the Connections permission UI and ShareReview automatic-approval path. App checks are offline evidence; this PR does not publish, deploy or live-verify Maincloud.
- **Apify:** server-only Actor adapter, bounded normalization/cache and fixture path exist. Live retrieval is still unverified. `--fetch` spends credits and needs configured credentials and source review.
- **Discovery:** UI and guarded state paths are implemented; live candidate/event density and full newcomer journey still require verification.

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

Read [AGENTS.md](AGENTS.md) before working. Start with [INSTRUCTIONS.md](INSTRUCTIONS.md), then your role plan and handoff. Shared contracts live on `main`; role updates are in `docs/updates/`.

## Sponsor targets

Meta/Facebook: AI that brings people together. Anthropic: Best use of Claude. Factory: Best use of Droid SDK. Cartesia: Best use of Cartesia. SpacetimeDB: core state and authorization. Apify: public event catalogue. Tool use alone does not establish prize eligibility; evidence and exact criteria are tracked in [INSTRUCTIONS.md](INSTRUCTIONS.md).

Demo/video planning stays separate in [docs/DEMO.md](docs/DEMO.md).
