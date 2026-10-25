'use client';

/**
 * The door (spec, "Door"). A paper tag asks "What's your new chapter?"; the door swings open in 3D while the camera
 * pushes through and the room fades up from the light. Signed out, the tag reads "Sign in to come in".
 * The chapter choice is local to this device (transition-model.ts) and never sent anywhere.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Show, SignInButton } from '@clerk/nextjs';
import { TRANSITIONS, readPref, sessionStore, writePref, type TransitionId } from '@/components/feature/transition-model';
import { isClerkConfigured } from '@/lib/config';
import { DUR, EASE, prefersReducedMotion, registerMotion } from './motion';

const SEEN_KEY = 'dor:door-seen';

function hasSeenDoor(): boolean {
  try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

function ChapterTag({ onEnter }: { onEnter: () => void }) {
  const saved = readPref(sessionStore());
  const [chosen, setChosen] = useState<TransitionId | null>(saved.transition);
  const choose = (id: TransitionId) => {
    setChosen(id);
    writePref(sessionStore(), { transition: id, areaKey: saved.areaKey });
    onEnter();
  };
  return (
    <>
      <p className="font-hand text-[26px] leading-none">What&apos;s your new chapter?</p>
      <p className="mt-1 font-pencil text-lg leading-none">Only you can see this</p>
      <div className="mt-2">
        {TRANSITIONS.map((t) => (
          <button key={t.id} type="button" className="chapter-choice" aria-pressed={chosen === t.id} onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={onEnter} className="mt-3 text-sm text-muted-foreground underline underline-offset-4">Just come in</button>
    </>
  );
}

function SignInTag() {
  return (
    <>
      <p className="font-hand text-[28px] leading-none">Sign in to come in</p>
      <p className="mt-2 text-sm text-muted-foreground">Your notebook stays on this device. Everything else is opt-in.</p>
      <SignInButton mode="modal" forceRedirectUrl="/" signUpForceRedirectUrl="/">
        <button type="button" className="chapter-choice mt-3">Knock</button>
      </SignInButton>
    </>
  );
}

export function Door({ onOpened }: { onOpened: () => void }) {
  const scene = useRef<HTMLDivElement>(null);
  const [isQuick] = useState(hasSeenDoor);

  const open = (quick: boolean) => {
    const root = scene.current;
    if (!root) return;
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked: the door just plays again */ }
    const panel = root.querySelector('.door-panel');
    const frame = root.querySelector('.door-frame');
    const light = root.querySelector('.door-light');
    if (prefersReducedMotion()) {
      gsap.to(root, { opacity: 0, duration: DUR.reduced, ease: 'none', onComplete: onOpened });
      return;
    }
    const d = quick ? DUR.doorRepeat : DUR.door;
    gsap.timeline({ onComplete: onOpened })
      .to(root.querySelector('.door-tag'), { opacity: 0, y: -10, duration: d * 0.2, ease: EASE.leave }, 0)
      .to(panel, { rotateY: -108, duration: d * 0.7, ease: EASE.glide }, 0)
      .to(light, { opacity: 1, duration: d * 0.5, ease: EASE.settle }, d * 0.1)
      .to(frame, { scale: 2.6, duration: d * 0.75, ease: EASE.glide }, d * 0.25)
      .to(root, { opacity: 0, duration: d * 0.3, ease: 'none' }, d * 0.7);
  };

  useLayoutEffect(() => {
    registerMotion();
    if (!isQuick || !scene.current) return;
    // Repeat visit: a short push, no tag.
    const id = requestAnimationFrame(() => open(true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount
  }, []);

  const tag = <ChapterTag onEnter={() => open(false)} />;
  return (
    <div ref={scene} className="door-scene" role="dialog" aria-label="Front door">
      <div className="door-light" aria-hidden />
      <div className="door-frame">
        <div className="door-panel"><span className="door-knob" aria-hidden /></div>
        {!isQuick && (
          <div className="door-tag">
            {isClerkConfigured
              ? <><Show when="signed-out"><SignInTag /></Show><Show when="signed-in">{tag}</Show></>
              : tag}
          </div>
        )}
      </div>
    </div>
  );
}
