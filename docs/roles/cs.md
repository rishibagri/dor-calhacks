# CS — Product engineering and integration

Branch: `role/cs-app`

Ownership: src/app/, src/server/, deployment, API implementation

Next.js/React/TypeScript with Tailwind/shadcn; onboarding quiz UI, connection profile, preset confirmation and named-recipient preview. Own Clerk identity integration, SpacetimeDB reducers/views/subscriptions, Vercel deployment and worker API integration.

## Deliverables
Hour 3: deployed Next.js shell and authenticated SpacetimeDB identity spike. Hour 7: quiz, local journal/review UI and accepted pair. Hour 12: live two-account path. Hour 22: integrated preset/receipt/revoke screens.

## Dependencies
Cyber supplies policy checks; AI supplies voice/candidate adapter; DS supplies ranking/fixtures. Do not implement around missing policy by bypassing it.

Before coding: read AGENTS.md and all contracts. Post handoffs to docs/updates/cs.md. Open small compatible PRs, include verification, and read the other role logs every hour.

Handoff file: docs/handoffs/cs.md. Shared interfaces: contracts/README.md; do not fork contract types into role directories.
