'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { areExtensionsEnabled } from '@/lib/config';

/**
 * Core-first separation (README Core 4). With extensions off, an extension page shows a plain notice instead of
 * its setup/browse UI, but anything passed as `controls` still renders: withdraw, block, report and cancel must
 * keep working for anyone who used the extension earlier.
 */
export function ExtensionGate({ title, children, controls }: { title: string; children: ReactNode; controls?: ReactNode }) {
  if (areExtensionsEnabled) return <>{children}</>;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          This optional feature is not part of the current release. dor is focused on staying close to the people you
          already know. <Link className="underline" href="/journal">Go to your journal</Link>.
        </p>
      </header>
      {controls}
    </div>
  );
}
