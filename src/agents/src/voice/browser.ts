/**
 * Browser voice helpers: microphone capture, streaming Cartesia STT (`ink-2`, turn detection) and interruptible TTS.
 * Uses only the short-lived scoped token from POST /api/voice/session. Audio and transcripts are never sent to
 * dor servers or persisted here; the caller stores the final transcript in the owner's local vault.
 * Wire protocol per @cartesia/cartesia-js 4.2.0 (`/stt/turns/websocket`, raw PCM frames, `{"type":"close"}`).
 */
import type { VoiceSession } from '@dor/contracts';

export const CARTESIA_HTTP_BASE = 'https://api.cartesia.ai';
export const CARTESIA_STT_WS_URL = 'wss://api.cartesia.ai/stt/turns/websocket';
const CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz
const MAX_QUEUED_CHUNKS = 50; // 5 s of audio while the socket opens
const FINALIZE_TIMEOUT_MS = 5000;

/** Why voice stopped working; every code means "offer typed entry". */
export type VoiceErrorCode = 'mic_denied' | 'mic_unavailable' | 'unauthenticated' | 'rate_limited' | 'unavailable'
  | 'network' | 'provider';
export class VoiceError extends Error {
  constructor(readonly code: VoiceErrorCode) {
    super(code);
    this.name = 'VoiceError';
  }
}

/** Float32 mono at any rate → PCM s16 at 16 kHz, by averaging each output window. */
export function toPcm16(input: Float32Array, inputRate: number, outputRate = 16000): Int16Array {
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / (to - from)));
    out[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return out;
}

export function streamingSttUrl(session: VoiceSession): string {
  const url = new URL(CARTESIA_STT_WS_URL);
  url.searchParams.set('model', session.sttModel);
  url.searchParams.set('encoding', session.sttEncoding);
  url.searchParams.set('sample_rate', String(session.sttSampleRate));
  url.searchParams.set('cartesia_version', session.apiVersion);
  url.searchParams.set('access_token', session.accessToken);
  return url.toString();
}

/** Minimal WebSocket surface used here, so tests can inject a fake. */
export interface SocketLike {
  readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number): void;
}
export type SocketFactory = (url: string) => SocketLike;
export interface MicCapture { stop(): void }
export type MicStarter = (onFrame: (frame: Float32Array, sampleRate: number) => void) => Promise<MicCapture>;

export type DictationState = 'idle' | 'starting' | 'listening' | 'finalizing' | 'stopped' | 'error';
export interface DictationSnapshot {
  state: DictationState;
  /** Final text of completed turns. */
  transcript: string;
  /** Text of the turn in progress (cumulative; Cartesia never revises emitted text). */
  partial: string;
  /** True while the user is speaking; use it to interrupt TTS playback. */
  speaking: boolean;
  error: VoiceErrorCode | null;
}

export interface VoiceDictationDeps {
  /** Usually createVoiceSessionClient().createSession; called once per start(). */
  getSession: (signal?: AbortSignal) => Promise<VoiceSession>;
  onChange: (snapshot: DictationSnapshot) => void;
  socket?: SocketFactory;
  mic?: MicStarter;
}

/**
 * One dictation: start() opens the mic and the STT socket, stop() finalizes and resolves the transcript,
 * cancel() discards everything immediately. Any failure lands in state `error` with a code; the UI then offers
 * typed entry. Not reusable after stop/cancel; create a new instance per recording.
 */
export class VoiceDictation {
  private snapshot: DictationSnapshot = { state: 'idle', transcript: '', partial: '', speaking: false, error: null };
  private socket: SocketLike | null = null;
  private capture: MicCapture | null = null;
  private readonly abort = new AbortController();
  private queue: Int16Array[] = [];
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private finalized: { resolve: (text: string) => void } | null = null;

  constructor(private readonly deps: VoiceDictationDeps) {}

  get current(): DictationSnapshot { return { ...this.snapshot }; }

