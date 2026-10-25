'use client';

/**
 * The door (spec, "Door"). A paper tag asks "What's your new chapter?"; the door swings open in 3D while the camera
 * pushes through and the room fades up from the light. Signed out, the tag reads "Sign in to come in".
 * The chapter choice is local to this device (transition-model.ts) and never sent anywhere.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { SignInButton } from '@clerk/nextjs';
import { TRANSITIONS, readPref, sessionStore, writePref, type TransitionId } from '@/components/feature/transition-model';
import { DUR, EASE, prefersReducedMotion, registerMotion } from './motion';
import { useSignedIn } from './use-signed-in';

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
  const isSignedIn = useSignedIn();
  const [hasSeen] = useState(hasSeenDoor);
  const isOpening = useRef(false);
  // The quick push only ever applies to someone already signed in; signed out always gets a tag to act on.
  const isQuick = hasSeen && isSignedIn === true;

  const open = (quick: boolean) => {
    const root = scene.current;
    if (!root || isOpening.current) return;
    isOpening.current = true;
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked: the door just plays again */ }
    const panel = root.querySelector('.door-panel');
    const frame = root.querySelector('.door-frame');
    const light = root.querySelector('.door-light');
    if (prefersReducedMotion()) {
      gsap.to(root, { opacity: 0, duration: DUR.reduced, ease: 'none', onComplete: onOpened });
      return;
    }
    const d = quick ? DUR.doorRepeat : DUR.door;
    const tl = gsap.timeline({ onComplete: onOpened });
    const tag = root.querySelector('.door-tag');
    if (tag) tl.to(tag, { opacity: 0, y: -10, duration: d * 0.2, ease: EASE.leave }, 0);
    tl.to(panel, { rotateY: -108, duration: d * 0.7, ease: EASE.glide }, 0)
      .to(light, { opacity: 1, duration: d * 0.5, ease: EASE.settle }, d * 0.1)
      .to(frame, { scale: 2.6, duration: d * 0.75, ease: EASE.glide }, d * 0.25)
      .to(root, { opacity: 0, duration: d * 0.3, ease: 'none' }, d * 0.7);
  };

  useLayoutEffect(() => { registerMotion(); }, []);

  useLayoutEffect(() => {
    if (!isQuick) return;
    const id = requestAnimationFrame(() => open(true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the quick push becomes possible
  }, [isQuick]);

  return (
    <div ref={scene} className="door-scene" role="dialog" aria-label="Front door">
      <div className="door-light" aria-hidden />
      <div className="door-frame">
        <div className="door-panel"><span className="door-knob" aria-hidden /></div>
        {!isQuick && isSignedIn !== null && (
          <div className="door-tag">
            {isSignedIn ? <ChapterTag onEnter={() => open(false)} /> : <SignInTag />}
          </div>
        )}
      </div>
    </div>
  );
}
