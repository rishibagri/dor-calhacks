/**
 * Line primitives for the room art. A drawn line is an ink stroke plus a faint pencil ghost offset by half a unit,
 * which reads as hand-drawn without runtime filters (spec: no live SVG filters, blurs or watercolour effects).
 */
import type { ReactNode, SVGProps } from 'react';

export const C = {
  paper: '#FAF7F0',
  paperDeep: '#EFE8CF',
  cardStock: '#FBF4E4',
  washGrey: '#F1ECE0',
  rule: '#E4DFD2',
  ink: '#1B1A17',
  pencil: '#A39E93',
  pencilText: '#6B665D',
  sky: '#9DBEE8',
  skyInk: '#2F5C91',
  skyWash: '#EAF2FC',
  skyPale: '#C9DCF3',
  mint: '#A8DCC4',
  pink: '#F2A7B8',
  butter: '#F6D77A',
  peach: '#F7B98B',
  lavender: '#C3B1E1',
  kraft: '#E6D2AC',
  cork: '#EADBB8',
  wood: '#E3CFA6',
} as const;

export const WASHES = [C.butter, C.peach, C.pink, C.lavender] as const;

type PathProps = Omit<SVGProps<SVGPathElement>, 'd'> & { d: string; w?: number; ghost?: boolean };

export function Ink({ d, w = 1.1, ghost = true, ...rest }: PathProps) {
  return (
    <>
      {ghost && <path d={d} fill="none" stroke={C.pencil} strokeWidth={w * 0.7} opacity={0.45} transform="translate(0.6 0.5)" strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={C.ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" {...rest} />
    </>
  );
}

export function Pencil({ d, w = 0.9, ...rest }: PathProps) {
  return <path d={d} fill="none" stroke={C.pencil} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" {...rest} />;
}

/** A filled wash with an ink outline: the base unit of every painted object. */
export function Shape({ d, fill, w = 1.1, opacity = 0.85 }: { d: string; fill: string; w?: number; opacity?: number }) {
  return (
    <>
      <path d={d} fill={fill} opacity={opacity} />
      <Ink d={d} w={w} />
    </>
  );
}

export const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;
export const quad = (pts: readonly (readonly [number, number])[]) => `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}Z`;

export function Layer({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 390 844" width="390" height="844" className="absolute inset-0 overflow-visible" aria-hidden data-layer={label}>
      {children}
    </svg>
  );
}

/** Deterministic pick so a person's book keeps its colour across renders. */
export function washFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return WASHES[Math.abs(h) % WASHES.length];
}
