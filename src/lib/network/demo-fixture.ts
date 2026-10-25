/** Fictional, read-only sill preview. Only rendered in local development when explicitly enabled. */
import type { FofCard, ProfileDetail } from './types.ts';

export const DEMO_PROFILE: ProfileDetail = {
  bio: 'New around Berkeley and always up for a walk.',
  homeArea: 'berkeley',
  availability: 'weekend afternoons',
  upTo: 'finding favorite coffee spots',
  interests: ['coffee', 'climbing', 'live-music'],
  answers: [],
};

export const DEMO_FOF_CARDS: readonly FofCard[] = [
  { candidateRef: 'demo-riya', viaName: 'Sam', hops: 2, mutualCount: 1, sharedTags: ['climbing', 'coffee'], requestStatus: 'none' },
  { candidateRef: 'demo-theo', viaName: 'Sam', hops: 3, mutualCount: 2, sharedTags: ['live-music'], requestStatus: 'none' },
];
