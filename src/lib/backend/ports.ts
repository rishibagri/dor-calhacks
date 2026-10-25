/**
 * dor app-side integration seam (CS-owned).
 *
 * UI code depends ONLY on these interfaces. Concrete adapters:
 *   - SpacetimeDB adapter (src/lib/spacetime/*)  — CS
 *   - Vault adapter (src/vault/*)                — Cyber (not yet implemented)
 *   - Reflection/voice adapters (src/agents/*)   — AI (not yet implemented)
 *
 * Wire shapes come from @dor/contracts. Do not redefine them here.
 * Authorization is enforced inside SpacetimeDB reducers/views, never by these
 * client interfaces; a client-side "ok" is not permission.
 */
import type { ConnectionProfile, FofCard, NudgeRequestView, ProfileDetail } from '@/lib/network/types';
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
  SupportMode,
  Availability,
  PrivateReflection,
} from '@dor/contracts';
import type { BookInteraction, NewBookInteraction, NewRelationshipBookPhoto, RelationshipBookPhoto } from '@/vault/book-types';

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

/**
 * The caller's OWN recipient consent in one pair (`my_support_preferences`, D035). Written only by the
 * recipient; every change bumps consentVersion. No row = no consent (worker fails closed).
 */
export interface SupportPreferencesView {
  pairId: string;
  supportModes: SupportMode[];
  availability: Availability[];
  consentVersion: number;
  expiresAt: string;
  revokedAt: string | null;
}

/**
 * The recipient's own nudge (`my_nudges`), narrowed by Cyber (Core 3 audit item 2): no creation time, exact expiry,
 * source signal ids or consent ids, because those let the recipient recover the sender's approval moment.
 * `visibleUntil` is the expiry rounded up to the hour.
 */
export interface RecipientNudgeView {
  id: string;
  pairId: string;
  templateId: Nudge['templateId'];
  visibleUntil: string;
  /** D056: what the sender's device suggested talking about, or null. */
  hook: string | null;
}

/** One of the caller's own approved signals (`my_signals`), with its revocation time if revoked. */
export type SignalView = ApprovedSignal & { revokedAt: string | null };

/** The caller's own discovery publication + area status (`my_discovery_profile`). Never another person's. */
export interface MyDiscoveryView {
  /** Own card ref (publication id), or null before first publish. */
  publicationId: string | null;
  published: boolean;
  displayName: string | null;
  interestTags: string[];
  revision: number;
  expiresAt: string | null;
  withdrawn: boolean;
  expired: boolean;
  areaKey: string | null;
  areaExpiresAt: string | null;
  areaActive: boolean;
  discoveryEnabled: boolean;
}

/**
 * One `discovery_cards` row, exactly the C8 DiscoveryCardProjection keys (DS's adapter rejects any other key).
 * No identity, area, distance or contact field exists on it.
 */
export interface DiscoveryCardRow {
  cardRef: string;
  displayName: string;
  interestTags: string[];
  sharedTags: string[];
  revision: number;
}

/** The caller's own introduction (`my_introductions`). Outgoing declines read as pending by design (D038). */
export interface IntroductionView {
  introId: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'declined' | 'closed';
  counterpartName: string | null;
  sharedTags: string[];
  createdAt: string;
  expiresAt: string | null;
}

/**
 * The viewer's own latest "Suggest someone" request (`my_introduction_suggestion_request`, D048): `open` while the
 * worker may still answer (before expiresAt), `done` once it ran. Status only: never why, or who was considered.
 */
export interface IntroductionSuggestionRequestView {
  requestId: string;
  status: 'open' | 'done';
  createdAt: string;
  expiresAt: string;
}

/** The viewer's own AI introduction suggestion (`my_introduction_proposals`). A suggestion, never a request. */
export interface IntroductionProposalView {
  proposalId: string;
  candidateRef: string;
  reasonCode: string;
  sharedTags: string[];
  openerId: 'suggest_shared_interest' | 'suggest_event_together';
  expiresAt: string;
}

/**
 * A view row that exists but failed validation. Shown as "couldn't read" with a safe off/revoke action, never
 * silently dropped (a dropped row would hide an active approval or show an opted-in setting as off).
 */
export interface UnreadableRow { id: string | null; pairId: string | null }

/**
 * Privacy-safe diagnostics for rows that failed validation. Row lists exist where the UI offers a safe action;
 * `counts` covers every subscribed view by name, with no row contents (D049).
 */
export interface Unreadable {
  signals: UnreadableRow[];
  supportPreferences: UnreadableRow[];
  nudgeDelivery: UnreadableRow[];
  presets: UnreadableRow[];
  counts: Partial<Record<string, number>>;
}

