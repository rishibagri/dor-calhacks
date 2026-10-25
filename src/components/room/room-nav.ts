/** Room navigation bus and href resolution. Pure apart from the listener set; unit-tested. */
import { ROUTE_TARGETS, placeById, type PlaceId } from './layout.ts';

type Listener = (id: PlaceId | null) => void;
const listeners = new Set<Listener>();

/** The RoomStage registers here; anything in the room can ask the camera to move. */
export function onRoomNavigate(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function navigateRoom(id: PlaceId | null): void {
  for (const fn of listeners) fn(id);
}

/** Resolves an href to a room place, or undefined when it is not a room destination. */
export function placeForHref(href: string): PlaceId | null | undefined {
  const url = new URL(href, 'http://room.local');
  if (url.origin !== 'http://room.local') return undefined;
  if (url.pathname === '/') return placeById(url.searchParams.get('at'))?.id ?? null;
  return ROUTE_TARGETS[url.pathname];
}


export function hasRoomListener(): boolean {
  return listeners.size > 0;
}
