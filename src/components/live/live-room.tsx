'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { createVoiceSessionClient, speak } from '@dor/agents/client';
import { useReflection, useSharedState } from '@/lib/backend';
import { isClerkConfigured } from '@/lib/config';
import { useDictation } from '@/features/voice/use-dictation';
import { LiveBridge } from './bridge';
import { RefreshButton } from '@/components/backstage/refresh-button';

declare global {
  interface Window { __dorLive?: { attach(inst: unknown): void } }
}

interface LiveAuth {
  signedIn: boolean;
  accountName: string | null;
  openSignIn(): void;
  signOut(): Promise<void>;
}

/** Without Clerk configured (CI, offline) the layout has no ClerkProvider, so the room stays signed out. */
const NO_AUTH: LiveAuth = { signedIn: false, accountName: null, openSignIn: () => {}, signOut: async () => {} };

/**
 * The live app: the Claude Design room, full screen, driven by the real backend through LiveBridge. The design runs in
 * a same-origin iframe (its own React 18 runtime); this page keeps Clerk, SpacetimeDB and the reflection route.
 * BackendProvider remounts this per signed-in user, so a sign-in or account switch starts a fresh bridge and room.
 */
export function LiveRoom() {
  return isClerkConfigured ? <ClerkLiveRoom /> : <LiveRoomFrame auth={NO_AUTH} />;
}

function ClerkLiveRoom() {
  const clerk = useClerk();
  const { isSignedIn, user } = useUser();
  const accountName = user ? (user.firstName || user.username || user.primaryEmailAddress?.emailAddress.split('@')[0] || null) : null;
  return <LiveRoomFrame auth={{ signedIn: !!isSignedIn, accountName, openSignIn: () => clerk.openSignIn({}), signOut: () => clerk.signOut() }} />;
}

function LiveRoomFrame({ auth }: { auth: LiveAuth }) {
  const shared = useSharedState();
  const reflection = useReflection();
  // Voice journaling (Cartesia) runs here, where the microphone permission lives; the design's mic button drives it.
  const getSession = useMemo(() => createVoiceSessionClient().createSession, []);
  const dictation = useDictation({ getSession });
  // Read-aloud (Cartesia TTS). Phones only play audio from a context unlocked during a tap, so the notebook's tap calls
  // unlock() before any network wait and the reply plays through that same context.
  const audio = useRef<AudioContext | null>(null);
  const unlock = () => {
    try { audio.current ??= new AudioContext(); void audio.current.resume(); } catch { /* no Web Audio: text still shows */ }
  };
  const say = async (text: string) => {
    const session = await getSession();
    return speak(session, text, { play: async (wav, signal) => {
      const ctx = audio.current ?? (audio.current = new AudioContext());
      await ctx.resume();
      const buffer = await ctx.decodeAudioData(wav.slice(0));
      if (signal.aborted) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        signal.addEventListener('abort', () => { source.stop(); resolve(); }, { once: true });
        source.start();
      });
    } });
  };
  const bridge = useRef<LiveBridge | null>(null);
  if (!bridge.current) bridge.current = new LiveBridge();
  if (typeof window !== 'undefined') window.__dorLive = { attach: (inst) => bridge.current!.attach(inst) };

  useEffect(() => {
    bridge.current!.update({
      shared, reflection, signedIn: auth.signedIn, accountName: auth.accountName,
      voice: { start: dictation.start, stop: dictation.stop, cancel: dictation.cancel, partial: dictation.snapshot.partial, unlock, say },
      openSignIn: auth.openSignIn,
      signOut: auth.signOut,
    });
  });
  useEffect(() => shared.subscribe(() => bridge.current!.sync()), [shared]);
  useEffect(() => () => { bridge.current!.detach(); delete window.__dorLive; }, []);

  return (
    <>
      <iframe src="/live/index.html" title="dor" allow="microphone; web-share; clipboard-write"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100dvh', border: 0, background: '#FAF7F0' }} />
      {/* D053 demo backstage: observer-gated live view of the agents and backend (opens in a new tab). */}
      <a href="/backstage" target="_blank" rel="noopener"
        style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 10, padding: '4px 10px', borderRadius: 999, fontSize: 12,
          background: 'rgba(28,25,23,.78)', color: '#FAF7F0', textDecoration: 'none', fontFamily: 'system-ui, sans-serif' }}>
        backstage ↗
      </a>
      {/* D057: live Apify refresh; new events and places flow into the window as they save. */}
      {auth.signedIn && (
        <RefreshButton style={{ position: 'fixed', right: 104, bottom: 12, zIndex: 10, padding: '4px 10px', borderRadius: 999, fontSize: 12,
          border: 0, background: 'rgba(28,25,23,.78)', color: '#FAF7F0', fontFamily: 'system-ui, sans-serif', cursor: 'pointer' }} />
      )}
    </>
  );
}
