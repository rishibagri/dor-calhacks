'use client';

/**
 * CameraRig: moves the room under a fixed viewport. One GSAP timeline at a time; a new move kills the old one and
 * starts from wherever the camera is, so taps mid-glide never jump. Only transform and opacity are animated.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';
import { arcBetween, cameraAt, cameraFor, levelOf, toTransform, type Camera, type PlaceId } from './layout';
import { DUR, EASE, prefersReducedMotion, promote } from './motion';

interface Size { w: number; h: number }

function durationFor(from: PlaceId | null, to: PlaceId | null): number {
  const a = levelOf(from);
  const b = levelOf(to);
  return Math.max(a, b) === 2 && Math.min(a, b) >= 1 ? DUR.closeUp : DUR.place;
}

export function useCamera(world: RefObject<HTMLDivElement | null>, size: Size | null) {
  const current = useRef<{ id: PlaceId | null; cam: Camera } | null>(null);
  /** The camera as last drawn, so an interrupted glide continues from the frame on screen. */
  const live = useRef<Camera | null>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  /** Snap without animation (first layout, resize). */
  const snap = useCallback((id: PlaceId | null) => {
    if (!world.current || !size) return;
    const cam = cameraFor(id, size);
    tl.current?.kill();
    gsap.set(world.current, { ...toTransform(cam), transformOrigin: '0 0', force3D: true, opacity: 1 });
    current.current = { id, cam };
    live.current = cam;
  }, [world, size]);

  const move = useCallback((to: PlaceId | null): Promise<void> => {
    const el = world.current;
    if (!el || !size) return Promise.resolve();
    const from = current.current ?? { id: null, cam: cameraFor(null, size) };
    const target = cameraFor(to, size);
    current.current = { id: to, cam: target };
    tl.current?.kill();
    const release = promote(el);

    return new Promise((resolve) => {
      const done = () => { release(); resolve(); };
      const t = gsap.timeline({ onComplete: done, onInterrupt: done });
      tl.current = t;
      if (prefersReducedMotion()) {
        live.current = target;
        t.to(el, { opacity: 0, duration: DUR.reduced / 2, ease: 'none' })
          .set(el, toTransform(target))
          .to(el, { opacity: 1, duration: DUR.reduced / 2, ease: 'none' });
        return;
      }
      // Start from where the camera actually is, even mid-glide.
      const start = live.current ?? from.cam;
      const mid = arcBetween(start, target, from.id, to);
      const proxy = { p: 0 };
      t.to(proxy, {
        p: 1,
        duration: durationFor(from.id, to),
        ease: EASE.glide,
        onUpdate: () => {
          const cam = cameraAt(start, mid, target, proxy.p);
          live.current = cam;
          gsap.set(el, toTransform(cam));
        },
      });
    });
  }, [world, size]);

  // Keep framing on resize and orientation change.
  useEffect(() => {
    if (current.current) snap(current.current.id);
  }, [size, snap]);

  useEffect(() => () => { tl.current?.kill(); }, []);

  return { move, snap, currentId: () => current.current?.id ?? null };
}
