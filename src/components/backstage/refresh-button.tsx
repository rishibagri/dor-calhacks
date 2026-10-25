'use client';
/** D057 live Apify refresh: starts one server-side scrape and shows its progress. Data lands in the room as it saves. */
import { useEffect, useRef, useState } from 'react';

interface RefreshState {
  status: 'running' | 'done' | 'failed';
  phase: 'scraping' | 'saving' | 'finished';
  runsTotal: number; runsDone: number; runsFailed: number;
  found: { events: number; places: number; details: number };
  saved: { events: number; places: number; details: number };
  errors: string[];
  finishedAt: string | null;
}

function label(s: RefreshState | null, starting: boolean): string {
  if (starting) return 'starting…';
  if (!s) return '↻ refresh nearby';
  if (s.status === 'running') {
    return s.phase === 'scraping' ? `scraping live · ${s.runsDone}/${s.runsTotal} searches` : `saving ${s.found.events} events · ${s.found.places} places…`;
  }
  if (s.status === 'failed') return `refresh failed (${s.errors[0] ?? 'error'}) · retry`;
  return `↻ refreshed · ${s.saved.events} events · ${s.saved.places} places`;
}

export function RefreshButton({ style, className }: { style?: React.CSSProperties; className?: string }) {
  const [state, setState] = useState<RefreshState | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = () => fetch('/api/catalogue/refresh', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j) setState(j.state); }).catch(() => undefined);

  useEffect(() => { void poll(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);
  useEffect(() => {
    if (state?.status === 'running' && !timer.current) timer.current = setInterval(() => void poll(), 2500);
    if (state?.status !== 'running' && timer.current) { clearInterval(timer.current); timer.current = null; }
  }, [state?.status]);

  const start = async () => {
    if (state?.status === 'running') return;
    setStarting(true);
    try {
      const r = await fetch('/api/catalogue/refresh', { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (j?.state) setState(j.state);
    } finally { setStarting(false); }
  };

  return (
    <button type="button" onClick={() => void start()} disabled={starting || state?.status === 'running'} className={className} style={style}
      title="Scrape Luma, Google Events and Google Maps live for every interest and area">
      {label(state, starting)}
    </button>
  );
}
