// D060 demo backstage: which provider tools are configured and in use on this live host, plus the recent activity log
// (metadata only, first names only). Signed-in callers; reachable only by URL (the room no longer links to it).
import { auth } from '@clerk/nextjs/server';
import { recentActivity } from '@/server/activity';
import { refreshState } from '@/server/catalogue/refresh';

export const runtime = 'nodejs';
const headers = { 'cache-control': 'no-store' };

interface ClerkSummary { users: number; names: Record<string, string>; lastSignInAt: string | null }
let clerkCache: { at: number; value: ClerkSummary } | null = null;

async function clerkSummary(): Promise<ClerkSummary | null> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return null;
  if (clerkCache && Date.now() - clerkCache.at < 60_000) return clerkCache.value;
  try {
    const res = await fetch('https://api.clerk.com/v1/users?limit=100', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const users = (await res.json()) as { id: string; first_name: string | null; last_sign_in_at: number | null }[];
    const last = users.map((u) => u.last_sign_in_at ?? 0).sort((a, b) => b - a)[0];
    const value = { users: users.length, names: Object.fromEntries(users.map((u) => [u.id, u.first_name || 'someone'])),
      lastSignInAt: last ? new Date(last).toISOString() : null };
    clerkCache = { at: Date.now(), value };
    return value;
  } catch { return null; }
}

async function workerState(): Promise<'up' | 'db_disconnected' | 'down' | 'not_configured'> {
  const base = process.env.DOR_WORKER_URL;
  if (!base) return 'not_configured';
  try {
    const res = await fetch(new URL('/healthz', base), { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return res.ok ? 'up' : 'db_disconnected';
  } catch { return 'down'; }
}

export async function GET(): Promise<Response> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return Response.json({ error: 'not_configured' }, { status: 503, headers });
  if (!(await auth()).userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers });
  const [clerk, worker] = await Promise.all([clerkSummary(), workerState()]);
  const events = recentActivity().slice(0, 100).map(({ userId, ...e }) => ({ ...e, who: userId ? clerk?.names[userId] ?? 'someone' : null }));
  const env = process.env;
  return Response.json({
    now: new Date().toISOString(),
    events,
    tools: {
      claude: { configured: Boolean(env.ANTHROPIC_API_KEY), detail: env.DOR_REASONING_MODEL || 'claude-opus-5-5' },
      cartesia: { configured: Boolean(env.CARTESIA_API_KEY), detail: 'voice journaling + read-aloud' },
      apify: { configured: Boolean(env.APIFY_API_TOKEN), detail: 'Luma · Google Events · Google Maps', refresh: refreshState() },
      factory: { configured: worker !== 'not_configured', detail: 'Droid agents in the coordination worker', worker },
      spacetimedb: { configured: Boolean(env.NEXT_PUBLIC_SPACETIMEDB_URI), detail: `module ${env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? 'dor'}` },
      clerk: { configured: Boolean(env.CLERK_SECRET_KEY), detail: clerk ? `${clerk.users} accounts` : 'sign-in', lastSignInAt: clerk?.lastSignInAt ?? null },
    },
  }, { headers });
}
