/**
 * PLACEHOLDER adapters. Each is explicit about not being real; UI must show
 * the non-live status. None persist anything. This file must NOT import
 * '@kinetic/contracts/fakes'.
 */
import type {
  AdapterStatus, ConnectionState, JournalEntrySummary, ReducerResult, ReflectionPort, VaultPort,
} from './ports';
import type { SharedStateController } from '@/lib/spacetime/types';

const VAULT_MSG = 'vault pending (Cyber)';
const REFLECTION_MSG = 'reflection pending (AI)';

const vaultStatus: AdapterStatus = {
  kind: 'not_implemented', owner: 'Cyber', reason: 'Local encrypted vault not implemented; nothing is persisted.',
};
const reflectionStatus: AdapterStatus = {
  kind: 'not_implemented', owner: 'AI', reason: 'Reflection route not implemented.',
};

function pending(message: string): never {
  throw new Error(message);
}

/** Vault placeholder: always locked; every write/read throws; NO plaintext persistence. */
export const placeholderVault: VaultPort = {
  status: vaultStatus,
  locked: true,
  unlock: async () => pending(VAULT_MSG),
  lock: () => undefined,
  saveJournal: async () => pending(VAULT_MSG),
  listJournals: async (): Promise<JournalEntrySummary[]> => pending(VAULT_MSG),
  readJournal: async () => pending(VAULT_MSG),
  deleteJournal: async () => pending(VAULT_MSG),
  saveProfile: async () => pending(VAULT_MSG),
  loadProfile: async () => pending(VAULT_MSG),
};

export const placeholderReflection: ReflectionPort = {
  status: reflectionStatus,
  reflect: async () => pending(REFLECTION_MSG),
};

/**
 * Offline SharedStatePort for unconfigured / signed-out modes: reducers refuse
 * with 'unavailable', views are empty. Immutable, so subscribe is a no-op.
 */
export function createOfflineSharedState(
  connection: ConnectionState,
  status: AdapterStatus,
): SharedStateController {
  const refuse = async (): Promise<ReducerResult> => ({
    ok: false, code: 'unavailable', message: status.kind === 'live' ? 'offline' : describe(status),
  });
  return {
    status, connection,
    registerAccount: refuse, createPairInvite: refuse, acceptPairInvite: refuse, unlinkPair: refuse,
    setRelationshipPreset: refuse, assignRelationshipPreset: refuse, approveSignal: refuse,
    revokeSignal: refuse, dismissNudge: refuse, snoozeNudge: refuse,
    myAccount: () => null, myPairs: () => EMPTY, myInvites: () => EMPTY, myPresets: () => EMPTY,
    myPresetAssignments: () => EMPTY, myNudges: () => EMPTY, myReceipts: () => EMPTY,
    subscribe: () => () => undefined,
    getVersion: () => 0,
    dispose: () => undefined,
  };
}

const EMPTY: never[] = [];

function describe(status: AdapterStatus): string {
  return status.kind === 'live' ? 'offline' : status.reason;
}
