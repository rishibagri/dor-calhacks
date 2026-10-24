import type { CommitNudgeArgs, WorkerStateSource } from './adapters.js';

/**
 * Structural view of generated SpacetimeDB client bindings (`spacetime generate --lang typescript`). Kept loose
 * so the worker compiles before bindings exist; names are looked up camelCase first, then snake_case, as in
 * src/lib/spacetime/bindings.ts.
 */
export interface LooseTable { iter(): Iterable<unknown> }
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
  onConnect(cb: (conn: LooseConnection, identity: { toHexString(): string }) => void): LooseBuilder;
  onConnectError(cb: (ctx: unknown, error: Error) => void): LooseBuilder;
  onDisconnect(cb: (ctx: unknown, error?: Error) => void): LooseBuilder;
  build(): LooseConnection;
}

export const WORKER_VIEWS = ['worker_signal_context', 'worker_delivery'] as const;

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
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
}

/**
 * Live WorkerStateSource: one connection subscribed to the two worker-only views. Reads come from the
 * subscription cache, which the server keeps current; they are advisory because commit_nudge rechecks every
 * guard in its own transaction. Commits go through the reducer and surface its `code: reason` refusal.
 */
export class SpacetimeWorkerConnection implements WorkerStateSource {
  private constructor(private readonly conn: LooseConnection, readonly identityHex: string) {}

  static connect(options: SpacetimeWorkerOptions): Promise<SpacetimeWorkerConnection> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('unavailable: connect timeout')), options.connectTimeoutMs ?? 15_000);
      const fail = (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error('unavailable')); };
      options.builder().withUri(options.uri).withDatabaseName(options.database).withToken(options.token)
        .onConnect((conn, identity) => {
          conn.subscriptionBuilder()
            .onApplied(() => { clearTimeout(timer); resolve(new SpacetimeWorkerConnection(conn, identity.toHexString())); })
            .onError(() => fail(new Error('unavailable: subscription rejected')))
            .subscribe(WORKER_VIEWS.map(v => `SELECT * FROM ${v}`));
        })
        .onConnectError((_ctx, error) => fail(error))
        .onDisconnect(() => undefined)
        .build();
    });
  }

  async signalContext() {
    return [...table(this.conn, 'worker_signal_context').iter()];
  }

  async delivery() {
    return [...table(this.conn, 'worker_delivery').iter()];
  }

  async commitNudge(args: CommitNudgeArgs): Promise<void> {
    const reducer = this.conn.reducers.commitNudge ?? this.conn.reducers.commit_nudge;
    if (!reducer) throw new Error('unavailable: bindings lack commit_nudge');
    await reducer({ nudgeId: args.nudge_id, pairId: args.pair_id, templateId: args.template_id,
      sourceSignalIds: args.source_signal_ids, sourceConsentVersions: args.source_consent_versions });
  }

  close(): void {
    this.conn.disconnect();
  }
}
