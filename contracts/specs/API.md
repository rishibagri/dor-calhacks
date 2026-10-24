# API contract v2 — local vault and SpacetimeDB
Next.js provider-facing routes use JSON and authenticated sessions. Shared-state operations below are logical contracts implemented by SpacetimeDB reducers/views; HTTP wrappers are optional and cannot weaken reducer authorization. JSON, authenticated session, UTC ISO timestamps, random opaque IDs, server-side authorization. All handlers parse strict schemas and reject unknown fields. Errors: {error:{code, message, requestId}} with no private payload echoes. 401 unauthenticated, 403 unauthorized, 404 unavailable resource (avoid existence leaks), 409 stale consent/state, 422 schema invalid, 429 rate limited, 503 provider unavailable.

| Endpoint | Request | Response / behavior |
|---|---|---|
| POST /api/pairs/invites | {} | opaque expiring invite; no contact upload |
| POST /api/pairs/accept | {inviteToken} | accepted pair; both identities verified |
| POST /api/voice/session | {} | short-lived scoped session or server proxy; never master key |
| Local vault: saveJournal | {text, localId} | encrypted owner-only IndexedDB entry; no server persistence |
| Local vault: listJournals | local cursor | decrypted only within the unlocked owner session |
| POST /api/reflections | {selectedText, clientRequestId} | transient Claude processing; private reflection/candidate returned to local vault; no body logging or server persistence |
| POST /api/signals/preview | {proposedSignal,pairId,recipientPolicyVersion,presetAssignmentVersion} | exact fixed-template recipient preview, canonical payload revision; no raw local candidate draft |
| POST /api/signals/approve | {proposedSignal,pairId,payloadRevision,recipientPolicyVersion,presetAssignmentVersion,consentVersion,clientRequestId} | approved signal ID; validate displayed revision, recipient, expiry, membership |
| POST /api/signals/:id/revoke | {} | revoked; cancel queued uses, invalidate derived cached nudges |
| POST /api/coordination/run | {pairId,clientRequestId} | bounded exchange + eligible nudges; authenticated member trigger only |
| GET /api/nudges | cursor | own eligible inbox, revalidate current consent before display |
| POST /api/nudges/:id/feedback | {action:helpful/dismiss/snooze} | own feedback; no automatic personal message |
| GET /api/privacy/receipts | cursor | own disclosure receipts; omit private references |
| Local vault: deleteJournal + revoke signals | {localId,derivedSignalIds} | delete local ciphertext; revoke associated signals via guarded reducer without uploading local journal identifiers |
| DELETE /api/pairs/:id | {} | unlink, invalidate scoped signals, suppress queued use |

Approve, revoke, coordination, and delivery use transactions/version checks so retries cannot resurrect revoked consent. Idempotency keys are scoped to authenticated user and operation. Voice binary transport and exact Cartesia SDK configuration are adapter details; AI publishes them after the first spike. No journal content in URL paths or query parameters.

## Relationship presets and assignments
`set_relationship_preset` takes presetKind (partner/friend/family), allowedCategories, purpose, expectedVersion and expiresAt; the authenticated owner confirms settings, and the reducer increments the preset version atomically. `assign_relationship_preset` takes pairId, recipientId, presetKind and expectedAssignmentVersion; reducer validates owner and accepted relationship. No per-person category overrides. Preset tightening invalidates affected pending work for all assigned connections; reassignment invalidates prior assignment permissions. Each signal approval binds recipient, preset version and assignment version. Direct reducer calls must enforce the same rules. `my_nudges`, `my_receipts` and `my_preset_assignments` are caller-filtered views. Quiz results have no shared endpoint. Strict Zod validation applies at API/worker boundaries and equivalent deterministic guards apply inside reducers.