/** One `catalogue_events` row: public, source-backed, normalized server-side (D039). Never joined to a person. */
export interface CatalogueEventView {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  topics: string[];
  format: 'in_person' | 'online';
  areaKey: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
}

/** One `catalogue_places` row (D051 proposal): a public, well-reviewed place near a launch area. Never joined to a person. */
export interface CataloguePlaceView {
  placeId: string;
  name: string;
  kind: 'food' | 'coffee' | 'dessert' | 'study';
  /** The source's category text, display only. */
  label: string;
  /** Average rating, one decimal (4.6). */
  rating: number;
  reviewCount: number;
  areaKey: string;
  sourceUrl: string | null;
  fetchedAt: string;
}

/** Ingestion health for one configured feed (`catalogue_status`). Operational metadata only. */
export interface CatalogueStatusView {
  feedKey: string;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastStatus: 'ok' | 'failed';
  recordCount: number;
}

/** The caller's own event intent (`my_event_intents`), withdrawn ones included so the next version is known. */
export interface EventIntentRow {
  eventId: string;
  kind: 'interested' | 'going';
  version: number;
  active: boolean;
  expiresAt: string;
}

/** Mutual overlap only (`event_companions`): a visible card and an event both of you marked. */
export interface EventCompanionRow { cardRef: string; eventId: string }

/** The caller's own standing C7 approval (`my_activity_approvals`). */
export interface ActivityApprovalRow { approvalId: string; pairId: string; topics: string[]; expiresAt: string }

export type PlanStatus = 'pending' | 'confirmed' | 'stale' | 'expired' | 'declined' | 'cancelled' | 'closed';

/** The caller's own shared plan (`my_plans`). The other person's acceptance is never shown before confirmed. */
export interface PlanView {
  planId: string;
  revision: number;
  status: PlanStatus;
  myAcceptance: boolean;
  eventId: string;
  eventTitle: string;
  eventStartsAt: string;
  sourceUrl: string | null;
  counterpartName: string | null;
  expiresAt: string;
}

export type ReportReason = 'spam' | 'harassment' | 'impersonation' | 'inappropriate_profile' | 'other';

/** The caller's OWN delivery settings as a recipient in one pair (`my_nudge_delivery`, D017/D018). */
export interface NudgeDeliveryView {
  pairId: string;
  optedIn: boolean;
  quietStartMinute: number | null;
  quietEndMinute: number | null;
  utcOffsetMinutes: number;
}

/** The caller's OWN pause of one counterpart (`my_recipient_pauses`, D041). No reason is stored. `version` 0 = never paused. */
export interface RecipientPause {
  pairId: string;
  version: number;
  expiresAt: string;
  active: boolean;
  createdAt: string;
}

