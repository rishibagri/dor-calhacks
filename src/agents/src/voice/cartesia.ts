import Cartesia, { toFile } from '@cartesia/cartesia-js';
import { VoiceSessionSchema, type VoicePort, type VoiceSession } from '@dor/contracts';
import { ProviderError, toProviderError } from '../errors.js';

/** Version the pinned SDK sends; browser WebSocket clients pass the same value as `cartesia_version`. */
export const CARTESIA_API_VERSION = '2026-08-14';
export const DEFAULT_VOICE = {
  sttStreamingModel: 'ink-2', sttBatchModel: 'ink-whisper', ttsModel: 'sonic-3.6',
  ttsVoiceId: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
} as const;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_SPOKEN_CHARS = 1000;

export interface CartesiaVoiceOptions {
  apiKey?: string;
  sttBatchModel?: string;
  sttStreamingModel?: string;
  ttsModel?: string;
  ttsVoiceId?: string;
  /** Browser token lifetime; Cartesia allows up to 3600 and recommends minutes. */
  tokenTtlSeconds?: number;
  timeoutMs?: number;
  client?: Cartesia;
  now?: () => Date;
}

/** Server-side Cartesia adapter. The master key stays here; browsers get short-lived scoped tokens only. */
export class CartesiaVoiceAdapter implements VoicePort {
  private client: Cartesia | undefined;
  constructor(private readonly options: CartesiaVoiceOptions = {}) {
    this.client = options.client;
  }

  async createSession(_requestId: string): Promise<VoiceSession> {
    const ttl = this.options.tokenTtlSeconds ?? 60;
    if (!Number.isInteger(ttl) || ttl < 10 || ttl > 600) throw new ProviderError('cartesia', 'invalid_input');
    const issuedAt = (this.options.now ?? (() => new Date()))();
    const { token } = await this.call(c => c.accessToken.create({ grants: { stt: true, tts: true }, expires_in: ttl }));
    const parsed = VoiceSessionSchema.safeParse({
      schemaVersion: 1, provider: 'cartesia', accessToken: token,
      expiresAt: new Date(issuedAt.getTime() + ttl * 1000).toISOString(), apiVersion: CARTESIA_API_VERSION,
      sttModel: this.options.sttStreamingModel ?? DEFAULT_VOICE.sttStreamingModel, sttEncoding: 'pcm_s16le', sttSampleRate: 16000,
      ttsModel: this.options.ttsModel ?? DEFAULT_VOICE.ttsModel, ttsVoiceId: this.options.ttsVoiceId ?? DEFAULT_VOICE.ttsVoiceId,
    });
    if (!parsed.success) throw new ProviderError('cartesia', 'invalid_output');
    return parsed.data;
  }

  /** Batch transcription for uploaded clips (server-proxy path). Streaming turns use the browser session. */
  async transcribe(audio: Uint8Array, _requestId: string): Promise<{ text: string }> {
    const extension = sniffAudioExtension(audio);
    if (!extension || audio.byteLength > MAX_AUDIO_BYTES) throw new ProviderError('cartesia', 'invalid_input');
    const file = await toFile(audio, `clip.${extension}`);
    const result = await this.call(c => c.stt.transcribe({
      file, model: this.options.sttBatchModel ?? DEFAULT_VOICE.sttBatchModel, language: 'en',
    }));
    if (typeof result.text !== 'string') throw new ProviderError('cartesia', 'invalid_output');
    return { text: result.text.trim() };
  }

  async synthesize(text: string, _requestId: string): Promise<{ audio: Uint8Array; mimeType: string }> {
    const transcript = text.trim();
    if (!transcript || transcript.length > MAX_SPOKEN_CHARS) throw new ProviderError('cartesia', 'invalid_input');
    const response = await this.call(c => c.tts.generate({
      model_id: this.options.ttsModel ?? DEFAULT_VOICE.ttsModel, transcript,
      voice: { mode: 'id', id: this.options.ttsVoiceId ?? DEFAULT_VOICE.ttsVoiceId },
      output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 },
      language: 'en', save: false,
    }));
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new ProviderError('cartesia', 'invalid_output');
    return { audio, mimeType: 'audio/wav' };
  }

  private async call<T>(fn: (client: Cartesia) => PromiseLike<T>): Promise<T> {
    const client = this.getClient();
    try {
      return await fn(client);
    } catch (error) {
      throw toProviderError('cartesia', error);
    }
  }

  private getClient(): Cartesia {
    if (this.client) return this.client;
    const apiKey = this.options.apiKey ?? process.env.CARTESIA_API_KEY;
    if (!apiKey) throw new ProviderError('cartesia', 'not_configured');
    this.client = new Cartesia({ apiKey, timeout: this.options.timeoutMs ?? 15000, maxRetries: 1, logLevel: 'off' });
    return this.client;
  }
}

/** Accept only container formats Cartesia batch STT documents; reject anything else before upload. */
export function sniffAudioExtension(bytes: Uint8Array): 'wav' | 'webm' | 'ogg' | 'mp3' | 'flac' | 'm4a' | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.byteLength < 12) return null;
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(4, 4) === 'ftyp') return 'm4a';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return 'mp3';
  return null;
}
