# src/agents — `@kinetic/agents`

AI-owned provider adapters and the bounded coordinator. Wire types come from `@kinetic/contracts`; this package adds implementations, not new wire shapes. Synthetic doubles are exported only from `@kinetic/agents/testing` and must never run in live mode.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation.

## Published interfaces

| Export | Implements | Consumer | Status |
|---|---|---|---|
| `ClaudeReflectionAdapter` | C1 `PrivateReflectionPort` → `PrivateReflection` | CS `POST /api/reflections` | Implemented, offline-tested. **Not live-verified** (no `ANTHROPIC_API_KEY`). |
| `CartesiaVoiceAdapter` | C1 `VoicePort` (`createSession`, `transcribe`, `synthesize`) | CS `POST /api/voice/session` (+ optional clip proxy) | Implemented, offline-tested. **Not live-verified** (no `CARTESIA_API_KEY`). |
| `BoundedCoordinator` | C4 `CoordinationPort` | `worker/` | Implemented, offline-tested; live with Factory Droid using offline policy stand-ins. |
| `eligibleOptions`, `intersectWindow` | Deterministic C4 intersection | DS ranking, evaluation | Implemented. |
| `ProviderError`, `httpStatusFor` | Sanitized error codes → API error envelope | CS routes | Implemented. |
| `PROVIDER_PROCESSING` | Facts for provider-processing notices | CS copy, Cyber review | Retention is **unverified** for both providers. |

### Reflection (`POST /api/reflections`)
`new ClaudeReflectionAdapter().reflect(selectedText, clientRequestId)` returns `{ schemaVersion: 1, reflection, candidate }`. `candidate` is `null` or `{ supportMode?, availability? }` with contract enums only. Store the whole result in the owner's local vault. It is a draft: the UI builds the named-recipient preview from it, and nothing is shared without the guarded approval flow.

- Model `claude-opus-5-5` (override `KINETIC_CLAUDE_MODEL`), effort `low`, structured output, server-side `fallbacks: "default"` (a declined request is retried on another Claude model, so it stays with Anthropic), 8 s timeout, 1 retry, SDK logging off.
- Sends only the selected text and a fixed system prompt: no user, pair or request identifiers.
- Journal text is treated as data. Injection attempts cannot widen the output, because the candidate is enum-only and checked against the strict contract schema.
- If the text suggests self-harm, the reflection points to emergency or crisis support (988 in the US) and the candidate is forced to `null`. **Team decision needed:** confirm this behavior and its copy.
- Errors: `ProviderError` codes `not_configured | invalid_input | auth_failed | rate_limited | timeout | unavailable | refused | invalid_output`. Map them with `httpStatusFor`. Messages never include provider bodies or input.

### Voice (`POST /api/voice/session`)
`new CartesiaVoiceAdapter().createSession(requestId)` mints a 60-second Cartesia access token with `stt` and `tts` grants and returns `VoiceSession` (C1). The master key never leaves the server. The browser connects with `access_token` and `cartesia_version=apiVersion` as WebSocket query parameters. Streaming STT uses `ink-2` with PCM s16le at 16 kHz; TTS uses `sonic-3.6`.

- `transcribe(audio)`: batch `/stt` with `ink-whisper` for an uploaded clip (wav/webm/ogg/mp3/flac/m4a, ≤ 10 MiB; anything else is rejected before upload).
- `synthesize(text)`: `/tts/bytes`, WAV PCM s16le 24 kHz, `save: false`, ≤ 1000 chars.
- Pinned SDK `@cartesia/cartesia-js@4.2.0` sends `Cartesia-Version: 2026-08-14`.
- **Not built yet:** browser microphone capture and the streaming STT/TTS WebSocket client (hour 7 milestone).

### Coordination
`new BoundedCoordinator({ policy, preferences, delivery, proposer, clock, rank?, fallbackOnProposerFailure? })` implements FLOWS.md F5–F6 using the contracts functions `nudgeDelivery` and `templateForSignal`:
1. `policy.check` every envelope. A throw or a non-`true` result denies.
2. Delivery gate (`delivery.current` → `nudgeDelivery`): the recipient must have opted in for this pair (D017, default off), plus quiet hours and the 24 h cooldown (D018). A throw counts as `not_opted_in`.
3. Load the recipient's `RecipientSupportPreferences`. Wrong pair or recipient, revoked, or expired → `preferences_unavailable`.
4. Deterministic intersection (`eligibleOptions`). No overlap, or an availability-only signal (it has no template) → decline ACK, `no_intersection`, zero model calls.
5. At most 2 proposer rounds. The proposer sees `{ approved: {supportMode?, availability?}, options, round }` only. Output must match `AckProposalSchema` and index an existing option.
6. If both rounds fail: the top-ranked option (`fixed_template`), or no suggestion when `fallbackOnProposerFailure: false`.
7. Recheck policy, the delivery gate and the recipient consent version before returning. Changes during generation suppress the nudge.
8. Return a schema-checked `AgentAck` and a `Nudge` whose template comes from `templateForSignal`, with a request-stable `nudge_…` ID, plus a sanitized `CoordinationOutcome`. Nothing is committed here.

Availability intersection: `no_preference` defers to the other side, equal windows match, and `today` ∩ `this_week` = `today`. Availability is matched only when the recipient consented to share it; otherwise the ACK omits it. The DS `rank` hook may reorder or drop options; anything it adds is ignored.

## Fixtures (synthetic)
- `fixtures/reflection.synthetic.json`: six C1 cases (three relationships, wants-space, injection, crisis language). Outputs are hand-written examples, not recorded model output.
- `fixtures/voice.synthetic.json`: `VoiceSession`, transcribe and synthesize shapes, plus the live round-trip phrase.
- `fixtures/coordination.synthetic.json`: recipient preferences for all three scenarios and thirteen expected C4 outcomes, including opt-in, quiet hours and availability-only.

## Commands
```sh
npm run ai:check   # build contracts + agents + worker, run offline tests (no network)
npm run live -w @kinetic/agents   # live Claude/Cartesia checks; SKIPPED_MISSING_CREDENTIAL without keys
```
Live checks read `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` from the environment or the repo-root `.env.local`. They print statuses, latencies and candidate enums, never keys or tokens.
