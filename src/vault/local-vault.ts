/**
 * Real VaultPort (Cyber): IndexedDB + Web Crypto, single device. Design: src/vault/DESIGN.md.
 * Drop-in for `placeholderVault` in src/lib/backend/index.tsx (CS wires it).
 *
 * Guarantees implemented here: no plaintext or key material at rest; the session DEK is a
 * non-extractable CryptoKey held only in memory; lock (explicit, idle, pagehide) drops it;
 * every record is AES-GCM with a fresh IV and AAD binding vault/store/id; errors are constant codes.
 * NOT guaranteed: protection from script running in this origin while unlocked (XSS), extensions,
 * malware, provider processing, or secure erase of IndexedDB's on-disk residue.
 */
import { LocalConnectionProfileSchema, type LocalConnectionProfile } from '@kinetic/contracts';
import type {
  AdapterStatus, JournalEntrySummary, LocalQuizExtras, VaultErrorCode, VaultPort, VaultState,
} from '../lib/backend/ports.ts';
import {
  MIN_PASSPHRASE_LENGTH, PBKDF2_ITERATIONS, newDek, newRecoveryCode, newSalt, normalizePassphrase,
  normalizeRecoveryCode, openRecord, passphraseKek, recoveryKek, sealRecord, unwrapDek, wrapDek, type Bytes,
} from './crypto.ts';
import { IndexedDbVaultStore, type RecordStore, type VaultMeta, type VaultStore } from './store.ts';

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode) { super(code); this.code = code; this.name = 'VaultError'; }
}

export interface LocalVaultOptions {
  store?: VaultStore;
  /** Auto-lock after this much inactivity. Default 15 min; 0 disables (tests only). */
  idleLockMs?: number;
  /** Lock on `pagehide` in browsers. Default true. */
  lockOnPageHide?: boolean;
  /** TESTS ONLY: cheaper PBKDF2 for new wraps. Production must omit it (600k iterations). */
  unsafeTestIterations?: number;
}

const ID_RE = /^[A-Za-z0-9-]{1,128}$/;
const MAX_JOURNAL_CHARS = 100_000;
const MAX_REFLECTION_CHARS = 2_000; // PrivateReflectionSchema.reflection max
const ACTIVITIES = ['talking', 'games', 'watching_together', 'creating', 'other'] as const;
const ACTIVITIES_NOTE_MAX = 200;
const SINGLETON = { profile: 'profile', quizExtras: 'quizExtras' } as const;

interface JournalPlain { localId: string; text: string; createdAt: string }

