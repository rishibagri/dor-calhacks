'use client';

/**
 * dor's motion vocabulary. Every animation in the room uses only these named curves and durations, so the
 * camera, sheets and objects move like one piece. Registered once with GSAP's CustomEase.
 *
 * Rules (spec, "Performance rules"): animate only transform and opacity, one loop (GSAP's ticker), promote a
 * layer only while it moves, and every glide becomes a short crossfade under reduced motion.
 */
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

export const EASE = {
  /** Arrivals: cards, notes, words settling into place. Fast start, long soft landing. */
  settle: 'dor.settle',
  /** The camera. Symmetric so a glide feels carried, not thrown; arcs stay continuous through the midpoint. */
  glide: 'dor.glide',
  /** Paper sheets and the drawer, in both directions. */
  sheet: 'dor.sheet',
  /** Small confirmations with a slight overshoot: a pin pressing in, a stamp landing. */
  press: 'dor.press',
  /** Things leaving the room. Gathers, then goes. */
  leave: 'dor.leave',
} as const;

const CURVES: Record<(typeof EASE)[keyof typeof EASE], string> = {
  'dor.settle': '0.2,0.9,0.25,1',
  'dor.glide': '0.66,0,0.22,1',
  'dor.sheet': '0.3,0.75,0.1,1',
  'dor.press': '0.34,1.4,0.6,1',
  'dor.leave': '0.55,0,0.8,0.2',
};

/** Seconds. */
export const DUR = {
  tap: 0.24,
  base: 0.48,
  closeUp: 0.55,
  place: 1.0,
  door: 1.5,
  doorRepeat: 0.6,
  reduced: 0.3,
} as const;

let registered = false;

export function registerMotion(): void {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(CustomEase);
  for (const [name, curve] of Object.entries(CURVES)) CustomEase.create(name, curve);
  gsap.defaults({ ease: EASE.settle, duration: DUR.base });
  registered = true;
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Promote a layer for the duration of a tween, then let the browser re-sharpen it. */
export function promote(el: Element | null): () => void {
  if (!el) return () => {};
  (el as HTMLElement).style.willChange = 'transform';
  return () => { (el as HTMLElement).style.willChange = ''; };
}
