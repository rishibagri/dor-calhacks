import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { ProviderError, toProviderError } from '../errors.js';
import { OPENER_SYSTEM_PROMPT } from './opener-prompt.js';

export const DEFAULT_OPENER_MODEL = 'claude-opus-5-5';
export const MAX_OPENER_CHARS = 200;
const MAX_FIELD = 280;
const MAX_TAGS = 12;

const shortText = z.string().max(MAX_FIELD).default('');
const tags = z.array(z.string().max(40)).max(MAX_TAGS).default([]);

/** Everything the opener may use: the candidate card as the sender sees it, and the sender's own profile. */
export const OpenerRequestSchema = z.object({
  candidate: z.object({
    viaName: z.string().min(1).max(64),
    hops: z.number().int().min(2).max(3),
    mutualCount: z.number().int().min(1).max(50),
    sharedTags: tags,
    area: z.string().max(64).default(''),
  }).strict(),
  sender: z.object({
    bio: shortText, upTo: shortText, availability: shortText, interests: tags, homeArea: z.string().max(64).default(''),
  }).strict(),
}).strict();
export type OpenerRequest = z.infer<typeof OpenerRequestSchema>;

const ModelOpenerSchema = z.object({
  message: z.string(),
  angle: z.enum(['shared_interest', 'new_in_town', 'mutual_friend', 'activity_invite']),
  suggestion: z.string(),
});

export interface Opener {
  message: string;
  angle: z.infer<typeof ModelOpenerSchema>['angle'];
  /** A concrete first thing to do together, or ''. */
  suggestion: string;
}

export interface OpenerPort { draft(input: OpenerRequest): Promise<Opener> }

export interface ClaudeOpenerOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  client?: Anthropic;
  onUsage?: (usage: { model: string; durationMs: number; outcome: string; cacheReadTokens: number | null }) => void;
}

/** Context block sent per request; the long few-shot system prompt before it is cached. */
export function describeOpenerContext(input: OpenerRequest): string {
  const { candidate: c, sender: s } = input;
  const via = c.hops === 2 ? `${c.viaName} (a friend of yours) knows them directly` : `They know a friend of ${c.viaName}'s`;
  return [
    '<candidate>',
    `connection: ${via}`,
    `mutual friends leading to them: ${c.mutualCount}`,
    `area: ${c.area || 'unknown'}`,
    `shared interests: ${c.sharedTags.join(', ') || 'none listed'}`,
    '</candidate>',
    '<sender>',
    `home area: ${s.homeArea || 'unknown'}`,
    `bio: ${s.bio || '(none)'}`,
    `up to lately: ${s.upTo || '(none)'}`,
    `usually free: ${s.availability || '(none)'}`,
    `interests: ${s.interests.join(', ') || '(none)'}`,
    '</sender>',
  ].join('\n');
}

export function toOpener(output: z.infer<typeof ModelOpenerSchema>): Opener {
  const message = output.message.trim().replace(/\s+/g, ' ');
  if (!message) throw new ProviderError('anthropic', 'invalid_output');
  const clipped = message.length > MAX_OPENER_CHARS ? `${message.slice(0, MAX_OPENER_CHARS - 1).trimEnd()}…` : message;
  return { message: clipped, angle: output.angle, suggestion: output.suggestion.trim().slice(0, 120) };
}

/** Drafts a first message the sender can edit and send themselves. Never sends anything. */
export class ClaudeOpenerAdapter implements OpenerPort {
  private client: Anthropic | undefined;
  constructor(private readonly options: ClaudeOpenerOptions = {}) { this.client = options.client; }

  async draft(input: OpenerRequest): Promise<Opener> {
    const client = this.getClient();
    const model = this.options.model ?? DEFAULT_OPENER_MODEL;
    const started = Date.now();
    let cacheRead: number | null = null;
    const report = (outcome: string) =>
      this.options.onUsage?.({ model, outcome, durationMs: Date.now() - started, cacheReadTokens: cacheRead });
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(ModelOpenerSchema) },
        system: [{ type: 'text', text: OPENER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: describeOpenerContext(input) }],
      });
    } catch (error) {
      report('error');
      if (error instanceof Anthropic.APIError) throw toProviderError('anthropic', error);
      throw new ProviderError('anthropic', 'invalid_output');
    }
    cacheRead = response.usage.cache_read_input_tokens ?? null;
    if (response.stop_reason === 'refusal') { report('refused'); throw new ProviderError('anthropic', 'refused'); }
    if (!response.parsed_output) { report('invalid_output'); throw new ProviderError('anthropic', 'invalid_output'); }
    report('ok');
    return toOpener(response.parsed_output);
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderError('anthropic', 'not_configured');
    this.client = new Anthropic({ apiKey, timeout: this.options.timeoutMs ?? 8000, maxRetries: 1, logLevel: 'off' });
    return this.client;
  }
}
