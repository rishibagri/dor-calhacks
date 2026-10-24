import { BookOpen, Bell, Compass, Link2, ShieldCheck, Sparkles } from 'lucide-react';

export const NAV_ITEMS = [
  { href: '/onboarding', label: 'Onboarding', icon: Sparkles },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/connections', label: 'Connections', icon: Link2 },
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/nudges', label: 'Nudges', icon: Bell },
  { href: '/privacy', label: 'Privacy', icon: ShieldCheck },
] as const;
