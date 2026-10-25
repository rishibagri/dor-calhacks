/** Local-only relationship-book records. These are not contracts or shared-state payloads. */
import type { Nudge } from '@dor/contracts';

export const RELATIONSHIP_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type RelationshipPhotoMime = (typeof RELATIONSHIP_PHOTO_MIME_TYPES)[number];

/** A user-selected photo stored only in the owner's encrypted LocalVault. */
export interface RelationshipBookPhoto {
  photoId: string;
  pairId: string;
  mimeType: RelationshipPhotoMime;
  /** Bounded data URL from a local file selection; never a remote URL. */
  dataUrl: string;
  caption: string;
  createdAt: string;
}

export type BookInteractionKind = 'call' | 'nudge_received' | 'introduction';
export type BookInteractionOutcome = 'positive' | 'neutral' | 'negative';

/** User-entered or user-confirmed local history. `note` and `sourceId` never leave the vault. */
export interface BookInteraction {
  interactionId: string;
  pairId: string;
  kind: BookInteractionKind;
  sourceId?: string;
  /** Fixed-contract template identifier for a locally recorded received nudge. */
  templateId?: Nudge['templateId'];
  outcome?: BookInteractionOutcome;
  note?: string;
  createdAt: string;
}

export type NewRelationshipBookPhoto = Omit<RelationshipBookPhoto, 'createdAt'> & { createdAt?: string };
export type NewBookInteraction = Omit<BookInteraction, 'createdAt'> & { createdAt?: string };
