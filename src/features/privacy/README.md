# src/features/privacy — privacy controls component (Cyber)

Status: vault controls **implemented and offline-verified over the real `LocalVault`**; introduction controls (CYBER-R2) and event privacy controls (CYBER-R3) **implemented, model-tested only, not composed into a page or seen in a real browser.**

| File | What it is |
|---|---|
| `vault-controller.ts` | UI-free state machine for create, show the recovery code once, unlock, recover, change passphrase, lock and delete. Tested with `node --test` against `LocalVault` + `IndexedDbVaultStore` (fake-indexeddb). |
| `vault-controls.tsx` | Thin `'use client'` shadcn view: `<VaultControls vault={vault} />`. |
| `__tests__/vault-controller.test.ts` | 10 tests: validation, show-once code, constant error copy, backoff, recovery rotation, passphrase change, typed delete, vault-initiated lock, StrictMode re-mount. |
| `introduction-model.ts` | CYBER-R2: groups `my_introductions` rows, report reason labels (same allowlist as the server), fixed copy for refusals (server text is never shown). |
| `introduction-controls.tsx` | `<IntroductionControls introductions={rows} discoverable={bool} actions={port} />`: accept / decline / block / report on incoming requests, cancel outgoing, block/report connections, "stop being discoverable now". |
| `event-consent-model.ts` | CYBER-R3: exact preview copy for event intents, C7 activity approvals and plan acceptance; truthful source age; plan status copy; fixed refusal copy. |
| `event-privacy-controls.tsx` | `<EventPrivacyControls intents approvals eventTitle pairName actions />`: every shared event intent and activity approval with an immediate withdraw/revoke. |
| `__tests__/event-consent-model.test.ts` | 6 tests: copy states audience, privacy of kind, duration, no external action; no live-feed claim; no decision leak. |
| `__tests__/introduction-model.test.ts` | 5 tests: grouping, fixed copy, no decline wording, reasons match the server, `runAction` never throws. |

## CS: how to compose it
```tsx
// Per signed-in account (call vault.lock() on identity change / sign-out):
const vault = useMemo(() => new LocalVault({
  store: new IndexedDbVaultStore(indexedDB, 'dor-vault:' + sha256Hex(clerkUserId)),
}), [clerkUserId]);
<VaultControls vault={vault} />
```
- Pass the **same** `LocalVault` instance the journal and quiz pages use, so a lock anywhere is reflected everywhere. The controller follows vault-initiated locks (idle, pagehide).
- Put it on a page with no third-party scripts, analytics or session replay (src/vault/DESIGN.md "Browser hardening").
- Don't wrap the inputs in controlled state. Secrets are read from the form on submit, then the form is reset.

## CS: how to compose the introduction controls (D038)
```tsx
const rows = useLiveShared().myIntroductions(); // map the my_introductions view to IntroductionView (camelCase)
const profile = useLiveShared().myDiscoveryProfile();
const actions: IntroductionActionsPort = {
  respond: (introId, accept) => reducers.respondIntroductionRequest({ introId, accept }),
  cancel: (introId) => reducers.cancelIntroductionRequest({ introId }),
  block: (introId) => reducers.blockIntroductionParticipant({ introId }),
  report: (introId, reason) => reducers.reportDiscoveryUser({ targetKind: 'introduction', targetRef: introId, reason }),
  withdraw: () => reducers.withdrawDiscoveryProfile({}),
};
<IntroductionControls introductions={rows} discoverable={Boolean(profile?.areaActive && !profile?.withdrawn)} actions={actions} />
```
- Regenerate bindings after the module change; the reducer and view names above come from D038. The `useLiveShared` hooks are illustrative: use whatever CS's live layer exposes.
- Card-level block/report on the Discover page uses `block_discovery_user({card_ref})` and `report_discovery_user({target_kind:'card', ...})`.
- The server decides everything; the component only renders the view and shows fixed copy. Never add a "declined" state for the sender.

## CS: events (D039)
- Before `publish_event_intent`, show `intentPreviewCopy(title)`. Before `approve_activity_interest`, show `activityApprovalPreviewCopy(name, topics)`. Next to Accept, show `planAcceptCopy(name)`. Use them verbatim; changing the wording means bumping the relevant notice version with Cyber.
- Show `sourceAgeLabel(fetchedAt, now)` on every event card. Never label synthetic or cached events as live.
- Compose `<EventPrivacyControls>` on the privacy page with `revokeIntent: (eventId) => reducers.revokeEventIntent({ eventId })` and `revokeApproval: (approvalId) => reducers.revokeActivityInterest({ approvalId })`.
- `my_plans.status` comes from the server; render it with `PLAN_STATUS_COPY`. Never show the other person's acceptance before "confirmed".

## What it guarantees, and what it doesn't
- The recovery code exists only in controller memory until the user retypes its last group. It is never persisted, logged or sent.
- A wrong passphrase and a wrong recovery code produce one identical message.
- After 3 failures, attempts back off up to 60 s. This is UI friction only: an offline attacker isn't limited by it, and the PBKDF2 cost is the real control.
- Delete needs a typed `DELETE` and crypto-shreds the vault (meta first). It doesn't revoke shared approvals; those go through `revoke_signal`.
- Not verified yet: real-browser rendering, focus/screen-reader behaviour, pagehide, on-disk IndexedDB contents (CYBER-R4/R5).
