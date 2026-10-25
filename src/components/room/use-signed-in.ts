'use client';

/**
 * Real sign-in state from Clerk, independent of the SpacetimeDB connection. The door must never depend on the backend
 * socket: a missing JWT template or a stopped database is a backend problem, not a reason to lock someone out.
 * Returns null while Clerk loads. Without Clerk configured, the room is always open (offline placeholders).
 */
import { useAuth } from '@clerk/nextjs';
import { isClerkConfigured } from '@/lib/config';

function useClerkSignedIn(): boolean | null {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded ? Boolean(isSignedIn) : null;
}

const alwaysIn = (): boolean | null => true;

// Chosen once at module load, so the hook order never changes between renders.
export const useSignedIn: () => boolean | null = isClerkConfigured ? useClerkSignedIn : alwaysIn;
