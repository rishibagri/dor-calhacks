/**
 * SpacetimeDB-backed SharedStatePort. Only constructed when
 * getSpacetimeAvailability().ready. Authorization lives in reducers/views;
 * "ok" here means the reducer accepted the call, nothing more.
 */
import type { AdapterStatus, ConnectionState, ReducerResult, SharedStatePort } from '@/lib/backend/ports';
import { spacetimeConfig } from '@/lib/config';
import { findReducer, newBuilder, type LooseConnection } from './bindings';
import { parseReducerError } from './errors';
import { reducerArgs as A } from './reducer_args';
import type { SharedStateController } from './types';
import { EMPTY_VIEWS, VIEW_NAMES, readViews, viewTables, type ViewData } from './views';

export interface AdapterOptions {
  /** Returns a fresh Clerk JWT (template from config) or null when signed out. */
  getToken: () => Promise<string | null>;
}

export class SpacetimeSharedState implements SharedStateController {
  private conn: LooseConnection | null = null;
  private identityHex: string | null = null;
  private views: ViewData = EMPTY_VIEWS;
  private conState: ConnectionState = { phase: 'connecting' };
  private adapterStatus: AdapterStatus = { kind: 'error', reason: 'connecting' };
  private version = 0;
  private disposed = false;
  private refreshQueued = false;
  private readonly listeners = new Set<() => void>();
  /** Connections whose table callbacks are registered (a reconnect may hand back a new object). */
  private readonly wired = new WeakSet<LooseConnection>();
  /** The one live subscription; replaced, never stacked, on reconnect. */
  private subscription: { conn: LooseConnection; handle: unknown } | null = null;

  constructor(private readonly opts: AdapterOptions) {
    void this.start();
  }

  get status(): AdapterStatus { return this.adapterStatus; }
  get connection(): ConnectionState { return this.conState; }
  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  dispose(): void {
    this.disposed = true;
    if (this.subscription) endSubscription(this.subscription.handle);
    this.subscription = null;
    this.conn?.disconnect();
    this.conn = null;
    this.identityHex = null;
    this.views = EMPTY_VIEWS;
    this.listeners.clear();
  }

  // ---- lifecycle -----------------------------------------------------------
  private async start(): Promise<void> {
    try {
      const token = await this.opts.getToken();
      if (this.disposed) return;
      if (!token) return this.set({ phase: 'signed_out' }, { kind: 'unconfigured', reason: 'signed out' });
      this.connect(token);
    } catch (e) {
      this.fail(e);
    }
  }

  private connect(token: string): void {
    const refresh = async (): Promise<string> => {
      const fresh = await this.opts.getToken();
      if (!fresh) throw new Error('unauthenticated: no Clerk token');
      return fresh;
    };
    let b = newBuilder()
      .withUri(spacetimeConfig.uri ?? '')
      .withDatabaseName(spacetimeConfig.module)
      .withToken(token)
      .withTokenProvider(refresh);
    b = b.withAutomaticReconnect?.() ?? b;
    b = b.onConnect((c, id) => this.onConnected(c, id.toHexString()));
    b = b.onAutomaticReconnect?.((c, id) => this.onConnected(c, id.toHexString())) ?? b;
    b = b.onConnectError((_c, e) => this.fail(e));
    b = b.onDisconnect((_c, e) => this.onDisconnected(e));
    this.conn = b.build();
  }

  private onConnected(conn: LooseConnection, identityHex: string): void {
    if (this.disposed) return conn.disconnect();
    if (this.identityHex !== null && this.identityHex !== identityHex) this.views = EMPTY_VIEWS;
    this.conn = conn;
    this.identityHex = identityHex;
    if (!this.wired.has(conn)) {
      this.wired.add(conn);
      viewTables(conn).forEach((t) => {
        const cb = () => this.queueRefresh();
        t.onInsert?.(cb); t.onDelete?.(cb); t.onUpdate?.(cb);
      });
    }
    this.resubscribe(conn);
    this.set({ phase: 'connected', identityHex }, { kind: 'live' });
  }

  /** Exactly one subscription per adapter: end the previous one on the same connection before opening another. */
  private resubscribe(conn: LooseConnection): void {
    const prev = this.subscription;
    if (prev && prev.conn === conn) endSubscription(prev.handle);
    const handle = conn.subscriptionBuilder()
      .onApplied(() => this.queueRefresh())
      .onError(() => this.fail(new Error('subscription error')))
      .subscribe(VIEW_NAMES.map((n) => `SELECT * FROM ${n}`));
    this.subscription = { conn, handle };
  }

