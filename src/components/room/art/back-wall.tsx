/** Back layer: walls, floor, the window and the city outside. Furthest from the viewer, so it moves least. */
import { C, Ink, Layer, Pencil, Shape, quad, rect } from './ink';

export type Daylight = 'dawn' | 'day' | 'golden' | 'night';

const SKY: Record<Daylight, [string, string]> = {
  dawn: ['#F7D9C9', '#FAF1E6'],
  day: [C.skyWash, '#F7FAFD'],
  golden: ['#F9DFAE', '#FBEFD8'],
  night: ['#3A4566', '#5B6788'],
};

export function daylightAt(hour: number): Daylight {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'golden';
  return 'night';
}

const VP = { x: 195, y: 300 };
const FLOOR_Y = 586;

/** Floorboards converge on the vanishing point behind the window. */
function boardAt(bottomX: number): string {
  const t = (844 - FLOOR_Y) / (844 - VP.y);
  return `M${bottomX} 844L${bottomX + (VP.x - bottomX) * t} ${FLOOR_Y}`;
}

const BUILDINGS: readonly [number, number, number][] = [
  [126, 246, 22], [148, 228, 18], [166, 258, 16], [182, 236, 20], [202, 252, 14], [216, 222, 22], [238, 244, 26],
];

/** Window slots in the city, in the order they light up (one per real connection). */
const LIGHTS: readonly [number, number][] = [
  [131, 256], [153, 240], [187, 248], [221, 232], [243, 256], [137, 272], [170, 268], [227, 250],
  [192, 266], [158, 286], [246, 276], [206, 264],
];

export function BackWall({ daylight, cityLights }: { daylight: Daylight; cityLights: number }) {
  const [top, bottom] = SKY[daylight];
  const lit = daylight === 'night' ? C.butter : '#F3C969';
  return (
    <Layer label="back">
      <defs>
        <linearGradient id="dor-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <clipPath id="dor-glass"><path d={rect(125, 92, 140, 212)} /></clipPath>
      </defs>
      <path d={rect(0, 0, 390, FLOOR_Y)} fill={C.paper} />
      <path d={quad([[0, FLOOR_Y], [390, FLOOR_Y], [390, 844], [0, 844]])} fill={C.paperDeep} />
      {[-260, -170, -80, 10, 100, 195, 290, 380, 470, 560, 650].map((x) => <Pencil key={x} d={boardAt(x)} w={0.7} opacity={0.7} />)}
      <Ink d={`M0 ${FLOOR_Y}H390`} w={1.2} />
      <Pencil d={`M0 ${FLOOR_Y - 8}H390`} w={0.8} />
      <Pencil d="M0 34H390" w={0.7} opacity={0.6} />

      {/* The city through the glass */}
      <g clipPath="url(#dor-glass)">
        <path d={rect(125, 92, 140, 212)} fill="url(#dor-sky)" />
        {daylight !== 'night' && <circle cx={238} cy={128} r={11} fill={daylight === 'day' ? '#FFFFFF' : C.peach} opacity={0.7} />}
        {daylight === 'night' && <circle cx={150} cy={122} r={7} fill={C.cardStock} opacity={0.9} />}
        <path d="M118 282 Q160 262 200 276 T272 270 V310 H118Z" fill={daylight === 'night' ? '#2C344D' : C.washGrey} opacity={0.9} />
        {BUILDINGS.map(([x, y, w]) => (
          <Shape key={x} d={rect(x, y, w, 310 - y)} fill={daylight === 'night' ? '#46527A' : C.cardStock} opacity={0.95} w={0.8} />
        ))}
        {LIGHTS.map(([x, y], i) => (
          <path key={`${x}-${y}`} d={rect(x, y, 4, 5)} fill={i < cityLights ? lit : 'none'} stroke={C.pencil} strokeWidth={0.5} opacity={i < cityLights ? 1 : 0.6} />
        ))}
        {/* Lamppost outside: flyers get pinned here too */}
        <Ink d="M256 304V176M256 176q-10 0 -12 8" w={1} />
        <circle cx={244} cy={186} r={3} fill={daylight === 'night' ? C.butter : C.cardStock} stroke={C.ink} strokeWidth={0.7} />
      </g>

      {/* Frame, mullions, curtains rail */}
      <Ink d={rect(117, 84, 156, 228)} w={1.4} />
      <Ink d={rect(125, 92, 140, 212)} w={1} />
      <Ink d="M195 92V304M125 198H265" w={1} />
      <Ink d="M104 72H286" w={1.2} />
      <Pencil d="M110 72v-6M280 72v-6" />
    </Layer>
  );
}
