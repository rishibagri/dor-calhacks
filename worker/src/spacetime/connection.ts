import type { CommitIntroductionArgs, CommitNudgeArgs, CommitPlanArgs, WorkerStateSource } from './adapters.js';

/**
 * Structural view of generated SpacetimeDB client bindings (`spacetime generate --lang typescript`). Kept loose
 * so the worker compiles before bindings exist; names are looked up camelCase first, then snake_case, as in
 * src/lib/spacetime/bindings.ts.
 */
export interface LooseTable {
  iter(): Iterable<unknown>;
  /** Row callbacks from the generated bindings; optional so test doubles and older bindings still fit. */
  onInsert?(cb: (...args: unknown[]) => void): void;
}
export interface LooseConnection {
  db: Record<string, LooseTable | undefined>;
  reducers: Record<string, ((args: unknown) => Promise<unknown>) | undefined>;
  subscriptionBuilder(): {
    onApplied(cb: () => void): ReturnType<LooseConnection['subscriptionBuilder']>;
    onError(cb: (ctx: unknown) => void): ReturnType<LooseConnection['subscriptionBuilder']>;
    subscribe(queries: string[]): unknown;
  };
  disconnect(): void;
}
export interface LooseBuilder {
  withUri(uri: string): LooseBuilder;
  withDatabaseName(name: string): LooseBuilder;
  withToken(token: string): LooseBuilder;
  /** SpacetimeDB SDK 2.13+: reconnect after a drop, keeping table handles, callbacks and subscriptions. */
  withAutomaticReconnect?(options?: unknown): LooseBuilder;
  onAutomaticReconnect?(cb: (conn: LooseConnection, identity: { toHexString(): string }) => void): LooseBuilder;
  onConnect(cb: (conn: LooseConnection, identity: { toHexString(): string }) => void): LooseBuilder;
  onConnectError(cb: (ctx: unknown, error: Error, nextReconnectAttempt?: number, nextReconnectDelayMs?: number) => void): LooseBuilder;
  /** `nextReconnectAttempt` is undefined when the SDK will not retry. */
  onDisconnect(cb: (ctx: unknown, error?: Error, nextReconnectAttempt?: number, nextReconnectDelayMs?: number) => void): LooseBuilder;
  build(): LooseConnection;
}

/**
 * Connection lifecycle seen by the worker loop:
 * - `lost`: the cache may be stale; every read and commit now throws DISCONNECTED until `ready`. `willRetry` is false
 *   when the SDK will not reconnect (the process should exit so its supervisor restarts it).
 * - `ready`: the replayed subscription has applied fresh rows again.
 * - `change`: a row was inserted into a worker view, so there may be new work (event-driven sweep).
 */
export type WorkerConnectionEvent =
  | { kind: 'lost'; willRetry: boolean; nextDelayMs?: number }
  | { kind: 'ready' }
  | { kind: 'change' };

/** Thrown by every read and commit while the connection is down: a transient fault, never a policy decision. */
export const DISCONNECTED = 'unavailable: disconnected';
export const isDisconnected = (error: unknown) => error instanceof Error && error.message === DISCONNECTED;

export const WORKER_VIEWS = ['worker_signal_context', 'worker_delivery', 'worker_support_preferences'] as const;
/**
 * Subscribed only when the generated bindings include them (D039 plans, D048 suggestion requests); without them the
 * worker proposes no plans or suggestions.
 */
export const OPTIONAL_WORKER_VIEWS = ['worker_plan_candidates', 'worker_introduction_requests'] as const;

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const hasTable = (conn: LooseConnection, name: string) => Boolean(conn.db[camel(name)] ?? conn.db[name]);
function table(conn: LooseConnection, name: string): LooseTable {
  const t = conn.db[camel(name)] ?? conn.db[name];
  if (!t) throw new Error(`unavailable: bindings lack ${name}`);
  return t;
}

export interface SpacetimeWorkerOptions {
  uri: string;
  database: string;
  /** Token for the allow-listed worker identity (set_worker_identity). Never logged. */
  token: string;
  /** DbConnection.builder from generated bindings. */
  builder: () => LooseBuilder;
  connectTimeoutMs?: number;
  /** Use the SDK's automatic reconnect when the bindings support it. Default true. */
  autoReconnect?: boolean;
}

/**
 * Views whose new rows can mean new work; a callback on them triggers an immediate sweep. Delivery and preference rows
 * are included so a recipient's later opt-in or consent retries a deferred signal at once (SignalWatcher).
 */
