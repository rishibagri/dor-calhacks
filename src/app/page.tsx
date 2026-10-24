'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { IntegrationStatus } from '@/components/shell/integration-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STEPS = [
  { href: '/onboarding', label: 'Take the optional quiz', note: 'Personalizes suggestions; never grants sharing.' },
  { href: '/journal', label: 'Write a private entry', note: 'Encrypted on this device. Reflect, and share only what you approve.' },
  { href: '/connections', label: 'Connect someone', note: 'Invite, then confirm a preset per person.' },
  { href: '/privacy', label: 'Review what is shared', note: 'Approved signals and receipts.' },
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold md:text-5xl">dor</h1>
        <p className="max-w-[48ch] text-lg text-muted-foreground">
          Stay close to your partner, friends and family. Reflect privately; reach out only when you choose, to the
          person you choose.
        </p>
      </header>
      <section aria-labelledby="next-steps">
        <h2 id="next-steps" className="mb-2 text-xl font-semibold">Next steps</h2>
        <ul className="divide-y divide-border/70 border-y">
          {STEPS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group -mx-3 flex items-center justify-between gap-4 rounded-lg px-3 py-4 transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-accent/50 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-sm text-muted-foreground">{s.note}</span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)] group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <Card className="bg-card/60 shadow-none">
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Honest view of what is real and what is a placeholder.</CardDescription>
        </CardHeader>
        <CardContent><IntegrationStatus /></CardContent>
      </Card>
    </div>
  );
}
