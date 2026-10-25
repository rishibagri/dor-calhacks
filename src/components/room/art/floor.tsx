/** Front layer: moving boxes and the door mat. Nearest the viewer, so it moves most under parallax. */
import type { RoomSignals } from '../room-signals';
import { C, Ink, Layer, Pencil, Shape, quad, rect } from './ink';

function Box({ x, y, w, h, open }: { x: number; y: number; w: number; h: number; open: boolean }) {
  const lid = 10;
  return (
    <g>
      <Shape d={quad([[x, y + lid], [x + w, y + lid], [x + w, y + h], [x, y + h]])} fill={C.kraft} opacity={0.9} w={1.1} />
      <Shape d={quad([[x, y + lid], [x + 8, y], [x + w + 8, y], [x + w, y + lid]])} fill={C.kraft} opacity={0.7} w={1} />
      <Shape d={quad([[x + w, y + lid], [x + w + 8, y], [x + w + 8, y + h - lid], [x + w, y + h]])} fill={C.kraft} opacity={0.55} w={1} />
      {open
        ? <Ink d={`M${x + 8} ${y}l-6 -10M${x + w + 8} ${y}l6 -8`} w={0.9} />
        : <path d={rect(x + w / 2 - 5, y + lid, 10, h - lid)} fill={C.cardStock} opacity={0.7} />}
      <Pencil d={`M${x + 8} ${y + lid + 14}h${w - 16}`} w={0.6} />
    </g>
  );
}

export function Floor({ signals, boxesDone }: { signals: RoomSignals; boxesDone: boolean }) {
  return (
    <Layer label="floor">
      {/* Settles in once the boxes are unpacked: a rug, never removed */}
      {boxesDone && <path d="M64 700q124-26 260 0q-130 30-260 0z" fill={C.pink} opacity={0.22} />}

      <g data-place="boxes" opacity={boxesDone ? 0.55 : 1}>
        <Box x={76} y={672} w={44} h={66} open={boxesDone} />
        <Box x={124} y={690} w={44} h={50} open={boxesDone} />
        <Box x={98} y={632} w={40} h={44} open={boxesDone} />
      </g>

      <g data-place="mat">
        <Shape d={quad([[146, 774], [244, 774], [254, 830], [136, 830]])} fill={C.peach} opacity={0.55} w={1.2} />
        <Pencil d="M150 784h90M147 798h96M144 812h102" w={0.6} />
        {Array.from({ length: signals.envelopes }, (_, i) => (
          <g key={i} transform={`rotate(${i % 2 ? 7 : -6} ${170 + i * 14} 800)`}>
            <Shape d={rect(156 + i * 14, 788, 36, 24)} fill={C.cardStock} opacity={1} w={0.9} />
            <Ink d={`M${156 + i * 14} 788l18 12 18-12`} w={0.7} ghost={false} />
            <path d={rect(182 + i * 14, 791, 7, 7)} fill={C.mint} opacity={0.9} />
          </g>
        ))}
      </g>
    </Layer>
  );
}
