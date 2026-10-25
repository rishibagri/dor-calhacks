'use client';
/**
 * D061 demo playbook: what each teammate can show live from the starting board that "Reset demo" restores, with a
 * readiness check computed from the observer views (real rows, never a script). Who runs what is a rehearsal aid only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';

type Slot = 'adam' | 'rishi' | 'nimisha' | 'sumedh';
interface Check { state: 'ready' | 'used' | 'blocked'; note: string }
interface Scenario { n: number; title: string; who: string; steps: string; shows: string; once: boolean; check: (b: Board) => Check }

export interface PlaybookInput {
  rows: Record<string, any[]>;
  /** Nudge paths from the backstage, keyed `${fromHex}>${toHex}`; an empty list means the note would get through. */
  blockers: Map<string, string[]>;
  tools: Record<string, { configured: boolean; refresh?: any }> | null;
}

const hex = (v: any): string => (v && typeof v.toHexString === 'function' ? v.toHexString() : v ? String(v) : '');

class Board {
  readonly ids = new Map<Slot, string>();
  readonly names = new Map<Slot, string>();
  constructor(readonly input: PlaybookInput) {
    const accountName = new Map(input.rows.observer_accounts.map((a) => [hex(a.identity), a.displayName as string]));
    for (const m of input.rows.observer_demo_members) {
      const slot = m.slot as Slot;
      this.ids.set(slot, hex(m.identity));
      this.names.set(slot, accountName.get(hex(m.identity)) ?? slot[0]!.toUpperCase() + slot.slice(1));
    }
  }
  name = (s: Slot) => this.names.get(s) ?? s[0]!.toUpperCase() + s.slice(1);
  member = (s: Slot) => this.input.rows.observer_demo_members.find((m) => m.slot === s);
  linked(a: Slot, b: Slot): boolean {
    const x = this.ids.get(a), y = this.ids.get(b);
    return this.input.rows.observer_pairs.some((p) => p.status === 'accepted' &&
      ((hex(p.memberA) === x && hex(p.memberB) === y) || (hex(p.memberA) === y && hex(p.memberB) === x)));
  }
  /** Why a note from `a` to `b` would not get through right now ([] = it would). */
  pathBlockers(a: Slot, b: Slot): string[] | null {
    if (!this.linked(a, b)) return null;
    return this.input.blockers.get(`${this.ids.get(a)}>${this.ids.get(b)}`) ?? [];
  }
  between(view: 'observer_nudge_requests' | 'observer_introductions', a: Slot, b: Slot) {
    const x = this.ids.get(a), y = this.ids.get(b);
    return this.input.rows[view].filter((r) => (hex(r.sender) === x && hex(r.recipient) === y) || (hex(r.sender) === y && hex(r.recipient) === x));
  }
  published = (s: Slot) => Boolean(this.member(s)?.published && this.member(s)?.areaKey);
}

const nudgeCheck = (b: Board, from: Slot, to: Slot): Check => {
  const blockers = b.pathBlockers(from, to);
  if (blockers === null) return { state: 'blocked', note: `${b.name(from)} and ${b.name(to)} aren't linked. Reset restores it.` };
  return blockers.length ? { state: 'blocked', note: blockers.join(' · ') } : { state: 'ready', note: `${b.name(from)} → ${b.name(to)} would get through` };
};

