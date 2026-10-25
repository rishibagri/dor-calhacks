'use client';

import { useReflection, useSharedState, useVault } from '@/lib/backend';
import type { AdapterStatus } from '@/lib/backend/ports';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function describeStatus(s: AdapterStatus): { label: string; detail: string } {
  switch (s.kind) {
    case 'live': return { label: 'wired', detail: 'Real adapter connected in code; provider and deployment availability are verified separately.' };
    case 'unconfigured': return { label: 'unconfigured', detail: s.reason };
    case 'not_implemented': return { label: `not implemented (${s.owner})`, detail: s.reason };
    case 'error': return { label: 'error', detail: s.reason };
  }
}

function Row({ name, status }: { name: string; status: AdapterStatus }) {
  const { label, detail } = describeStatus(status);
  return (
    <li className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[8rem_auto_1fr] sm:items-center">
      <span className="text-sm font-medium">{name}</span>
      <Badge
        variant="outline"
        className={cn(
          'justify-self-start font-normal',
          status.kind === 'live' && 'border-success/40 bg-success/10 text-success',
          status.kind === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
          (status.kind === 'unconfigured' || status.kind === 'not_implemented') && 'border-warning/50 bg-warning/10 text-warning',
        )}
      >
        {label}
      </Badge>
      <span className="text-sm text-muted-foreground">{detail}</span>
    </li>
  );
}

export function IntegrationStatus() {
  const shared = useSharedState();
  const vault = useVault();
  const reflection = useReflection();
  return (
    <ul className="divide-y divide-border/70" aria-label="Integration status">
      <Row name="Shared state" status={shared.status} />
      <Row name="Local vault" status={vault.status} />
      <Row name="Reflection" status={reflection.status} />
    </ul>
  );
}
