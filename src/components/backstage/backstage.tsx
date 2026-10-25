'use client';
/**
 * D053/D060 demo backstage: a live view of what dor's backend, agents and provider tools are doing between users.
 * Reachable only by URL (/backstage). Two sources:
 *  - its own read-only SpacetimeDB connection with the signed-in user's token, subscribed to the observer_* views (empty
 *    unless the module owner allow-listed this identity) and the public catalogue views;
 *  - /api/backstage/activity on the live host: which tools are configured and running (Claude, Cartesia, Apify, the
 *    Factory Droid worker, Clerk), plus a metadata-only activity log with in-flight calls.
 * Shared state and metadata only. Journals never reach the server.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import { newBuilder } from '@/lib/spacetime/bindings';
import { spacetimeConfig, isClerkConfigured } from '@/lib/config';
import { RefreshButton } from './refresh-button';
import { Playbook } from './playbook';

const VIEWS = ['observer_status', 'observer_accounts', 'observer_pairs', 'observer_assignments', 'observer_signals', 'observer_nudges',
  'observer_delivery', 'observer_support_preferences', 'observer_pauses', 'observer_introductions', 'observer_nudge_requests',
  'observer_reasoning', 'catalogue_events', 'catalogue_places', 'observer_signal_schedules', 'observer_demo_members', 'my_demo_round'] as const;
type View = (typeof VIEWS)[number];
type Rows = Record<View, any[]>;
const EMPTY = Object.fromEntries(VIEWS.map((v) => [v, []])) as unknown as Rows;
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const hex = (v: any): string => (v && typeof v.toHexString === 'function' ? v.toHexString() : v ? String(v) : '');
const ms = (v: any): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return Date.parse(v);
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.microsSinceUnixEpoch === 'bigint') return Number(v.microsSinceUnixEpoch / 1000n);
  return null;
};
const DAY = 86_400_000;
const ago = (t: number | null) => {
  if (t === null || Number.isNaN(t)) return '';
  const d = Date.now() - t, a = Math.abs(d), f = d >= 0 ? (s: string) => `${s} ago` : (s: string) => `in ${s}`;
  return a < 60_000 ? (d >= 0 ? 'just now' : 'in <1 min') : a < 3_600_000 ? f(`${Math.round(a / 60_000)} min`) : a < DAY ? f(`${Math.round(a / 3_600_000)} h`) : f(`${Math.round(a / DAY)} d`);
};

function useObserverConnection(enabled: boolean) {
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState('');
  const [me, setMe] = useState('');
  const [rows, setRows] = useState<Rows>(EMPTY);
  const conn = useRef<any>(null);
  useEffect(() => {
    if (!enabled || !isSignedIn || !spacetimeConfig.uri) return;
    let stop = false;
    setState('connecting');
    (async () => {
      const token = await getToken({ template: spacetimeConfig.jwtTemplate });
      if (!token || stop) return;
      newBuilder().withUri(spacetimeConfig.uri!).withDatabaseName(spacetimeConfig.module).withToken(token)
        .onConnect((c: any, id: any) => {
          if (stop) return c.disconnect();
          conn.current = c; setMe(id.toHexString());
          c.subscriptionBuilder()
            .onApplied(() => setState('connected'))
            .onError((ctx: any) => { setState('error'); setError(String(ctx?.event?.message ?? 'subscription failed (is the module republished with the observer views?)')); })
            .subscribe(VIEWS.map((v) => `SELECT * FROM ${v}`));
        })
        .onConnectError((_c: any, e: any) => { setState('error'); setError(String(e?.message ?? e)); })
        .build();
    })().catch((e) => { setState('error'); setError(String(e)); });
    const tick = setInterval(() => {
      const c = conn.current; if (!c) return;
      const next = {} as Rows;
      for (const v of VIEWS) next[v] = c.db[camel(v)] ? [...c.db[camel(v)].iter()] : [];
      setRows(next);
    }, 1200);
    return () => { stop = true; clearInterval(tick); conn.current?.disconnect(); conn.current = null; };
  }, [enabled, isSignedIn, getToken]);
  return { state, error, me, rows, conn };
}

interface ActivityEvent { id: string; tool: string; action: string; who: string | null; startedAt: string; endedAt: string | null; status: 'running' | 'ok' | 'error'; durationMs: number | null }
interface ToolInfo { configured: boolean; detail: string; worker?: string; refresh?: any; lastSignInAt?: string | null }
interface Activity { events: ActivityEvent[]; tools: Record<'claude' | 'cartesia' | 'apify' | 'factory' | 'spacetimedb' | 'clerk', ToolInfo> }

function useActivity(): Activity | null {
  const [a, setA] = useState<Activity | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => fetch('/api/backstage/activity', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => alive && j && setA(j)).catch(() => undefined);
    void run(); const t = setInterval(run, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return a;
}

interface Item { at: number; kind: string; tone: string; title: string; detail: string; running?: boolean }

export function Backstage() {
  if (!isClerkConfigured) return <Shell><p>Clerk is not configured on this host, so the backstage can&apos;t sign in.</p></Shell>;
  return <SignedInBackstage />;
}

const TOOL_LABEL: Record<string, string> = { claude: 'Claude', cartesia: 'Cartesia', apify: 'Apify', factory: 'Factory Droid', spacetimedb: 'SpacetimeDB', clerk: 'Clerk' };

function SignedInBackstage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { state, error, me, rows, conn } = useObserverConnection(true);
  const activity = useActivity();
  const [resetNote, setResetNote] = useState('');
  const [resetStep, setResetStep] = useState<'idle' | 'armed' | 'running'>('idle');
  const round = rows.my_demo_round[0];
  const operator = round?.operator === true;
  // D061: two taps (arm, then confirm) so a stray click never wipes a judge's demo mid-way.
  const reset = async () => {
    if (resetStep === 'running') return;
    if (resetStep === 'idle') { setResetStep('armed'); setResetNote('Tap again to reset all four phones to the starting board.'); setTimeout(() => setResetStep((s) => (s === 'armed' ? 'idle' : s)), 5000); return; }
    setResetStep('running'); setResetNote('Resetting…');
    try {
      await conn.current.reducers.demoReset({});
      setResetNote('Reset done. Phones clear their notebooks as soon as they sync.');
    } catch (e: any) {
      setResetNote(`Reset failed: ${String(e?.message ?? e)}`);
    } finally { setResetStep('idle'); }
  };
  const observer = rows.observer_status[0]?.observer === true;
  const worker = activity?.tools.factory.worker ?? 'checking';

  const names = useMemo(() => new Map(rows.observer_accounts.map((a) => [hex(a.identity), a.displayName as string])), [rows.observer_accounts]);
  const who = (id: any) => names.get(hex(id)) ?? `${hex(id).slice(0, 8)}…`;
  const pairs = useMemo(() => new Map(rows.observer_pairs.map((p) => [p.pairId as string, p])), [rows.observer_pairs]);
  const other = (pairId: string, self: string) => {
    const p = pairs.get(pairId); if (!p) return null;
    return hex(p.memberA) === self ? hex(p.memberB) : hex(p.memberA);
  };

  const schedules = useMemo(() => new Map(rows.observer_signal_schedules.map((s) => [s.signalId as string, ms(s.deliverAfter)])), [rows.observer_signal_schedules]);

  const timeline = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const e of activity?.events ?? []) {
      out.push({ at: ms(e.startedAt) ?? 0, kind: TOOL_LABEL[e.tool] ?? e.tool, tone: e.status === 'running' ? 'sky' : e.status === 'error' ? 'rose' : 'stone',
        running: e.status === 'running',
        title: `${e.who ? `${e.who} · ` : ''}${e.action}${e.status === 'running' ? ' — in progress' : ''}`,
        detail: e.status === 'running' ? `started ${ago(ms(e.startedAt))}` : `${e.status === 'ok' ? 'done' : 'failed'} in ${((e.durationMs ?? 0) / 1000).toFixed(1)} s` });
    }
    for (const d of rows.observer_reasoning) {
      const ownerHex = hex(d.owner);
      const target = d.pairId ? other(d.pairId, ownerHex) : null;
      const tone = d.mode === 'act' ? 'emerald' : d.mode === 'ask' ? 'amber' : d.mode === 'defer' ? 'sky' : 'stone';
      out.push({ at: ms(d.createdAt) ?? 0, kind: 'reasoning', tone,
        title: `${who(d.owner)}'s reasoning → ${String(d.mode).toUpperCase()}${d.action ? ` · ${d.action}` : ''}${target ? ` → ${who(target)}` : ''}`,
        detail: [`outcome: ${d.outcome}`, `via ${d.source}`, d.reasons.length ? `why: ${d.reasons.join(', ')}` : '',
          d.reassessAfterMinutes ? `reassess in ${d.reassessAfterMinutes} min` : '', d.rejected.length ? `rejected: ${d.rejected.slice(0, 4).join(' · ')}` : ''].filter(Boolean).join('  ·  ') });
    }
    for (const s of rows.observer_signals) {
      const exp = ms(s.expiresAt) ?? 0;
      const status = s.revokedAt ? 'revoked' : exp < Date.now() ? 'expired' : 'active';
      const due = schedules.get(s.signalId) ?? null;
      const held = status === 'active' && due !== null && due > Date.now();
      out.push({ at: exp - DAY, kind: held ? 'held signal' : 'signal', tone: held ? 'amber' : status === 'active' ? 'violet' : 'stone',
        title: `${who(s.senderId)} → ${who(s.recipientId)}: approved signal (${s.supportMode ?? 'availability only'}${s.availability ? `, ${s.availability}` : ''})`,
        detail: held
          ? `logged and held (bad news needs time) · deliverable ${new Date(due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${ago(due)}) · the agents wait until then`
          : `${status}${status === 'active' ? ` · expires ${ago(exp)}` : ''} · the Factory Droid agents decide if and how it lands` });
    }
    for (const n of rows.observer_nudges) {
      const status = n.suppressed ? 'suppressed' : n.dismissed ? 'seen & dismissed' : (ms(n.expiresAt) ?? 0) < Date.now() ? 'expired' : 'visible to recipient';
      out.push({ at: ms(n.createdAt) ?? 0, kind: 'nudge', tone: status === 'visible to recipient' ? 'emerald' : 'stone',
        title: `agents delivered a nudge to ${who(n.recipientId)}: “${(NUDGE_TEMPLATE_COPY as any)[n.templateId] ?? n.templateId}”`, detail: status });
    }
    for (const x of rows.observer_introductions) out.push({ at: ms(x.createdAt) ?? 0, kind: 'introduction', tone: 'rose',
      title: `${who(x.sender)} → ${who(x.recipient)}: introduction`, detail: `${x.status}${x.sharedTags.length ? ` · shared: ${x.sharedTags.join(', ')}` : ''}` });
    for (const r of rows.observer_nudge_requests) out.push({ at: ms(r.createdAt) ?? 0, kind: 'friend-of-friend', tone: 'rose',
      title: `${who(r.sender)} → ${who(r.recipient)} via ${who(r.via)}`, detail: `${r.status} · ${r.hops} hops` });
    return out.sort((a, b) => Number(b.running ?? false) - Number(a.running ?? false) || b.at - a.at).slice(0, 100);
  }, [rows, names, pairs, activity, schedules]); // eslint-disable-line react-hooks/exhaustive-deps

  const paths = useMemo(() => {
    const out: { key: string; fromHex: string; toHex: string; from: string; to: string; blockers: string[]; notes: string[] }[] = [];
    const now = Date.now();
    for (const p of rows.observer_pairs) {
      if (p.status !== 'accepted' || !p.memberB) continue;
      for (const [x, y] of [[hex(p.memberA), hex(p.memberB)], [hex(p.memberB), hex(p.memberA)]]) {
        const blockers: string[] = [], notes: string[] = [];
        const pause = rows.observer_pauses.find((q) => q.pairId === p.pairId && hex(q.owner) === x && !q.resumedAt && (ms(q.expiresAt) ?? 0) > now);
        if (pause) blockers.push(`${who(x)} paused ${who(y)}`);
        const del = rows.observer_delivery.find((d) => d.pairId === p.pairId && hex(d.recipient) === y);
        if (del && !del.optedIn) blockers.push(`${who(y)} turned notes off`);
        if (del && del.quietStartMinute != null && del.quietEndMinute != null) {
          const local = ((new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + del.utcOffsetMinutes) % 1440 + 1440) % 1440;
          const s = del.quietStartMinute, e = del.quietEndMinute;
          const quiet = s <= e ? local >= s && local < e : local >= s || local < e;
          (quiet ? blockers : notes).push(`${who(y)} quiet hours ${String(Math.floor(s / 60)).padStart(2, '0')}:00–${String(Math.floor(e / 60)).padStart(2, '0')}:00${quiet ? ' (now)' : ''}`);
        }
        const pref = rows.observer_support_preferences.find((q) => q.pairId === p.pairId && hex(q.recipient) === y);
        if (pref && (pref.revokedAt || (ms(pref.expiresAt) ?? 0) <= now)) blockers.push(`${who(y)}'s support styles ${pref.revokedAt ? 'revoked' : 'expired'}`);
        else if (pref) notes.push(`${who(y)} accepts: ${pref.supportModes.join(', ') || 'nothing'}`);
        else notes.push(`${who(y)}: standard styles`);
        // D059: no per-pair cooldown, so a recent nudge never blocks the next one.
        const asg = rows.observer_assignments.find((a) => a.pairId === p.pairId && hex(a.owner) === x);
        notes.push(asg ? `${who(x)} preset: ${asg.presetKind}` : `${who(x)}: default preset`);
        out.push({ key: `${p.pairId}:${x}`, fromHex: x, toHex: y, from: who(x), to: who(y), blockers, notes });
      }
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }, [rows, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockerMap = useMemo(() => new Map(paths.map((p) => [`${p.fromHex}>${p.toHex}`, p.blockers])), [paths]);

  const tools = useMemo(() => {
    if (!activity) return [];
    const events = activity.events;
    const lastOf = (tool: string) => events.find((e) => e.tool === tool) ?? null;
    const runningOf = (tool: string) => events.filter((e) => e.tool === tool && e.status === 'running');
    const callsOf = (tool: string) => events.filter((e) => e.tool === tool).length;
    const lastNudge = rows.observer_nudges.map((n) => ms(n.createdAt) ?? 0).sort((a, b) => b - a)[0] ?? null;
    const pendingSignals = rows.observer_signals.filter((s) => !s.revokedAt && (ms(s.expiresAt) ?? 0) > Date.now()).length;
    const t = activity.tools;
    const refresh = t.apify.refresh;
    const card = (id: keyof Activity['tools'], extra: { busy?: boolean; busyText?: string; lines: string[]; last?: number | null; down?: boolean }) => {
      const info = t[id];
      const running = runningOf(id);
      const busy = extra.busy ?? running.length > 0;
      const status = !info.configured ? 'not configured' : extra.down ? 'down' : busy ? 'in use now' : extra.last ? `used ${ago(extra.last)}` : 'ready';
      const tone = !info.configured || extra.down ? 'rose' : busy ? 'sky' : extra.last ? 'emerald' : 'stone';
      return { id, label: TOOL_LABEL[id]!, detail: info.detail, status, tone, busy,
        lines: [...(busy && (extra.busyText ?? running[0]?.action) ? [`now: ${extra.busyText ?? running.map((r) => `${r.who ? `${r.who} · ` : ''}${r.action}`).join(', ')}`] : []), ...extra.lines] };
    };
    const claudeLast = lastOf('claude');
    return [
      card('claude', { last: ms(claudeLast?.startedAt), lines: [`${callsOf('claude')} calls this session`, claudeLast ? `last: ${claudeLast.action}` : 'no calls yet'] }),
      card('cartesia', { last: ms(lastOf('cartesia')?.startedAt), lines: [`${callsOf('cartesia')} voice sessions this session`] }),
      card('apify', { busy: refresh?.status === 'running', busyText: refresh?.status === 'running'
          ? (refresh.phase === 'scraping' ? `scraping ${refresh.runsDone}/${refresh.runsTotal} searches` : 'saving results') : undefined,
        last: ms(refresh?.finishedAt), lines: [`${rows.catalogue_events.length} events · ${rows.catalogue_places.length} places in the window`,
          refresh?.finishedAt ? `last refresh: ${refresh.status === 'done' ? `+${refresh.saved.events} events, +${refresh.saved.places} places` : 'failed'}` : 'not refreshed this session'] }),
      card('factory', { down: worker === 'down' || worker === 'db_disconnected', busy: pendingSignals > 0 && worker === 'up',
        busyText: pendingSignals > 0 ? `${pendingSignals} signal${pendingSignals === 1 ? '' : 's'} with the agents` : undefined, last: lastNudge,
        lines: [`worker: ${worker.replace('_', ' ')}`, `${rows.observer_nudges.length} nudges delivered by the agents`] }),
      card('spacetimedb', { busy: false, last: state === 'connected' ? Date.now() : null, down: state === 'error',
        lines: [`connection: ${state}`, `${rows.observer_accounts.length} accounts · ${rows.observer_pairs.length} pairs · ${rows.observer_signals.length} signals`] }),
      card('clerk', { busy: false, last: ms(t.clerk.lastSignInAt ?? null), lines: [t.clerk.detail, t.clerk.lastSignInAt ? `last sign-in ${ago(ms(t.clerk.lastSignInAt))}` : ''].filter(Boolean) }),
    ];
  }, [activity, rows, state, worker]);

  if (!isLoaded) return <Shell><p>Loading…</p></Shell>;
  if (!isSignedIn) return <Shell><p>Sign in on the <a className="underline" href="/">live app</a> first, then come back to <code>/backstage</code>.</p></Shell>;

  const counts = [
    ['people', rows.observer_accounts.length], ['connections', rows.observer_pairs.filter((p) => p.status === 'accepted').length],
    ['reasoning decisions', rows.observer_reasoning.length], ['active signals', rows.observer_signals.filter((s) => !s.revokedAt && (ms(s.expiresAt) ?? 0) > Date.now()).length],
    ['nudges delivered', rows.observer_nudges.length], ['introductions', rows.observer_introductions.length],
  ] as const;

  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={state === 'connected' ? 'emerald' : state === 'error' ? 'rose' : 'stone'}>database: {state}</Pill>
        <Pill tone={worker === 'up' ? 'emerald' : worker === 'checking' ? 'stone' : 'rose'}>agents worker: {worker.replace('_', ' ')}</Pill>
        <Pill tone={observer ? 'emerald' : 'amber'}>{observer ? 'observer access' : 'not an observer yet'}</Pill>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <RefreshButton className="rounded-full bg-stone-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60" />
          {/* D061: demo_reset is refused unless this account is the demo operator on the module's demo roster. */}
          {round && <Pill tone="stone">demo round {round.round}{round.resetAt ? ` · reset ${ago(ms(round.resetAt))}` : ''}</Pill>}
          <button type="button" onClick={() => void reset()} disabled={!operator || resetStep === 'running'}
            title={operator ? 'Put all four demo phones back on the starting board' : 'Only the demo operator account can reset'}
            className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50 ${resetStep === 'armed' ? 'border-rose-600 bg-rose-600 text-white' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
            {resetStep === 'armed' ? '↺ Tap again to reset' : resetStep === 'running' ? 'Resetting…' : '↺ Reset demo'}
          </button>
        </span>
      </div>
      {resetNote && <p className="mt-2 text-xs text-rose-700">{resetNote}</p>}
      {state === 'connected' && !operator && (
        <p className="mt-2 text-xs text-stone-500">Reset demo needs this account on the demo roster as the operator (module owner: set_demo_member).</p>
      )}
      {state === 'error' && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      {state === 'connected' && !observer && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">This account can&apos;t see the people view yet.</p>
          <p className="mt-1">The module owner allow-lists it once (demo only):</p>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">{`spacetime call -s maincloud dor set_observer_identity '{"__identity__":"0x${me}"}' true`}</pre>
        </div>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Tools in use</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.length === 0 && <div className="text-sm text-stone-500">Checking tools…</div>}
          {tools.map((t) => (
            <div key={t.id} className={`rounded-lg border bg-white p-3 ${t.busy ? 'border-sky-300 ring-2 ring-sky-100' : 'border-stone-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t.label}</span>
                <span className="flex items-center gap-1.5">{t.busy && <Spinner />}<Pill tone={t.tone}>{t.status}</Pill></span>
              </div>
              <div className="mt-0.5 text-xs text-stone-500">{t.detail}</div>
              {t.lines.map((l) => <div key={l} className={`mt-1 text-xs ${l.startsWith('now:') ? 'font-medium text-sky-800' : 'text-stone-700'}`}>{l}</div>)}
            </div>
          ))}
        </div>
      </section>

      {observer && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {counts.map(([label, n]) => (
            <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
            </div>
          ))}
        </div>
      )}
      {observer && <Playbook rows={rows} blockers={blockerMap} tools={activity?.tools ?? null} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Live activity</h2>
          <ol className="space-y-2">
            {timeline.length === 0 && <li className="text-sm text-stone-500">Nothing yet. Write a journal entry in the live app.</li>}
            {timeline.map((t, n) => (
              <li key={n} className={`rounded-lg border bg-white p-3 ${t.running ? 'border-sky-300' : 'border-stone-200'}`}>
                <div className="flex items-center gap-2">
                  <Pill tone={t.tone}>{t.kind}</Pill>
                  {t.running && <Spinner />}
                  <span className="text-xs text-stone-500">{ago(t.at)}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{t.title}</div>
                {t.detail && <div className="mt-0.5 text-xs text-stone-600">{t.detail}</div>}
              </li>
            ))}
          </ol>
        </section>
        {observer && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Nudge paths (would a note get through?)</h2>
            <ul className="space-y-2">
              {paths.length === 0 && <li className="text-sm text-stone-500">No accepted connections yet.</li>}
              {paths.map((p) => (
                <li key={p.key} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.from} → {p.to}</span>
                    <Pill tone={p.blockers.length ? 'rose' : 'emerald'}>{p.blockers.length ? 'blocked' : 'ready'}</Pill>
                  </div>
                  {p.blockers.map((b) => <div key={b} className="mt-1 text-xs text-rose-700">✗ {b}</div>)}
                  <div className="mt-1 text-xs text-stone-500">{p.notes.join(' · ')}</div>
                </li>
              ))}
            </ul>
            {worker !== 'up' && <p className="mt-3 text-xs text-rose-700">The agents worker isn&apos;t reachable: approved signals wait until it&apos;s running.</p>}
          </section>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-6xl bg-[#FAF7F0] px-4 py-6 text-stone-900">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">dor · backstage</h1>
        <a className="text-sm underline" href="/">← back to the room</a>
      </header>
      <p className="mb-4 max-w-3xl text-sm text-stone-600">
        Live view of what dor&apos;s agents, tools and backend are doing between people: provider calls in flight, reasoning decisions,
        approved signals, delivered nudges and introductions. Shared state and metadata only: journals and private reflections never
        leave each person&apos;s device. Developers only; not linked from the app.
      </p>
      {children}
    </main>
  );
}

function Spinner() {
  return <span aria-label="in progress" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" />;
}

const TONES: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800', sky: 'bg-sky-100 text-sky-800',
  stone: 'bg-stone-100 text-stone-700', rose: 'bg-rose-100 text-rose-800', violet: 'bg-violet-100 text-violet-800',
};
function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.stone}`}>{children}</span>;
}
