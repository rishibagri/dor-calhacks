import { BookOpen, Bell, Link2, ShieldCheck, Sparkles } from 'lucide-react';

export const NAV_ITEMS = [
  { href: '/onboarding', label: 'Onboarding', icon: Sparkles },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/connections', label: 'Connections', icon: Link2 },
  { href: '/nudges', label: 'Nudges', icon: Bell },
  { href: '/privacy', label: 'Privacy', icon: ShieldCheck },
] as const;
