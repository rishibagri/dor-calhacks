'use client';

/** "Show as a list": every place as a plain, accessible list (spec, "A list view for everyone"). */
import { useState } from 'react';
import { PLACES } from './layout';
import { navigateRoom } from './room-link';

export function PlaceList() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <section aria-labelledby="place-list-title" className="rounded-lg border border-[var(--rule)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="place-list-title" className="font-medium">Every place in your room</h3>
        <button type="button" className="text-sm underline underline-offset-4" aria-expanded={isOpen} onClick={() => setIsOpen((v) => !v)}>
          {isOpen ? 'Hide list' : 'Show as a list'}
        </button>
      </div>
      {isOpen && (
        <ul className="mt-3 divide-y divide-[var(--rule)]">
          {PLACES.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => navigateRoom(p.id)} className="flex w-full items-baseline justify-between gap-4 py-2.5 text-left">
                <span>{p.label}</span>
                <span className="text-sm text-muted-foreground">{p.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
