import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { BackendProvider } from '@/lib/backend';
import { isClerkConfigured } from '@/lib/config';
import { AppShell } from '@/components/shell/app-shell';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'dor',
  description: 'A private voice journal with owner-approved, minimal signals.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Follows the system theme before first paint to avoid a flash.
const THEME_SCRIPT = `try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    <BackendProvider>
      <AppShell>{children}</AppShell>
    </BackendProvider>
  );
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        {isClerkConfigured ? <ClerkProvider>{body}</ClerkProvider> : body}
      </body>
    </html>
  );
}
