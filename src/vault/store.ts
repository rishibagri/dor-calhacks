/**
 * IndexedDB persistence for the vault (Cyber). Stores ciphertext and non-secret metadata only:
 * no plaintext, no key material, nothing in localStorage/sessionStorage.
 */
import type { Bytes, Sealed, WrapPurpose } from './crypto.ts';

export const DB_NAME = 'dor-vault';
const DB_VERSION = 2;
export const RECORD_STORES = ['journal', 'reflection', 'profile', 'quizExtras', 'relationshipPhoto', 'bookInteraction'] as const;
export type RecordStore = (typeof RECORD_STORES)[number];

/** Single plaintext metadata row. Contains salts, KDF parameters and wrapped (encrypted) DEKs only. */
export interface VaultMeta {
  format: 1;
  vaultId: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: Bytes };
  recoverySalt: Bytes;
  wraps: Record<WrapPurpose, Sealed>;
}
export interface RecordEnvelope { v: 1; id: string; iv: Bytes; ct: Bytes }

export interface VaultStore {
  getMeta(): Promise<VaultMeta | null>;
  putMeta(meta: VaultMeta): Promise<void>;
  get(store: RecordStore, id: string): Promise<RecordEnvelope | null>;
  put(store: RecordStore, rec: RecordEnvelope): Promise<void>;
  delete(store: RecordStore, id: string): Promise<void>;
  list(store: RecordStore): Promise<RecordEnvelope[]>;
  /** Crypto-shred: delete the wrapped keys FIRST (records become undecryptable), then every record. */
  destroy(): Promise<void>;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => {
  tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
});

export class IndexedDbVaultStore implements VaultStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;
  private readonly name: string;
  /** `name` lets CS namespace the vault per signed-in account on a shared browser profile. */
  constructor(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME) {
    this.factory = factory;
    this.name = name;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB unavailable'));
    this.db ??= new Promise((res, rej) => {
      const r = this.factory.open(this.name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        for (const s of RECORD_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  }

  async getMeta() {
    const db = await this.open();
    return (await req(db.transaction('meta').objectStore('meta').get('meta')) as VaultMeta | undefined) ?? null;
  }
  async putMeta(meta: VaultMeta) {
    const tx = (await this.open()).transaction('meta', 'readwrite');
    tx.objectStore('meta').put(meta, 'meta');
    await done(tx);
  }
  async get(store: RecordStore, id: string) {
    const db = await this.open();
    return (await req(db.transaction(store).objectStore(store).get(id)) as RecordEnvelope | undefined) ?? null;
  }
  async put(store: RecordStore, rec: RecordEnvelope) {
    const tx = (await this.open()).transaction(store, 'readwrite');
    tx.objectStore(store).put(rec);
    await done(tx);
  }
  async delete(store: RecordStore, id: string) {
    const tx = (await this.open()).transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    await done(tx);
  }
  async list(store: RecordStore) {
    const db = await this.open();
    return (await req(db.transaction(store).objectStore(store).getAll())) as RecordEnvelope[];
  }
  async destroy() {
    const db = await this.open();
    const metaTx = db.transaction('meta', 'readwrite');
    metaTx.objectStore('meta').clear();
    await done(metaTx);
    const tx = db.transaction([...RECORD_STORES], 'readwrite');
    for (const s of RECORD_STORES) tx.objectStore(s).clear();
    await done(tx);
  }
}