const SCENARIOS: Scenario[] = [
  { n: 1, title: 'Instant nudge', who: 'Adam → Rishi', once: false,
    steps: 'Adam writes good news that names Rishi ("Rishi helped me land the internship"), then taps Send.',
    shows: "Rishi's tray gets a note within seconds with a generic starter. Claude, then the Droid agents, then delivery light up here.",
    check: (b) => nudgeCheck(b, 'adam', 'rishi') },
  { n: 2, title: 'Held nudge (bad news)', who: 'Adam → Rishi', once: false,
    steps: 'Adam writes hard news and says he wants to talk to Rishi ("I didn\'t get the job, I want to talk to Rishi about it").',
    shows: 'The phone says dor will nudge later. Here the signal shows as held, with its delivery time; nothing reaches Rishi during the demo.',
    check: (b) => nudgeCheck(b, 'adam', 'rishi') },
  { n: 3, title: 'Help line', who: 'anyone', once: false,
    steps: 'Write an entry with real distress (hopeless, not safe).',
    shows: 'The 988 support card appears on the phone. No signal, nudge or decision shows up here: nothing was sent to anyone.',
    check: () => ({ state: 'ready', note: 'device and Claude only; needs no server state' }) },
  { n: 4, title: 'Holding back', who: 'Adam', once: false,
    steps: 'Adam writes "I need some space from Rishi" or "I owe Rishi an apology".',
    shows: 'No note goes out. For the apology, Rishi\'s book on Adam\'s shelf gets a line saying it\'s his to say himself. The decision log here shows why.',
    check: (b) => (b.linked('adam', 'rishi') ? { state: 'ready', note: 'Adam and Rishi are linked' } : { state: 'blocked', note: 'not linked. Reset restores it.' }) },
  { n: 5, title: 'Voice + keep talking', who: 'Sumedh (about Rishi)', once: false,
    steps: 'Sumedh taps the mic, talks about his week with Rishi, taps again, then Keep talking. Cartesia reads the follow-up aloud. Then Send.',
    shows: 'Cartesia dictation and read-aloud, Claude follow-up question, then the same nudge path to Rishi.',
    check: (b) => (b.input.tools && !b.input.tools.cartesia?.configured ? { state: 'blocked', note: 'Cartesia is not configured on this host' } : nudgeCheck(b, 'sumedh', 'rishi')) },
  { n: 6, title: 'Friend of a friend', who: 'Adam → Sumedh (via Rishi)', once: true,
    steps: 'Adam opens the windowsill card "someone Rishi knows" and sends a request. Sumedh opens the envelope on his door mat and accepts.',
    shows: 'No name until Sumedh accepts; then each gets the other\'s book on their shelf (a new pair, ready for nudges).',
    check: (b) => {
      if (b.linked('adam', 'sumedh')) return { state: 'used', note: 'Adam and Sumedh are already linked' };
      const r = b.between('observer_nudge_requests', 'adam', 'sumedh')[0];
      if (r) return { state: 'used', note: `request ${r.status}` };
      if (!b.linked('adam', 'rishi') || !b.linked('rishi', 'sumedh')) return { state: 'blocked', note: 'the Adam–Rishi–Sumedh links are missing' };
      return b.published('sumedh') && b.published('adam') ? { state: 'ready', note: 'Sumedh is on Adam\'s sill via Rishi' } : { state: 'blocked', note: 'Adam or Sumedh is not published' };
    } },
  { n: 7, title: 'Meet someone nearby', who: 'Nimisha → Rishi', once: true,
    steps: 'Nimisha (new in town) opens Rishi\'s postcard on her windowsill and says hello. Rishi accepts the envelope on his mat.',
    shows: 'Discovery with zero model calls: shared interests only. After accepting, a loose page appears for both.',
    check: (b) => {
      const x = b.between('observer_introductions', 'nimisha', 'rishi')[0];
      if (x) return { state: 'used', note: `introduction ${x.status}` };
      if (b.linked('nimisha', 'rishi')) return { state: 'used', note: 'already linked' };
      return b.published('nimisha') && b.published('rishi') ? { state: 'ready', note: 'both published on campus' } : { state: 'blocked', note: 'Nimisha or Rishi is not published' };
    } },
  { n: 8, title: 'Live events refresh', who: 'Nimisha', once: false,
    steps: 'Nimisha opens the window and taps Refresh nearby.',
    shows: 'Apify runs live (Luma, Google Events, Google Maps); new flyers and "for you" picks land on the pinboard.',
    check: (b) => {
      const apify = b.input.tools?.apify;
      if (apify && !apify.configured) return { state: 'blocked', note: 'Apify is not configured on this host' };
      if (apify?.refresh?.status === 'running') return { state: 'used', note: 'a refresh is running now' };
      return { state: 'ready', note: `${b.input.rows.catalogue_events.length} events · ${b.input.rows.catalogue_places.length} places now` };
    } },
  { n: 9, title: 'Plan together', who: 'Adam + Rishi (any time) · Rishi + Nimisha (after 7)', once: true,
    steps: 'Both tap "show my interest" on the same flyer.',
    shows: 'The worker proposes a plan to both; each accepts their own copy and it lands on both calendars.',
    check: (b) => {
      const events = b.input.rows.catalogue_events.length;
      if (!events) return { state: 'blocked', note: 'no events in the window. Run a refresh first (8).' };
      return b.linked('adam', 'rishi') ? { state: 'ready', note: `${events} events to choose from` } : { state: 'blocked', note: 'Adam and Rishi are not linked' };
    } },
  { n: 10, title: 'Recipient in control', who: 'Rishi', once: true,
    steps: 'Rishi opens Adam\'s book and turns notes off. Adam writes good news about Rishi again.',
    shows: 'Adam\'s reasoning still runs, but the note is not delivered. The nudge path here turns red and says why.',
    check: (b) => {
      const blockers = b.pathBlockers('adam', 'rishi');
      if (blockers === null) return { state: 'blocked', note: 'not linked. Reset restores it.' };
      return blockers.length ? { state: 'used', note: `${blockers.join(' · ')}. Reset turns it back on.` } : { state: 'ready', note: 'Rishi currently accepts notes from Adam' };
    } },
];

