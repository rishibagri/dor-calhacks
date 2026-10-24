'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { isDiscoveryUiEnabled } from '@/lib/config';

/**
 * Escape hatch (NEXT_PUBLIC_DOR_DISCOVERY=off). Discovery is on by default; when hidden, the page shows a plain notice
 * but anything passed as `controls` still renders: withdraw, block, report and cancel must keep working.
 */
export function DiscoveryGate({ title, children, controls }: { title: string; children: ReactNode; controls?: ReactNode }) {
  if (isDiscoveryUiEnabled) return <>{children}</>;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          This part of dor is turned off in this build. <Link className="underline" href="/connections">Keep in touch with people you already know</Link>.
        </p>
      </header>
      {controls}
    </div>
  );
}
