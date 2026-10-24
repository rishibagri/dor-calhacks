'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PrivateReflection, SignalCandidate, VoiceSession } from '@dor/contracts';
import { RouteError, createReflectionClient, createVoiceSessionClient, speak } from '@dor/agents/client';
import type { VaultPort } from '@/lib/backend/ports';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { describeCandidate, insertTranscript, reflectFailureCopy, speakableText, splitReflection, textToReflect,
  voiceFailureCopy, type Selection } from './model';
import { useDictation, type UseDictationOptions } from './use-dictation';

export interface VoiceReflectionProps {
  /** The owner's LocalVault (CS composes the per-account instance). Saving is disabled unless unlocked. */
  vault: Pick<VaultPort, 'status' | 'locked' | 'saveJournal' | 'saveReflection' | 'subscribe' | 'getVersion'>;
  /** Defaults to the authenticated /api/reflections client. */
  reflect?: (selectedText: string, clientRequestId: string, signal?: AbortSignal) => Promise<PrivateReflection>;
  /** Defaults to the authenticated /api/voice/session client. Pass null to hide voice (typed only). */
  getVoiceSession?: ((signal?: AbortSignal) => Promise<VoiceSession>) | null;
  /**
   * The reflection's suggested share, held in memory only. CS routes it into the device-only preview and
   * per-item approval; nothing is shared until the owner approves there. Called with null when cleared.
   */
  onCandidate?: (candidate: SignalCandidate | null, entryLocalId: string) => void;
  /** Test seams for the dictation hook. */
  dictation?: Pick<UseDictationOptions, 'mic' | 'socket'>;
}

type ReflectState =
  | { phase: 'idle' }
  | { phase: 'pending'; abort: AbortController }
  | { phase: 'done'; reflection: string; candidate: SignalCandidate | null; scope: 'selection' | 'entry' }
  | { phase: 'failed'; message: string };

const errorCode = (e: unknown) => e instanceof RouteError ? e.code
  : (e as { name?: string })?.name === 'AbortError' ? 'aborted' : 'unavailable';

/**
 * AI-R1 voice/reflection experience: record → stop → correct the transcript in the entry → reflect on the
 * selected text → save entry and reflection locally. Typed entry works throughout; voice failures never block
 * it. The candidate never touches the vault or the network from here.
 */
