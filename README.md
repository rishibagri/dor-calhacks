# Kinetic — CalHacks
Private reflection. Thoughtful connection.

A voice journal for people separated by distance. Each person has a private agent. Only explicitly approved, bounded signals reach a shared coordination service; that service proposes considerate nudges without exposing journal content. People retain control over whether to act.

## Repository setup
Inspired by [FaultLine's contract-first collaboration structure](https://github.com/Jay-Thpr/FaultLine). Kinetic keeps its own TypeScript stack and privacy model; no FaultLine runtime code is copied.

| Path | Owner | Status |
|---|---|---|
| `contracts/` | Shared; producer and consumer review | Types, strict schemas, fixtures, fakes and offline contract checks |
| `src/app/`, `src/server/`, `spacetimedb/` | CS, Cyber reviews authorization | Planned application and real-time module |
| `src/evaluation/` | DS | Planned quiz mapping, matching and evaluation |
| `src/privacy/`, `src/vault/` | Cyber | Planned runtime policy and local encryption |
| `src/agents/`, `worker/` | AI | Planned Claude/Cartesia/Factory adapters |
| `integration/` | Shared; CS integrates | Verification matrix and future live smoke checks |
| `docs/handoffs/`, `docs/updates/` | Each role owns its file | Handoffs and ongoing coordination |
| `PRD.md`, `PROJECT_KNOWLEDGE.md` | Shared | Product requirements and durable current context |

## Setup
Requires Node.js 20+ and npm. No cloud account or API keys are needed for contract checks.

```sh
npm ci
npm run check
```

This builds and checks the shared contract package only. There is no application start command until the app is implemented. Start against the explicit fakes/fixtures while real adapters are built. See [contracts/README.md](contracts/README.md) for C1–C6 and producer/consumer ownership.

## Start here
1. Read [AGENTS.md](AGENTS.md) before any work, then [PRD.md](PRD.md), [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md), and [contracts/README.md](contracts/README.md).
2. Read [the 36-hour plan](docs/PLAN.md) and [product scope](PRD.md).
3. Read every contract in [contracts/specs](contracts/specs), then your role in [docs/roles](docs/roles).
4. Claim work and post updates as described in AGENTS.md.

## Role branches
- role/cs-app — application, API, deployment, integration
- role/ds-context — matching, evaluation, synthetic examples
- role/cyber-privacy — authorization, disclosure policy, deletion, adversarial tests
- role/ai-voice — Cartesia voice loop, private agent, safe proposals

All branches start with the same contracts. Main is the shared integration branch. The shared repository is https://github.com/rishibagri/closer-calhacks (private). Each role branch starts from the complete planning scaffold.

## Shared contracts
All major contracts live on `main` in [contracts/specs](contracts/specs) and [contracts](contracts). Every role reads the same contracts; role branches never define private copies. Contract changes merge into `main` and are then merged into all role branches. Repository access remains private to invited collaborators.

## Separate demo document
Video production and presentation details are kept separately in [docs/DEMO.md](docs/DEMO.md); they are not part of the engineering contracts or role deliverables.

## Status
Planning and interface scaffold only; no running application yet. The selected stack is documented in [TECH_STACK.md](docs/TECH_STACK.md): Next.js, React, TypeScript, Tailwind/shadcn, SpacetimeDB, Claude, Factory Droid, Cartesia, Zod, and an encrypted local vault. The GitHub repository keeps its existing name to preserve shared links.

## Onboarding and sharing
See the [onboarding and recipient-sharing contract](contracts/specs/ONBOARDING_SHARING.md). Quiz answers personalize suggestions; only explicit, named-recipient consent under a confirmed relationship preset authorizes sharing. Unanswered product choices are marked provisional.
