/**
 * Kinetic app-side integration seam (CS-owned).
 *
 * UI code depends ONLY on these interfaces. Concrete adapters:
 *   - SpacetimeDB adapter (src/lib/spacetime/*)  — CS
 *   - Vault adapter (src/vault/*)                — Cyber (not yet implemented)
 *   - Reflection/voice adapters (src/agents/*)   — AI (not yet implemented)
 *
 * Wire shapes come from @kinetic/contracts. Do not redefine them here.
 * Authorization is enforced inside SpacetimeDB reducers/views, never by these
 * client interfaces; a client-side "ok" is not permission.
 */
import type {
  AgentAck,
  ApprovedSignal,
  DisclosureReceipt,
  LocalConnectionProfile,
  Nudge,
  RecipientPresetAssignment,
  RelationshipPreset,
  RelationshipPresetKind,
  SharingCategory,
} from '@kinetic/contracts';

export type { AgentAck, ApprovedSignal, DisclosureReceipt, LocalConnectionProfile, Nudge };

/** Every adapter declares whether it is real. UI must surface non-live status. */
export type AdapterStatus =
  | { kind: 'live' }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'not_implemented'; owner: 'CS' | 'Cyber' | 'AI' | 'DS'; reason: string }
  | { kind: 'error'; reason: string };

export type ConnectionState =
  | { phase: 'signed_out' }
  | { phase: 'connecting' }
  | { phase: 'connected'; identityHex: string }
  | { phase: 'disconnected'; reason?: string }
  | { phase: 'unconfigured'; reason: string };

/** Pair as visible to the caller via the `my_pairs` view. No journal data. */
export interface PairView {
  pairId: string;
  /** The other member's account handle; null until invite accepted. */
  counterpartIdentityHex: string | null;
  counterpartDisplayName: string | null;
  status: 'pending' | 'accepted' | 'unlinked';
  createdAt: string;
}

export interface InviteView {
  inviteToken: string;
  expiresAt: string;
}

export type ReducerResult = { ok: true } | { ok: false; code: ReducerErrorCode; message: string };

/** Mirrors API.md error codes; reducers throw SenderError with one of these prefixes. */
export type ReducerErrorCode =
  | 'unauthenticated'
  | 'unauthorized'
  | 'not_found'
  | 'stale'
  | 'invalid'
  | 'rate_limited'
  | 'unavailable';

/**
 * Shared-state port. Methods map 1:1 to SpacetimeDB reducers (snake_case names
 * in spacetimedb/src). Views map to caller-filtered SpacetimeDB views.
 * Callers never pass owner/sender IDs; identity comes from the authenticated
 * connection.
 */
export interface SharedStatePort {
  readonly status: AdapterStatus;
  readonly connection: ConnectionState;

  // reducers
  registerAccount(displayName: string): Promise<ReducerResult>; // register_account
  createPairInvite(): Promise<ReducerResult>; // create_pair_invite
  acceptPairInvite(inviteToken: string): Promise<ReducerResult>; // accept_pair_invite
  unlinkPair(pairId: string): Promise<ReducerResult>; // unlink_pair
  setRelationshipPreset(input: {
    presetKind: RelationshipPresetKind;
    allowedCategories: SharingCategory[];
    expectedVersion: number;
    expiresAt: string;
  }): Promise<ReducerResult>; // set_relationship_preset
  assignRelationshipPreset(input: {
    pairId: string;
    presetKind: RelationshipPresetKind;
    expectedAssignmentVersion: number;
  }): Promise<ReducerResult>; // assign_relationship_preset
  /** Placeholder: blocked until Cyber's policy guard lands (C3/C6). */
  approveSignal(input: {
    pairId: string;
    supportMode?: ApprovedSignal['supportMode'];
    availability?: ApprovedSignal['availability'];
    payloadRevision: number;
    recipientPolicyVersion: number;
    presetAssignmentVersion: number;
    consentVersion: number;
    clientRequestId: string;
  }): Promise<ReducerResult>; // approve_signal
  revokeSignal(signalId: string): Promise<ReducerResult>; // revoke_signal
  dismissNudge(nudgeId: string): Promise<ReducerResult>; // dismiss_nudge
  snoozeNudge(nudgeId: string, until: string): Promise<ReducerResult>; // snooze_nudge

  // caller-filtered views
  myAccount(): { displayName: string } | null; // my_account
  myPairs(): PairView[]; // my_pairs
  myInvites(): InviteView[]; // my_invites
  myPresets(): RelationshipPreset[]; // my_presets
  myPresetAssignments(): RecipientPresetAssignment[]; // my_preset_assignments
  myNudges(): Nudge[]; // my_nudges
  myReceipts(): DisclosureReceipt[]; // my_receipts

  subscribe(listener: () => void): () => void;
}

/**
 * Raw quiz answers with no LocalConnectionProfile field (ONBOARDING_SHARING.md Q1 "space",
 * Q5, Q6, Q8). LOCAL VAULT ONLY: never a wire type, never sent to SpacetimeDB, providers or
 * peer agents, and never an authorization input. Promoting any field into the shared
 * profile schema needs a versioned contract change reviewed by Cyber/AI (docs/DECISIONS.md D015).
 */
export type ConnectActivity = 'talking' | 'games' | 'watching_together' | 'creating' | 'other';
export interface LocalQuizExtras {
  /** Q1 "space": prefers no outreach; maps to no support mode (natural no-action case). */
  prefersSpace: boolean;
  /** Q5 */
  activities: ConnectActivity[];
  /** Q5 "other" free text; capped, stays local. */
  activitiesNote: string | null;
  /** Q6 */
  scheduleSuggestions: 'only_after_review' | 'keep_private' | null;
  /** Q8: comfort only; every disclosure is still approved per item regardless. */
  reviewComfort: 'review_everything' | 'quick_review' | null;
}

/** Local encrypted vault. Cyber owns key lifecycle (PRIVACY.md, API.md "Local vault"). */
export interface JournalEntrySummary {
  localId: string;
  createdAt: string;
}
export interface VaultPort {
  readonly status: AdapterStatus;
  readonly locked: boolean;
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  saveJournal(entry: { localId: string; text: string }): Promise<void>;
  listJournals(): Promise<JournalEntrySummary[]>;
  readJournal(localId: string): Promise<{ localId: string; text: string; createdAt: string }>;
  deleteJournal(localId: string): Promise<void>;
  saveProfile(profile: LocalConnectionProfile): Promise<void>;
  loadProfile(): Promise<LocalConnectionProfile | null>;
  saveQuizExtras(extras: LocalQuizExtras): Promise<void>;
  loadQuizExtras(): Promise<LocalQuizExtras | null>;
}

/** Transient provider reflection via authenticated Next.js route (AI owns). */
export interface ReflectionPort {
  readonly status: AdapterStatus;
  reflect(selectedText: string, clientRequestId: string): Promise<{ reflection: string }>;
}
