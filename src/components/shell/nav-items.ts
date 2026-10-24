import { BookOpen, Bell, CalendarDays, Compass, Link2, ShieldCheck, type LucideIcon } from 'lucide-react';

import { isDiscoveryUiEnabled } from '@/lib/config';
import { orderNav } from './nav-order';

/** D045 transition-first: Discover first, then Events, then the existing-relationship paths. Six tabs fit the mobile bar. */
interface NavItem { href: string; label: string; icon: LucideIcon }

const DISCOVERY_ITEMS: readonly NavItem[] = [
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/events', label: 'Events', icon: CalendarDays },
];

const OTHER_ITEMS: readonly NavItem[] = [
  { href: '/connections', label: 'Connections', icon: Link2 },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/nudges', label: 'Nudges', icon: Bell },
  { href: '/privacy', label: 'Privacy', icon: ShieldCheck },
];

export const NAV_ITEMS = orderNav(DISCOVERY_ITEMS, OTHER_ITEMS, isDiscoveryUiEnabled);
