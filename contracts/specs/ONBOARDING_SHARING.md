# Onboarding and relationship-preset sharing contract v1
Confirmed: a skippable 6–8-question account-onboarding quiz personalizes communication style, support preferences, social bandwidth and suggested sharing preferences. Sharing uses relationship presets only, with explicit disclosure confirmation. The proposed question wording and visual styling below remain editable.

## Experience proposal
Skippable eight-question “How do you connect?” onboarding with one question per screen, progress, back/edit, and an owner-only illustrated connection profile. Results describe chosen preferences, not a diagnosis or scientific personality classification. Never rank relationships or label someone needy, avoidant, compatible/incompatible, or emotionally unsafe from a short quiz.

Proposed eight scenario questions:
1. After a long day, what helps: a short call, a kind note, shared activity, or space?
2. When you have gone quiet for a while, what would you like from a friend: a light check-in, an invitation, or time? (D027; app copy alignment is CS work.)
3. What communication tone and rhythm feel right: direct/gentle/playful, and spontaneous/planned/flexible?
4. When overwhelmed, should suggestions be fewer, quieter, or paused?
5. Which activities make connecting easy: talking, games, watching together, creating, or other? Keep free text local.
6. How should the app approach schedule suggestions: only after review, or keep them private?
7. Which categories would you consider sharing: support preference, coarse availability, neither? This nominates draft settings only.
8. Before connecting someone, how much review feels comfortable? Initial release still asks for each disclosure; no quiz answer grants automatic sharing.

The result can show an editable “connection style” card and suggested support modes. Quiz labels and raw answers stay in the local vault. Declining/omitting any answer must not enable sharing. Quiz personalization never authorizes provider processing beyond the separate provider notice/choice.

## Relationship presets and named recipients
Configure three owner-confirmed presets: partner, friend, and family. Each preset controls category, purpose, allowed detail and expiry; no per-person category overrides in this release. The owner explicitly assigns a preset to a named accepted connection. Show each connection's preset and effective sharing rules in a read-only recipient matrix. Never infer relationship type from conversations or let another person assign their own access. A new preset has all categories blocked until the owner confirms its settings; assigning one still does not share an item automatically.
Initial supported categories: support preference and coarse availability, matching the existing ApprovedSignal payload. Future bandwidth, event interest and shared activity-interest fields require versioned contracts and explicit consent before any export. Mood, precise calendars, raw journal details and quiz labels are blocked. Suggested preset configurations: partner can include both supported categories, friend support preference only, family neither until selected. The owner must confirm each preset configuration. These are suggestions, not enabled defaults. Assign the confirmed preset to each named connection; the same preset has the same category rules for every connection assigned to it.

Policy permission is a ceiling, not a disclosure: an allowed category still requires exact per-item approval under the existing consent contract. Effective disclosure = accepted relationship ∩ explicit assigned preset policy ∩ item approval ∩ allowed purpose ∩ unexpired/unrevoked consent. Default deny and intersect rules; never union permissions from multiple relationships.

## Required product surfaces
- Owner-only quiz and editable connection profile.
- Read-only recipient matrix: “Alex → Partner preset → support + availability, ask each time; Sam → Friend preset → support only, ask each time.” Editing happens at preset level, not per person.
- Exact preview: “Alex may see that you welcome a short call this week.” A support-only preview omits timing entirely. No source journal explanation.
- Receipt showing precisely which approved fields were used, for whom, and when they expire.
- Edit preset/reassign/revoke/unlink: tightening a preset increments its version and invalidates affected pending signals/nudges for every assigned connection. Reassignment increments the connection assignment version and invalidates old pending permissions. Broadening a preset never retroactively shares old data. Show the affected connection count before confirming a preset edit.

## Example
Private journal: “I am anxious about an exam.” Proposed signal: short_call + this_week. Alex is assigned the confirmed Partner preset permitting both categories; the owner can approve Alex's exact preview. Sam is assigned the confirmed Friend preset permitting support only: construct a new preview without availability and ask separately, ApprovedSignal v2 permits omission of blocked fields but requires at least one allowed category. Never silently remove fields from an already approved envelope or substitute no_preference to bypass a blocked category. No one receives the exam reason.

## Acceptance checks
Quiz completion/skip never emits a shared signal. Changing a quiz answer never changes live access automatically. Same private input produces distinct allowed previews or no signal for different recipients. New recipients get no inherited access. Wrong recipient/preset version/assignment version/category is rejected directly at the reducer. Revocation removes pending use and recipient-visible cached state where feasible. Group recipients cannot reuse pair permissions. UI labels and aura cannot leak an unapproved inference.

## Skip and change behavior
Skip goes directly to the application with no inferred personality profile and all sharing blocked until explicit preset confirmation. Users can retake/edit the quiz. Quiz changes only suggest draft settings; confirmed presets remain unchanged until the owner reviews and confirms the edits. Disconnecting a person revokes only that connection; changing a preset affects all assigned connections.

## Discovery onboarding is a separate opt-in
After or without the quiz, users can enter Discover. They preview the exact public profile fields, choose publication, and authorize one-time approximate location separately. Raw quiz responses/labels stay local; they may pre-fill an editable local draft but never publish automatically. A public profile can be shown before an invitation is accepted, per user choice. Do not create a relationship preset assignment until the person explicitly chooses it for an accepted relationship. New event-intent publication also needs its own explicit preview. C8 runtime shapes/guards remain proposed.