  async start(): Promise<void> {
    if (this.snapshot.state !== 'idle') return;
    this.update({ state: 'starting' });
    let session: VoiceSession;
    try {
      session = await this.deps.getSession(this.abort.signal);
    } catch (error) {
      return this.fail(routeErrorCode(error));
    }
    if (this.isClosed()) return;
    try {
      this.capture = await (this.deps.mic ?? startMicCapture)((frame, rate) => this.onAudio(frame, rate));
    } catch (error) {
      return this.fail(error instanceof VoiceError ? error.code : 'mic_unavailable');
    }
    if (this.isClosed()) { this.capture.stop(); return; }
    const socket = (this.deps.socket ?? browserSocket)(streamingSttUrl(session));
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      for (const chunk of this.queue) socket.send(chunk);
      this.queue = [];
    };
    socket.onmessage = (ev) => this.onEvent(ev.data);
    socket.onerror = () => { if (this.snapshot.state === 'listening') this.fail('network'); };
    socket.onclose = (ev) => this.onClose(ev.code);
    this.update({ state: 'listening' });
  }

  /** Stop recording, let Cartesia finish buffered audio, and resolve with the final transcript. */
  stop(): Promise<string> {
    if (this.snapshot.state !== 'listening') return Promise.resolve(this.snapshot.transcript);
    this.capture?.stop();
    this.flushPending();
    this.update({ state: 'finalizing', speaking: false });
    return new Promise(resolve => {
      this.finalized = { resolve };
      const socket = this.socket;
      if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'close' }));
      else this.finish();
      setTimeout(() => { if (this.snapshot.state === 'finalizing') { socket?.close(1000); this.finish(); } }, FINALIZE_TIMEOUT_MS);
    });
  }

  /** Discard audio and text immediately. */
  cancel(): void {
    this.abort.abort();
    this.capture?.stop();
    this.detachSocket(4000);
    this.queue = []; this.pending = []; this.pendingSamples = 0;
    this.update({ state: 'stopped', transcript: '', partial: '', speaking: false });
    this.finalized?.resolve('');
    this.finalized = null;
  }

  private onAudio(frame: Float32Array, sampleRate: number): void {
    if (this.snapshot.state !== 'listening') return;
    const pcm = toPcm16(frame, sampleRate);
    this.pending.push(pcm);
    this.pendingSamples += pcm.length;
    if (this.pendingSamples >= CHUNK_SAMPLES) this.flushPending();
  }

  private flushPending(): void {
    if (this.pendingSamples === 0) return;
    const chunk = new Int16Array(this.pendingSamples);
    let offset = 0;
    for (const part of this.pending) { chunk.set(part, offset); offset += part.length; }
    this.pending = []; this.pendingSamples = 0;
    const socket = this.socket;
    if (socket && socket.readyState === 1) socket.send(chunk);
    else if (this.queue.length < MAX_QUEUED_CHUNKS) this.queue.push(chunk);
  }

  private onEvent(data: unknown): void {
    if (typeof data !== 'string') return;
    let event: { type?: unknown; transcript?: unknown; status_code?: unknown };
    try { event = JSON.parse(data); } catch { return; }
    const text = typeof event.transcript === 'string' ? event.transcript.trim() : '';
    switch (event.type) {
      case 'turn.start': return this.update({ speaking: true });
      case 'turn.update':
      case 'turn.eager_end': return this.update({ partial: text });
      case 'turn.resume': return this.update({ speaking: true });
      case 'turn.end': return this.update({ transcript: join(this.snapshot.transcript, text), partial: '', speaking: false });
      case 'error': {
        const status = typeof event.status_code === 'number' ? event.status_code : 0;
        return this.fail(status === 401 || status === 403 ? 'unauthenticated' : status === 429 ? 'rate_limited' : 'provider');
      }
    }
  }

  private onClose(code: number): void {
    this.socket = null;
    if (this.snapshot.state === 'finalizing') return this.finish();
    if (this.snapshot.state === 'listening') this.fail(code === 1000 ? 'provider' : 'network');
  }

  private finish(): void {
    if (this.snapshot.state !== 'finalizing') return;
    // Emitted text is final, so a turn cut off by close still counts.
    const transcript = join(this.snapshot.transcript, this.snapshot.partial);
    this.update({ state: 'stopped', transcript, partial: '' });
    this.finalized?.resolve(transcript);
    this.finalized = null;
  }

  private fail(code: VoiceErrorCode): void {
    if (this.isClosed()) return;
    this.capture?.stop();
    this.detachSocket(1000);
    this.update({ state: 'error', error: code, speaking: false });
    this.finalized?.resolve(join(this.snapshot.transcript, this.snapshot.partial));
    this.finalized = null;
  }

  private detachSocket(code: number): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState <= 1) socket.close(code);
  }

  private isClosed(): boolean {
    return this.snapshot.state === 'stopped' || this.snapshot.state === 'error';
  }

  private update(patch: Partial<DictationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange({ ...this.snapshot });
  }
}

