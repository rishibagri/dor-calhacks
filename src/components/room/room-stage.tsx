'use client';

/**
 * RoomStage: the one screen of dor (spec rule 1). Owns the viewport, the three art layers, hotspots, the paper sheet
 * and browser history. Every navigation is a camera move inside the same room; back zooms out one level.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { gsap } from 'gsap';
import { ArrowLeft } from 'lucide-react';
import { useLiveShared } from '@/components/shell/use-live';
import { ConnectionPill } from '@/components/shell/connection-pill';
import { AccountArea } from '@/components/shell/account-area';
import { BackWall, daylightAt } from './art/back-wall';
import { Furniture } from './art/furniture';
import { Floor } from './art/floor';
import { Door } from './door';
import { PLACES, ROOM_H, ROOM_W, boxRect, hotspotRect, levelOf, parentOf, pathTo, placeById, type PlaceId } from './layout';
import { DUR, EASE, prefersReducedMotion, registerMotion } from './motion';
import { PlaceContent } from './place-content';
import { placeBadges, roomSignals } from './room-signals';
import { onRoomNavigate } from './room-nav';
import { useCamera } from './use-camera';
import { useParallax } from './use-parallax';
import { useSignedIn } from './use-signed-in';

const GLOW_KEY = 'dor:room-glowed';
const SWIPE_CLOSE_PX = 70;

interface HistoryEntry { dorAt: PlaceId | null; dorDepth: number }

function readAt(): PlaceId | null {
  return placeById(new URLSearchParams(window.location.search).get('at'))?.id ?? null;
}

function urlFor(id: PlaceId | null): string {
  return id ? `/?at=${id}` : '/';
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => { window.addEventListener('online', cb); window.addEventListener('offline', cb); return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); }; },
    () => navigator.onLine,
    () => true,
  );
}

function useStageSize(el: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

/** Hotspots shown at the current level: the room's places, or the desk's objects once you are at the desk. */
function hotspotsFor(at: PlaceId | null): PlaceId[] {
  const context = at && (at === 'desk' || parentOf(at) === 'desk') ? 'desk' : null;
  return PLACES.filter((p) => p.parent === context).map((p) => p.id);
}

