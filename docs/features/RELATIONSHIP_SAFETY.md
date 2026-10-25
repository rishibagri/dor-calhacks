# Relationship-safe nudges

User requirement: dor must not expose a private activity or imply a hidden story through a seemingly harmless question. Synthetic acceptance case: someone declines an invitation saying they are sick, then attends a party. A private reflection about this must never produce “ask about Friday night” for the friend.

## Existing enforceable boundary

- Relationship coordination accepts only allowlisted support/availability fields for one resolved accepted pair under its current relationship preset. Raw stories, reasons, event details and suggested questions are rejected by the strict approved-signal schema.
- The model selects from permitted options. It does not author recipient-facing copy. Extra free text in its reply is rejected; recipient copy comes from the fixed contract templates.
- Journal/reflection content, names and risk assessments stay out of recipient prompts and shared state. An enum-only candidate can enter the automatic D050 flow after unique pair resolution and private risk screening; no per-nudge sender approval is required. This does not share journal content.
- A pair preset, membership, revocation, recipient opt-out, pause, quiet hours and cooldown remain authoritative. Unclear recipient identity, missing/stale policy, interpersonal-conflict risk or serious-distress risk means no relationship nudge.

## Required product behavior for future integration

1. Resolve one accepted recipient deterministically from a literal mention; ask the owner only when identity is ambiguous. A private reflection alone never broadens the pair preset or fields the system can share.
2. Do not derive outreach timing, audience or follow-up topics directly from private journal activity. Use the approved signal and explicit delivery settings only.
3. Do not infer deception, compare friends' private accounts, reveal attendance, or send “ask about…” prompts based on hidden events. The purpose is connection, not truth policing.
4. Public discovery is a separate disclosure: show the audience clearly before publishing event interests. A public event intention can itself reveal plans; private journaling cannot make an already-public post confidential.
5. Provide clear recipient opt-out, owner pause and revoke controls. Opt-out is per connection; absence of a customization row uses the standard default-on state.
6. If a safe suggestion cannot be justified entirely by current approved inputs, send nothing. Suppression reasons must not reveal the private story either.

Regression coverage: src/lib/backend/__tests__/relationship-safety.test.ts exercises the sick/party case at the approved-signal and model-output boundaries. It is offline evidence, not a guarantee that all social inference or conflict is impossible. Timing noninterference and deployed two-account behavior still need verification.
