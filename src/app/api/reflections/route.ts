// AI-owned route (claimed in docs/updates/ai.md; CS owns session middleware and app wiring).
// Transient Claude reflection over owner-selected text. Never log or persist request bodies.
import { auth } from '@clerk/nextjs/server';
import { tracked } from '@/server/activity';
import { ClaudeReflectionAdapter, InFlightRequests, RateLimiter, handleReflectionRequest, type RouteSession } from '@dor/agents';
import type { PrivateReflection } from '@dor/contracts';

// Usage lines are metadata only (model, timing, token counts, outcome): never text, user IDs or keys.
const reflection = new ClaudeReflectionAdapter({ model: process.env.DOR_CLAUDE_MODEL || undefined,
  onUsage: usage => console.log(JSON.stringify({ at: new Date().toISOString(), event: 'reflection_call', ...usage })) });
const limiter = new RateLimiter({ limit: 12, windowMs: 60_000 });
// Double submits and retries join the running call; nothing is kept after it settles.
const inFlight = new InFlightRequests<PrivateReflection>();

async function session(): Promise<RouteSession> {
  // Without Clerk the proxy passes requests through; refuse rather than serve anonymous callers.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return { configured: false, userId: null };
  const { userId } = await auth();
  return { configured: true, userId };
}

export async function POST(request: Request): Promise<Response> {
  const s = await session();
  // D060 backstage activity (metadata only).
  return tracked('claude', 'journal reflection', s.userId, () => handleReflectionRequest(request, { session: s, reflection, limiter, inFlight }));
}
