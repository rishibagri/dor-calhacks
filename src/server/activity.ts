/**
 * D060 demo backstage activity log. Server-only, in-process ring buffer on the live host: which provider tool ran,
 * for whom (Clerk user id, resolved to a first name only by the backstage endpoint), when, how long and with what
 * outcome. Metadata only: never request bodies, journal text, prompts, tokens or model output.
 */
export const TOOLS = ['claude', 'cartesia', 'apify', 'factory', 'spacetimedb', 'clerk'] as const;
export type Tool = (typeof TOOLS)[number];

export interface ActivityEvent {
  id: string;
  tool: Tool;
  /** Short fixed label, e.g. "journal reflection", "reasoning", "voice session". */
  action: string;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: 'running' | 'ok' | 'error';
  durationMs: number | null;
}

const MAX = 200;
const store = ((globalThis as unknown as { __dorActivity?: ActivityEvent[] }).__dorActivity ??= []);

export function recentActivity(): ActivityEvent[] {
  return store.map((e) => ({ ...e })).reverse();
}

export function begin(tool: Tool, action: string, userId: string | null): (status: 'ok' | 'error') => void {
  const e: ActivityEvent = { id: crypto.randomUUID(), tool, action, userId, startedAt: new Date().toISOString(), endedAt: null,
    status: 'running', durationMs: null };
  store.push(e);
  if (store.length > MAX) store.splice(0, store.length - MAX);
  return (status) => {
    e.status = status;
    e.endedAt = new Date().toISOString();
    e.durationMs = Date.parse(e.endedAt) - Date.parse(e.startedAt);
  };
}

/** Wraps a route handler: records start, then ok/error from the response status (or a throw). */
export async function tracked(tool: Tool, action: string, userId: string | null, run: () => Promise<Response>): Promise<Response> {
  const end = begin(tool, action, userId);
  try {
    const res = await run();
    end(res.ok ? 'ok' : 'error');
    return res;
  } catch (e) {
    end('error');
    throw e;
  }
}
