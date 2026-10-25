# Live notebook (D056)

The notebook in the live room (`src/components/live`, built from the Claude Design room by `scripts/build-live-ui.mjs`). It's a private journal you can talk to. Nothing in it is stored, and nothing reaches another person unless you tap **Send** and dor's Reasoning then decides a note fits (D054).

## How it works

| Control | What happens | Provider calls |
|---|---|---|
| **Mic, first tap** | Starts Cartesia dictation. Your words appear on the right page as you speak. | Cartesia STT (60 s scoped token) |
| **Mic, second tap** | Stops and transcribes. Nothing is sent anywhere. | none |
| **or write instead** / tap your words | Type or correct the entry; **Done** returns to the same choice. | none |
| **Keep talking** | dor asks one short, open question about what you said, reads it aloud, and writes it in blue between your words. The mic then says "Tap to answer". | 1 Claude call (`/api/journal/followup`), 1 Cartesia TTS |
| **Send** | Private reflection, then Reasoning: act, ask, defer or do nothing (D054). Only your own words are sent, never dor's questions. | 1 Claude reflection + 1 Claude reasoning call |
| **Start over** | Clears your words, dor's questions, any pending suggestion or reassessment, and a recording in progress. | none |
| **Just for me** | Keep talking and Send make no Claude call at all. | none |

Safety: an entry that matches the local distress check, or a follow-up the model marks `distress`, shows the U.S. 988 card instead of a question and contacts no one.

The right page scrolls (newest words in view) instead of running past the book. Long entries never leave the page.

## Privacy
- dor's questions are kept in memory only, with their position in your text, and are cleared on Send, Start over, sign-out or reload.
- `/api/journal/followup` receives your entry and the questions already asked. It doesn't log or store them; its logs are metadata only (model, duration, token counts).
- Read-aloud audio plays on your device through an audio context unlocked by your tap. Cartesia gets a 60-second scoped token, never the master key, and `save: false`.

## Files
- `src/app/api/journal/followup/route.ts`: the follow-up question route (Clerk session, 20/min per user, strict body, Opus 5.5 low effort, structured output, server-side refusal fallback).
- `src/components/live/bridge.ts`: mic, Send, Keep talking, Start over, the interleaved words and auto-scroll.
- `src/components/live/live-room.tsx`: dictation, audio unlock and `say()` (Cartesia read-aloud) for the bridge.
- `scripts/build-live-ui.mjs` §5: the scrolling page, blue question words, Start over, Keep talking and Send in the design's own style.

## Evidence (2026-10-25)
- Live app as a signed-in account, headless Chrome at phone size: a typed entry about 8× the page height stays inside the scrolling page with the newest line in view. Keep talking returned a question in 3.7 s (877 input / 39 output tokens), shown in blue with "Tap to answer". Start over cleared everything.
- Not yet checked: real speech on a phone (record, stop, answer) and hearing the read-aloud on iOS.
