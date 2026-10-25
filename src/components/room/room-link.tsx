'use client';

/**
 * In-room links. Inside the room no page ever changes (spec rule 1): a link to an old route or to `/?at=place`
 * becomes a camera move. Anything else stays an ordinary Next link.
 */
import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { hasRoomListener, navigateRoom, placeForHref } from './room-nav';

export { navigateRoom } from './room-nav';

export function RoomLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const target = placeForHref(href);
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || target === undefined || !hasRoomListener()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigateRoom(target);
  };
  return <Link href={href} onClick={handleClick} {...rest} />;
}
