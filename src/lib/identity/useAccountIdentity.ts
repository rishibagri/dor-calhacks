'use client';

import { useUser } from '@clerk/nextjs';
import { isClerkConfigured } from '@/lib/config';
import { useConnectionState, useSharedState } from '@/lib/backend';

export interface AccountIdentity {
  /** Clerk user id, or null (signed out / Clerk unset). */
  clerkUserId: string | null;
  /** Display name: SpacetimeDB account if registered, else Clerk name. */
  displayName: string | null;
  email: string | null;
  /** SpacetimeDB identity hex (the pairing handle); null until connected. */
  identityHex: string | null;
  /** True once register_account has produced a my_account row. */
  isRegistered: boolean;
  isSignedIn: boolean;
}

interface ClerkBits { id: string | null; name: string | null; email: string | null; loaded: boolean }
const NO_CLERK: ClerkBits = { id: null, name: null, email: null, loaded: true };

function useClerkBits(): ClerkBits {
  const { user, isLoaded } = useUser();
  return {
    id: user?.id ?? null,
    name: user?.fullName ?? user?.username ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    loaded: isLoaded,
  };
}

// isClerkConfigured is a build-time constant, so the hook choice never changes at runtime.
const useClerk: () => ClerkBits = isClerkConfigured ? useClerkBits : () => NO_CLERK;

/** Combines the Clerk user with the SpacetimeDB identity and account row. */
export function useAccountIdentity(): AccountIdentity {
  const clerk = useClerk();
  const connection = useConnectionState();
  const account = useSharedState().myAccount();
  return {
    clerkUserId: clerk.id,
    displayName: account?.displayName ?? clerk.name,
    email: clerk.email,
    identityHex: connection.phase === 'connected' ? connection.identityHex : null,
    isRegistered: account !== null,
    isSignedIn: clerk.id !== null,
  };
}
