// AI-owned route (claimed in docs/updates/ai.md; CS owns session middleware and app wiring).
// Mints a short-lived scoped Cartesia token for the signed-in browser; the master key never leaves the server.
import { auth } from '@clerk/nextjs/server';
import { CartesiaVoiceAdapter, RateLimiter, handleVoiceSessionRequest, type RouteSession } from '@dor/agents';

const voice = new CartesiaVoiceAdapter();
const limiter = new RateLimiter({ limit: 10, windowMs: 60_000 });

async function session(): Promise<RouteSession> {
  // Without Clerk the proxy passes requests through; refuse rather than serve anonymous callers.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return { configured: false, userId: null };
  const { userId } = await auth();
  return { configured: true, userId };
}

export async function POST(request: Request): Promise<Response> {
  return handleVoiceSessionRequest(request, { session: await session(), voice, limiter });
}
