// D053 demo backstage: is the coordination worker up? Signed-in callers only; returns a status, never config or URLs.
import { auth } from '@clerk/nextjs/server';

export async function GET(): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return Response.json({ state: 'unknown' }, { headers });
  const { userId } = await auth();
  if (!userId) return Response.json({ state: 'unauthenticated' }, { status: 401, headers });
  const base = process.env.DOR_WORKER_URL;
  if (!base) return Response.json({ state: 'not_configured' }, { headers });
  try {
    const res = await fetch(new URL('/healthz', base), { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return Response.json({ state: res.ok ? 'up' : 'db_disconnected' }, { headers });
  } catch {
    return Response.json({ state: 'down' }, { headers });
  }
}
