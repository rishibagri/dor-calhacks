'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AccountArea } from './account-area';
import { ConnectionPill } from './connection-pill';
import { NAV_ITEMS } from './nav-items';

function NavLinks({ vertical }: { vertical: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={cn('flex gap-1', vertical ? 'flex-col' : 'grid grid-cols-5')}>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-accent/60 hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                vertical ? '' : 'min-h-12 flex-col justify-center gap-0.5 px-1 text-[11px]',
                active && 'bg-accent font-medium text-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-card/50 p-4 md:flex">
        <Link href="/" className="rounded-md px-3 pt-1 font-display text-xl font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring">dor</Link>
        <nav aria-label="Primary"><NavLinks vertical /></nav>
        <div className="mt-auto flex flex-col items-start gap-3 border-t px-3 pt-4">
          <ConnectionPill />
          <AccountArea />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col pb-24 md:pb-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-3 md:hidden">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">dor</Link>
          <div className="flex items-center gap-2"><ConnectionPill /><AccountArea /></div>
        </header>
        <main className="page-enter mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-10 md:py-12">{children}</main>
      </div>
      <nav aria-label="Primary mobile" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden">
        <NavLinks vertical={false} />
      </nav>
    </div>
  );
}
