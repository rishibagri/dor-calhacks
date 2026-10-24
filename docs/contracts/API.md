# API contract v1
JSON, authenticated session, UTC ISO timestamps, random opaque IDs, server-side authorization. All handlers parse strict schemas and reject unknown fields. Errors: {error:{code, message, requestId}} with no private payload echoes. 401 unauthenticated, 403 unauthorized, 404 unavailable resource (avoid existence leaks), 409 stale consent/state, 422 schema invalid, 429 rate limited, 503 provider unavailable.

| Endpoint | Request | Response / behavior |
|---|---|---|
| POST /api/pairs/invites | {} | opaque expiring invite; no contact upload |
| POST /api/pairs/accept | {inviteToken} | accepted pair; both identities verified |
| POST /api/voice/session | {} | short-lived scoped session or server proxy; never master key |
| POST /api/journals | {text, clientRequestId} | owner-only journal ID; typed/transcribed text |
| GET /api/journals | cursor | owner-only paginated entries |
| POST /api/journals/:id/reflect | {} | private reflection + owner-only candidate |
| POST /api/signals/preview | {candidateId,pairId} | exact fixed-template recipient preview, candidate revision |
| POST /api/signals/approve | {candidateId,pairId,candidateRevision,consentVersion,clientRequestId} | approved signal ID; validate displayed revision, recipient, expiry, membership |
| POST /api/signals/:id/revoke | {} | revoked; cancel queued uses, invalidate derived cached nudges |
| POST /api/coordination/run | {pairId,clientRequestId} | bounded exchange + eligible nudges; demo trigger, authenticated member only |
| GET /api/nudges | cursor | own eligible inbox, revalidate current consent before display |
| POST /api/nudges/:id/feedback | {action:helpful/dismiss/snooze} | own feedback; no automatic personal message |
| GET /api/privacy/receipts | cursor | own disclosure receipts; omit private references |
| DELETE /api/journals/:id | {} | tombstone immediately, revoke derivatives, deletion tracking |
| DELETE /api/pairs/:id | {} | unlink, invalidate scoped signals, suppress queued use |

Approve, revoke, coordination, and delivery use transactions/version checks so retries cannot resurrect revoked consent. Idempotency keys are scoped to authenticated user and operation. Voice binary transport and exact Cartesia SDK configuration are adapter details; AI publishes them after the first spike. No journal content in URL paths or query parameters.
