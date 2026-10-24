# Product and ambitious scope
## Promise
Help people show up for each other without requiring them to share every private detail. Distance creates missing context; Kinetic proposes small, timely acts of care.

## Committed 36-hour experience
- Skippable 6–8-question onboarding personalizes communication, support, social bandwidth and draft sharing preferences; editable owner-only connection profile.
- Owner-confirmed partner/friend/family sharing presets, explicit assignment to each connection, and named-recipient disclosure previews. No individual category overrides or quiz-based automatic consent.
- Responsive, polished web app: pair onboarding, two authenticated accounts, invite acceptance, journal, consent review, nudges, settings.
- Live voice reflection through a Cartesia adapter, visible recording state, interruption/stop, transcript correction, and typed fallback.
- Encrypted local IndexedDB/Web Crypto journal history and useful reflection via disclosed transient Claude processing. Raw audio defaults to transient processing; persistent recording requires separate explicit consent.
- A private agent proposes a coarse sharing signal; the owner previews its exact recipient-visible meaning and approves or declines it. No signal is shared by default.
- Two agents coordinate through structured, bounded signal exchange. Sender agent proposes; policy service validates; recipient agent ACKs compatible support modes and availability from its own approved preferences; coordinator proposes a nudge. Maximum two exchange rounds, no unrestricted agent chat.
- Nudge inbox with rationale limited to approved context, dismiss/snooze/helpful feedback, quiet hours, cooldown, and one action the person can choose.
- Privacy center: approved signals, recipient, expiry, revoke/unlink, journal deletion, and a sanitized receipt of what crossed the boundary.
- Three complete seeded experiences: partners, friends, family. Same product, different relationship context.
- Deployed application with reproducible seed/reset and documented recovery behavior.
- CS-owned Apify discovery from one public activity source, with normalized source-backed cards, freshness and failure fallback.
- Consent-reviewed activity matching and proposal acceptance by both participants. This requires new activity/proposal contracts and current approval checks; existing C3 fields are not sufficient authorization.

## Stretch after core acceptance at hour 22
Opt-in recurring ritual suggestion, time-zone-aware scheduling, accessible playback, richer longitudinal owner-only reflection. Choose at most two. Do not add native apps, calendar OAuth, SMS, contact import, group relationships, or unlimited agent negotiation during this sprint.

## Privacy truth
A nudge can itself reveal that someone may want support. Even coarse signals can invite inference. Show this clearly at approval; allow no sharing, generic suggestions, or exact bounded sharing. The journal is private from the other person, not necessarily from the processing providers. State which providers process audio/text and verify their actual retention options before making claims.

## Core acceptance
Two real accounts, a live journal, explicitly approved signal, bounded agent exchange, an actionable nudge, and revocation that prevents subsequent use. The other account cannot retrieve journal text, audio, identifiers, embeddings, private reasoning, or unapproved facts. All three relationship instances have synthetic end-to-end verification scenarios.

## Team and execution
CS (you): app/integration/Apify. Nimisha: DS/quiz/matching/evaluation. Adam: AI/voice/providers/worker. Sumedh: Cyber/vault/authorization. Detailed P0–P9 phases and acceptance gates live in README.md and docs/roles/*.md; dependency artifacts/consumers live in docs/PLAN.md. Preserve already-started branch work.
