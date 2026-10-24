# Message for Sumedh and his Cyber agent

Current branch status: remote role/cyber-privacy 129c31f reports real disclosure guards, authoritative approve_signal and vault key design (offline only). Preserve it; reconcile its policy implementation with main disclosure.ts/FLOWS.md and decision IDs, then focus on real VaultPort, worker commit/identity and consumer ACKs. Do not implement a second parallel policy.


Sumedh owns implementation of the encrypted local vault and real privacy/authorization rules. This includes VaultPort for journals/profiles/quiz extras, key/unlock/lock/recovery, exact recipient-bound item approval, preset/assignment/item versions, expiry/revocation and adversarial tests. CS owns app/database/client plumbing, Adam providers/worker, Nimisha quiz/ranking semantics.

The merged app has a locked vault placeholder and approve_signal intentionally refuses. Reuse that structure rather than creating a parallel store/module. Inspect src/lib/backend/ports.ts, spacetimedb/src/guards.ts, reducers/signals.ts, schema.ts and views.ts. Claim exact guard/approval/suppression files with CS. Resolve issuer/audience/internal-worker identity questions, D015 fixture privacy and Adam’s merged D021 consent boundaries explicitly.

Immediate handoffs are a real drop-in vault adapter and authoritative approval/use guards. Verify direct reducer/view/subscription access as well as API checks; frontend/Zod validation alone does not authorize. A model or worker cannot mint consent. Test third-user denial, altered payload, stale assignment/preset, revoke-during-generation and retry/replay. Offline fake-policy tests do not prove production isolation.

New scope is CS-owned Apify public activity discovery, with Nimisha ranking and Adam bounded proposals. No journals, private quiz extras, detailed calendars, pair/person IDs or relationship labels may enter Actor inputs. Review normalized public source fields and proposed C7/new activity-consent categories before shared user-specific delivery. Both people accept the same proposal revision; changed consent or expired data suppresses pending plans. Existing C3 cannot secretly carry new activity fields.

Use CYBER-P# phases in your updated role guide; publish interfaces early and update your log/handoff with actual checks and exact consumers. Document key loss/provider retention and already-viewed-data limits honestly. Keep sharing blocked when the real guard is missing, rather than adding a convenient bypass.

One newer main change landed during planning: read `contracts/specs/FLOWS.md` and `contracts/src/disclosure.ts` before implementing preview/delivery. Preserve device-only preview, recipient opt-in default off, quiet hours/24h cooldown, no candidate for space/no need, and no nudge for availability-only input. Sumedh reviews the CS-drafted pure semantics. Adam's branch proposal also used D016; main D016–D020 now name the core flow decisions, so reconcile types by commit instead of relying on the duplicate label.

Publication update: Adam’s M1/D021 code merged into main via PR #4 while this message was drafted. Consume the merged interfaces and preserve your active branch; remaining consumer review and real-policy/app integration are still required. Nimisha/Sumedh also have active branch work: inspect current logs instead of restarting milestones.
