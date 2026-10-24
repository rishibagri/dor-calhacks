# Kinetic — CalHacks
Private reflection. Thoughtful connection.

A voice journal for people separated by distance. Each person has a private agent. Only explicitly approved, bounded signals reach a shared coordination service; that service proposes considerate nudges without exposing journal content. People retain control over whether to act.

## Start here
1. Read [AGENTS.md](AGENTS.md) before any work.
2. Read [the 36-hour plan](docs/PLAN.md) and [product scope](docs/PRODUCT.md).
3. Read every contract in [docs/contracts](docs/contracts), then your role in [docs/roles](docs/roles).
4. Claim work and post updates as described in AGENTS.md.

## Role branches
- role/cs-app — application, API, deployment, integration
- role/ds-context — matching, evaluation, synthetic examples
- role/cyber-privacy — authorization, disclosure policy, deletion, adversarial tests
- role/ai-voice — Cartesia voice loop, private agent, safe proposals

All branches start with the same contracts. Main is the shared integration branch. The shared repository is https://github.com/rishibagri/closer-calhacks (private). Each role branch starts from the complete planning scaffold.

## Shared contracts
All major contracts live on `main` in [docs/contracts](docs/contracts) and [packages/contracts](packages/contracts). Every role reads the same contracts; role branches never define private copies. Contract changes merge into `main` and are then merged into all role branches. Repository access remains private to invited collaborators.

## Separate demo document
Video production and presentation details are kept separately in [docs/DEMO.md](docs/DEMO.md); they are not part of the engineering contracts or role deliverables.

## Status
Planning and interface scaffold only; no running application yet. The selected stack is documented in [TECH_STACK.md](docs/TECH_STACK.md): Next.js, React, TypeScript, Tailwind/shadcn, SpacetimeDB, Claude, Factory Droid, Cartesia, Zod, and an encrypted local vault. The GitHub repository keeps its existing name to preserve shared links.

## Onboarding and sharing
See the [onboarding and recipient-sharing contract](docs/contracts/ONBOARDING_SHARING.md). Quiz answers personalize suggestions; only explicit, named-recipient consent under a confirmed relationship preset authorizes sharing. Unanswered product choices are marked provisional.
