import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { AvailabilitySchema, PrivateReflectionSchema, SupportModeSchema, type PrivateReflection,
  type PrivateReflectionPort, type SignalCandidate } from '@dor/contracts';
import { ProviderError, toProviderError } from '../errors.js';
import { REFLECTION_SYSTEM_PROMPT } from './prompt.js';

export const DEFAULT_REFLECTION_MODEL = 'claude-opus-5-5';
export const MAX_SELECTED_TEXT_CHARS = 8000;

// Model-facing shape: nullable instead of optional so every key is present in the constrained output.
const ModelReflectionSchema = z.object({
  reflection: z.string(),
  candidate: z.object({ supportMode: SupportModeSchema.nullable(), availability: AvailabilitySchema.nullable() }).nullable(),
});
type ModelReflection = z.infer<typeof ModelReflectionSchema>;

export interface ClaudeReflectionOptions {
  apiKey?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  /** Per-call budget from AGENTS_PROTOCOL.md; the SDK retries once on transport failure. */
  timeoutMs?: number;
  client?: Anthropic;
  /** Metadata-only usage per call (R4 cost/latency tracking): never text, prompts or identifiers. */
  onUsage?: (usage: ReflectionUsage) => void;
}

export interface ReflectionUsage {
  model: string;
  durationMs: number;
  /** `ok`, or the ProviderError code the call ended with. */
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  /** Whether the reply carried a draft candidate (a measure of usefulness, not content). */
  candidate: boolean | null;
}

/**
 * Transient Claude reflection over owner-selected text. Stores nothing, logs nothing, and sends no identifiers.
 * The returned candidate is an owner-only draft; it never becomes an ApprovedSignal without the guarded approval flow.
 */
export class ClaudeReflectionAdapter implements PrivateReflectionPort {
  private client: Anthropic | undefined;
  constructor(private readonly options: ClaudeReflectionOptions = {}) {
    this.client = options.client;
  }

  async reflect(selectedText: string, _requestId: string): Promise<PrivateReflection> {
    const text = selectedText.trim();
    if (!text || text.length > MAX_SELECTED_TEXT_CHARS) throw new ProviderError('anthropic', 'invalid_input');
    const client = this.getClient();
    const model = this.options.model ?? DEFAULT_REFLECTION_MODEL;
    const started = Date.now();
    let usage: Anthropic.Beta.BetaUsage | undefined;
    const report = (outcome: string, candidate: boolean | null) => this.options.onUsage?.({ model, outcome, candidate,
      durationMs: Date.now() - started, inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null,
      cacheReadTokens: usage?.cache_read_input_tokens ?? null });
    try {
      const result = await this.call(client, model, text, u => { usage = u; });
      report('ok', result.candidate !== null);
      return result;
    } catch (error) {
      report(error instanceof ProviderError ? error.code : 'unknown', null);
      throw error;
    }
  }

  private async call(client: Anthropic, model: string, text: string, onUsage: (u: Anthropic.Beta.BetaUsage) => void):
    Promise<PrivateReflection> {
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: this.options.effort ?? 'low', format: betaZodOutputFormat(ModelReflectionSchema) },
        system: REFLECTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) throw toProviderError('anthropic', error);
      // Non-API failures here are output parsing errors from the structured-output helper.
      throw new ProviderError('anthropic', 'invalid_output');
    }
    onUsage(response.usage);
    if (response.stop_reason === 'refusal') throw new ProviderError('anthropic', 'refused');
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new ProviderError('anthropic', 'invalid_output');
    return toPrivateReflection(response.parsed_output);
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderError('anthropic', 'not_configured');
    this.client = new Anthropic({ apiKey, timeout: this.options.timeoutMs ?? 8000, maxRetries: 1, logLevel: 'off' });
    return this.client;
  }
}

export function toPrivateReflection(output: ModelReflection): PrivateReflection {
  let candidate: SignalCandidate | null = null;
  if (output.candidate && (output.candidate.supportMode || output.candidate.availability)) {
    candidate = {};
    if (output.candidate.supportMode) candidate.supportMode = output.candidate.supportMode;
    if (output.candidate.availability) candidate.availability = output.candidate.availability;
  }
  const parsed = PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: output.reflection.trim(), candidate });
  if (!parsed.success) throw new ProviderError('anthropic', 'invalid_output');
  return parsed.data;
}
