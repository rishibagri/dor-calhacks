# API contract v2 — local vault and SpacetimeDB
Next.js provider-facing routes use JSON and authenticated sessions. Shared-state operations below are logical contracts implemented by SpacetimeDB reducers/views; HTTP wrappers are optional and cannot weaken reducer authorization. JSON, authenticated session, UTC ISO timestamps, random opaque IDs, server-side authorization. All handlers parse strict schemas and reject unknown fields. Errors: {error:{code, message, requestId}} with no private payload echoes. 401 unauthenticated, 403 unauthorized, 404 unavailable resource (avoid existence leaks), 409 stale consent/state, 422 schema invalid, 429 rate limited, 503 provider unavailable.

| Endpoint | Request | Response / behavior |
|---|---|---|
| POST /api/pairs/invites | {} | opaque expiring invite; no contact upload |
| POST /api/pairs/accept | {inviteToken} | accepted pair; both identities verified |
| POST /api/journal/followup | {entry ≤ 8000, asked: string[] ≤ 8} | `{question, distress}` (D056): one short open follow-up question about the writer's own entry, read aloud on the device; `distress` means show support resources instead. Transient Claude call, strict body, Clerk session, 20/min per user, no body logging or persistence; nothing reaches another person or the database |
| POST /api/voice/session | {} | `VoiceSession` (C1): 60 s Cartesia access token with stt+tts grants, model/voice/version settings; never the master key |
| Local vault: saveJournal | {text, localId} | encrypted owner-only IndexedDB entry; no server persistence |
| Local vault: listJournals | local cursor | decrypted only within the unlocked owner session |
| POST /api/reflections | {selectedText, clientRequestId} | `PrivateReflection` (C1): transient Claude processing; private reflection plus nullable enum-only candidate and optional owner-only `assessment` (D040; in memory only, narrows the private decision loop, never persisted or sent) returned to the device; only the reflection text goes to the local vault; no body logging or server persistence |
| Local device: previewDisclosure | candidate + accepted pair + preset/assignment snapshot | exact named-recipient preview; no API call or server-visible candidate; reducer rechecks authoritative state at approval |
| POST /api/signals/approve | {proposedSignal,pairId,payloadRevision,recipientPolicyVersion,presetAssignmentVersion,consentVersion,clientRequestId} | approved signal ID; validate displayed revision, recipient, expiry, membership |
| POST /api/signals/:id/revoke | {} | revoked; cancel queued uses, invalidate derived cached nudges |
| POST /api/coordination/run | {pairId,clientRequestId} | bounded exchange + eligible nudges; authenticated member trigger only |
| GET /api/nudges | cursor | own eligible inbox, revalidate current consent before display |
| POST /api/nudges/:id/feedback | {action:helpful/dismiss/snooze} | own feedback; no automatic personal message |
| GET /api/privacy/receipts | cursor | own disclosure receipts; omit private references |
| Local vault: deleteJournal + revoke signals | {localId,derivedSignalIds} | delete local ciphertext; revoke associated signals via guarded reducer without uploading local journal identifiers |
| DELETE /api/pairs/:id | {} | unlink, invalidate scoped signals, suppress queued use |

Approve, revoke, coordination, and delivery use transactions/version checks so retries cannot resurrect revoked consent. Idempotency keys are scoped to authenticated user and operation. Voice binary transport and exact Cartesia SDK configuration are adapter details; AI published them after the first spike in src/agents/README.md (browser helpers implemented; app wiring and real-browser verification pending). No journal content in URL paths or query parameters.

## Relationship presets and assignments
`set_relationship_preset` takes presetKind (partner/friend/family), allowedCategories, purpose, expectedVersion and expiresAt; the authenticated owner confirms settings, and the reducer increments the preset version atomically. `assign_relationship_preset` takes pairId, recipientId, presetKind and expectedAssignmentVersion; reducer validates owner and accepted relationship. No per-person category overrides. Preset tightening invalidates affected pending work for all assigned connections; reassignment invalidates prior assignment permissions. Each signal approval binds recipient, preset version and assignment version. Direct reducer calls must enforce the same rules. `my_nudges`, `my_receipts` and `my_preset_assignments` are caller-filtered views. Quiz results have no shared endpoint. Strict Zod validation applies at API/worker boundaries and equivalent deterministic guards apply inside reducers.

Core flow clarification: D050/FLOWS.md define default-on in-app nudges for accepted pairs under an assigned current preset, with recipient per-pair opt-out, pause, configured quiet-hours/cooldown and commit-time revalidation. The active UI no longer requires a per-nudge sender approval or D044 standing-consent setup. Legacy `approve_signal` item-consent and D044 reducers remain compatibility paths; the active flow submits a validated enum-only candidate through the normal guarded approval reducer. Reflection processing is separately disclosed.

## Current implementation update and proposed discovery API
Main d7285eb includes guarded `approve_signal`, recipient-owned `set_nudge_delivery`, worker-only `commit_nudge`, `worker_signal_context` and `worker_delivery`, plus real LocalVault. Browser voice helpers also exist. Recipient support-preference storage/version binding, actual app wiring and live proof remain pending; old “pending route/helper” notes are historical.

C8 needs reviewed publish/update/withdraw profile, activate/expire coarse area, publish/revoke event intent, invite/accept/decline and block/report transitions plus caller-filtered discovery views. DISCOVERY.md specifies the proposed boundary, not existing endpoints. Identity comes from the authenticated caller. Publication enables selected profile visibility before acceptance, never arbitrary profile reads. Enforce limits, source versions, expiry and current blocks server-side; return bounded authorized pages, not a global user directory. C7/C8 source schemas and generated types must land before dependent production code.
