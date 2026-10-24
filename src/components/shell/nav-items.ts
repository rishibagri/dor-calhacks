import { BookOpen, Bell, CalendarDays, Compass, Link2, ShieldCheck, Sparkles } from 'lucide-react';

import { areExtensionsEnabled } from '@/lib/config';

/** Core journey items. */
const CORE_ITEMS = [
  { href: '/onboarding', label: 'Onboarding', icon: Sparkles },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/connections', label: 'Connections', icon: Link2 },
  { href: '/nudges', label: 'Nudges', icon: Bell },
  { href: '/privacy', label: 'Privacy', icon: ShieldCheck },
] as const;

/** Preserved extensions (nearby introductions, local events), shown only when NEXT_PUBLIC_DOR_EXTENSIONS=true. */
const EXTENSION_ITEMS = [
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/events', label: 'Events', icon: CalendarDays },
] as const;

export const NAV_ITEMS = areExtensionsEnabled ? [...CORE_ITEMS, ...EXTENSION_ITEMS] : [...CORE_ITEMS];
