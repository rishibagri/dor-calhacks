import { spacetimeConfig } from '@/lib/config';
import { bindingsGenerated } from './bindings';

export type SpacetimeAvailability = { ready: true } | { ready: false; reason: string };

export const GENERATE_HINT =
  'run `spacetime generate --lang typescript --out-dir src/lib/spacetime/module_bindings --module-path spacetimedb` (see src/lib/spacetime/README.md)';

/** Live only when bindings are generated AND NEXT_PUBLIC_SPACETIMEDB_URI is set. */
export function getSpacetimeAvailability(): SpacetimeAvailability {
  if (!bindingsGenerated()) {
    return { ready: false, reason: `SpacetimeDB bindings not generated: ${GENERATE_HINT}` };
  }
  if (!spacetimeConfig.uri) {
    return { ready: false, reason: 'NEXT_PUBLIC_SPACETIMEDB_URI is not set' };
  }
  return { ready: true };
}
