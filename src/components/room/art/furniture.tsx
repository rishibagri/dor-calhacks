/**
 * Middle layer: shelf, sill, pinboard and desk. Every live object here is drawn from the caller's own counts
 * (room-signals.ts), so the room fills in as real connections happen and never invents any.
 */
import type { RoomSignals } from '../room-signals';
import { C, Ink, Layer, Pencil, Shape, WASHES, quad, rect } from './ink';

const SHELF_ROWS = [214, 314, 414, 514] as const;

function Shelf({ s }: { s: RoomSignals }) {
  const books = Array.from({ length: s.books }, (_, i) => i);
  const pending = Array.from({ length: s.pendingBooks }, (_, i) => i);
  const pages = Array.from({ length: s.loosePages }, (_, i) => i);
  return (
    <g data-place="shelf">
      <Shape d={rect(10, 140, 98, 466)} fill={C.wood} opacity={0.55} w={1.3} />
      <Ink d={rect(16, 146, 86, 454)} w={0.8} />
      {SHELF_ROWS.map((y) => <Shape key={y} d={rect(16, y, 86, 6)} fill={C.wood} opacity={0.9} w={0.9} />)}
      {/* Top row: books from home, painted once the tie is accepted */}
      {books.slice(0, 5).map((i) => (
        <Shape key={`b${i}`} d={rect(20 + i * 15, 168 - (i % 2) * 6, 12, 46 + (i % 2) * 6)} fill={WASHES[i % WASHES.length]} w={0.9} />
      ))}
      {books.slice(5).map((i) => (
        <Shape key={`b${i}`} d={rect(20 + (i - 5) * 15, 270, 12, 44)} fill={WASHES[i % WASHES.length]} w={0.9} />
      ))}
      {pending.map((i) => (
        <g key={`p${i}`}>
          <Pencil d={rect(60 + i * 13, 372, 11, 42)} w={0.9} />
          <Pencil d={`M${65 + i * 13} 372v-8`} w={0.6} />
        </g>
      ))}
      {/* "New here" side: loose pages for people met through an introduction */}
      {pages.map((i) => (
        <Shape key={`l${i}`} d={quad([[22 + i * 6, 512], [36 + i * 6, 470 + i * 2], [44 + i * 6, 472 + i * 2], [30 + i * 6, 514]])} fill={C.mint} opacity={0.8} w={0.7} />
      ))}
      <Pencil d="M24 596h20M60 596h30" w={0.6} />
      <Shape d="M74 600c-2-16 10-22 14-24 2 10-2 22-14 24z" fill={C.mint} opacity={0.5} w={0.7} />
    </g>
  );
}

function Sill({ s }: { s: RoomSignals }) {
  return (
    <g data-place="sill">
      <Shape d={quad([[110, 352], [280, 352], [286, 362], [104, 362]])} fill={C.wood} opacity={0.9} w={1.2} />
      {Array.from({ length: s.postcards }, (_, i) => {
        const x = 128 + i * 30;
        const tilt = i % 2 ? 4 : -3;
        return (
          <g key={i} transform={`rotate(${tilt} ${x + 11} 352)`}>
            <Shape d={rect(x, 324, 24, 28)} fill={C.cardStock} opacity={1} w={0.9} />
            <path d={rect(x + 3, 327, 18, 10)} fill={WASHES[(i + 1) % WASHES.length]} opacity={0.75} />
            <Pencil d={`M${x + 4} ${342}h14M${x + 4} 346h9`} w={0.6} />
          </g>
        );
      })}
      {s.postcards === 0 && <Pencil d="M140 350l6-10 6 10M200 350c4-6 10-6 14 0" w={0.6} opacity={0.6} />}
    </g>
  );
}

function Flyers({ count }: { count: number }) {
  const spots: readonly [number, number, number][] = [[132, 104, -5], [228, 116, 6], [204, 218, -3], [136, 222, 4], [246, 196, -6]];
  return (
    <g data-place="window">
      {spots.slice(0, count).map(([x, y, r], i) => (
        <g key={i} transform={`rotate(${r} ${x + 14} ${y})`}>
          <Shape d={`M${x} ${y}h28v34l-6 4h-22z`} fill={i % 2 ? C.mint : C.cardStock} opacity={0.95} w={0.8} />
          <Pencil d={`M${x + 4} ${y + 8}h18M${x + 4} ${y + 14}h12M${x + 4} ${y + 20}h16`} w={0.6} />
          <circle cx={x + 14} cy={y + 2} r={1.6} fill={C.peach} stroke={C.ink} strokeWidth={0.5} />
        </g>
      ))}
    </g>
  );
}

