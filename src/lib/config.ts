/**
 * Public (browser-safe) configuration. NEXT_PUBLIC_* values are visible to
 * users: never put secrets here. Next inlines each variable by literal name,
 * so every access below must be a direct `process.env.NEXT_PUBLIC_X` read.
 */
const DEFAULT_MODULE = 'dor';
const DEFAULT_JWT_TEMPLATE = 'spacetimedb';

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const isClerkConfigured: boolean = clean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) !== null;

export interface SpacetimeConfig {
  /** ws(s) URI of the SpacetimeDB host; null when unset (adapter stays unconfigured). */
  readonly uri: string | null;
  readonly module: string;
  /** Clerk JWT template whose token SpacetimeDB accepts. */
  readonly jwtTemplate: string;
}

export const spacetimeConfig: SpacetimeConfig = {
  uri: clean(process.env.NEXT_PUBLIC_SPACETIMEDB_URI),
  module: clean(process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE) ?? DEFAULT_MODULE,
  jwtTemplate: clean(process.env.NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE) ?? DEFAULT_JWT_TEMPLATE,
};

/**
 * Set while discovery runs on seeded test accounts (LOCAL_CONNECTIONS.md "Launch"), so the Discover page labels
 * every card as synthetic. Defaults to true: a real-people launch must opt out explicitly with "false".
 */
export const isDiscoverySynthetic: boolean = clean(process.env.NEXT_PUBLIC_DISCOVERY_SYNTHETIC) !== 'false';

/**
 * Core-first release (README "Current direction"): Discover and Events are preserved extensions, hidden unless this is
 * exactly "true". The core journey must work with it off, without location permission or an event source.
 * Hiding is presentation only; the module's discovery flag and guards remain the authority.
 */
export const areExtensionsEnabled: boolean = clean(process.env.NEXT_PUBLIC_DOR_EXTENSIONS) === 'true';
