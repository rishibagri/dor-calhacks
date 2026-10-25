'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { createVoiceSessionClient } from '@dor/agents/client';
import { useReflection, useSharedState } from '@/lib/backend';
import { useDictation } from '@/features/voice/use-dictation';
import { LiveBridge } from './bridge';

declare global {
  interface Window { __dorLive?: { attach(inst: unknown): void } }
}

/**
 * The live app: the Claude Design room, full screen, driven by the real backend through LiveBridge. The design runs in
 * a same-origin iframe (its own React 18 runtime); this page keeps Clerk, SpacetimeDB and the reflection route.
 * BackendProvider remounts this per signed-in user, so a sign-in or account switch starts a fresh bridge and room.
 */
export function LiveRoom() {
  const shared = useSharedState();
  const reflection = useReflection();
  const clerk = useClerk();
  const { isSignedIn, user } = useUser();
  // Voice journaling (Cartesia) runs here, where the microphone permission lives; the design's mic button drives it.
  const getSession = useMemo(() => createVoiceSessionClient().createSession, []);
  const dictation = useDictation({ getSession });
  const bridge = useRef<LiveBridge | null>(null);
  if (!bridge.current) bridge.current = new LiveBridge();
  if (typeof window !== 'undefined') window.__dorLive = { attach: (inst) => bridge.current!.attach(inst) };

  const accountName = user ? (user.firstName || user.username || user.primaryEmailAddress?.emailAddress.split('@')[0] || null) : null;
  useEffect(() => {
    bridge.current!.update({
      shared, reflection, signedIn: !!isSignedIn, accountName,
      voice: { start: dictation.start, stop: dictation.stop, cancel: dictation.cancel, partial: dictation.snapshot.partial },
      openSignIn: () => clerk.openSignIn({}),
      signOut: () => clerk.signOut(),
    });
  });
  useEffect(() => shared.subscribe(() => bridge.current!.sync()), [shared]);
  useEffect(() => () => { bridge.current!.detach(); delete window.__dorLive; }, []);

  return (
    <iframe src="/live/index.html" title="dor" allow="microphone; web-share; clipboard-write"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100dvh', border: 0, background: '#FAF7F0' }} />
  );
}
