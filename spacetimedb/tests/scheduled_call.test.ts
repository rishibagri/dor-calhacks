import { describe, expect, it } from 'vitest';
import { Identity } from 'spacetimedb';
import { isScheduledCall } from '../src/guards';

const DB = Identity.fromString('c200' + '0'.repeat(60));
const OTHER = Identity.fromString('c200' + '0'.repeat(59) + '1');
const CONN = { some: 'connection' };

describe('isScheduledCall', () => {
  it('admits calls the harness marks internal', () => {
    const result = isScheduledCall({ isInternal: true, connectionId: CONN, sender: OTHER, databaseIdentity: DB });
    expect(result).toBe(true);
  });
  it('admits no connection with sender equal to the database identity', () => {
    const result = isScheduledCall({ isInternal: false, connectionId: null, sender: DB, databaseIdentity: DB });
    expect(result).toBe(true);
  });
  it('rejects a connection even when sender equals the database identity', () => {
    const result = isScheduledCall({ isInternal: false, connectionId: CONN, sender: DB, databaseIdentity: DB });
    expect(result).toBe(false);
  });
  it('rejects no connection with a different sender', () => {
    const result = isScheduledCall({ isInternal: false, connectionId: null, sender: OTHER, databaseIdentity: DB });
    expect(result).toBe(false);
  });
  it('rejects a connection with a different sender', () => {
    const result = isScheduledCall({ isInternal: false, connectionId: CONN, sender: OTHER, databaseIdentity: DB });
    expect(result).toBe(false);
  });
});