export class LocalVault implements VaultPort {
  readonly status: AdapterStatus;
  private readonly store: VaultStore;
  private readonly idleLockMs: number;
  private readonly iterations: number;
  private dek: CryptoKey | null = null;
  private meta: VaultMeta | null = null;
  private current: VaultState = 'unknown';
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: LocalVaultOptions = {}) {
    const available = Boolean(globalThis.crypto?.subtle) && (Boolean(opts.store) || typeof globalThis.indexedDB !== 'undefined');
    this.status = available ? { kind: 'live' }
      : { kind: 'unconfigured', reason: 'This browser lacks IndexedDB or Web Crypto; nothing can be stored.' };
    this.store = opts.store ?? new IndexedDbVaultStore();
    this.idleLockMs = opts.idleLockMs ?? 15 * 60 * 1000;
    this.iterations = opts.unsafeTestIterations ?? PBKDF2_ITERATIONS;
    if (opts.lockOnPageHide !== false && typeof window !== 'undefined') window.addEventListener('pagehide', () => this.lock());
  }

  get locked(): boolean { return this.dek === null; }
  get state(): VaultState { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getVersion(): number { return this.version; }

  async refresh(): Promise<VaultState> {
    this.meta = await this.store.getMeta();
    this.set(this.meta ? (this.dek ? 'unlocked' : 'locked') : 'absent');
    return this.current;
  }

  async create(passphrase: string): Promise<{ recoveryCode: string }> {
    this.requireAvailable();
    checkPassphrase(passphrase);
    if (await this.store.getMeta()) throw new VaultError('vault_exists');
    const vaultId = globalThis.crypto.randomUUID();
    const recoveryCode = newRecoveryCode();
    const meta = await this.wrapAll(await newDek(), vaultId, passphrase, recoveryCode);
    await this.store.putMeta(meta);
    await this.adopt(meta, await passphraseKek(passphrase, meta.kdf.salt, meta.kdf.iterations));
    return { recoveryCode };
  }

  async unlock(passphrase: string): Promise<void> {
    const meta = await this.requireMeta();
    if (typeof passphrase !== 'string' || passphrase.length === 0) throw new VaultError('wrong_secret');
    await this.adopt(meta, await passphraseKek(passphrase, meta.kdf.salt, meta.kdf.iterations));
  }

  async recover(recoveryCode: string, newPassphrase: string): Promise<{ recoveryCode: string }> {
    const meta = await this.requireMeta();
    checkPassphrase(newPassphrase);
    const code = typeof recoveryCode === 'string' ? normalizeRecoveryCode(recoveryCode) : null;
    if (!code) throw new VaultError('wrong_secret');
    const dek = await unwrapOrWrong(meta, await recoveryKek(code, meta.recoverySalt), 'recovery', true);
    // Rotate BOTH wraps: the used recovery code stops working; a new one is issued.
    const fresh = newRecoveryCode();
    const next = await this.wrapAll(dek, meta.vaultId, newPassphrase, fresh);
    await this.store.putMeta(next);
    await this.adopt(next, await passphraseKek(newPassphrase, next.kdf.salt, next.kdf.iterations));
    return { recoveryCode: fresh };
  }

  async changePassphrase(currentPassphrase: string, nextPassphrase: string): Promise<void> {
    const meta = await this.requireMeta();
    checkPassphrase(nextPassphrase);
    const dek = await unwrapOrWrong(meta, await passphraseKek(currentPassphrase, meta.kdf.salt, meta.kdf.iterations), 'passphrase', true);
    const salt = newSalt();
    const kek = await passphraseKek(nextPassphrase, salt, this.iterations);
    const next: VaultMeta = {
      ...meta, kdf: { ...meta.kdf, iterations: this.iterations, salt },
      wraps: { ...meta.wraps, passphrase: await wrapDek(dek, kek, meta.vaultId, 'passphrase') },
    };
    await this.store.putMeta(next);
    await this.adopt(next, kek);
  }

  lock(): void {
    this.dek = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.current === 'unlocked') this.set('locked');
  }

  async destroy(): Promise<void> {
    this.lock();
    await this.store.destroy();
    this.meta = null;
    this.set('absent');
  }

  // ---- journals ----
  async saveJournal(entry: { localId: string; text: string }): Promise<void> {
    const { localId, text } = entry ?? ({} as { localId: string; text: string });
    if (!isId(localId) || typeof text !== 'string' || text.length === 0 || text.length > MAX_JOURNAL_CHARS) throw new VaultError('invalid_input');
    const prior = await this.readPlain('journal', localId) as JournalPlain | null;
    await this.write('journal', localId, { localId, text, createdAt: prior?.createdAt ?? new Date().toISOString() });
  }
  async listJournals(): Promise<JournalEntrySummary[]> {
    const dek = this.key();
    const out: JournalEntrySummary[] = [];
    for (const rec of await this.store.list('journal')) {
      const j = journalShape(await this.open(dek, 'journal', rec.id, rec));
      out.push({ localId: j.localId, createdAt: j.createdAt });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async readJournal(localId: string): Promise<{ localId: string; text: string; createdAt: string }> {
    if (!isId(localId)) throw new VaultError('invalid_input');
    const j = await this.readPlain('journal', localId);
    if (j === null) throw new VaultError('not_found');
    return journalShape(j);
  }
  /** Deletes the entry and its reflection locally. Derived shared signals are revoked separately via revoke_signal (IDs only). */
  async deleteJournal(localId: string): Promise<void> {
    this.key();
    if (!isId(localId)) throw new VaultError('invalid_input');
    await this.store.delete('journal', localId);
    await this.store.delete('reflection', localId);
    this.touch();
  }

  // ---- reflections (text only; the candidate is never persisted, D021 review) ----
  async saveReflection(localId: string, reflection: string): Promise<void> {
    if (!isId(localId) || typeof reflection !== 'string' || reflection.length === 0 || reflection.length > MAX_REFLECTION_CHARS)
      throw new VaultError('invalid_input');
    await this.write('reflection', localId, { localId, reflection });
  }
  async readReflection(localId: string): Promise<string | null> {
    if (!isId(localId)) throw new VaultError('invalid_input');
    const r = await this.readPlain('reflection', localId) as { localId?: unknown; reflection?: unknown } | null;
    if (r === null) return null;
    if (r.localId !== localId || typeof r.reflection !== 'string') throw new VaultError('vault_corrupt');
    return r.reflection;
  }

  // ---- profile + quiz extras (owner-only; never an authorization input) ----
  async saveProfile(profile: LocalConnectionProfile): Promise<void> {
    const parsed = LocalConnectionProfileSchema.safeParse(profile);
    if (!parsed.success) throw new VaultError('invalid_input');
    await this.write('profile', SINGLETON.profile, parsed.data);
  }
  async loadProfile(): Promise<LocalConnectionProfile | null> {
    const raw = await this.readPlain('profile', SINGLETON.profile);
    if (raw === null) return null;
    const parsed = LocalConnectionProfileSchema.safeParse(raw);
    if (!parsed.success) throw new VaultError('vault_corrupt');
    return parsed.data;
  }
  async saveQuizExtras(extras: LocalQuizExtras): Promise<void> {
    if (!isQuizExtras(extras)) throw new VaultError('invalid_input');
    await this.write('quizExtras', SINGLETON.quizExtras, extras);
  }
  async loadQuizExtras(): Promise<LocalQuizExtras | null> {
    const raw = await this.readPlain('quizExtras', SINGLETON.quizExtras);
    if (raw === null) return null;
    if (!isQuizExtras(raw)) throw new VaultError('vault_corrupt');
    return raw;
  }

  // ---- internals ----
  private requireAvailable(): void {
    if (this.status.kind !== 'live') throw new VaultError('vault_unavailable');
  }
  private async requireMeta(): Promise<VaultMeta> {
    this.requireAvailable();
    const meta = await this.store.getMeta();
    if (!meta) { this.meta = null; this.set('absent'); throw new VaultError('vault_absent'); }
    return meta;
  }
  private key(): CryptoKey {
    if (!this.dek || !this.meta) throw new VaultError('vault_locked');
    return this.dek;
  }
  /** Unwraps the session key as NON-extractable and starts the idle timer. */
  private async adopt(meta: VaultMeta, kek: CryptoKey): Promise<void> {
    this.dek = await unwrapOrWrong(meta, kek, 'passphrase', false);
    this.meta = meta;
    this.set('unlocked');
    this.touch();
  }
  private async wrapAll(dek: CryptoKey, vaultId: string, passphrase: string, recoveryCode: string): Promise<VaultMeta> {
    const salt = newSalt(), recoverySalt = newSalt();
    const code = normalizeRecoveryCode(recoveryCode)!;
    return {
      format: 1, vaultId, recoverySalt,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: this.iterations, salt },
      wraps: {
        passphrase: await wrapDek(dek, await passphraseKek(passphrase, salt, this.iterations), vaultId, 'passphrase'),
        recovery: await wrapDek(dek, await recoveryKek(code, recoverySalt), vaultId, 'recovery'),
      },
    };
  }
  private async write(store: RecordStore, id: string, value: unknown): Promise<void> {
    const dek = this.key();
    const sealed = await sealRecord(dek, this.meta!.vaultId, store, id, value);
    await this.store.put(store, { v: 1, id, ...sealed });
    this.touch();
  }
  private async readPlain(store: RecordStore, id: string): Promise<unknown | null> {
    const dek = this.key();
    const rec = await this.store.get(store, id);
    this.touch();
    return rec ? this.open(dek, store, id, rec) : null;
  }
  private async open(dek: CryptoKey, store: RecordStore, id: string, rec: { id: string; iv: Bytes; ct: Bytes }): Promise<unknown> {
    if (rec.id !== id) throw new VaultError('vault_corrupt');
    try {
      return await openRecord(dek, this.meta!.vaultId, store, id, rec);
    } catch {
      throw new VaultError('vault_corrupt'); // tampered, swapped or from another vault
    }
  }
  private touch(): void {
    if (this.idleLockMs <= 0 || !this.dek) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), this.idleLockMs);
    (this.idleTimer as { unref?: () => void }).unref?.();
  }
  private set(state: VaultState): void {
    if (state === this.current) return;
    this.current = state;
    this.version++;
    for (const l of this.listeners) l();
  }
}

