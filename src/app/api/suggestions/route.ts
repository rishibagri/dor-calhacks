// D057 "for you" suggestions: one structured Claude call that picks catalogue items for the caller's own interests.
// Input is the caller's interests and a device-pre-ranked list of public catalogue items; output is validated ids.
// Mirrors /api/reasoning (Clerk session, rate limit, structured output, fallbacks). Never logs request bodies.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { RateLimiter } from '@dor/agents';
import { MAX_CANDIDATES, SUGGESTIONS_SYSTEM_PROMPT, validatePicks, type SuggestionItem } from '@/reasoning/runtime/suggestions';

const MODEL = process.env.DOR_REASONING_MODEL || 'claude-opus-5-5';
const limiter = new RateLimiter({ limit: 10, windowMs: 60_000 });
let client: Anthropic | null = null;

const ItemSchema = z.object({
  id: z.string().max(140), kind: z.enum(['event', 'place']), title: z.string().max(200), tags: z.array(z.string().max(40)).max(12),
  keywords: z.array(z.string().max(40)).max(12), summary: z.string().max(300), areaKey: z.string().max(60).nullable(),
  startsAt: z.string().max(40).nullable(), rating: z.number().nullable(), reviews: z.number().nullable(), label: z.string().max(80),
}).strict();
const RequestSchema = z.object({
  interests: z.array(z.string().max(40)).max(30),
  memory: z.array(z.string().max(160)).max(20),
  areaLabel: z.string().max(80).nullable(),
  localTime: z.string().max(40),
  items: z.array(ItemSchema).max(MAX_CANDIDATES),
}).strict();
const PicksSchema = z.object({ picks: z.array(z.object({ id: z.string(), why: z.string() })) });

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
  if (body.items.length === 0) return json(200, { picks: [] });

  client ??= new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1, logLevel: 'off' });
  const list = body.items.map((i) => `- id ${i.id} | ${i.kind} | ${JSON.stringify(i.title)} | ${i.kind === 'event' ? `starts ${i.startsAt}` : `${i.rating ?? '?'}★ (${i.reviews ?? 0} reviews)`} | ${i.label} | tags: ${[...i.tags, ...i.keywords].join(', ')}${i.summary ? ` | ${JSON.stringify(i.summary.slice(0, 200))}` : ''}`).join('\n');
  const started = Date.now();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(PicksSchema) },
      system: SUGGESTIONS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Local time: ${body.localTime}\nTheir area: ${body.areaLabel ?? 'not set'}\nInterests: ${body.interests.join(', ') || 'none chosen'}\nTheir own notes: ${body.memory.join(' | ') || 'none'}\n\nItems:\n${list}` }],
    });
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'suggestions_call', model: MODEL, durationMs: Date.now() - started,
      outcome: response.stop_reason, items: body.items.length, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }));
    if (response.stop_reason === 'refusal' || !response.parsed_output) return json(502, { error: 'invalid_output' });
    return json(200, { picks: validatePicks(response.parsed_output.picks, body.items as SuggestionItem[]) });
  } catch (error) {
    const code = error instanceof Anthropic.APIError ? 'provider_error' : 'invalid_output';
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'suggestions_call', model: MODEL, durationMs: Date.now() - started, outcome: code }));
    return json(502, { error: code });
  }
}
