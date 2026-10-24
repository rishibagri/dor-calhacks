import { LocalVault, type LocalVaultOptions } from '../../vault/local-vault.ts';
import { IndexedDbVaultStore } from '../../vault/store.ts';

/** Account separation is local only. No user ID, journal, or key is sent to a provider. */
export async function accountVaultName(userId: string): Promise<string> {
  if (!userId) throw new Error('vault_unavailable');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return 'dor-vault:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Owns pagehide cleanup and invalidates initialization when the account changes. */
export async function openAccountVault(userId: string, signal: AbortSignal,
  options: { factory?: IDBFactory; lifecycle?: EventTarget; vaultOptions?: Pick<LocalVaultOptions, 'unsafeTestIterations' | 'idleLockMs'> } = {},
): Promise<LocalVault> {
  signal.throwIfAborted();
  const name = await accountVaultName(userId);
  signal.throwIfAborted();
  const vault = new LocalVault({ ...options.vaultOptions,
    store: new IndexedDbVaultStore(options.factory ?? globalThis.indexedDB, name), lockOnPageHide: false });
  const lock = () => vault.lock();
  const dispose = () => {
    lock();
    options.lifecycle?.removeEventListener('pagehide', lock);
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  options.lifecycle?.addEventListener('pagehide', lock);
  try {
    await vault.refresh();
    signal.throwIfAborted();
    return vault;
  } catch (error) {
    dispose();
    throw error;
  }
}
