# src/features/privacy — privacy controls component (Cyber)

Status: **implemented, offline-verified over the real `LocalVault`; not composed into a page or seen in a real browser.**

| File | What it is |
|---|---|
| `vault-controller.ts` | UI-free state machine for create, show the recovery code once, unlock, recover, change passphrase, lock and delete. Tested with `node --test` against `LocalVault` + `IndexedDbVaultStore` (fake-indexeddb). |
| `vault-controls.tsx` | Thin `'use client'` shadcn view: `<VaultControls vault={vault} />`. |
| `__tests__/vault-controller.test.ts` | 10 tests: validation, show-once code, constant error copy, backoff, recovery rotation, passphrase change, typed delete, vault-initiated lock, StrictMode re-mount. |

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

## What it guarantees, and what it doesn't
- The recovery code exists only in controller memory until the user retypes its last group. It is never persisted, logged or sent.
- A wrong passphrase and a wrong recovery code produce one identical message.
- After 3 failures, attempts back off up to 60 s. This is UI friction only: an offline attacker isn't limited by it, and the PBKDF2 cost is the real control.
- Delete needs a typed `DELETE` and crypto-shreds the vault (meta first). It doesn't revoke shared approvals; those go through `revoke_signal`.
- Not verified yet: real-browser rendering, focus/screen-reader behaviour, pagehide, on-disk IndexedDB contents (CYBER-R4/R5).
