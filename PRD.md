# dor — human connection, with AI doing the preparation

## Product promise
Help people start and sustain human connections. dor supports existing partners, friends and family, people new to a neighborhood/campus, and people seeking company at a local event. AI helps find a useful person, reason and moment; people decide whether to connect.

This expands the original distance-focused product without discarding it. Private journaling is optional for discovery. The thesis is worth testing: reducing coordination effort and uncertainty could produce more real conversations and shared plans. Do not present demand, loneliness reduction or retention as proven.

## Three committed experiences
1. **Existing connections:** skippable 6–8-question quiz; editable local preferences; typed/Cartesia voice reflection with disclosed Claude processing; local encrypted history; literal-name resolution to an accepted partner/friend/family pair; private conflict/distress screening; automatic bounded two-agent decision; recipient default-on in-app nudge under the current preset, with per-pair opt-out, pause, revoke/unlink, quiet-hours/cooldown and minimized receipts. Preserve all three relationship examples.
2. **Nearby introductions:** user grants one-time approximate location and separately publishes selected profile fields. Coarsen a location sample on device and discard precise coordinates. Match only opted-in dor profiles in a permitted area, using explicit interests and approved broad availability. Show opted-in public profiles before invite acceptance, as the user requested. Private journals/quiz labels/routine histories never become discovery fields automatically.
3. **Same-event connections:** collect a public local event catalogue via Apify; users separately choose to publish an interested/going intention for an event. Find people with compatible explicit intentions and suggest an introduction or shared plan. “Going” is self-declared, not verified attendance. Both people independently accept the same current proposal revision; no auto-RSVP, booking, personal message or purchase.

## First-session experience
Sign in → optionally take quiz → choose existing connections or Discover → see and confirm exactly what a public profile will show → one-time approximate area → useful nearby people or local events → choose an invitation/plan. An empty neighborhood still offers real public events; do not invent nearby people. Returning users see a small set of relevant suggestions, not an endless feed or pressure to journal.

## Consent is specific to the experience
Existing pair support uses the assigned C2/C3 relationship preset; standard in-app nudges are on for accepted pairs unless the recipient opts out. Quiz answers never authorize broader disclosure. Public discovery uses a separate proposed C8 publication consent with fields, audience, purpose, version and expiry. A published profile may be seen by eligible signed-in discoverers before mutual acceptance. Direct interaction still requires recipient acceptance. An accepted introduction does not automatically enable journal-based support or assign a relationship preset.

One-time location does not imply continuous presence. Do not reveal exact coordinates, distances, home/work addresses, movement trails or habitual venues. A deliberately selected public venue preference may later be supported as an explicit C8 field; automatic claims that two people regularly visit the same place are out of scope. See [local connection requirements](docs/features/LOCAL_CONNECTIONS.md).

## Scope and success
Aim to ship all three experiences with one local event source, one configured launch region, real consent enforcement and a polished usable interface. Defer generalized groups, calendar OAuth, multiple scrapers, inferred routines, unrestricted agent chat and native apps. The 36-hour deadline does not restart. README R0–R6 and the four role guides allocate the remaining work.

Success is a useful introduction, accepted invitation or agreed shared plan, plus optional user-reported completion. Track first useful suggestion, no-fit rate and false/unsafe suggestions. Do not optimize for bot conversation length, private disclosures collected, or compulsive notifications. Use synthetic fixtures and small honest user tests; no unsupported compatibility scores.

## Release acceptance
Two actual accounts and a denied third account complete (a) private reflection → unique pair resolution → conflict/distress screening → two-agent decision → nudge or no action, (b) opt-in public profile → nearby introduction, and (c) same-event intention → mutually accepted plan. Wrong audience, withdrawn profile, stale preset, recipient opt-out, paused/unlinked pair, blocked user and expired source cannot yield a new visible result. A serious-distress phrase immediately presents a support resource card and never contacts a connection. A real browser verifies vault lock/recovery/account isolation. Provider and deployment evidence are recorded separately from offline tests.

The app is not yet proven end-to-end. Runtime C7/C8 schemas and transitions remain review-gated. Local encrypted storage is not cloud-free processing, and publication/withdrawal cannot erase information already seen. Keep private audio/text out of shared state and peer prompts; disclose actual provider processing and avoid unverified retention claims.
