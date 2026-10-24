'use client';

/**
 * Backend composition root (CS-owned). UI consumes only these hooks.
 * Works with Clerk and/or SpacetimeDB unconfigured: falls back to labeled
 * offline placeholders instead of throwing.
 */
import { Fragment, createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@clerk/nextjs';
import { isClerkConfigured, spacetimeConfig } from '@/lib/config';
import { SpacetimeSharedState, getSpacetimeAvailability } from '@/lib/spacetime';
import type { SharedStateController } from '@/lib/spacetime';
import type { ConnectionState, ReflectionPort, SharedStatePort, VaultPort } from './ports';
import { openAccountVault } from './account-vault';
import { createReflectionClient } from '@dor/agents/client';
import { createOfflineSharedState, placeholderReflection, placeholderVault } from './placeholders';

export type { ConnectionState, ReflectionPort, SharedStatePort, VaultPort };

interface AuthSnapshot {
  isLoaded: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
}

interface BackendValue {
  shared: SharedStateController;
  vault: VaultPort;
  reflection: ReflectionPort;
  userId: string | null;
}

const BackendContext = createContext<BackendValue | null>(null);

const UNCONFIGURED_NO_CLERK = offline(
  { phase: 'unconfigured', reason: 'Clerk not configured (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY unset)' },
);

function offline(connection: ConnectionState): SharedStateController {
  const reason = connection.phase === 'unconfigured' ? connection.reason : connection.phase;
  return createOfflineSharedState(connection, { kind: 'unconfigured', reason });
}

const SIGNED_OUT = offline({ phase: 'signed_out' });
const LOADING = offline({ phase: 'connecting' });

function useClerkAuth(): AuthSnapshot {
  const { isLoaded, userId, getToken } = useAuth();
  return useMemo(
    () => ({
      isLoaded,
      userId: userId ?? null,
      getToken: () => getToken({ template: spacetimeConfig.jwtTemplate }),
    }),
    [isLoaded, userId, getToken],
  );
}

/** Chooses the SharedStatePort for the current auth/config state. */
function useSharedController(auth: AuthSnapshot): SharedStateController {
  const availability = useMemo(getSpacetimeAvailability, []);
  const [live, setLive] = useState<{ userId: string; ctl: SharedStateController } | null>(null);
  const { userId, getToken } = auth;
  const ready = availability.ready;
  useEffect(() => {
    if (!ready || !userId) return;
    const ctl = new SpacetimeSharedState({ getToken });
    setLive({ userId, ctl });
    return () => {
      ctl.dispose(); // clears cached rows + closes socket on user change / unmount
      setLive(null);
    };
  }, [ready, userId, getToken]);
  return useMemo(() => {
    if (!auth.isLoaded) return LOADING;
    if (!userId) return SIGNED_OUT;
    if (!availability.ready) return offline({ phase: 'unconfigured', reason: availability.reason });
    return live && live.userId === userId ? live.ctl : LOADING;
  }, [auth.isLoaded, userId, availability, live]);
}

function ClerkBackend({ children }: { children: ReactNode }) {
  const auth = useClerkAuth();
  return <Provide auth={auth}>{children}</Provide>;
}

const routeReflection: ReflectionPort = { status: { kind: 'live' }, reflect: createReflectionClient().reflect };
const unavailableVault: VaultPort = {
  ...placeholderVault,
  status: { kind: 'unconfigured', reason: 'Sign in and enable browser storage to use your local vault.' },
};

function useAccountVault(userId: string | null): VaultPort {
  const [current, setCurrent] = useState<{ userId: string; vault: VaultPort } | null>(null);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void openAccountVault(userId, controller.signal, { lifecycle: window }).then(vault => {
      if (!controller.signal.aborted) setCurrent({ userId, vault });
    }).catch(() => {
      if (!controller.signal.aborted) setCurrent({ userId, vault: unavailableVault });
    });
    return () => controller.abort();
  }, [userId]);
  return userId && current?.userId === userId ? current.vault : unavailableVault;
}

function Provide({ auth, children }: { auth: AuthSnapshot; children: ReactNode }) {
  const shared = useSharedController(auth);
  const vault = useAccountVault(auth.userId);
  const value = useMemo<BackendValue>(
    () => ({ shared, vault, reflection: auth.userId ? routeReflection : placeholderReflection, userId: auth.userId }),
    [shared, vault, auth.userId],
  );
  return <BackendContext.Provider value={value}><Fragment key={auth.userId ?? 'signed-out'}>{children}</Fragment></BackendContext.Provider>;
}

function NoClerkBackend({ children }: { children: ReactNode }) {
  const value = useMemo<BackendValue>(
    () => ({ shared: UNCONFIGURED_NO_CLERK, vault: unavailableVault, reflection: placeholderReflection, userId: null }),
    [],
  );
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function BackendProvider({ children }: { children: ReactNode }) {
  // isClerkConfigured is a build-time constant, so hook order is stable.
  return isClerkConfigured ? <ClerkBackend>{children}</ClerkBackend> : <NoClerkBackend>{children}</NoClerkBackend>;
}

function useBackend(): BackendValue {
  const value = useContext(BackendContext);
  if (!value) throw new Error('useBackend must be used inside <BackendProvider>');
  return value;
}

/** Returns the port and re-renders the caller whenever SharedState changes. */
export function useSharedState(): SharedStatePort {
  const { shared } = useBackend();
  useSyncExternalStore(shared.subscribe, shared.getVersion, shared.getVersion);
  return shared;
}

export function useVault(): VaultPort {
  const { vault } = useBackend();
  useSyncExternalStore(vault.subscribe.bind(vault), vault.getVersion.bind(vault), () => 0);
  return vault;
}

export function useReflection(): ReflectionPort {
  return useBackend().reflection;
}

export function useConnectionState(): ConnectionState {
  const { shared } = useBackend();
  useSyncExternalStore(shared.subscribe, shared.getVersion, shared.getVersion);
  return shared.connection;
}

/** Clerk user id (null when signed out or Clerk unset). Used by identity hook. */
export function useBackendUserId(): string | null {
  return useBackend().userId;
}