async function unwrapOrWrong(meta: VaultMeta, kek: CryptoKey, purpose: 'passphrase' | 'recovery', extractable: boolean): Promise<CryptoKey> {
  try {
    return await unwrapDek(meta.wraps[purpose], kek, meta.vaultId, purpose, extractable);
  } catch {
    throw new VaultError('wrong_secret');
  }
}

function checkPassphrase(p: unknown): void {
  if (typeof p !== 'string') throw new VaultError('weak_passphrase');
  const n = normalizePassphrase(p);
  if (n.trim().length < MIN_PASSPHRASE_LENGTH || n.length > 1024) throw new VaultError('weak_passphrase');
}

const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

function journalShape(v: unknown): JournalPlain {
  const j = v as Partial<JournalPlain> | null;
  if (!j || typeof j.localId !== 'string' || typeof j.text !== 'string' || typeof j.createdAt !== 'string' ||
    Object.keys(j).length !== 3) throw new VaultError('vault_corrupt');
  return j as JournalPlain;
}

/** Strict LocalQuizExtras check (app-side local type; never a wire type or authorization input). */
function isQuizExtras(v: unknown): v is LocalQuizExtras {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  const keys = ['prefersSpace', 'activities', 'activitiesNote', 'scheduleSuggestions', 'reviewComfort'];
  if (Object.keys(e).length !== keys.length || !keys.every(k => k in e)) return false;
  const acts = e.activities;
  return typeof e.prefersSpace === 'boolean' &&
    Array.isArray(acts) && acts.every(a => (ACTIVITIES as readonly unknown[]).includes(a)) && new Set(acts).size === acts.length &&
    (e.activitiesNote === null || (typeof e.activitiesNote === 'string' && e.activitiesNote.length > 0 && e.activitiesNote.length <= ACTIVITIES_NOTE_MAX)) &&
    [null, 'only_after_review', 'keep_private'].includes(e.scheduleSuggestions as string | null) &&
    [null, 'review_everything', 'quick_review'].includes(e.reviewComfort as string | null);
}
