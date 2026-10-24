/**
 * a3 (PROPOSED, D044; DS + AI ACK needed before enforcement): approved-signal IDs must be opaque and server-minted.
 * The SpacetimeDB module mints every signal id with `ctx.newUuidV4()` (lowercase RFC 4122 v4). A client- or
 * model-chosen id such as "exam-friday-panic" could spell out a private reason, so the shared contract should accept
 * only this shape. Not enforced yet: fixtures and tests across contracts, DS and the worker still use readable ids.
 * Runtime-dependency-free (re-exported from `@dor/contracts/policy`).
 */
const SERVER_MINTED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True only for an id in the exact shape the module mints (lowercase UUID v4). */
export const isServerMintedId = (id: unknown): id is string => typeof id === 'string' && SERVER_MINTED_ID.test(id);