  private onDisconnected(error?: Error): void {
    this.views = EMPTY_VIEWS; // never serve stale rows after a drop
    if (this.disposed) return;
    this.set({ phase: 'disconnected', reason: error?.message }, { kind: 'error', reason: error?.message ?? 'disconnected' });
  }

  private fail(error: unknown): void {
    const reason = error instanceof Error ? error.message : 'connection failed';
    this.views = EMPTY_VIEWS;
    this.set({ phase: 'disconnected', reason }, { kind: 'error', reason });
  }

  private queueRefresh(): void {
    if (this.refreshQueued || this.disposed) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (this.conn && !this.disposed) this.setViews(readViews(this.conn));
    });
  }

  private setViews(views: ViewData): void {
    // Diagnostics only: view names and counts, never row contents (D049). Logged when the set changes.
    const counts = JSON.stringify(views.unreadable.counts);
    if (counts !== JSON.stringify(this.views.unreadable.counts) && counts !== '{}') console.warn('[dor] unreadable view rows', counts);
    this.views = views;
    this.emit();
  }
  private set(connection: ConnectionState, status: AdapterStatus): void {
    this.conState = connection; this.adapterStatus = status; this.emit();
  }
  private emit(): void {
    if (this.disposed) return;
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  // ---- reducers ------------------------------------------------------------
  private async call(name: string, build: () => unknown): Promise<ReducerResult> {
    const conn = this.conn;
    if (!conn || this.conState.phase !== 'connected') {
      return { ok: false, code: 'unavailable', message: 'not connected to SpacetimeDB' };
    }
    const reducer = findReducer(conn, name);
    if (!reducer) return { ok: false, code: 'unavailable', message: `reducer ${name} missing from bindings` };
    try {
      await reducer(build());
      return { ok: true };
    } catch (e) {
      return parseReducerError(e);
    }
  }

  registerAccount = (n: string) => this.call('register_account', () => A.registerAccount(n));
  createPairInvite = () => this.call('create_pair_invite', () => ({}));
  acceptPairInvite = (t: string) => this.call('accept_pair_invite', () => A.acceptPairInvite(t));
  unlinkPair = (id: string) => this.call('unlink_pair', () => A.unlinkPair(id));
  // A save that doesn't mention the activity permission keeps the preset's current value (D049), so re-saving the
  // core categories never silently drops it; with no visible preset it stays off.
  setRelationshipPreset: SharedStatePort['setRelationshipPreset'] = (i) =>
    this.call('set_relationship_preset', () => A.setRelationshipPreset({ ...i, activityInterestAllowed: i.activityInterestAllowed
      ?? this.views.presets.find((p) => p.presetKind === i.presetKind)?.activityInterestAllowed ?? false }));
  assignRelationshipPreset: SharedStatePort['assignRelationshipPreset'] = (i) =>
    this.call('assign_relationship_preset', () => A.assignRelationshipPreset(i));
  approveSignal: SharedStatePort['approveSignal'] = (i) => this.call('approve_signal', () => A.approveSignal(i));
  revokeSignal = (id: string) => this.call('revoke_signal', () => A.revokeSignal(id));
  dismissNudge = (id: string) => this.call('dismiss_nudge', () => A.dismissNudge(id));
  snoozeNudge = (id: string, until: string) => this.call('snooze_nudge', () => A.snoozeNudge(id, until));
  setSupportPreferences: SharedStatePort['setSupportPreferences'] = (i) =>
    this.call('set_support_preferences', () => A.setSupportPreferences(i));
  revokeSupportPreferences = (id: string) => this.call('revoke_support_preferences', () => A.revokeSupportPreferences(id));
  setNudgeDelivery: SharedStatePort['setNudgeDelivery'] = (i) => this.call('set_nudge_delivery', () => A.setNudgeDelivery(i));
  pauseRecipient = (pairId: string, expiresAt: string, v: number) => this.call('pause_recipient', () => A.pauseRecipient(pairId, expiresAt, v));
  resumeRecipient = (pairId: string, v: number) => this.call('resume_recipient', () => A.resumeRecipient(pairId, v));
  setStandingConsent: SharedStatePort['setStandingConsent'] = (i) => this.call('set_standing_consent', () => A.setStandingConsent(i));
  revokeStandingConsent = (pairId: string) => this.call('revoke_standing_consent', () => A.revokeStandingConsent(pairId));
  approveSignalStanding: SharedStatePort['approveSignalStanding'] = (i) => this.call('approve_signal_standing', () => A.approveSignalStanding(i));
  publishDiscoveryProfile: SharedStatePort['publishDiscoveryProfile'] = (i) =>
    this.call('publish_discovery_profile', () => A.publishDiscoveryProfile(i));
  withdrawDiscoveryProfile = () => this.call('withdraw_discovery_profile', () => ({}));
  setDiscoveryArea = (key: string) => this.call('set_discovery_area', () => A.setDiscoveryArea(key));
  blockDiscoveryUser = (ref: string) => this.call('block_discovery_user', () => A.cardRef(ref));
  setDiscoveryPage = (after: string) => this.call('set_discovery_page', () => ({ afterRef: after }));
  sendIntroductionRequest = (ref: string, req: string) =>
    this.call('send_introduction_request', () => A.sendIntroductionRequest(ref, req));
  respondIntroductionRequest = (id: string, accept: boolean) =>
    this.call('respond_introduction_request', () => A.respondIntroductionRequest(id, accept));
  cancelIntroductionRequest = (id: string) => this.call('cancel_introduction_request', () => A.introId(id));
  blockIntroductionParticipant = (id: string) => this.call('block_introduction_participant', () => A.introId(id));
  publishEventIntent = (eventId: string, kind: 'interested' | 'going', expectedVersion: number) =>
    this.call('publish_event_intent', () => ({ eventId, kind, expectedVersion }));
  revokeEventIntent = (eventId: string) => this.call('revoke_event_intent', () => ({ eventId }));
  approveActivityInterest: SharedStatePort['approveActivityInterest'] = (i) =>
    this.call('approve_activity_interest', () => ({ ...i, topics: [...i.topics] }));
  revokeActivityInterest = (approvalId: string) => this.call('revoke_activity_interest', () => ({ approvalId }));
  respondPlan = (planId: string, revision: number, accept: boolean) =>
    this.call('respond_plan', () => ({ planId, revision, accept }));
  cancelPlan = (planId: string) => this.call('cancel_plan', () => ({ planId }));
  dismissIntroductionProposal = (id: string) =>
    this.call('dismiss_introduction_proposal', () => ({ proposalId: id }));
  requestIntroductionSuggestion = (id: string) =>
    this.call('request_introduction_suggestion', () => ({ clientRequestId: id }));
  reportDiscoveryUser: SharedStatePort['reportDiscoveryUser'] = (t, reason) =>
    this.call('report_discovery_user', () => A.reportDiscoveryUser(t, reason));
  setProfileDetail: SharedStatePort['setProfileDetail'] = (d) => this.call('set_profile_detail', () => ({
    bio: d.bio, homeArea: d.homeArea, availability: d.availability, upTo: d.upTo, interests: d.interests, answers: [],
  }));
  sendNudgeRequest = (candidateRef: string, message: string) =>
    this.call('send_nudge_request', () => ({ candidateRef, message }));
  respondNudgeRequest = (requestId: string, accept: boolean) =>
    this.call('respond_nudge_request', () => ({ requestId, accept }));
  cancelNudgeRequest = (requestId: string) => this.call('cancel_nudge_request', () => ({ requestId }));

  // ---- views ---------------------------------------------------------------
  myAccount = () => this.views.account;
  myPairs = () => this.views.pairs;
  myInvites = () => this.views.invites;
  myPresets = () => this.views.presets;
  myPresetAssignments = () => this.views.assignments;
  myNudges = () => this.views.nudges;
  myReceipts = () => this.views.receipts;
  mySignals = () => this.views.signals;
  mySupportPreferences = () => this.views.supportPreferences;
  myNudgeDelivery = () => this.views.nudgeDelivery;
  myRecipientPauses = () => this.views.pauses;
  myStandingConsents = () => this.views.standingConsents;
  myDiscoveryProfile = () => this.views.discoveryProfile;
  discoveryCards = () => this.views.discoveryCards;
  myIntroductions = () => this.views.introductions;
  myIntroductionProposals = () => this.views.proposals;
  myIntroductionSuggestionRequest = () => this.views.suggestionRequest;
  catalogueEvents = () => this.views.catalogue;
  catalogueStatus = () => this.views.catalogueStatus;
  myEventIntents = () => this.views.eventIntents;
  eventCompanions = () => this.views.companions;
  myActivityApprovals = () => this.views.activityApprovals;
  myPlans = () => this.views.plans;
  myProfileDetail = () => this.views.network.profile;
  fofCards = () => this.views.network.fofCards;
  myNudgeRequests = () => this.views.network.requests;
  myConnectionProfiles = () => this.views.network.connections;
  unreadable = () => this.views.unreadable;
}

/** SDK handles expose unsubscribe() once applied; ending an already-ended or unapplied one is a no-op. */
function endSubscription(handle: unknown): void {
  const h = handle as { isActive?: () => boolean; unsubscribe?: () => void } | null;
  try {
    if (h?.unsubscribe && (h.isActive?.() ?? true)) h.unsubscribe();
  } catch {
    // Unsubscribing a handle the server already dropped throws in some SDK versions; nothing else to clean up.
  }
}
