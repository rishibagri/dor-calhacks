// Drafts a friend-of-friend first message with Claude. The owner edits and sends it themselves.
import { auth } from '@clerk/nextjs/server';
import { ClaudeOpenerAdapter, RateLimiter, handleOpenerRequest, type RouteSession } from '@dor/agents';

// Usage lines are metadata only (model, timing, cache hits, outcome): never message text or user IDs.
const opener = new ClaudeOpenerAdapter({ model: process.env.DOR_CLAUDE_MODEL || undefined,
  onUsage: usage => console.log(JSON.stringify({ at: new Date().toISOString(), event: 'opener_call', ...usage })) });
const limiter = new RateLimiter({ limit: 20, windowMs: 60_000 });

async function session(): Promise<RouteSession> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return { configured: false, userId: null };
  const { userId } = await auth();
  return { configured: true, userId };
}

export async function POST(request: Request): Promise<Response> {
  return handleOpenerRequest(request, { session: await session(), opener, limiter });
}
