'use client';

import { useEffect, useReducer } from 'react';
import { useSharedState } from '@/lib/backend';
import type { SharedStatePort } from '@/lib/backend/ports';

/** Returns the shared-state port and re-renders whenever it notifies. */
export function useLiveShared(): SharedStatePort {
  const port = useSharedState();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => port.subscribe(bump), [port]);
  return port;
}