export function RoomStage() {
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const size = useStageSize(stage);
  const camera = useCamera(world, size);
  const [at, setAt] = useState<PlaceId | null>(null);
  /** Sheet content lags `at` on the way out, so the sheet slides away with its content still on it. */
  const [shown, setShown] = useState<PlaceId | null>(null);
  const [isInside, setIsInside] = useState(false);
  const [glow, setGlow] = useState(false);
  const pending = useRef<PlaceId | null>(null);
  const isOnline = useOnline();
  const isSignedIn = useSignedIn();

  const shared = useLiveShared();
  const nowMs = Date.now();
  const signals = roomSignals({
    me: shared.myDiscoveryProfile(), cards: shared.discoveryCards(), events: shared.catalogueEvents(),
    introductions: shared.myIntroductions(), pairs: shared.myPairs(), plans: shared.myPlans(), nudges: shared.myNudges(), nowMs,
  });
  const badges = placeBadges(signals);
  const boxesDone = Boolean(shared.myDiscoveryProfile()?.areaKey);
  const daylight = useMemo(() => daylightAt(new Date().getHours()), []);
  const homeZoom = size ? Math.min(size.w / ROOM_W, size.h / ROOM_H) : 1;

  useEffect(() => { registerMotion(); }, []);

  const go = useCallback((to: PlaceId | null, mode: 'push' | 'replace' | 'none' = 'push') => {
    if (camera.currentId() === to) return;
    if (mode !== 'none') {
      const depth = ((window.history.state as HistoryEntry | null)?.dorDepth ?? 0) + (mode === 'push' ? 1 : 0);
      const entry: HistoryEntry = { ...(window.history.state ?? {}), dorAt: to, dorDepth: depth };
      if (mode === 'push') window.history.pushState(entry, '', urlFor(to));
      else window.history.replaceState(entry, '', urlFor(to));
    }
    setAt(to);
    if (to) setShown(to);
    void camera.move(to);
  }, [camera]);

  /** Back always zooms out one level; uses the browser's own history when we created the entry. */
  const back = useCallback(() => {
    const current = camera.currentId();
    if (!current) return;
    const depth = (window.history.state as HistoryEntry | null)?.dorDepth ?? 0;
    const parent = parentOf(current);
    const prev = depth > 0 ? (window.history.state as HistoryEntry).dorAt : undefined;
    if (depth > 0 && prev === current) window.history.back();
    else go(parent, 'replace');
  }, [camera, go]);

  // First layout: frame the whole room; remember a deep link to glide to once the door opens.
  useLayoutEffect(() => {
    if (!size || pending.current !== null || camera.currentId() !== null) return;
    camera.snap(null);
    pending.current = readAt();
    window.history.replaceState({ ...(window.history.state ?? {}), dorAt: null, dorDepth: 0 } satisfies HistoryEntry, '', '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the first measurement
  }, [size]);

  const enterRoom = useCallback(() => {
    setIsInside(true);
    const target = pending.current;
    pending.current = null;
    if (target) {
      // Rebuild history so back walks out one level at a time.
      for (const id of pathTo(target)) {
        const depth = ((window.history.state as HistoryEntry | null)?.dorDepth ?? 0) + 1;
        window.history.pushState({ dorAt: id, dorDepth: depth } satisfies HistoryEntry, '', urlFor(id));
      }
      setAt(target);
      setShown(target);
      void camera.move(target);
      return;
    }
    try {
      if (localStorage.getItem(GLOW_KEY) !== '1') { setGlow(true); localStorage.setItem(GLOW_KEY, '1'); }
    } catch { /* storage blocked: skip the one-time glow */ }
  }, [camera]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => go((e.state as HistoryEntry | null)?.dorAt ?? readAt(), 'none');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [go]);

  useEffect(() => onRoomNavigate((id) => go(id)), [go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isInside) back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, isInside]);

  // Signed out mid-session (real Clerk sign-out, never a backend hiccup): pull back to the door.
  useEffect(() => {
    if (isSignedIn === false && isInside) { go(null, 'replace'); setIsInside(false); }
  }, [isSignedIn, isInside, go]);

  // The sheet's resting state belongs to GSAP alone, so CSS never fights the tween.
  useLayoutEffect(() => { if (sheet.current) gsap.set(sheet.current, { yPercent: 105, y: 0, autoAlpha: 0 }); }, []);

  // The paper sheet: slides up from below on entering a place, away when returning to the room.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const reduced = prefersReducedMotion();
    if (at) {
      gsap.to(el, reduced
        ? { autoAlpha: 1, yPercent: 0, duration: DUR.reduced, ease: 'none' }
        : { autoAlpha: 1, yPercent: 0, duration: DUR.base + 0.1, ease: EASE.sheet, delay: 0.12 });
    } else {
      gsap.to(el, reduced
        ? { autoAlpha: 0, duration: DUR.reduced, ease: 'none', onComplete: () => setShown(null) }
        : { yPercent: 105, duration: DUR.base, ease: EASE.sheet, onComplete: () => { gsap.set(el, { autoAlpha: 0 }); setShown(null); } });
    }
  }, [at]);

  useParallax(layers, isInside && at === null);

  // Swipe the sheet's grip down to zoom out.
  const drag = useRef<{ y: number; id: number } | null>(null);
  const onGripDown = (e: React.PointerEvent) => { drag.current = { y: e.clientY, id: e.pointerId }; (e.target as Element).setPointerCapture(e.pointerId); };
  const onGripMove = (e: React.PointerEvent) => {
    if (!drag.current || !sheet.current) return;
    gsap.set(sheet.current, { y: Math.max(0, e.clientY - drag.current.y) });
  };
  const onGripUp = (e: React.PointerEvent) => {
    if (!drag.current || !sheet.current) return;
    const dy = e.clientY - drag.current.y;
    drag.current = null;
    gsap.to(sheet.current, { y: 0, duration: DUR.tap, ease: EASE.settle });
    if (dy > SWIPE_CLOSE_PX) back();
  };

  const visible = hotspotsFor(at);
  const level = levelOf(at);
  const place = placeById(at);

  return (
    <div className="room-viewport">
      <div ref={stage} className="relative mx-auto h-full w-full max-w-[480px] overflow-hidden bg-[var(--paper)] md:shadow-[0_0_0_1px_var(--rule),0_30px_80px_-40px_rgba(27,26,23,0.5)]">
        <div ref={world} className="room-world" onDoubleClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).closest('svg')) go(null); }}>
          <div ref={(el) => { layers.current[0] = el; }} className="room-layer"><BackWall daylight={daylight} cityLights={signals.cityLights} /></div>
          <div ref={(el) => { layers.current[1] = el; }} className="room-layer"><Furniture signals={signals} /></div>
          <div ref={(el) => { layers.current[2] = el; }} className="room-layer"><Floor signals={signals} boxesDone={boxesDone} /></div>
          <nav aria-label="Places in your room" className="room-layer" hidden={!isInside}>
            {visible.map((id, i) => {
              const p = placeById(id)!;
              const r = hotspotRect(id, homeZoom);
              const badge = badges[id as keyof typeof badges];
              return (
                <button key={id} type="button" className="room-hotspot" data-glow={glow && level === 0 ? '1' : undefined}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, ['--glow-delay' as string]: `${i * 140}ms` }}
                  aria-label={`${p.label}: ${p.hint}${badge ? `, ${badge} new` : ''}`} aria-current={at === id ? 'location' : undefined}
                  onClick={() => go(id)}>
                  {badge ? <span className="room-badge" aria-hidden>{badge}</span> : null}
                </button>
              );
            })}
          </nav>
          {level === 0 && isInside && PLACES.filter((p) => !p.parent).map((p) => {
            const r = boxRect(p.id);
            return <span key={p.id} aria-hidden className="room-label" style={{ left: r.x + r.w / 2, top: r.y + r.h + 2 }}>{p.label.toLowerCase()}</span>;
          })}
        </div>

        <div className="room-chrome">
          {at
            ? <button type="button" className="room-back" onClick={back} aria-label={`Back to ${placeById(parentOf(at))?.label ?? 'the room'}`}>
                <ArrowLeft className="size-4" aria-hidden />{placeById(parentOf(at))?.label.toLowerCase() ?? 'room'}
              </button>
            : <span className="room-wordmark">dor</span>}
          <div className="flex items-center gap-2"><ConnectionPill /><AccountArea /></div>
        </div>

        <section ref={sheet} className="room-sheet invisible" aria-label={place ? `${place.label}: ${place.hint}` : undefined}>
          <div className="touch-none py-1" onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
            <div className="room-sheet-grip" aria-hidden />
          </div>
          <div className="room-sheet-body">
            {shown && <div key={shown} className="sheet-enter"><PlaceContent id={shown} /></div>}
          </div>
        </section>

        {!isOnline && <p role="status" className="room-offline">Offline. Your notebook still works; anything you send will wait.</p>}
      </div>
      {!isInside && <Door onOpened={enterRoom} />}
    </div>
  );
}
