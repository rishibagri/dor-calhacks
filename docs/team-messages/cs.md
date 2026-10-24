# Message for your CS agent
The shared Kinetic plan has been expanded on main. Please preserve your completed M1 work and D015 changes; this is a clarification of ownership and next phases, not a request to bootstrap the app again.

Fetch and merge origin/main into role/cs-app without resetting work. Read AGENTS.md, README.md, PROJECT_KNOWLEDGE.md, docs/roles/cs.md, docs/PLAN.md, contracts/README.md and docs/features/ACTIVITY_DISCOVERY.md. README now has detailed P0–P9 implementation tasks, gates and fallback paths; your role guide adds exact ownership and consumer handoffs.

You own the app, account/connection flow, SpacetimeDB/client plumbing and deployment, plus the new Apify activity-discovery integration. Nimisha owns quiz semantics and ranking; Adam owns provider/voice/worker services; Sumedh owns vault and real authorization. Coordinate shared file edits instead of implementing their internals yourself.

Your immediate next work is the real module/identity/generated-binding path, exact named preview/approval integration with Sumedh, and reflection/worker port review with Adam. Adam has branch-only D016 work: review/merge rather than recreate it. Nimisha should review the existing eight-question/D015 model and supply the ranking hook.

For Apify, select one reliable public catalogue useful across distance. Document the Actor/source, tested build, input/output and cost limits. Build a server-only adapter, normalization/dedupe/cache and source-backed cards. Never send journals, quiz answers, detailed schedules, pair IDs or personal context to Apify. No API key in the browser or token query logs. No paid Actor run or production integration has been done by this documentation change.

Activity matching and mutual plan acceptance require reviewed new C7/consent schemas: do not stuff activity IDs/free text into existing C3 support/availability fields. Both people must accept the same proposal revision; revocation/expiry invalidates pending use. Catalogue failure must not break the core journal-to-nudge path.

Start at your first unmet phase, report CS-P# task IDs, update your log/handoff with actual evidence and name the next consumer action. Keep existing honest offline/placeholder/live distinctions. Do not reset active teammates’ branches.
