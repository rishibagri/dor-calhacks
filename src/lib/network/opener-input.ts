import type { FofCard } from './types.ts';

/** Minimize what the optional Claude drafting action sends: no journal or profile fields. */
export function openerInputForCard(card: Pick<FofCard, 'viaName' | 'hops' | 'mutualCount' | 'sharedTags'>) {
  return {
    candidate: { viaName: card.viaName, hops: card.hops, mutualCount: card.mutualCount, sharedTags: card.sharedTags, area: '' },
    sender: { bio: '', upTo: '', availability: '', interests: [], homeArea: '' },
  };
}
