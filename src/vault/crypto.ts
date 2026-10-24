/**
 * Local vault crypto (Cyber). Web Crypto only; no dependencies. Design: src/vault/DESIGN.md.
 *
 * Key hierarchy: a random AES-GCM-256 DEK encrypts every record. It is wrapped twice: under a
 * PBKDF2-SHA-256 passphrase key and under an HKDF-SHA-256 key from a 160-bit recovery code.
 * After unlock the DEK exists only as a NON-extractable CryptoKey in memory.
 */
const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto unavailable');
  return s;
};
const enc = new TextEncoder();
const dec = new TextDecoder();

export const VAULT_FORMAT = 1;
export const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
export const MIN_PASSPHRASE_LENGTH = 12;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const RECOVERY_BYTES = 20; // 160 bits
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type WrapPurpose = 'passphrase' | 'recovery';
/** ArrayBuffer-backed bytes (what Web Crypto accepts as BufferSource). */
export type Bytes = Uint8Array<ArrayBuffer>;
export interface Sealed { iv: Bytes; ct: Bytes }

export const randomBytes = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const newSalt = () => randomBytes(SALT_BYTES);

/** Passphrases are NFKC-normalised so the same visible text always derives the same key. */
export function normalizePassphrase(p: string): string {
  return p.normalize('NFKC');
}

/** 160-bit recovery code as 8 groups of 4 base32 characters, e.g. ABCD-EFGH-... */
export function newRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_BYTES);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Canonical form for comparison/derivation: uppercase base32, no separators. Null if malformed. */
export function normalizeRecoveryCode(code: string): string | null {
  const c = code.toUpperCase().replace(/[\s-]/g, '');
  return c.length === 32 && [...c].every(ch => B32.includes(ch)) ? c : null;
}

const aad = (...parts: (string | number)[]) => enc.encode(['dor-vault', `v${VAULT_FORMAT}`, ...parts].join('/'));

export async function passphraseKek(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

/** The recovery code has full entropy, so HKDF (no stretching) is sufficient. */
export async function recoveryKek(normalizedCode: string, salt: Bytes): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(normalizedCode), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: aad('recovery') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

/** Generated extractable ONLY so it can be wrapped at creation; callers keep the unwrapped non-extractable copy. */
export async function newDek(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey, vaultId: string, purpose: WrapPurpose): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: aad(vaultId, 'wrap', purpose) }));
  return { iv, ct };
}

/**
 * Throws (GCM auth failure) on a wrong secret or any tampering with the wrap or its AAD.
 * `extractable` is true ONLY transiently while re-wrapping (passphrase change / recovery); the
 * session key held after unlock is always non-extractable.
 */
export async function unwrapDek(sealed: Sealed, kek: CryptoKey, vaultId: string, purpose: WrapPurpose,
  extractable = false): Promise<CryptoKey> {
  return subtle().unwrapKey('raw', sealed.ct, kek, { name: 'AES-GCM', iv: sealed.iv, additionalData: aad(vaultId, 'wrap', purpose) },
    { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

/** Fresh random 96-bit IV per call; AAD binds the ciphertext to its vault, store and record id. */
export async function sealRecord(dek: CryptoKey, vaultId: string, store: string, id: string, value: unknown): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(vaultId, store, id) },
    dek, enc.encode(JSON.stringify(value))));
  return { iv, ct };
}

export async function openRecord(dek: CryptoKey, vaultId: string, store: string, id: string, sealed: Sealed): Promise<unknown> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: aad(vaultId, store, id) }, dek, sealed.ct);
  return JSON.parse(dec.decode(pt));
}