/** Caller-owned D044 rule. The view exposes no recipient identity beyond its accepted pair. */
export interface StandingConsentView {
  pairId: string;
  categories: SharingCategory[];
  version: number;
  expiresAt: string;
  active: boolean;
  createdAt: string;
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
    /** C7 activity permission (D049). Omitted keeps the preset's current value; false removes it. */
    activityInterestAllowed?: boolean;
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
  /** Caller's own recipient consent; expectedVersion 0 creates. */
  setSupportPreferences(input: {
    pairId: string;
    supportModes: SupportMode[];
    availability: Availability[];
    expiresAt: string;
    expectedVersion: number;
  }): Promise<ReducerResult>; // set_support_preferences
  revokeSupportPreferences(pairId: string): Promise<ReducerResult>; // revoke_support_preferences
  /** Caller's own opt-in; default (no row) is off. */
  setNudgeDelivery(input: NudgeDeliveryView): Promise<ReducerResult>; // set_nudge_delivery
  /** Owner-only, reason-free pause of one counterpart; expectedVersion 0 = first pause (D041). */
  pauseRecipient(pairId: string, expiresAt: string, expectedVersion: number): Promise<ReducerResult>; // pause_recipient
  resumeRecipient(pairId: string, expectedVersion: number): Promise<ReducerResult>; // resume_recipient
  /** D052/D053: content-free record of the owner's own Reasoning decision (codes only); authorizes nothing. */
  /** D056: attach a talking point to the caller's own just-approved signal (shown on the recipient's nudge). */
  attachSignalHook(clientRequestId: string, hook: string): Promise<ReducerResult>; // attach_signal_hook
  recordReasoningDecision(input: {
    episodeId: string; pairId: string | null; mode: string; action: string | null; surface: string | null;
    reasons: string[]; rejected: string[]; reassessAfterMinutes: number | null; source: string; outcome: string;
  }): Promise<ReducerResult>; // record_reasoning_decision
  /** D044: owner explicitly authorizes future enum-only signals for one accepted pair. */
  setStandingConsent(input: {
    pairId: string; categories: SharingCategory[]; expiresAt: string; expectedVersion: number;
    expectedPolicyVersion: number; expectedAssignmentVersion: number; noticeVersion: number;
  }): Promise<ReducerResult>; // set_standing_consent
  revokeStandingConsent(pairId: string): Promise<ReducerResult>; // revoke_standing_consent
  approveSignalStanding(input: {
    pairId: string; supportMode?: SupportMode; availability?: Availability; clientRequestId: string; ruleVersion: number;
  }): Promise<ReducerResult>; // approve_signal_standing
  /** C8 (flag-gated server-side). The exact preview the owner confirmed; expectedRevision 0 = first publish. */
  publishDiscoveryProfile(input: {
    displayName: string;
    interestTags: string[];
    expiresAt: string;
    expectedRevision: number;
  }): Promise<ReducerResult>; // publish_discovery_profile
  withdrawDiscoveryProfile(): Promise<ReducerResult>; // withdraw_discovery_profile
  /** A configured coarse area key only; coordinates never reach this port. */
  setDiscoveryArea(areaKey: string): Promise<ReducerResult>; // set_discovery_area
  blockDiscoveryUser(cardRef: string): Promise<ReducerResult>; // block_discovery_user
  /** Caller's own discovery cursor: cards after this ref; '' = first page. */
  setDiscoveryPage(afterRef: string): Promise<ReducerResult>; // set_discovery_page
  sendIntroductionRequest(cardRef: string, clientRequestId: string): Promise<ReducerResult>; // send_introduction_request
  respondIntroductionRequest(introId: string, accept: boolean): Promise<ReducerResult>; // respond_introduction_request
  cancelIntroductionRequest(introId: string): Promise<ReducerResult>; // cancel_introduction_request
  blockIntroductionParticipant(introId: string): Promise<ReducerResult>; // block_introduction_participant
  /** Also blocks. The target is never told who reported or why. */
  /** C8 event intent; expectedVersion 0 = first. Expires with the event. */
  publishEventIntent(eventId: string, kind: 'interested' | 'going', expectedVersion: number): Promise<ReducerResult>; // publish_event_intent
  revokeEventIntent(eventId: string): Promise<ReducerResult>; // revoke_event_intent
  /** C7 item consent; needs a preset with activityInterestAllowed for this pair. Never a C3 signal. */
  approveActivityInterest(input: {
    pairId: string;
    topics: string[];
    expectedPolicyVersion: number;
    expectedAssignmentVersion: number;
    consentVersion: number;
    clientRequestId: string;
  }): Promise<ReducerResult>; // approve_activity_interest
  revokeActivityInterest(approvalId: string): Promise<ReducerResult>; // revoke_activity_interest
  /** Own accept/decline of the CURRENT plan revision. */
  respondPlan(planId: string, revision: number, accept: boolean): Promise<ReducerResult>; // respond_plan
  cancelPlan(planId: string): Promise<ReducerResult>; // cancel_plan
  dismissIntroductionProposal(proposalId: string): Promise<ReducerResult>; // dismiss_introduction_proposal
  /** D048: ask the worker for at most one suggestion now. Grants nothing; nobody is contacted. Fresh id per tap. */
  requestIntroductionSuggestion(clientRequestId: string): Promise<ReducerResult>; // request_introduction_suggestion
  reportDiscoveryUser(target: { kind: 'card' | 'introduction'; ref: string }, reason: ReportReason): Promise<ReducerResult>; // report_discovery_user
  /** Network (D045): own profile details; replaces the whole row. */
  setProfileDetail(detail: ProfileDetail): Promise<ReducerResult>; // set_profile_detail
  /** Nudge someone a friend knows nearby (a fof_cards candidate). */
  sendNudgeRequest(candidateRef: string, message: string): Promise<ReducerResult>; // send_nudge_request
  respondNudgeRequest(requestId: string, accept: boolean): Promise<ReducerResult>; // respond_nudge_request
  cancelNudgeRequest(requestId: string): Promise<ReducerResult>; // cancel_nudge_request

