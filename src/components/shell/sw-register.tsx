'use client';

import { useEffect } from 'react';

/** Registers the static-asset-only service worker (production only). No push, no notifications. */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      /* installability is best-effort; the app works without it */
    });
  }, []);
  return null;
}
