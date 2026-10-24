# `src/features/voice` — journal voice and private reflection (AI, Adam)

Drop-in feature used by `src/app/journal/page.tsx`. Typed entry always works. Voice (Cartesia) and reflection (Claude) go through the authenticated routes `/api/voice/session` and `/api/reflections`.

| Export | What it does |
|---|---|
| `<VoiceReflection vault reflect? getVoiceSession? onCandidate? />` | Record/stop/correct dictation with a typed fallback; reflect on the selection or the whole entry; read aloud. Persists the entry and the **reflection text only** in the local vault. |
| `onCandidate(candidate, entryLocalId, assessment?)` | Fires from "Review what to share". Passes the enum-only candidate and Claude's owner-only private **assessment** (D040), both in memory only. The button is hidden when the assessment says `wants_space` or cannot be used safely (`suggestsNothing`). |
| `initialLoopState`, `assessedRecipients`, `leftOutByAssessment`, `nameMatches`, `suggestsNothing` (`assessment.ts`) | Pure helpers CS's `DecisionLoop` applies before `decide()`. They narrow only: stop, skip the company question, leave named people out (ambiguous → all matches), order preferred people first. They never choose a person. |
| `splitReflection` (`model.ts`) | `{ persist: { reflection }, memoryOnly: candidate, assessment }`. Only `persist` may reach the vault. |

**Rules:**
- No assessment, valid or not, can reach a share preview without the owner choosing the person (`__tests__/assessment.test.ts`, invariant test).
- Never log, persist or send the candidate, the assessment or any name from it.

**Spec:** [docs/features/PRIVATE_ASSESSMENT.md](../../../docs/features/PRIVATE_ASSESSMENT.md). **Loop:** [docs/features/PRIVATE_DECISION_LOOP.md](../../../docs/features/PRIVATE_DECISION_LOOP.md). **Durable pause (Cyber):** [docs/features/RECIPIENT_PAUSE.md](../../../docs/features/RECIPIENT_PAUSE.md).

**Status:** offline unit tests and app build only. Live Claude, Cartesia and browser-microphone checks are pending (Core 3).