const TRIGGER_VIEWS = ['worker_signal_context', 'worker_delivery', 'worker_support_preferences', 'worker_plan_candidates',
  'worker_introduction_requests'] as const;

/**
 * Live WorkerStateSource: one connection subscribed to the worker-only views. Reads come from the
 * subscription cache, which the server keeps current; they are advisory because commit_nudge rechecks every
 * guard in its own transaction. Commits go through the reducer and surface its `code: reason` refusal.
 *
 * Fail closed on disconnect: once the connection drops, the cache is no longer authoritative, so every read and
 * commit throws DISCONNECTED until the SDK has reconnected AND the replayed subscription has applied again.
 */
export class SpacetimeWorkerConnection implements WorkerStateSource {
  private alive = true;
  private readonly listeners = new Set<(event: WorkerConnectionEvent) => void>();

  private constructor(private readonly conn: LooseConnection, readonly identityHex: string, missing: ReadonlySet<string> = new Set()) {
    // Only advertise the plan path when both its view and its reducer are in the bindings.
    if (!hasTable(conn, 'worker_plan_candidates') || !(conn.reducers.commitPlanProposal ?? conn.reducers.commit_plan_proposal)) {
      this.planCandidates = undefined;
      this.commitPlanProposal = undefined;
    }
    if (!(conn.reducers.commitIntroductionProposal ?? conn.reducers.commit_introduction_proposal)) {
      this.commitIntroductionProposal = undefined;
    }
    // Suggestion requests (D048) need the view, its close reducer and the proposal commit.
    if (!hasTable(conn, 'worker_introduction_requests') || !this.commitIntroductionProposal ||
      !(conn.reducers.closeIntroductionSuggestionRequest ?? conn.reducers.close_introduction_suggestion_request)) {
      this.introductionRequests = undefined;
      this.closeIntroductionRequest = undefined;
    }
    for (const view of missing) this.disableView(view);
    // Event-driven triggers. Registered once: the SDK keeps table handles and callbacks across reconnects.
    for (const name of TRIGGER_VIEWS) {
      const t = conn.db[camel(name)] ?? conn.db[name];
      t?.onInsert?.(() => this.emit({ kind: 'change' }));
    }
  }

