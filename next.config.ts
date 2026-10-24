import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Reflection/voice routes carry private selected text; never cache them.
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
  },
};

export default nextConfig;
