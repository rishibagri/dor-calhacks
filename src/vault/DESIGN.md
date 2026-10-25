# Local vault: key, unlock and recovery design (Cyber) — v1

Status: **implemented, offline-verified** in `src/vault/` (`LocalVault`, `IndexedDbVaultStore`, `crypto.ts`). Tests: `src/vault/__tests__/vault.test.ts` (Node Web Crypto + fake-indexeddb). **Not yet wired into the app.** CS swaps `placeholderVault` and adds the create/unlock/recovery screens. Not verified in a real browser yet (auto-lock on pagehide, IndexedDB on disk).

Implementation differences from the original proposal:
- **No `encryptions` counter is stored.** A random 96-bit IV is safe for far more seals than a single-device journal will make.
- **Reflections store text only.** The candidate is never persisted (REVIEWS.md D021 #1).
- **Shared browser profiles.** `IndexedDbVaultStore(indexedDB, name)` takes a DB name. CS should namespace it per signed-in account, e.g. `dor-vault:<sha256(clerk userId)>`, and call `lock()` on identity change.

## What it protects, and what it does not
| In scope | Out of scope (state honestly in UI/claims) |
|---|---|
| Offline copy of the browser profile / IndexedDB (stolen laptop, disk backup, synced profile dir) | XSS or any script running in our origin while unlocked: it can call decrypt like we do |
| Another person using the device while the vault is locked | Malicious extensions, OS malware, keyloggers, memory forensics while unlocked |
| Tampering with or swapping ciphertext records | Provider processing: text/audio the owner sends to Claude/Cartesia leaves the vault by design |
| Server/SpacetimeDB compromise (no vault data is ever sent there) | Weak passphrases against offline guessing beyond the KDF cost |

This is encryption at rest for one device. It is not end-to-end encrypted inference, not secure erase, and not a guarantee against a compromised browser.

## Contents
Vault-only data: journal text and transcripts, private reflections and signal candidates, `LocalConnectionProfile`, `LocalQuizExtras`, detailed calendar entries, and relationship-book photos/interaction notes. None of it is uploaded, synced or escrowed, and none of it is ever an authorization input.

Relationship-book photos are selected by the owner from a local file picker (JPEG, PNG or WebP; 1.5 MB maximum each; 24 per pair). Captions are optional and limited to 160 characters. The local book can record a call, feedback on a visible nudge, or an introduction the owner explicitly links to the book. Optional notes are limited to 320 characters. These records remain encrypted in the owner's vault; photos are not scraped through Apify and call logs are not imported from the phone. The UI must clear decrypted photos/notes when the vault locks. These are local-only app types in `src/vault/book-types.ts`, not shared contracts.

## Key hierarchy
```
passphrase ──PBKDF2-SHA-256 (600k, 16B salt)──► KEK_pass ─┐
                                                          ├─ AES-GCM wrapKey ─► wrapped DEK (two copies)
recovery code (160-bit random) ──HKDF-SHA-256──► KEK_rec ─┘
DEK: random AES-GCM-256, unwrapped as NON-extractable, memory only ──► encrypts every record
```
- **DEK**: `generateKey(AES-GCM, 256)` once at vault creation. It is extractable only during the creation call so it can be wrapped twice. Every unlock re-imports it via `unwrapKey(..., extractable=false, ['encrypt','decrypt'])`.
- **KEK_pass**: PBKDF2-HMAC-SHA-256, 600,000 iterations (OWASP 2023 guidance for PBKDF2-SHA256), with a random 16-byte salt per vault. The passphrase is NFKC-normalised. Web Crypto has no Argon2; a WASM Argon2id is a possible later upgrade, signalled by `kdf.name`.
- **KEK_rec**: HKDF-SHA-256 over a 160-bit random recovery code, with salt = vault salt and info = `dor-vault/v1/recovery`. The code is shown once as 8 groups of 4 base32 characters. It has full entropy, so it needs no stretching.
- **Wrapping**: AES-GCM `wrapKey`/`unwrapKey` with a fresh 12-byte IV and AAD `dor-vault/v1/<vaultId>/wrap/<passphrase|recovery>`. A wrong passphrase fails GCM authentication, so no passphrase hash or verifier is stored.

## Stored layout (IndexedDB database `dor-vault`, schema version 2)
- `meta` (single plaintext row, contains no secrets): `{schemaVersion:1, vaultId, kdf:{name:'PBKDF2', hash:'SHA-256', iterations, salt}, wraps:{passphrase:{iv,ct}, recovery:{iv,ct}}, encryptions}`.
- Object stores keep `journal`, `profile`, `quizExtras`, `reflection`, `relationshipPhoto` and `bookInteraction` records. Each encrypted row is `{v:1, id, iv, ct}`. Upgrade from version 1 adds the two book stores while preserving existing rows.
  - `id`: a random UUID. The UI's `localId` is that UUID, never derived from content.
  - Plaintext JSON, including `createdAt`, lives inside `ct`. No titles, dates or lengths are stored in clear beyond what ciphertext size reveals.
  - AAD is `dor-vault/v1/<vaultId>/<store>/<id>`, so a record moved to another id, store or vault fails to decrypt.
  - IV: 12 random bytes per encryption via `crypto.getRandomValues`. Editing re-encrypts with a new IV. The `encryptions` counter triggers DEK rotation at 2^30, far below the 2^32 random-IV bound.
- Nothing is in `localStorage`/`sessionStorage`, no key material is persisted, and no plaintext cache exists.

## Lifecycle
| Operation | Behaviour |
|---|---|
| Create | Passphrase (min 12 characters, strength meter, confirm), then generate DEK, salt, vaultId and recovery code. Store both wraps. Show the recovery code once and require the user to retype its last group. Copy: "If you lose both your passphrase and recovery code, your journal cannot be recovered. Signing in does not restore it." |
| Unlock | Derive KEK_pass (≈0.3–1 s), unwrap DEK, keep the `CryptoKey` in a module-scoped variable. Never put it in React state, storage, logs or the URL. UI backoff after failed attempts (an offline attacker isn't limited by this; the KDF cost is the real control). |
| Lock | Drop the key reference and clear decrypted view state. Triggered by an explicit lock, 15 min idle, `pagehide`, sign-out or identity change. |
| Change passphrase | Requires unlock. Re-wrap the same DEK under a new salt/KEK and overwrite the passphrase wrap. Old IndexedDB copies remain openable with the old passphrase (documented; full rotation = re-encrypt under a new DEK). |
| Recover | Recovery code → KEK_rec → unwrap DEK, then force a new passphrase and issue a new recovery code (rotate both wraps). |
| Delete entry | Delete the record. Its derived signals are revoked through the guarded `revoke_signal` reducer using signal IDs only; no journal identifiers leave the device. IndexedDB may leave on-disk residue, but it is ciphertext. |
| Delete vault | Delete `meta` first (crypto-shred: without the wraps no record can be decrypted), then the records. Show data-loss copy before confirming. |
| Clear site data / new device | The vault is gone or absent. Login cannot restore it. Encrypted export is a separate, not-yet-designed feature. |

## Proposed VaultPort additions (needs CS ACK; `src/lib/backend/ports.ts` is CS-owned)
The current port has `unlock`/`lock` but no create or recovery path. Proposal:
```ts
readonly state: 'absent' | 'locked' | 'unlocked';
create(passphrase: string): Promise<{ recoveryCode: string }>;
recover(recoveryCode: string, newPassphrase: string): Promise<{ recoveryCode: string }>;
changePassphrase(current: string, next: string): Promise<void>;
destroy(): Promise<void>;   // crypto-shred, irreversible
```
Errors: `vault_locked`, `wrong_secret` (one constant message for passphrase or recovery code), `vault_absent`, `vault_corrupt`.

## Browser hardening that the vault depends on (CS)
Strict CSP (no `unsafe-inline`/`unsafe-eval` scripts), no `dangerouslySetInnerHTML` for journal text or transcripts, no third-party scripts on vault pages, and no analytics or session replay on journal routes.

## Verification plan (next Cyber milestone)
Run in Node 20 Web Crypto plus `fake-indexeddb`, offline:
- Wrong passphrase or wrong recovery code is rejected.
- Bit-flipped ciphertext, or a ciphertext swapped between records, stores or vaults, fails.
- IVs are unique across 10k encryptions.
- Serialised IndexedDB bytes contain no plaintext marker strings.
- Lock makes reads throw.
- Recovery rotates both wraps.
- Passphrase change keeps data readable.
- Destroy makes data unrecoverable.
- The DEK is non-extractable after unlock (`exportKey` throws).

A real-browser check of auto-lock and pagehide is a separate live item.
