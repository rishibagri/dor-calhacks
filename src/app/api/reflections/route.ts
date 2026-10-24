// AI-owned route (claimed in docs/updates/ai.md; CS owns session middleware and app wiring).
// Transient Claude reflection over owner-selected text. Never log or persist request bodies.
import { auth } from '@clerk/nextjs/server';
import { ClaudeReflectionAdapter, RateLimiter, handleReflectionRequest, type RouteSession } from '@kinetic/agents';

const reflection = new ClaudeReflectionAdapter({ model: process.env.KINETIC_CLAUDE_MODEL || undefined });
const limiter = new RateLimiter({ limit: 12, windowMs: 60_000 });

async function session(): Promise<RouteSession> {
  // Without Clerk the proxy passes requests through; refuse rather than serve anonymous callers.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return { configured: false, userId: null };
  const { userId } = await auth();
  return { configured: true, userId };
}

export async function POST(request: Request): Promise<Response> {
  return handleReflectionRequest(request, { session: await session(), reflection, limiter });
}
