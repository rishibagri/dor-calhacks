import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Caveat, Courier_Prime, Newsreader, Reenie_Beanie } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { BackendProvider } from '@/lib/backend';
import { isClerkConfigured } from '@/lib/config';
import { SwRegister } from '@/components/shell/sw-register';
import './globals.css';

// Type tells you who wrote something: your hand in ink, a private suggestion in pencil, anything that goes out typed.
const body = Newsreader({ subsets: ['latin'], variable: '--font-body', display: 'swap', style: ['normal', 'italic'] });
const hand = Caveat({ subsets: ['latin'], variable: '--font-caveat', display: 'swap', weight: ['500', '600'] });
const pencil = Reenie_Beanie({ subsets: ['latin'], variable: '--font-reenie', display: 'swap', weight: '400' });
const typed = Courier_Prime({ subsets: ['latin'], variable: '--font-courier', display: 'swap', weight: '400' });

export const metadata: Metadata = {
  title: 'dor',
  description: 'A room for your new chapter: meet people nearby, find real things to do, keep up with people from home.',
  applicationName: 'dor',
  icons: { apple: '/pwa-icon/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'dor', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAF7F0',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const app = <BackendProvider>{children}</BackendProvider>;
  return (
    <html lang="en" className={`${body.variable} ${hand.variable} ${pencil.variable} ${typed.variable}`}>
      <body className="min-h-dvh antialiased">
        <SwRegister />
        {isClerkConfigured ? <ClerkProvider>{app}</ClerkProvider> : app}
      </body>
    </html>
  );
}
