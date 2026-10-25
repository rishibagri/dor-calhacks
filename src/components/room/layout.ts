/**
 * Room layout and camera math (Room UI spec, "Layout of the room" and "Three zoom levels").
 * Pure: no DOM, no GSAP, so it is unit-tested with node --test.
 *
 * The room is drawn in a fixed 390 × 844 unit space (the spec's phone frame). Place boxes are the spec's
 * (u, v) fractions of that space, measured from the top left.
 */

export const ROOM_W = 390;
export const ROOM_H = 844;
/** Spec: the camera fits a place's box to the screen with a 16 px margin. */
export const FIT_MARGIN = 16;
/** Top share of the stage that frames the object while its paper sheet covers the rest. */
export const FRAME_SHARE = 0.4;
const MAX_ZOOM = 3.4;

export type PlaceId =
  | 'window' | 'sill' | 'shelf' | 'pinboard' | 'desk' | 'notebook' | 'calendar' | 'tray' | 'drawer' | 'boxes' | 'mat';

export interface Place {
  id: PlaceId;
  label: string;
  /** What lives here, in plain words (hotspot label for screen readers and the list view). */
  hint: string;
  /** u0, v0, u1, v1 as fractions of the room. */
  box: readonly [number, number, number, number];
  /** null = reached from the whole room; otherwise the place it sits inside. */
  parent: PlaceId | null;
}

