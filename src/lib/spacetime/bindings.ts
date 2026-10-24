/**
 * The ONLY file that touches `./module_bindings`. It exposes the generated
 * code through a loose structural facade, so the adapter compiles both before
 * and after `spacetime generate` (generated names/shapes vary by CLI version;
 * lookups try camelCase and snake_case).
 */
import * as raw from './module_bindings';

export interface LooseRow {
  readonly [key: string]: unknown;
}
export interface LooseTable {
  iter(): Iterable<LooseRow>;
  onInsert?(cb: (...a: unknown[]) => void): void;
  onDelete?(cb: (...a: unknown[]) => void): void;
  onUpdate?(cb: (...a: unknown[]) => void): void;
}
export interface LooseSubscriptionBuilder {
  onApplied(cb: () => void): LooseSubscriptionBuilder;
  onError(cb: (ctx: unknown) => void): LooseSubscriptionBuilder;
  subscribe(queries: string[]): unknown;
}
export interface LooseConnection {
  db: Record<string, LooseTable | undefined>;
  reducers: Record<string, ((args: unknown) => Promise<unknown>) | undefined>;
  subscriptionBuilder(): LooseSubscriptionBuilder;
  disconnect(): void;
}
export interface LooseBuilder {
  withUri(uri: string): LooseBuilder;
  withDatabaseName(name: string): LooseBuilder;
  withToken(token: string): LooseBuilder;
  withTokenProvider(provider: () => Promise<string>): LooseBuilder;
  withAutomaticReconnect?(): LooseBuilder;
  onConnect(cb: (conn: LooseConnection, identity: { toHexString(): string }, token: string) => void): LooseBuilder;
  onAutomaticReconnect?(cb: (conn: LooseConnection, identity: { toHexString(): string }) => void): LooseBuilder;
  onConnectError(cb: (ctx: unknown, error: Error) => void): LooseBuilder;
  onDisconnect(cb: (ctx: unknown, error?: Error) => void): LooseBuilder;
  build(): LooseConnection;
}

interface GeneratedModule {
  DbConnection?: { builder(): LooseBuilder };
}

const generated = raw as unknown as GeneratedModule;

/** Generated code replaces this directory and exports DbConnection. */
export function bindingsGenerated(): boolean {
  return typeof generated.DbConnection?.builder === 'function';
}

export function newBuilder(): LooseBuilder {
  if (!generated.DbConnection) throw new Error('SpacetimeDB bindings not generated');
  return generated.DbConnection.builder();
}

export function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function findTable(conn: LooseConnection, name: string): LooseTable | undefined {
  return conn.db[name] ?? conn.db[toCamel(name)];
}

export function findReducer(conn: LooseConnection, name: string): ((args: unknown) => Promise<unknown>) | undefined {
  return conn.reducers[toCamel(name)] ?? conn.reducers[name];
}
