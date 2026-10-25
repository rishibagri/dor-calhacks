/** Network (D045) view shapes the app reads: friend-of-friend cards, nudge requests, linked people's details. */
export interface ProfileDetail {
  bio: string;
  homeArea: string;
  availability: string;
  upTo: string;
  interests: string[];
  answers: string[];
}

export type FofRequestStatus = 'none' | 'pending' | 'incoming' | 'closed';

export interface FofCard {
  candidateRef: string;
  viaName: string;
  hops: number;
  mutualCount: number;
  sharedTags: string[];
  requestStatus: FofRequestStatus;
}

export type NudgeRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'closed';

export interface NudgeRequestView {
  requestId: string;
  direction: 'incoming' | 'outgoing';
  status: NudgeRequestStatus;
  counterpartName: string | null;
  viaName: string;
  hops: number;
  sharedTags: string[];
  message: string;
  pairId: string | null;
  createdAt: string;
}

export interface ConnectionProfile extends ProfileDetail {
  counterpartRef: string;
  displayName: string;
  sharedTags: string[];
}

export interface NetworkData {
  profile: ProfileDetail | null;
  fofCards: FofCard[];
  requests: NudgeRequestView[];
  connections: ConnectionProfile[];
}

export const EMPTY_NETWORK: NetworkData = { profile: null, fofCards: [], requests: [], connections: [] };

/** "Someone Sam knows" / "Someone a friend of Sam's knows". */
export function knownThrough(card: Pick<FofCard, 'viaName' | 'hops'>): string {
  return card.hops <= 2 ? `Someone ${card.viaName} knows` : `Someone a friend of ${card.viaName}'s knows`;
}
