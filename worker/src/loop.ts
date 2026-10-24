import type { WorkerConnectionEvent } from './spacetime/connection.js';

/** What the loop needs from the database connection (SpacetimeWorkerConnection, or a test double). */
export interface LoopConnection {
  readonly isAlive: boolean;
  on(listener: (event: WorkerConnectionEvent) => void): () => void;
}

export interface WorkerLoopOptions {
  /** Each sweep reads its worker view once and starts any new jobs (SignalWatcher, PlanWatcher). */
  sweeps: (() => Promise<unknown>)[];
  /** Coalesces bursts of change events into one sweep. Default 200 ms. */
  debounceMs?: number;
  /** Safety-net sweep interval when no change events arrive. Default 15 s. */
  fallbackIntervalMs?: number;
  /** Longest tolerated outage before giving up so a supervisor restarts the process. Default 2 min. */
  maxOfflineMs?: number;
  /** The process should exit non-zero: the SDK will not reconnect, or the outage lasted too long. */
  onFatal: (reason: 'no_reconnect' | 'offline_too_long') => void;
  /** Codes and counts only. */
  log?: (event: string, data?: Record<string, string | number>) => void;
}

/**
 * Event-driven worker loop (AI, Core 3 audit HIGH "worker never reconnects"). New rows in a worker view trigger a
 * debounced sweep at once; a slower interval sweep is the safety net. Nothing runs while the connection is down:
 * the cache is stale then, and reads would only throw. On reconnect the loop sweeps immediately to catch up.
 */
export class WorkerLoop {
  private debounce: NodeJS.Timeout | undefined;
  private interval: NodeJS.Timeout | undefined;
  private offline: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private stopped = false;

  constructor(private readonly connection: LoopConnection, private readonly options: WorkerLoopOptions) {}

  start(): void {
    this.unsubscribe = this.connection.on(event => this.onEvent(event));
    this.interval = setInterval(() => this.sweepNow('interval'), this.options.fallbackIntervalMs ?? 15_000);
    this.sweepNow('start');
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    for (const t of [this.debounce, this.interval, this.offline]) if (t) clearTimeout(t);
  }

  /** Schedules one sweep soon, coalescing bursts (e.g. a pause revoking several signals at once). */
  trigger(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => { this.debounce = undefined; this.sweepNow('change'); }, this.options.debounceMs ?? 200);
  }

  private onEvent(event: WorkerConnectionEvent): void {
    if (this.stopped) return;
    if (event.kind === 'change') return this.trigger();
    if (event.kind === 'ready') {
      if (this.offline) { clearTimeout(this.offline); this.offline = undefined; }
      this.options.log?.('reconnected');
      return this.sweepNow('reconnect');
    }
    this.options.log?.('disconnected', { willRetry: event.willRetry ? 1 : 0 });
    if (!event.willRetry) return this.fatal('no_reconnect');
    this.offline ??= setTimeout(() => this.fatal('offline_too_long'), this.options.maxOfflineMs ?? 120_000);
  }

  private fatal(reason: 'no_reconnect' | 'offline_too_long'): void {
    if (this.stopped) return;
    this.options.log?.('fatal_connection', { reason });
    this.stop();
    this.options.onFatal(reason);
  }

  private sweepNow(cause: 'start' | 'interval' | 'change' | 'reconnect'): void {
    if (this.stopped || !this.connection.isAlive) return;
    for (const sweep of this.options.sweeps) {
      void sweep().catch(() => this.options.log?.('sweep_error', { cause }));
    }
  }
}