  // caller-filtered views
  myAccount(): { displayName: string } | null; // my_account
  myPairs(): PairView[]; // my_pairs
  myInvites(): InviteView[]; // my_invites
  myPresets(): RelationshipPreset[]; // my_presets
  myPresetAssignments(): RecipientPresetAssignment[]; // my_preset_assignments
  myNudges(): RecipientNudgeView[]; // my_nudges (narrow projection, Core 3 audit item 2)
  myReceipts(): DisclosureReceipt[]; // my_receipts
  mySignals(): SignalView[]; // my_signals (sender-only, D026); includes revoked rows
  mySupportPreferences(): SupportPreferencesView[]; // my_support_preferences
  myNudgeDelivery(): NudgeDeliveryView[]; // my_nudge_delivery
  myRecipientPauses(): RecipientPause[]; // my_recipient_pauses (owner-only)
  myStandingConsents(): StandingConsentView[]; // my_standing_consents (owner-only)
  myDiscoveryProfile(): MyDiscoveryView | null; // my_discovery_profile
  discoveryCards(): DiscoveryCardRow[]; // discovery_cards (≤ DISCOVERY_CARD_LIMIT, caller-filtered)
  myIntroductions(): IntroductionView[]; // my_introductions
  myIntroductionProposals(): IntroductionProposalView[]; // my_introduction_proposals
  myIntroductionSuggestionRequest(): IntroductionSuggestionRequestView | null; // my_introduction_suggestion_request
  catalogueEvents(): CatalogueEventView[]; // catalogue_events
  cataloguePlaces(): CataloguePlaceView[]; // catalogue_places (D051 proposal)
  catalogueStatus(): CatalogueStatusView[]; // catalogue_status
  myEventIntents(): EventIntentRow[]; // my_event_intents
  eventCompanions(): EventCompanionRow[]; // event_companions
  myActivityApprovals(): ActivityApprovalRow[]; // my_activity_approvals
  myPlans(): PlanView[]; // my_plans
  myProfileDetail(): ProfileDetail | null; // my_profile_detail
  fofCards(): FofCard[]; // fof_cards (friends of friends in the caller's area)
  myNudgeRequests(): NudgeRequestView[]; // my_nudge_requests
  myConnectionProfiles(): ConnectionProfile[]; // my_connection_profiles (linked people's full details)
  /** Rows present in a view but unreadable; see UnreadableRow. */
  unreadable(): Unreadable;

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

/** 'unknown' until refresh() has read local metadata; 'absent' = no vault on this device yet. */
export type VaultState = 'unknown' | 'absent' | 'locked' | 'unlocked';
/** Constant, content-free error codes (Error.message === code). `wrong_secret` covers passphrase AND recovery code. */
export type VaultErrorCode =
  | 'vault_unavailable' | 'vault_absent' | 'vault_exists' | 'vault_locked' | 'wrong_secret'
  | 'weak_passphrase' | 'invalid_input' | 'not_found' | 'vault_corrupt';
/**
 * Cyber lifecycle additions (src/vault/DESIGN.md, D026; CS ACK pending): create/recover/change/destroy,
 * reflection text persistence (D021 review: never the candidate), and subscribe/getVersion so the UI
 * re-renders on lock/unlock/auto-lock like useSharedState.
 */
export interface VaultPort {
  readonly status: AdapterStatus;
  readonly locked: boolean;
  readonly state: VaultState;
  refresh(): Promise<VaultState>;
  /** Creates the single-device vault and returns the recovery code; show it once. Throws vault_exists. */
  create(passphrase: string): Promise<{ recoveryCode: string }>;
  unlock(passphrase: string): Promise<void>;
  /** Unlocks with the recovery code, sets a new passphrase and issues a NEW recovery code. */
  recover(recoveryCode: string, newPassphrase: string): Promise<{ recoveryCode: string }>;
  changePassphrase(current: string, next: string): Promise<void>;
  lock(): void;
  /** Irreversible crypto-shred of every local entry, profile and extra. */
  destroy(): Promise<void>;
  saveReflection(localId: string, reflection: string): Promise<void>;
  readReflection(localId: string): Promise<string | null>;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  saveJournal(entry: { localId: string; text: string }): Promise<void>;
  listJournals(): Promise<JournalEntrySummary[]>;
  readJournal(localId: string): Promise<{ localId: string; text: string; createdAt: string }>;
  deleteJournal(localId: string): Promise<void>;
  saveProfile(profile: LocalConnectionProfile): Promise<void>;
  loadProfile(): Promise<LocalConnectionProfile | null>;
  saveQuizExtras(extras: LocalQuizExtras): Promise<void>;
  loadQuizExtras(): Promise<LocalQuizExtras | null>;
  saveRelationshipPhoto(photo: NewRelationshipBookPhoto): Promise<void>;
  listRelationshipPhotos(pairId: string): Promise<RelationshipBookPhoto[]>;
  deleteRelationshipPhoto(pairId: string, photoId: string): Promise<void>;
  saveBookInteraction(interaction: NewBookInteraction): Promise<void>;
  listBookInteractions(pairId: string): Promise<BookInteraction[]>;
  deleteBookInteraction(pairId: string, interactionId: string): Promise<void>;
}

/** Transient provider reflection via authenticated Next.js route (AI owns). */
export interface ReflectionPort {
  readonly status: AdapterStatus;
  /** C1 (AI-owned contract): reflection text plus an owner-only candidate held in memory, never persisted. */
  reflect(selectedText: string, clientRequestId: string, signal?: AbortSignal): Promise<PrivateReflection>;
}