  static connect(options: SpacetimeWorkerOptions): Promise<SpacetimeWorkerConnection> {
    return new Promise((resolve, reject) => {
      let instance: SpacetimeWorkerConnection | undefined;
      const timer = setTimeout(() => reject(new Error('unavailable: connect timeout')), options.connectTimeoutMs ?? 15_000);
      const fail = (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error('unavailable')); };
      const lost = (nextReconnectAttempt?: number, nextDelayMs?: number) => {
        if (!instance) return fail(new Error('unavailable: disconnected before subscription applied'));
        instance.markLost(nextReconnectAttempt !== undefined, nextDelayMs);
      };
      let b = options.builder().withUri(options.uri).withDatabaseName(options.database).withToken(options.token);
      if (options.autoReconnect !== false && b.withAutomaticReconnect) b = b.withAutomaticReconnect();
      b.onConnect((conn, identity) => {
        // Optional views each get their own subscription: bindings newer than the published module (a view the server
        // does not have yet) then disable only that path instead of failing the whole connection.
        const optional = OPTIONAL_WORKER_VIEWS.filter(v => hasTable(conn, v));
        const missing = new Set<string>();
        let mainApplied = false, settled = 0;
        const maybeResolve = () => {
          if (instance || !mainApplied || settled < optional.length) return;
          clearTimeout(timer);
          instance = new SpacetimeWorkerConnection(conn, identity.toHexString(), missing);
          resolve(instance);
        };
        conn.subscriptionBuilder()
          // Fires for the first subscription and again when the SDK replays it after an automatic reconnect.
          .onApplied(() => {
            if (!instance) { mainApplied = true; maybeResolve(); } else instance.markReady();
          })
          .onError(() => (instance ? instance.markLost(false) : fail(new Error('unavailable: subscription rejected'))))
          .subscribe(WORKER_VIEWS.map(v => `SELECT * FROM ${v}`));
        for (const view of optional) {
          let done = false;
          const settle = () => { if (!done) { done = true; settled++; maybeResolve(); } };
          conn.subscriptionBuilder()
            .onApplied(settle)
            .onError(() => { if (instance) instance.disableView(view); else missing.add(view); settle(); })
            .subscribe([`SELECT * FROM ${view}`]);
        }
      })
        // A failed reconnect attempt arrives here too; before the first connect it is the initial failure.
        .onConnectError((_ctx, error, next, delay) => (instance ? lost(next, delay) : fail(error)))
        .onDisconnect((_ctx, _error, next, delay) => lost(next, delay))
        .build();
    });
  }

  /** The server lacks an optional view (or rejected it): turn off only the path that depends on it. */
  private disableView(view: string): void {
    if (view === 'worker_plan_candidates') {
      this.planCandidates = undefined;
      this.commitPlanProposal = undefined;
    } else if (view === 'worker_introduction_requests') {
      this.introductionRequests = undefined;
      this.closeIntroductionRequest = undefined;
    }
  }

  /** False from a drop until the replayed subscription applies again. */
  get isAlive(): boolean {
    return this.alive;
  }

  /** Subscribe to lifecycle and change events; returns an unsubscribe function. */
  on(listener: (event: WorkerConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WorkerConnectionEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* a listener fault must not break the connection */ }
    }
  }

  private markLost(willRetry: boolean, nextDelayMs?: number): void {
    this.alive = false;
    this.emit({ kind: 'lost', willRetry, ...(nextDelayMs !== undefined ? { nextDelayMs } : {}) });
  }

  private markReady(): void {
    const wasAlive = this.alive;
    this.alive = true;
    if (!wasAlive) this.emit({ kind: 'ready' });
  }

  private live(): LooseConnection {
    if (!this.alive) throw new Error(DISCONNECTED);
    return this.conn;
  }

  async signalContext() {
    return [...table(this.live(), 'worker_signal_context').iter()];
  }

  async delivery() {
    return [...table(this.live(), 'worker_delivery').iter()];
  }

  async supportPreferences() {
    return [...table(this.live(), 'worker_support_preferences').iter()];
  }

  async commitNudge(args: CommitNudgeArgs): Promise<void> {
    const conn = this.live();
    const reducer = conn.reducers.commitNudge ?? conn.reducers.commit_nudge;
    if (!reducer) throw new Error('unavailable: bindings lack commit_nudge');
    await reducer({ nudgeId: args.nudge_id, pairId: args.pair_id, templateId: args.template_id,
      sourceSignalIds: args.source_signal_ids, sourceConsentVersions: args.source_consent_versions,
      recipientConsentId: args.recipient_consent_id, recipientConsentVersion: args.recipient_consent_version });
  }

  planCandidates?: () => Promise<unknown[]> = async () => [...table(this.live(), 'worker_plan_candidates').iter()];

  commitPlanProposal?: (args: CommitPlanArgs) => Promise<void> = async args => {
    const conn = this.live();
    const reducer = conn.reducers.commitPlanProposal ?? conn.reducers.commit_plan_proposal;
    if (!reducer) throw new Error('unavailable: bindings lack commit_plan_proposal');
    await reducer({ planId: args.plan_id, basisKind: args.basis_kind, basisRef: args.basis_ref, eventId: args.event_id,
      intentIds: args.intent_ids, intentVersions: args.intent_versions, approvalIds: args.approval_ids,
      expiresAt: args.expires_at, decidedBy: args.decided_by });
  };

  commitIntroductionProposal?: (args: CommitIntroductionArgs) => Promise<void> = async args => {
    const conn = this.live();
    const reducer = conn.reducers.commitIntroductionProposal ?? conn.reducers.commit_introduction_proposal;
    if (!reducer) throw new Error('unavailable: bindings lack commit_introduction_proposal');
    await reducer({ proposalId: args.proposal_id, viewerRef: args.viewer_ref, candidateRef: args.candidate_ref,
      viewerPublicationVersion: args.viewer_publication_version, candidatePublicationVersion: args.candidate_publication_version,
      reasonCode: args.reason_code, sharedTags: args.shared_tags, eventId: args.event_id, openerId: args.opener_id,
      decidedBy: args.decided_by, expiresAt: args.expires_at });
  };

  introductionRequests?: () => Promise<unknown[]> = async () => [...table(this.live(), 'worker_introduction_requests').iter()];

  closeIntroductionRequest?: (requestId: string) => Promise<void> = async requestId => {
    const conn = this.live();
    const reducer = conn.reducers.closeIntroductionSuggestionRequest ?? conn.reducers.close_introduction_suggestion_request;
    if (!reducer) throw new Error('unavailable: bindings lack close_introduction_suggestion_request');
    await reducer({ requestId });
  };

  close(): void {
    this.listeners.clear();
    this.conn.disconnect();
  }
}
