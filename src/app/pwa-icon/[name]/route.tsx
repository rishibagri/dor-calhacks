import { ImageResponse } from 'next/og';

// Static, user-independent icons for the web app manifest / apple-touch-icon.
const BG = '#2c5848';
const FG = '#faf8f4';

const ICONS = {
  'icon-192.png': { size: 192, scale: 0.34 },
  'icon-512.png': { size: 512, scale: 0.34 },
  // Maskable: full-bleed background, wordmark kept well inside the 80% safe zone.
  'icon-maskable-512.png': { size: 512, scale: 0.26 },
  'apple-touch-icon.png': { size: 180, scale: 0.34 },
} as const;

type IconName = keyof typeof ICONS;

export const dynamic = 'force-static';

export function generateStaticParams() {
  return (Object.keys(ICONS) as IconName[]).map((name) => ({ name }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const spec = ICONS[name as IconName];
  if (!spec) return new Response('Not found', { status: 404 });
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BG,
          color: FG,
          fontSize: Math.round(spec.size * spec.scale * 1.6),
          fontWeight: 600,
          letterSpacing: '-0.04em',
        }}
      >
        dor
      </div>
    ),
    { width: spec.size, height: spec.size },
  );
}
