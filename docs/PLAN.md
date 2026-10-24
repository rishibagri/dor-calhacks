# 36-hour execution plan
T+0 is the team's agreed start. Planning occupies exactly the first 30 minutes. Checkpoints are integration gates; implementation continues throughout. Rotate brief rest breaks rather than assuming 144 fully productive person-hours.

| Window | CS: app/integration | DS: context/evaluation/demo | Cyber: privacy/security | AI: voice/private agents | Exit evidence |
|---|---|---|---|---|---|
| 0:00–0:10 | Agree single journey and stack | Select three stories | Define disclosure boundary | Confirm voice/provider route | Shared product decision |
| 0:10–0:20 | Read API/types | Define fixtures and scoring | Approve policy contract | Approve agent envelope | Freeze v1 contracts |
| 0:20–0:30 | Claim files, boot shell | Seed fixtures | Threat sketch | Voice spike setup | All four coding at minute 30 |
| 0:30–3 | Auth, two-user pair, app shell, API stubs, preview deployment | Three scenario fixtures and 30-case evaluation set | Ownership model, deny-by-default validator, secret handling | Cartesia connection, mic → transcript → spoken reply spike | Live provider feasibility; shared stub-driven app |
| 3–7 | Journal UI, private storage, invite acceptance, review screen | Matching/ranking module; quiet-hour/cooldown fixtures | Consent state machine, exact preview, server enforcement | Owner reflection, coarse candidate extraction, structured output | First live voice → private journal → approval path |
| 7–12 | Wire actual pair, inbox, status states, deploy | Compatibility/availability scoring; useful/irrelevant examples | Cross-user isolation, injection and revoked-consent tests | Bounded two-agent exchange with timeout/retry | Real two-user journey on deployment by hour 12 |
| 12–17 | Polished interactions, history, error recovery | Three full seeded journeys, baseline comparison, nudge feedback | Privacy center, unlink/delete, sanitized audit receipts | Nudge wording from safe enums, no raw context in shared prompts | All three scenarios; private facts blocked |
| 17–22 | Accessibility, mobile sizing, integration fixes | Evaluate 30 cases; capture rough cut footage | Revocation race, pair reassignment, log leak review | Latency tuning, interruptions, typed fallback, model failure | Core acceptance; scope lock for stretch |
| 22–27 | Approved stretch + visual polish | Begin film edit, captions, scenario inserts | Regression and boundary review | Approved stretch + demo voice support | Release candidate; complete footage by hour 27 |
| 27–31 | Fix blockers, production smoke checks | Finish first full film, team review, final edit | Final privacy verification and honest claims | Live demo rehearsal and recovery path | Finished film by hour 31 |
| 31–34 | Feature freeze, deploy stable revision, seed/reset | Exports, submission text, backup recording | Verify no secrets/personal data in artifacts | Rehearse judge questions and timing | Submission ready at hour 34 |
| 34–36 | Buffer for deployment/submission failures | Upload/export verification and pitch practice | Final release smoke test | Live demo support | Submitted, playable offline backup |

## Gates and recovery
- Hour 3: if live voice is blocked, AI timeboxes another 60 minutes while CS integrates the typed adapter. Keep Cartesia as the intended voice path; label fallback honestly.
- Hour 7: if real authentication/storage is blocked, CS resolves it before polish; do not substitute cross-user-unisolated storage.
- Hour 12: if the live path is incomplete, all work focuses on integration. Retain three scenarios, consent, and privacy checks; cut stretch.
- Hour 22: zero known cross-user leaks, all fixed privacy cases pass, core story works. Failing the privacy gate blocks real-user mode; use clearly labeled synthetic fixtures only.
- Hour 27: freeze film capture build. Recordings are real application behavior; staged fixture data is labeled. Later fixes require recapture only if visible behavior changes.
- Hour 31: finished video, not a storyboard. Re-export and test local playback plus submission upload.

## Cadence and dependencies
Each role gives a 2-minute handoff every 3 hours; no extended planning meetings. CS supplies stubs by hour 3 so UI, AI, policy, and ranking advance independently. Cyber supplies validator signature by hour 3. AI supplies safe candidate fixtures by hour 3. DS supplies three seeds by hour 3. Contract changes require affected-role ACK and fixture update in the same PR. CS merges compatible PRs every 2–3 hours; Cyber reviews boundary changes, AI reviews model/schema changes, DS checks scenario quality. Every role owns implementation, tests, and documentation for its surface.
