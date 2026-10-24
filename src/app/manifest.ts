import type { MetadataRoute } from 'next';

// Colours mirror the design tokens in globals.css (background / primary), as sRGB hex.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'dor',
    short_name: 'dor',
    description: 'A private voice journal with owner-approved, minimal signals.',
    start_url: '/journal',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf8f4',
    theme_color: '#faf8f4',
    icons: [
      { src: '/pwa-icon/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
