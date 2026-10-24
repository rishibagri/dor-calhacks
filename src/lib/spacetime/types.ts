import type { SharedStatePort } from '@/lib/backend/ports';

/** SharedStatePort plus the hooks BackendProvider needs. */
export interface SharedStateController extends SharedStatePort {
  /** Bumps on every state change; used as the useSyncExternalStore snapshot. */
  getVersion(): number;
  /** Closes the connection and clears all cached rows. */
  dispose(): void;
}
