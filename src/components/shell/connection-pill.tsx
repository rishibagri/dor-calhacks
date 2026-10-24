'use client';

import { useConnectionState } from '@/lib/backend';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LABELS: Record<string, string> = {
  signed_out: 'Signed out',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  unconfigured: 'Backend unconfigured',
};

const DOT: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning motion-safe:animate-pulse',
  disconnected: 'bg-destructive',
};

export function ConnectionPill() {
  const state = useConnectionState();
  const label = LABELS[state.phase];
  return (
    <Badge variant="outline" role="status" aria-label={`Connection: ${label}`} className="gap-1.5 bg-card py-1 pl-2 pr-2.5 font-normal text-muted-foreground">
      <span aria-hidden className={cn('size-1.5 rounded-full bg-muted-foreground/50', DOT[state.phase])} />
      {label}
    </Badge>
  );
}