export const PLACES: readonly Place[] = [
  { id: 'window', label: 'Window', hint: 'Local events', box: [0.30, 0.10, 0.70, 0.37], parent: null },
  { id: 'sill', label: 'Windowsill', hint: 'People nearby', box: [0.30, 0.37, 0.70, 0.43], parent: null },
  { id: 'shelf', label: 'Shelf', hint: 'Your people', box: [0.02, 0.16, 0.28, 0.72], parent: null },
  { id: 'pinboard', label: 'Pinboard', hint: 'Your profile', box: [0.72, 0.20, 0.97, 0.42], parent: null },
  { id: 'desk', label: 'Desk', hint: 'Notebook, calendar, notes, drawer', box: [0.58, 0.48, 0.98, 0.72], parent: null },
  { id: 'notebook', label: 'Notebook', hint: 'Private journal', box: [0.62, 0.52, 0.76, 0.58], parent: 'desk' },
  { id: 'calendar', label: 'Desk calendar', hint: 'Plans', box: [0.78, 0.47, 0.86, 0.53], parent: 'desk' },
  { id: 'tray', label: 'Tray', hint: 'Notes from your people', box: [0.86, 0.53, 0.96, 0.58], parent: 'desk' },
  { id: 'drawer', label: 'Drawer', hint: 'Privacy and controls', box: [0.70, 0.61, 0.90, 0.68], parent: 'desk' },
  { id: 'boxes', label: 'Moving boxes', hint: 'Set up your new chapter', box: [0.18, 0.74, 0.46, 0.88], parent: null },
  { id: 'mat', label: 'Door mat', hint: 'Introductions', box: [0.34, 0.90, 0.66, 0.99], parent: null },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

export function placeById(id: string | null | undefined): Place | null {
  return id ? BY_ID.get(id as PlaceId) ?? null : null;
}

/** Old routes keep working: each maps to the place that replaced it (spec, "Old routes"). */
export const ROUTE_TARGETS: Readonly<Record<string, PlaceId>> = {
  '/onboarding': 'boxes',
  '/discover': 'sill',
  '/events': 'window',
  '/connections': 'shelf',
  '/journal': 'notebook',
  '/nudges': 'tray',
  '/privacy': 'drawer',
};

/** 0 = whole room, 1 = place, 2 = close-up. */
export function levelOf(id: PlaceId | null): 0 | 1 | 2 {
  if (!id) return 0;
  return placeById(id)?.parent ? 2 : 1;
}

/** Back always zooms out one level. */
export function parentOf(id: PlaceId | null): PlaceId | null {
  return id ? placeById(id)?.parent ?? null : null;
}

/** Path from the whole room to a place, e.g. notebook → ['desk', 'notebook']. Used to rebuild history on deep links. */
export function pathTo(id: PlaceId | null): PlaceId[] {
  const out: PlaceId[] = [];
  for (let at = id; at; at = parentOf(at)) out.unshift(at);
  return out;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Camera as the room point at the centre of the frame, the frame centre on screen, and the zoom. */
export interface Camera { cx: number; cy: number; fx: number; fy: number; z: number }

export function boxRect(id: PlaceId): Rect {
  const [u0, v0, u1, v1] = placeById(id)!.box;
  return { x: u0 * ROOM_W, y: v0 * ROOM_H, w: (u1 - u0) * ROOM_W, h: (v1 - v0) * ROOM_H };
}

/** The area of the stage that frames the target: the whole stage at home, the top band when a sheet is open. */
export function frameFor(id: PlaceId | null, stage: { w: number; h: number }): Rect {
  if (!id) return { x: 0, y: 0, w: stage.w, h: stage.h };
  return { x: 0, y: 0, w: stage.w, h: Math.round(stage.h * FRAME_SHARE) };
}

/** Fits `rect` (room units) inside `frame` (stage px) with `margin`, centred. */
export function fit(rect: Rect, frame: Rect, margin: number): Camera {
  const z = Math.min((frame.w - margin * 2) / rect.w, (frame.h - margin * 2) / rect.h, MAX_ZOOM);
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, fx: frame.x + frame.w / 2, fy: frame.y + frame.h / 2, z };
}

export function cameraFor(id: PlaceId | null, stage: { w: number; h: number }): Camera {
  const frame = frameFor(id, stage);
  if (!id) return fit({ x: 0, y: 0, w: ROOM_W, h: ROOM_H }, frame, 0);
  return fit(boxRect(id), frame, FIT_MARGIN);
}

/** Screen transform for a camera: translate then scale, origin top left. */
export function toTransform(c: Camera): { x: number; y: number; scale: number } {
  return { x: c.fx - c.cx * c.z, y: c.fy - c.cy * c.z, scale: c.z };
}

/**
 * Midpoint for a move between two places at the same level: the camera eases out about 20 %, slides across and
 * eases back in (spec, "Moving between neighbours"). Returns null when no arc is needed.
 */
export function arcBetween(from: Camera, to: Camera, fromId: PlaceId | null, toId: PlaceId | null): Camera | null {
  if (!fromId || !toId || levelOf(fromId) !== levelOf(toId) || parentOf(fromId) !== parentOf(toId)) return null;
  return {
    cx: (from.cx + to.cx) / 2, cy: (from.cy + to.cy) / 2,
    fx: (from.fx + to.fx) / 2, fy: (from.fy + to.fy) / 2,
    z: Math.min(from.z, to.z) * 0.8,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mix(a: Camera, b: Camera, t: number): Camera {
  // Zoom interpolates in log space so a push feels constant-speed rather than rushing at the end.
  return {
    cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), fx: lerp(a.fx, b.fx, t), fy: lerp(a.fy, b.fy, t),
    z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)),
  };
}

/** Camera at progress t along a move, through the arc midpoint when there is one (quadratic, so no kink). */
export function cameraAt(from: Camera, mid: Camera | null, to: Camera, t: number): Camera {
  if (!mid) return mix(from, to, t);
  return mix(mix(from, mid, t), mix(mid, to, t), t);
}

/** Hotspots are at least 44 × 44 screen px at the whole-room zoom (spec, "Rules that keep it usable"). */
export function hotspotRect(id: PlaceId, homeZoom: number, minPx = 44): Rect {
  const r = boxRect(id);
  const min = minPx / homeZoom;
  const w = Math.max(r.w, min);
  const h = Math.max(r.h, min);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}
