'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSession } from '@kinetic/contracts';
import { VoiceDictation, type DictationSnapshot, type VoiceDictationDeps } from '@kinetic/agents/client';

const IDLE: DictationSnapshot = { state: 'idle', transcript: '', partial: '', speaking: false, error: null };

export interface UseDictationOptions {
  getSession: (signal?: AbortSignal) => Promise<VoiceSession>;
  /** Test seams; production uses the browser mic and WebSocket. */
  mic?: VoiceDictationDeps['mic'];
  socket?: VoiceDictationDeps['socket'];
}

/**
 * One VoiceDictation per recording (they are single-use). stop() resolves the final transcript; cancel()
 * discards it. Unmounting cancels, so audio never keeps streaming from a page the owner left.
 */
export function useDictation({ getSession, mic, socket }: UseDictationOptions) {
  const [snapshot, setSnapshot] = useState<DictationSnapshot>(IDLE);
  const current = useRef<VoiceDictation | null>(null);

  useEffect(() => () => { current.current?.cancel(); current.current = null; }, []);

  const start = useCallback(async () => {
    current.current?.cancel();
    const dictation = new VoiceDictation({ getSession, mic, socket,
      onChange: s => { if (current.current === dictation) setSnapshot(s); } });
    current.current = dictation;
    await dictation.start();
  }, [getSession, mic, socket]);

  const stop = useCallback(async (): Promise<string> => {
    const dictation = current.current;
    if (!dictation) return '';
    const text = await dictation.stop();
    if (current.current === dictation) current.current = null;
    return text;
  }, []);

  const cancel = useCallback(() => {
    current.current?.cancel();
    current.current = null;
    setSnapshot(IDLE);
  }, []);

  /** Clears a finished or failed recording's display state. */
  const reset = useCallback(() => { if (!current.current) setSnapshot(IDLE); }, []);

  return { snapshot, start, stop, cancel, reset };
}
