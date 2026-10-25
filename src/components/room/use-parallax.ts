'use client';

/**
 * Idle parallax across the three art layers, driven by pointer or device tilt. Runs on GSAP's ticker (the room's one
 * loop), eases toward the target a little each frame, and travels at most 8 px. Off under reduced motion and while
 * the camera is not at the whole room.
 */
import { useEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import { prefersReducedMotion } from './motion';

const MAX_PX = 8;
const FOLLOW = 0.06;
/** Back moves least, floor most. */
const DEPTH = [0.35, 0.7, 1] as const;

export function useParallax(layers: RefObject<(HTMLDivElement | null)[]>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || prefersReducedMotion()) return;
    const els = layers.current.filter((l): l is HTMLDivElement => Boolean(l));
    const setters = els.map((el) => ({ x: gsap.quickSetter(el, 'x', 'px'), y: gsap.quickSetter(el, 'y', 'px') }));
    const target = { x: 0, y: 0 };
    const now = { x: 0, y: 0 };

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      target.x = Math.max(-1, Math.min(1, e.gamma / 25));
      target.y = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
    };
    const tick = () => {
      now.x += (target.x - now.x) * FOLLOW;
      now.y += (target.y - now.y) * FOLLOW;
      setters.forEach((s, i) => { s.x(-now.x * MAX_PX * DEPTH[i]); s.y(-now.y * MAX_PX * DEPTH[i]); });
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onTilt, { passive: true });
    gsap.ticker.add(tick);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onTilt);
      gsap.ticker.remove(tick);
      // Settle home so a zoomed view is never offset.
      gsap.to(els, { x: 0, y: 0, duration: 0.4, ease: 'dor.settle' });
    };
  }, [layers, isActive]);
}
