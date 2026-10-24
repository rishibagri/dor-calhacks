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
    b = b.onConnect((c, id) => this.onConnected(c, id.toHexString(), true));
    b = b.onAutomaticReconnect?.((c, id) => this.onConnected(c, id.toHexString(), false)) ?? b;
    b = b.onConnectError((_c, e) => this.fail(e));
    b = b.onDisconnect((_c, e) => this.onDisconnected(e));
    this.conn = b.build();
  }

  private onConnected(conn: LooseConnection, identityHex: string, first: boolean): void {
    if (this.disposed) return conn.disconnect();
    if (this.identityHex !== null && this.identityHex !== identityHex) this.views = EMPTY_VIEWS;
    this.conn = conn;
    this.identityHex = identityHex;
    if (first) viewTables(conn).forEach((t) => {
      const cb = () => this.queueRefresh();
      t.onInsert?.(cb); t.onDelete?.(cb); t.onUpdate?.(cb);
    });
    conn.subscriptionBuilder()
      .onApplied(() => this.queueRefresh())
      .onError(() => this.fail(new Error('subscription error')))
      .subscribe(VIEW_NAMES.map((n) => `SELECT * FROM ${n}`));
    this.set({ phase: 'connected', identityHex }, { kind: 'live' });
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

  private setViews(views: ViewData): void { this.views = views; this.emit(); }
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
  setRelationshipPreset: SharedStatePort['setRelationshipPreset'] = (i) =>
    this.call('set_relationship_preset', () => A.setRelationshipPreset(i));
  assignRelationshipPreset: SharedStatePort['assignRelationshipPreset'] = (i) =>
    this.call('assign_relationship_preset', () => A.assignRelationshipPreset(i));
  approveSignal: SharedStatePort['approveSignal'] = (i) => this.call('approve_signal', () => A.approveSignal(i));
  revokeSignal = (id: string) => this.call('revoke_signal', () => A.revokeSignal(id));
  dismissNudge = (id: string) => this.call('dismiss_nudge', () => A.dismissNudge(id));
  snoozeNudge = (id: string, until: string) => this.call('snooze_nudge', () => A.snoozeNudge(id, until));

  // ---- views ---------------------------------------------------------------
  myAccount = () => this.views.account;
  myPairs = () => this.views.pairs;
  myInvites = () => this.views.invites;
  myPresets = () => this.views.presets;
  myPresetAssignments = () => this.views.assignments;
  myNudges = () => this.views.nudges;
  myReceipts = () => this.views.receipts;
}

