# Kinetic — selected tech stack
User-selected stack; replaces the earlier Postgres proposal. This is a planning contract, not a claim that integrations are implemented.

| Component | Technology | Responsibility | Sponsor |
|---|---|---|---|
| Frontend | Next.js + React + TypeScript | Dashboards, onboarding, journal, recipient rules, curiosity cards, aura, matching UI | — |
| UI | Tailwind CSS + shadcn/ui | Responsive accessible components | — |
| Authoritative shared state | Hosted SpacetimeDB | Relationships, approved disclosures, live subscriptions, matching state | SpacetimeDB |
| Database logic | SpacetimeDB reducers + private tables and caller-filtered views | Authorization and atomic consent/state transitions | SpacetimeDB |
| Reasoning | Anthropic Claude API | Selected-context extraction, event understanding, constrained proposals | Anthropic |
| Orchestration | Factory Droid TypeScript SDK | Trigger-driven workflows, bounded tools, sanitized action receipts | Factory |
| Voice | Cartesia API/SDK | Voice check-ins, transcription and spoken updates, verified adapter configuration | Cartesia |
| Privacy | TypeScript + Zod | Strict validation and recipient/category/purpose enforcement | — |
| Private vault | IndexedDB + Web Crypto | Encrypted local journals, transcripts, quiz answers and preferences | — |
| Calendar | Sample .ics parser initially; optional Google Calendar API | Private schedule analysis; approved coarse availability only | Google |
| Authentication | Clerk default proposal; Auth.js alternative | Verified account identity mapped to SpacetimeDB caller | — |
| Deployment | Vercel + hosted SpacetimeDB + separate compatible Factory worker | Frontend/API, shared state, agent execution | — |

## Runtime and provider boundaries
- Next.js API handles provider credentials and authenticated requests. Master keys never reach browsers. Factory worker runs a subprocess/daemon-compatible Node environment; verify deployed runtime, credentials, model availability, timeouts and cancellation by hour 3. Vercel hosts the UI/API; do not assume a long-running Droid process fits that environment.
- Claude provider calls and Factory model usage are separate integration decisions: private extraction uses the direct Claude adapter; shared coordination via Factory receives only approved structured signals. Do not accidentally transmit raw journals into persistent Droid sessions or tool logs.
- Factory SDK documentation currently calls for Node >=18, a Droid CLI or daemon, and Zod 3 for SDK tool/structured-output integrations. Pin actual compatible versions after the spike; isolate a separate adapter if the app adopts another Zod major.
- Cartesia documentation exposes speech-to-text and text-to-speech. AI owns testing chosen endpoints, streaming, turn detection, browser audio capture, provider processing disclosure, and failure behavior.
- SpacetimeDB authorization belongs in reducers and caller-filtered views over private tables. Next.js/Zod checks are additional safeguards; directly calling a reducer must never bypass consent enforcement. Do not publish sensitive tables as globally public subscriptions.
- Authentication polishing can be optional; stable verified identity and authorization are required before handling real private data. Synthetic development identities must remain clearly restricted to test mode.
- Local encrypted persistence does not mean exclusively local processing. Provider-bound selected content is disclosed before processing. No promise of cloud-free journaling or encrypted computation.

## Source documentation checked
- [SpacetimeDB](https://spacetimedb.com/docs/), [authentication](https://spacetimedb.com/docs/core-concepts/authentication/), [views recommended over experimental RLS](https://spacetimedb.com/docs/how-to/rls/)
- [Factory TypeScript SDK](https://docs.factory.com/sdk/typescript)
- [Claude platform](https://platform.claude.com/docs/en/home)
- [Cartesia overview](https://docs.cartesia.ai/get-started/overview)
- [Next.js](https://nextjs.org/docs), [Google Calendar](https://developers.google.com/workspace/calendar/api)

## Scope distinction
Core delivery remains private voice reflection → explicit disclosure approval → recipient-specific coordination → live nudge. Event curiosity cards, bandwidth aura, and group matching are supported by the selected stack but need their own product/consent contracts before commitment. Start calendars with synthetic .ics schedules. Group sharing must never inherit pair consent; it needs explicit audience membership and consent per recipient.