function Pinboard({ s }: { s: RoomSignals }) {
  return (
    <g data-place="pinboard">
      <Ink d="M300 168l-4-10M360 168l4-10" w={0.9} />
      <circle cx={296} cy={157} r={2.2} fill={C.butter} stroke={C.ink} strokeWidth={0.6} />
      <circle cx={364} cy={157} r={2.2} fill={C.butter} stroke={C.ink} strokeWidth={0.6} />
      <Shape d={rect(284, 168, 92, 168)} fill={C.cork} opacity={0.9} w={1.4} />
      <Ink d={rect(290, 174, 80, 156)} w={0.6} />
      {/* The profile card: sky only once it actually goes to other people */}
      <g transform="rotate(-3 318 230)">
        {s.pinboardPublished
          ? <Shape d={rect(298, 198, 48, 58)} fill={C.skyWash} opacity={1} w={0.9} />
          : <path d={rect(298, 198, 48, 58)} fill={C.cardStock} stroke={C.pencil} strokeWidth={0.8} strokeDasharray="3 2" />}
        {s.pinboardPublished && <path d={rect(298, 198, 48, 7)} fill={C.sky} opacity={0.9} />}
        <Pencil d="M304 216h30M304 224h22M304 232h28M304 240h16" w={0.6} />
        <circle cx={322} cy={200} r={2.4} fill={s.pinboardPublished ? C.skyInk : C.pencil} />
      </g>
      <g transform="rotate(5 352 288)">
        <path d={rect(334, 268, 32, 38)} fill={C.cardStock} stroke={C.pencil} strokeWidth={0.7} strokeDasharray="3 2" />
        <circle cx={350} cy={270} r={2} fill={C.pencil} />
      </g>
      {/* The little wooden sign: "Just for me" / "Visible nearby" */}
      <Ink d="M368 336l4 12M384 336l-4 12" w={0.6} />
      <Shape d={rect(352, 346, 34, 14)} fill={s.pinboardPublished ? C.sky : C.wood} opacity={0.9} w={0.8} />
    </g>
  );
}

function Desk({ s }: { s: RoomSignals }) {
  const dots = [...Array(s.confirmedPlans).fill('c'), ...Array(s.pendingPlans).fill('p')].slice(0, 6) as ('c' | 'p')[];
  return (
    <g data-place="desk">
      {/* Lamp */}
      <Ink d="M370 466v-50l-24-22" w={1.1} />
      <Shape d="M334 388l20-10 8 14-20 8z" fill={C.butter} opacity={0.7} w={0.9} />
      <Shape d={rect(360, 462, 20, 6)} fill={C.wood} w={0.8} />

      {/* Desk calendar (tent) */}
      <g data-place="calendar">
        <Shape d={quad([[306, 406], [334, 406], [338, 448], [302, 448]])} fill={C.cardStock} opacity={1} w={1} />
        <path d={rect(306, 406, 28, 8)} fill={C.peach} opacity={0.7} />
        <Ink d="M310 404v4M330 404v4" w={0.8} />
        {[0, 1, 2].map((r) => <Pencil key={r} d={`M308 ${422 + r * 8}h24`} w={0.4} />)}
        {dots.map((k, i) => (
          <circle key={i} cx={312 + (i % 3) * 8} cy={426 + Math.floor(i / 3) * 8} r={2.2}
            fill={k === 'c' ? C.pink : 'none'} stroke={k === 'c' ? C.ink : C.pencil} strokeWidth={0.6} strokeDasharray={k === 'p' ? '1.5 1' : undefined} />
        ))}
      </g>

      {/* Desk top in perspective, front edge, legs */}
      <Shape d={quad([[236, 458], [384, 458], [388, 500], [228, 500]])} fill={C.wood} opacity={0.8} w={1.3} />
      <Shape d={rect(228, 500, 160, 12)} fill={C.wood} opacity={0.95} w={1.1} />
      <Ink d="M234 512v94M382 512v94" w={1.4} />
      <Shape d={rect(264, 512, 98, 66)} fill={C.wood} opacity={0.65} w={1.1} />

      {/* Drawer front with a key-shaped pull */}
      <g data-place="drawer">
        <Shape d={rect(276, 522, 74, 44)} fill={C.washGrey} opacity={1} w={1} />
        <Ink d="M306 544h14" w={1.4} />
        <circle cx={313} cy={538} r={2} fill="none" stroke={C.ink} strokeWidth={0.7} />
      </g>

      {/* Notebook with clasp */}
      <g data-place="notebook">
        <Shape d={quad([[246, 466], [292, 462], [296, 492], [242, 496]])} fill={C.lavender} opacity={0.8} w={1.1} />
        <Ink d="M266 464l2 31" w={0.7} />
        <Shape d={rect(288, 474, 7, 9)} fill={C.butter} opacity={0.9} w={0.7} />
        <Pencil d="M272 476l14-1M273 482l12-1" w={0.5} />
      </g>

      {/* Tray with paper planes */}
      <g data-place="tray">
        <Shape d={quad([[336, 478], [374, 478], [370, 494], [340, 494]])} fill={C.washGrey} opacity={1} w={1} />
        {Array.from({ length: s.planes }, (_, i) => (
          <g key={i} transform={`translate(${340 + i * 6} ${470 - i * 3}) rotate(${-8 + i * 5})`}>
            <Shape d="M0 8l22-8-8 12-3-4z" fill={C.sky} opacity={0.9} w={0.7} />
            <Ink d="M11 8l3 4" w={0.5} ghost={false} />
          </g>
        ))}
      </g>
    </g>
  );
}

export function Furniture({ signals }: { signals: RoomSignals }) {
  return (
    <Layer label="furniture">
      <Flyers count={signals.flyers} />
      <Shelf s={signals} />
      <Sill s={signals} />
      <Pinboard s={signals} />
      <Desk s={signals} />
    </Layer>
  );
}
