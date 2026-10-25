// Reasoning runtime transport (D052). One structured Claude call that proposes ranked relational actions for the
// owner's own entry; the deterministic Reasoning core on the owner's device decides what is allowed. Mirrors the AI
// reflection adapter (src/agents/src/reflection/claude.ts): Clerk session, rate limit, structured output, fallbacks.
// Never logs or stores request bodies. Receives connection refs and the names the writer already used, nothing else.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { RateLimiter } from '@dor/agents';
import { REASONING_SYSTEM_PROMPT } from '@/reasoning/runtime/prompt';
import { EVENT_KINDS } from '@/reasoning/runtime/live';
import { MEMORY_KINDS } from '@/reasoning/runtime/memory';
import { CANDIDATE_ACTIONS, LEVELS, REASON_CODES, REASONING_MODES, REASSESS_CONDITIONS } from '@/reasoning/core/vocabulary';

const MODEL = process.env.DOR_REASONING_MODEL || 'claude-opus-5-5';
const MAX_TEXT = 8000;
const limiter = new RateLimiter({ limit: 12, windowMs: 60_000 });
let client: Anthropic | null = null;

const RequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT),
  localTime: z.string().max(40),
  people: z.array(z.object({
    ref: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/),
    mentionedAs: z.string().max(40).nullable(),
    excluded: z.boolean(),
    paused: z.boolean(),
  }).strict()).max(30),
  // D056: facts the writer's own device remembered from earlier entries.
  memory: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    kind: z.enum(MEMORY_KINDS),
    ref: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/).nullable(),
    daysAgo: z.number().int().min(0).max(400),
    text: z.string().max(160),
  }).strict()).max(40).default([]),
}).strict();

const ModelSchema = z.object({
  situation: z.object({
    eventKind: z.enum(EVENT_KINDS), topic: z.string().nullable(), windowMinutes: z.number().int(),
    windowConfidence: z.enum(LEVELS), doesNotWantToTalk: z.boolean(),
  }),
  people: z.array(z.object({ ref: z.string(), sensitiveTopics: z.array(z.string()) })),
  proposals: z.array(z.object({
    rank: z.number().int(), action: z.enum(CANDIDATE_ACTIONS), targetRef: z.string().nullable(),
    requestedMode: z.enum(REASONING_MODES), supportMode: z.enum(['short_call', 'encouraging_note', 'shared_activity']).nullable(),
    revealValue: z.enum(LEVELS), confidence: z.enum(LEVELS), timing: z.enum(['now', 'after_delay', 'not_now']),
    delayMinutes: z.number().int().nullable(), reassessMinutes: z.number().int().nullable(),
    reassessCondition: z.enum(REASSESS_CONDITIONS).nullable(), rationale: z.array(z.enum(REASON_CODES)), evidence: z.array(z.string()),
    talkingPoint: z.string().nullable(),
  })),
  memory: z.object({
    add: z.array(z.object({ kind: z.enum(MEMORY_KINDS), text: z.string(), ref: z.string().nullable(), ttlDays: z.number().int() })),
    expire: z.array(z.string()),
  }),
});

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return json(503, { error: 'not_configured' });
  const { userId } = await auth();
  if (!userId) return json(401, { error: 'unauthenticated' });
  if (!limiter.take(userId)) return json(429, { error: 'rate_limited' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { error: 'not_configured' });
  let body: z.infer<typeof RequestSchema>;
  try { body = RequestSchema.parse(await request.json()); } catch { return json(400, { error: 'invalid_input' }); }

  client ??= new Anthropic({ apiKey, timeout: 12_000, maxRetries: 1, logLevel: 'off' });
  const started = Date.now();
  const people = body.people.map(p => `- ref ${p.ref}: mentionedAs ${p.mentionedAs === null ? 'null' : JSON.stringify(p.mentionedAs)}${p.excluded ? ', EXCLUDED by the writer' : ''}${p.paused ? ', PAUSED by the writer' : ''}`).join('\n');
  const memory = body.memory.map(m => `- id ${m.id} (${m.kind}, ${m.daysAgo === 0 ? 'today' : `${m.daysAgo}d ago`}${m.ref ? `, about ref ${m.ref}` : ''}): ${m.text}`).join('\n');
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(ModelSchema) },
      // Frozen prompt, cached across calls; everything that varies goes in the user turn.
      system: [{ type: 'text', text: REASONING_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Writer's local time: ${body.localTime}\nAccepted connections:\n${people || '(none)'}\n\n` +
        `Remembered from earlier entries:\n${memory || '(nothing yet)'}\n\nNew journal entry:\n${body.text}` }],
    });
    // Metadata only: never text, refs or user ids.
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'reasoning_call', model: MODEL, durationMs: Date.now() - started,
      outcome: response.stop_reason, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? null }));
    if (response.stop_reason === 'refusal' || !response.parsed_output) return json(502, { error: 'invalid_output' });
    return json(200, response.parsed_output);
  } catch (error) {
    const code = error instanceof Anthropic.RateLimitError ? 'provider_rate_limited'
      : error instanceof Anthropic.APIError ? 'provider_error' : 'invalid_output';
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'reasoning_call', model: MODEL, durationMs: Date.now() - started, outcome: code }));
    return json(502, { error: code });
  }
}