export function VoiceReflection({ vault, reflect, getVoiceSession, onCandidate, dictation }: VoiceReflectionProps) {
  const reflectFn = useMemo(() => reflect ?? createReflectionClient().reflect, [reflect]);
  const sessionFn = useMemo(() => getVoiceSession === null ? null
    : getVoiceSession ?? createVoiceSessionClient().createSession, [getVoiceSession]);
  const noSession = useCallback(async (): Promise<VoiceSession> => { throw new RouteError(503, 'unavailable'); }, []);
  const voice = useDictation({ getSession: sessionFn ?? noSession, ...dictation });

  const [entryId, setEntryId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState<Selection | undefined>();
  const [result, setResult] = useState<ReflectState>({ phase: 'idle' });
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<{ stop(): void } | null>(null);
  const [, setVaultVersion] = useState(() => vault.getVersion());
  const entry = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => vault.subscribe(() => setVaultVersion(vault.getVersion())), [vault]);
  // Leaving the page stops playback and abandons any in-flight reflection.
  useEffect(() => () => { speaking?.stop(); }, [speaking]);
  useEffect(() => () => { if (result.phase === 'pending') result.abort.abort(); }, [result]);
  // The owner talking over read-aloud interrupts it.
  useEffect(() => { if (voice.snapshot.speaking) speaking?.stop(); }, [voice.snapshot.speaking, speaking]);

  const recording = voice.snapshot.state === 'starting' || voice.snapshot.state === 'listening';
  const finalizing = voice.snapshot.state === 'finalizing';
  const voiceError = voice.snapshot.state === 'error' ? voice.snapshot.error : null;
  const vaultReady = vault.status.kind === 'live' && !vault.locked;
  const pending = result.phase === 'pending';
  const toSend = textToReflect(draft, selection);

  function clearCandidate() {
    onCandidate?.(null, entryId);
  }

  async function stopRecording() {
    const at = selection ?? { start: draft.length, end: draft.length };
    const transcript = await voice.stop();
    if (!transcript) return;
    setDraft(current => {
      const next = insertTranscript(current, transcript, at);
      queueMicrotask(() => { entry.current?.focus(); entry.current?.setSelectionRange(next.caret, next.caret); });
      return next.text;
    });
    setSelection(undefined);
  }

  async function runReflection() {
    if (!toSend.ok || pending) return;
    speaking?.stop();
    const abort = new AbortController();
    setResult({ phase: 'pending', abort });
    clearCandidate();
    try {
      const reply = await reflectFn(toSend.text, crypto.randomUUID(), abort.signal);
      if (abort.signal.aborted) return;
      const { persist, memoryOnly } = splitReflection(reply);
      setResult({ phase: 'done', reflection: persist.reflection, candidate: memoryOnly, scope: toSend.scope });
    } catch (e) {
      setResult(errorCode(e) === 'aborted' ? { phase: 'idle' } : { phase: 'failed', message: reflectFailureCopy(errorCode(e)) });
    }
  }

  async function save() {
    if (!vaultReady || !draft.trim()) return;
    try {
      await vault.saveJournal({ localId: entryId, text: draft });
      if (result.phase === 'done') await vault.saveReflection(entryId, result.reflection);
      setSaveNote(result.phase === 'done' ? 'Entry and reflection saved to your local vault.' : 'Entry saved to your local vault.');
    } catch (e) {
      setSaveNote(e instanceof Error && e.message === 'vault_locked' ? 'Vault is locked: unlock it to save.' : 'Could not save this entry.');
    }
  }

  function startNew() {
    voice.cancel();
    speaking?.stop();
    if (result.phase === 'pending') result.abort.abort();
    clearCandidate();
    setDraft(''); setSelection(undefined); setResult({ phase: 'idle' }); setSaveNote(null);
    setEntryId(crypto.randomUUID());
  }

  async function readAloud(text: string) {
    if (!sessionFn) return;
    if (speaking) { speaking.stop(); setSpeaking(null); return; }
    try {
      const session = await sessionFn();
      if (!mounted.current || vault.locked) return;
      const playback = speak(session, speakableText(text));
      setSpeaking(playback);
      await playback.done.catch(() => undefined);
    } catch {
      // Read-aloud is optional; the text stays on screen.
    } finally {
      setSpeaking(null);
    }
  }

  const suggestion = result.phase === 'done' ? describeCandidate(result.candidate) : null;

  return (
    <div className="space-y-6">
      <section aria-labelledby="voice-entry-heading" className="space-y-3">
        <h2 id="voice-entry-heading" className="sr-only">New entry</h2>
        <Label htmlFor="voice-entry" className="text-sm text-muted-foreground">
          Type privately, or record through Cartesia and then correct the transcript here. Reflection sends your selected text to Claude.
        </Label>
        <Textarea id="voice-entry" ref={entry} rows={12} value={draft} disabled={recording || finalizing}
          onChange={e => { setDraft(e.target.value); setSaveNote(null); }}
          onSelect={e => {
            const t = e.currentTarget;
            setSelection(t.selectionEnd > t.selectionStart ? { start: t.selectionStart, end: t.selectionEnd } : undefined);
          }}
          placeholder="What is on your mind?" className="min-h-64 resize-y p-4 text-base leading-relaxed md:text-base" />

        {(recording || finalizing) && (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {finalizing ? 'Finishing transcript…' : voice.snapshot.state === 'starting' ? 'Starting microphone…'
              : voice.snapshot.partial || voice.snapshot.transcript ? `Hearing: ${[voice.snapshot.transcript, voice.snapshot.partial].filter(Boolean).join(' ')}`
              : 'Listening…'}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {sessionFn && !recording && !finalizing && (
            <Button variant="outline" onClick={() => { voice.reset(); void voice.start(); }} disabled={pending}>Record</Button>
          )}
          {recording && <Button onClick={() => void stopRecording()} disabled={voice.snapshot.state === 'starting'}>Stop</Button>}
          {(recording || finalizing) && <Button variant="ghost" onClick={voice.cancel}>Discard recording</Button>}
          <Button variant="secondary" onClick={() => void runReflection()} disabled={!toSend.ok || pending || recording || finalizing}>
            {selection ? 'Reflect on selection' : 'Reflect'}
          </Button>
          {pending && <Button variant="ghost" onClick={() => result.abort.abort()}>Cancel</Button>}
          <Button onClick={() => void save()} disabled={!vaultReady || !draft.trim() || recording || finalizing}>Save to vault</Button>
          {(draft || result.phase !== 'idle') && <Button variant="ghost" onClick={startNew}>New entry</Button>}
        </div>

        <div className="space-y-1 text-sm text-muted-foreground" aria-live="polite">
          {voiceError && <p role="alert">{voiceFailureCopy(voiceError)}</p>}
          {!toSend.ok && toSend.reason === 'too_long' && <p>Select a shorter passage to reflect on (up to 8,000 characters).</p>}
          {!vaultReady && <p>{vault.status.kind !== 'live' ? 'Vault unavailable: saving is disabled.' : 'Vault is locked: unlock it to save.'}</p>}
          {pending && <p>Reflecting on {toSend.ok && toSend.scope === 'selection' ? 'your selection' : 'this entry'}…</p>}
          {saveNote && <p role="status" className="text-foreground">{saveNote}</p>}
        </div>
      </section>

      {result.phase === 'failed' && (
        <Alert variant="destructive"><AlertTitle>Reflection</AlertTitle><AlertDescription>{result.message}</AlertDescription></Alert>
      )}

      {result.phase === 'done' && (
        <Card>
          <CardHeader><CardTitle>Reflection</CardTitle></CardHeader>
          <CardContent className="space-y-4 leading-relaxed">
            <p className="whitespace-pre-line">{result.reflection}</p>
            {suggestion && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{suggestion}</p>
                <p className="text-muted-foreground">Nothing has been shared. You can review exactly what a person would see first.</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {sessionFn && <Button variant="outline" onClick={() => void readAloud(result.reflection)}>{speaking ? 'Stop reading' : 'Read aloud'}</Button>}
            {suggestion && onCandidate && (
              <Button variant="secondary" onClick={() => onCandidate(result.candidate, entryId)}>Review what to share</Button>
            )}
          </CardFooter>
        </Card>
      )}

      <Alert>
        <AlertTitle>Provider processing notice</AlertTitle>
        <AlertDescription className="text-pretty">
          Your entry stays on this device. When you ask for a reflection, only the text you selected is sent transiently to
          Claude to write it; when you record, audio streams to Cartesia for transcription, and read-aloud sends the reflection
          to Cartesia. Your connections never see any of it.
        </AlertDescription>
      </Alert>
    </div>
  );
}
