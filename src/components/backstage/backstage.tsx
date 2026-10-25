'use client';
/**
 * D053 demo backstage: a live view of what dor's backend and agents are doing between users. It opens its own
 * read-only SpacetimeDB connection with the signed-in user's token and subscribes only to the observer_* views,
 * which the module returns empty unless the module owner allow-listed this identity (set_observer_identity).
 * Shows shared state only (ids, enums, times, chosen display names). Journals never reach the server.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import { newBuilder } from '@/lib/spacetime/bindings';
import { spacetimeConfig, isClerkConfigured } from '@/lib/config';

const VIEWS = ['observer_status', 'observer_accounts', 'observer_pairs', 'observer_assignments', 'observer_signals', 'observer_nudges',
  'observer_delivery', 'observer_support_preferences', 'observer_pauses', 'observer_introductions', 'observer_nudge_requests',
  'observer_reasoning'] as const;
type View = (typeof VIEWS)[number];
type Rows = Record<View, any[]>;
const EMPTY = Object.fromEntries(VIEWS.map((v) => [v, []])) as unknown as Rows;
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const hex = (v: any): string => (v && typeof v.toHexString === 'function' ? v.toHexString() : v ? String(v) : '');
const ms = (v: any): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.microsSinceUnixEpoch === 'bigint') return Number(v.microsSinceUnixEpoch / 1000n);
  return null;
};
const DAY = 86_400_000;
const ago = (t: number | null) => {
  if (t === null) return '';
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
  return { state, error, me, rows };
}

function useWorker(): string {
  const [s, setS] = useState('checking');
  useEffect(() => {
    let alive = true;
    const run = () => fetch('/api/backstage/worker', { cache: 'no-store' }).then((r) => r.json()).then((j) => alive && setS(j.state)).catch(() => alive && setS('unknown'));
    run(); const t = setInterval(run, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return s;
}

interface Item { at: number; kind: string; tone: string; title: string; detail: string }

export function Backstage() {
  if (!isClerkConfigured) return <Shell><p>Clerk is not configured on this host, so the backstage can't sign in.</p></Shell>;
  return <SignedInBackstage />;
}

function SignedInBackstage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { state, error, me, rows } = useObserverConnection(true);
  const worker = useWorker();
  const observer = rows.observer_status[0]?.observer === true;

  const names = useMemo(() => new Map(rows.observer_accounts.map((a) => [hex(a.identity), a.displayName as string])), [rows.observer_accounts]);
  const who = (id: any) => names.get(hex(id)) ?? `${hex(id).slice(0, 8)}…`;
  const pairs = useMemo(() => new Map(rows.observer_pairs.map((p) => [p.pairId as string, p])), [rows.observer_pairs]);
  const other = (pairId: string, self: string) => {
    const p = pairs.get(pairId); if (!p) return null;
    return hex(p.memberA) === self ? hex(p.memberB) : hex(p.memberA);
  };

  const timeline = useMemo<Item[]>(() => {
    const out: Item[] = [];
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
      out.push({ at: exp - DAY, kind: 'signal', tone: status === 'active' ? 'violet' : 'stone',
        title: `${who(s.senderId)} → ${who(s.recipientId)}: approved signal (${s.supportMode ?? 'availability only'}${s.availability ? `, ${s.availability}` : ''})`,
        detail: `${status}${status === 'active' ? ` · expires ${ago(exp)}` : ''} · waiting for the two agents` });
    }
    for (const n of rows.observer_nudges) {
      const status = n.suppressed ? 'suppressed' : n.dismissed ? 'seen & dismissed' : (ms(n.expiresAt) ?? 0) < Date.now() ? 'expired' : 'visible to recipient';
      out.push({ at: ms(n.createdAt) ?? 0, kind: 'nudge', tone: status === 'visible to recipient' ? 'emerald' : 'stone',
        title: `agents delivered a nudge to ${who(n.recipientId)}: “${(NUDGE_TEMPLATE_COPY as any)[n.templateId] ?? n.templateId}”`,
        detail: status });
    }
    for (const x of rows.observer_introductions) out.push({ at: ms(x.createdAt) ?? 0, kind: 'introduction', tone: 'rose',
      title: `${who(x.sender)} → ${who(x.recipient)}: introduction`, detail: `${x.status}${x.sharedTags.length ? ` · shared: ${x.sharedTags.join(', ')}` : ''}` });
    for (const r of rows.observer_nudge_requests) out.push({ at: ms(r.createdAt) ?? 0, kind: 'friend-of-friend', tone: 'rose',
      title: `${who(r.sender)} → ${who(r.recipient)} via ${who(r.via)}`, detail: `${r.status} · ${r.hops} hops` });
    return out.sort((a, b) => b.at - a.at).slice(0, 80);
  }, [rows, names, pairs]); // eslint-disable-line react-hooks/exhaustive-deps

  const paths = useMemo(() => {
    const out: { key: string; from: string; to: string; blockers: string[]; notes: string[] }[] = [];
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
        const last = rows.observer_nudges.filter((n) => n.pairId === p.pairId && hex(n.recipientId) === y).map((n) => ms(n.createdAt) ?? 0).sort().pop();
        if (last && now - last < DAY) blockers.push(`cooldown until ${new Date(last + DAY).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
        const asg = rows.observer_assignments.find((a) => a.pairId === p.pairId && hex(a.owner) === x);
        notes.push(asg ? `${who(x)} preset: ${asg.presetKind}` : `${who(x)}: default preset`);
        out.push({ key: `${p.pairId}:${x}`, from: who(x), to: who(y), blockers, notes });
      }
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }, [rows, names]); // eslint-disable-line react-hooks/exhaustive-deps

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
      </div>
      {state === 'error' && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      {state === 'connected' && !observer && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">This account can't see the backstage yet.</p>
          <p className="mt-1">The module owner allow-lists it once (demo only):</p>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">{`spacetime call -s maincloud dor set_observer_identity '{"__identity__":"0x${me}"}' true`}</pre>
        </div>
      )}
      {observer && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {counts.map(([label, n]) => (
              <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
                <div className="text-2xl font-semibold tabular-nums">{n}</div>
                <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Live activity</h2>
              <ol className="space-y-2">
                {timeline.length === 0 && <li className="text-sm text-stone-500">Nothing yet. Write a journal entry in the live app.</li>}
                {timeline.map((t, n) => (
                  <li key={n} className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <Pill tone={t.tone}>{t.kind}</Pill>
                      <span className="text-xs text-stone-500">{ago(t.at)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium">{t.title}</div>
                    {t.detail && <div className="mt-0.5 text-xs text-stone-600">{t.detail}</div>}
                  </li>
                ))}
              </ol>
            </section>
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
              {worker !== 'up' && <p className="mt-3 text-xs text-rose-700">The agents worker isn't reachable: approved signals wait until it's running.</p>}
            </section>
          </div>
        </>
      )}
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
        Live view of what dor&apos;s agents and backend are doing between people: reasoning decisions, approved signals, delivered nudges
        and introductions. Shared state only: journals and private reflections never leave each person&apos;s device. Demo use only.
      </p>
      {children}
    </main>
  );
}

const TONES: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800', sky: 'bg-sky-100 text-sky-800',
  stone: 'bg-stone-100 text-stone-700', rose: 'bg-rose-100 text-rose-800', violet: 'bg-violet-100 text-violet-800',
};
function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.stone}`}>{children}</span>;
}
