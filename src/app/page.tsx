'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { IntegrationStatus } from '@/components/shell/integration-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TRANSITIONS, readPref, sessionStore, writePref, type TransitionId } from '@/components/feature/transition-model';
import { LAUNCH_AREAS } from '@/lib/discovery/config';
import { isDiscoveryUiEnabled } from '@/lib/config';

const SECONDARY = [
  { href: '/connections', label: 'Keep up with people you already know', note: 'Invite someone and set what you are comfortable sharing.' },
  { href: '/journal', label: 'Write a private entry', note: 'Optional. Encrypted on this device; share only what you approve.' },
  { href: '/privacy', label: 'Review what is shared', note: 'Approved signals and receipts.' },
] as const;

export default function HomePage() {
  const saved = readPref(sessionStore());
  const [transition, setTransition] = useState<TransitionId | null>(saved.transition);
  const [areaKey, setAreaKey] = useState<string>(saved.areaKey ?? LAUNCH_AREAS[0]?.key ?? '');

  // Local to this browser session only: never sent to the server or a model.
  const choose = (next: TransitionId) => { setTransition(next); writePref(sessionStore(), { transition: next, areaKey }); };
  const pickArea = (key: string) => { setAreaKey(key); writePref(sessionStore(), { transition, areaKey: key }); };

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold md:text-5xl">What&apos;s changing for you?</h1>
        <p className="max-w-[52ch] text-lg text-muted-foreground">
          Moving somewhere new is a good time to meet people. Pick what fits; this stays on this device and is not shared.
        </p>
      </header>
      {isDiscoveryUiEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Meet people nearby</CardTitle>
            <CardDescription>Everything is opt-in. You choose what to show, and nobody can contact you unless you accept.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div role="group" aria-label="What is changing" className="flex flex-wrap gap-2">
              {TRANSITIONS.map((t) => (
                <Button key={t.id} size="sm" variant={transition === t.id ? 'default' : 'outline'} aria-pressed={transition === t.id} onClick={() => choose(t.id)}>
                  {t.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="home-area" className="text-sm">Broad area</label>
              <select id="home-area" className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={areaKey} onChange={(e) => pickArea(e.target.value)}>
                {LAUNCH_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <Button asChild><Link href="/discover">Continue to Discover <ArrowRight aria-hidden className="size-4" /></Link></Button>
          </CardContent>
        </Card>
      )}
      <IntegrationStatus />
      <section aria-labelledby="also">
        <h2 id="also" className="mb-2 text-lg font-semibold">Also in dor</h2>
        <ul className="divide-y divide-border/70 border-y">
          {SECONDARY.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="group -mx-3 flex items-center justify-between gap-4 rounded-lg px-3 py-4 transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-accent/50 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-sm text-muted-foreground">{s.note}</span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
