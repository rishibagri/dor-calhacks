# Closer — CalHacks working name
Private reflection. Thoughtful connection.

A voice journal for people separated by distance. Each person has a private agent. Only explicitly approved, bounded signals reach a shared coordination service; that service proposes considerate nudges without exposing journal content. People retain control over whether to act.

## Start here
1. Read [AGENTS.md](AGENTS.md) before any work.
2. Read [the 36-hour plan](docs/PLAN.md) and [product scope](docs/PRODUCT.md).
3. Read every contract in [docs/contracts](docs/contracts), then your role in [docs/roles](docs/roles).
4. Claim work and post updates as described in AGENTS.md.

## Role branches
- role/cs-app — application, API, deployment, integration
- role/ds-context — matching, evaluation, synthetic examples, demo edit
- role/cyber-privacy — authorization, disclosure policy, deletion, adversarial tests
- role/ai-voice — Cartesia voice loop, private agent, safe proposals

All branches start with the same contracts. Main is the shared integration branch. The shared repository is https://github.com/rishibagri/closer-calhacks (private). Each role branch starts from the complete planning scaffold.

## Status
Planning and interface scaffold only. No running app, vendor credentials, deployed service, or rendered demo video yet. Proposed stack: TypeScript web app, server API, Postgres with enforced ownership policies, server-side model calls, Cartesia voice adapter. Validate vendor capabilities in the first implementation spike. Never describe a privacy guarantee as shipped until tested.
