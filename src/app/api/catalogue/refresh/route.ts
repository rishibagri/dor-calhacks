// D057 live catalogue refresh: POST starts one server-side Apify refresh (single-flight), GET reports progress.
// Signed-in callers only. The browser never sees the Apify token, the worker token or any source URL beyond what the
// guarded catalogue views already show.
import { auth } from '@clerk/nextjs/server';
import { refreshState, startRefresh } from '@/server/catalogue/refresh';

export const runtime = 'nodejs';
const headers = { 'cache-control': 'no-store' };

async function caller(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return null;
  return (await auth()).userId;
}

export async function GET(): Promise<Response> {
  if (!(await caller())) return Response.json({ error: 'unauthenticated' }, { status: 401, headers });
  return Response.json({ state: refreshState() }, { headers });
}

export async function POST(): Promise<Response> {
  const userId = await caller();
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers });
  return Response.json({ state: startRefresh(process.env, userId) }, { status: 202, headers });
}
