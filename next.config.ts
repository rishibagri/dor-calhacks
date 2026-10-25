import type { NextConfig } from 'next';
import { ROUTE_TARGETS } from './src/components/room/layout';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Reflection/voice routes carry private selected text; never cache them.
  // The room replaced every page (Room UI spec): old routes glide the camera to the place that replaced them.
  async redirects() {
    return Object.entries(ROUTE_TARGETS).map(([source, at]) => ({ source, destination: `/?at=${at}`, permanent: false }));
  },
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