const TONE: Record<Check['state'], string> = { ready: 'bg-emerald-100 text-emerald-800', used: 'bg-amber-100 text-amber-800', blocked: 'bg-rose-100 text-rose-800' };
const LABEL: Record<Check['state'], string> = { ready: 'ready', used: 'used: reset to repeat', blocked: 'blocked' };

export function Playbook(input: PlaybookInput) {
  const board = useMemo(() => new Board(input), [input]);
  const roster = (['adam', 'rishi', 'nimisha', 'sumedh'] as Slot[]).map((s) => ({ s, m: board.member(s) }));
  const missing = roster.filter((r) => !r.m).map((r) => r.s);
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Demo playbook</h2>
      <p className="mb-2 text-xs text-stone-600">
        Starting board after a reset: {board.name('adam')}–{board.name('rishi')} and {board.name('rishi')}–{board.name('sumedh')} are linked and
        nudge-ready both ways; {board.name('nimisha')} is new in town and linked with nobody. Everyone is published on UC Berkeley campus.
      </p>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {roster.map(({ s, m }) => (
          <span key={s} className={`rounded-full px-2 py-0.5 font-medium ${!m ? TONE.blocked : m.published && m.areaKey ? TONE.ready : TONE.used}`}>
            {board.name(s)}: {!m ? 'not on the roster' : m.published && m.areaKey ? 'published' : 'not published (reset fixes it)'}
          </span>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mb-3 text-xs text-rose-700">Roster incomplete ({missing.join(', ')}). The module owner adds each demo account once with set_demo_member.</p>
      )}
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SCENARIOS.map((sc) => {
          const c = sc.check(board);
          return (
            <li key={sc.n} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{sc.n}. {sc.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[c.state]}`}>{LABEL[c.state]}</span>
              </div>
              <div className="mt-0.5 text-xs font-medium text-stone-700">{sc.who}{sc.once ? ' · once per reset' : ' · repeatable'}</div>
              <div className="mt-1 text-xs text-stone-700">{sc.steps}</div>
              <div className="mt-1 text-xs text-stone-500">Shows: {sc.shows}</div>
              <div className={`mt-1 text-xs ${c.state === 'ready' ? 'text-emerald-700' : c.state === 'used' ? 'text-amber-700' : 'text-rose-700'}`}>{c.note}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
