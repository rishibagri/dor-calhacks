'use client';

/** Everyone you're linked with, with the details they've shared on their profile. */
import { useLiveShared } from '@/components/shell/use-live';

const pretty = (t: string) => t.replace(/-/g, ' ');

export function ConnectionProfiles() {
  const people = useLiveShared().myConnectionProfiles();
  if (people.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="your-people">
      <h3 id="your-people" className="font-hand text-[28px] leading-none">Your people</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {people.map((p) => (
          <li key={p.counterpartRef} className="paper-tile space-y-2 p-4">
            <p className="font-hand text-[26px] leading-none">{p.displayName}</p>
            {p.homeArea && <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.homeArea}</p>}
            {p.bio && <p className="text-sm">{p.bio}</p>}
            {p.upTo && <p className="text-sm text-muted-foreground">Lately: {p.upTo}</p>}
            {p.availability && <p className="text-sm text-muted-foreground">Free: {p.availability}</p>}
            {p.interests.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {p.interests.map((t) => (
                  <li key={t} className={`rounded-full border px-2 py-0.5 text-xs ${p.sharedTags.includes(t) ? 'bg-foreground text-background' : ''}`}>
                    {pretty(t)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
