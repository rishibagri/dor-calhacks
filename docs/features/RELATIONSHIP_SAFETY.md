# Relationship-safe nudges

User requirement: dor must not expose a private activity or imply a hidden story through a seemingly harmless question. Synthetic acceptance case: someone declines an invitation saying they are sick, then attends a party. A private reflection about this must never produce “ask about Friday night” for the friend.

## Existing enforceable boundary

- Relationship coordination accepts only explicitly approved support/availability fields for a named recipient. Raw stories, reasons, event details and suggested questions are rejected by the strict approved-signal schema.
- The model selects from permitted options. It does not author recipient-facing copy. Extra free text in its reply is rejected; recipient copy comes from the fixed contract templates.
- Journal/reflection content stays out of recipient prompts and shared state. The reflection candidate is private until separately approved. The composed journal offers an explicit candidate-to-preview action; the owner must separately approve the named-recipient disclosure. No automatic sharing is permitted.
- Consent, revocation, membership and delivery checks remain authoritative. An uncertain permission means no delivery.

## Required product behavior for future integration

1. Preview the exact recipient-facing invitation and recipient before approval, explaining that even generic outreach can imply a desire for support. Quiz answers and reflection requests never authorize this.
2. Do not derive outreach timing, audience or follow-up topics directly from private journal activity. Use the approved signal and explicit delivery settings only.
3. Do not infer deception, compare friends' private accounts, reveal attendance, or send “ask about…” prompts based on hidden events. The purpose is connection, not truth policing.
4. Public discovery is a separate disclosure: show the audience clearly before publishing event interests. A public event intention can itself reveal plans; private journaling cannot make an already-public post confidential.
5. Provide clear decline, pause and revoke controls. A recipient-specific pause beyond existing pair unlink/delivery controls requires a reviewed contract/UI addition; it is not implemented by this PR.
6. If a safe suggestion cannot be justified entirely by current approved inputs, send nothing. Suppression reasons must not reveal the private story either.

Regression coverage: src/lib/backend/__tests__/relationship-safety.test.ts exercises the sick/party case at the approved-signal and model-output boundaries. It is offline evidence, not a guarantee that all social inference or conflict is impossible. Timing noninterference and deployed two-account behavior still need verification.