export interface SpeakOptions {
  fetch?: typeof fetch;
  /** Plays WAV bytes until done or aborted; defaults to Web Audio. */
  play?: (wav: ArrayBuffer, signal: AbortSignal) => Promise<void>;
}

/** Speak text with Cartesia TTS from the browser. `stop()` interrupts both the request and playback. */
export function speak(session: VoiceSession, text: string, options: SpeakOptions = {}): { stop(): void; done: Promise<void> } {
  const abort = new AbortController();
  const done = (async () => {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    let response: Response;
    try {
      response = await doFetch(`${CARTESIA_HTTP_BASE}/tts/bytes`, {
        method: 'POST', signal: abort.signal,
        headers: { authorization: `Bearer ${session.accessToken}`, 'cartesia-version': session.apiVersion,
          'content-type': 'application/json' },
        body: JSON.stringify({ model_id: session.ttsModel, transcript: text, voice: { mode: 'id', id: session.ttsVoiceId },
          output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 }, language: 'en', save: false }),
      });
    } catch {
      if (abort.signal.aborted) return;
      throw new VoiceError('network');
    }
    if (!response.ok) throw new VoiceError(response.status === 401 || response.status === 403 ? 'unauthenticated'
      : response.status === 429 ? 'rate_limited' : 'provider');
    const wav = await response.arrayBuffer();
    if (abort.signal.aborted) return;
    await (options.play ?? playWav)(wav, abort.signal);
  })();
  return { stop: () => abort.abort(), done };
}

function join(a: string, b: string): string {
  return [a, b].filter(Boolean).join(' ');
}

function routeErrorCode(error: unknown): VoiceErrorCode {
  const status = (error as { status?: unknown })?.status;
  if (status === 401) return 'unauthenticated';
  if (status === 429) return 'rate_limited';
  if (typeof status === 'number') return 'unavailable';
  return 'network';
}

const browserSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

const PCM_WORKLET = `class DorPcm extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('dor-pcm', DorPcm);`;

/** Mono microphone capture via AudioWorklet. Throws VoiceError('mic_denied' | 'mic_unavailable'). */
export const startMicCapture: MicStarter = async (onFrame) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new VoiceError('mic_unavailable');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    throw new VoiceError((error as { name?: string })?.name === 'NotAllowedError' ? 'mic_denied' : 'mic_unavailable');
  }
  const context = new AudioContext();
  try {
    const moduleUrl = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'application/javascript' }));
    try { await context.audioWorklet.addModule(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'dor-pcm');
    const mute = context.createGain();
    mute.gain.value = 0;
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => onFrame(ev.data, context.sampleRate);
    source.connect(node).connect(mute).connect(context.destination);
    return { stop() {
      node.port.onmessage = null;
      source.disconnect();
      stream.getTracks().forEach(track => track.stop());
      void context.close();
    } };
  } catch {
    stream.getTracks().forEach(track => track.stop());
    void context.close();
    throw new VoiceError('mic_unavailable');
  }
};

async function playWav(wav: ArrayBuffer, signal: AbortSignal): Promise<void> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(wav);
    if (signal.aborted) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    await new Promise<void>(resolve => {
      source.onended = () => resolve();
      signal.addEventListener('abort', () => { source.stop(); resolve(); }, { once: true });
      source.start();
    });
  } finally {
    void context.close();
  }
}
