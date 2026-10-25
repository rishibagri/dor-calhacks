'use client';

/** Which feature surface each place hosts. Kept apart from the stage so the stage owns only camera and motion. */
import type { PlaceId } from './layout';
import { NotebookPlace } from './places/notebook-place';
import { SillPlace } from './places/sill-place';
import { WindowPlace } from './places/window-place';
import { ShelfPlace } from './places/shelf-place';
import { TrayPlace } from './places/tray-place';
import { DrawerPlace } from './places/drawer-place';
import { BoxesPlace, CalendarPlace, DeskPlace, MatPlace, PinboardPlace } from './places/small-places';

const CONTENT: Record<PlaceId, () => React.JSX.Element> = {
  window: WindowPlace,
  sill: SillPlace,
  shelf: ShelfPlace,
  pinboard: PinboardPlace,
  desk: DeskPlace,
  notebook: NotebookPlace,
  calendar: CalendarPlace,
  tray: TrayPlace,
  drawer: DrawerPlace,
  boxes: BoxesPlace,
  mat: MatPlace,
};

export function PlaceContent({ id }: { id: PlaceId }) {
  const Body = CONTENT[id];
  return <Body />;
}
