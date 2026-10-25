/** Name lookups shared by the adapter and the view mappers; free of the generated bindings so tests can import it. */
import type { LooseConnection, LooseTable } from './bindings';

export function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function findTable(conn: LooseConnection, name: string): LooseTable | undefined {
  return conn.db[name] ?? conn.db[toCamel(name)];
}
