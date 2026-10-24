import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFERENCE_MAX_LIFETIME_MS, validRecipientDelivery, validSupportPreferences } from '@dor/contracts/policy';
import {
  CONSENT_DURATION_DAYS, buildDelivery, consentExpiry, expectedConsentVersion, formatClock, isConsentActive,
  formatUtcOffset, localUtcOffsetMinutes, offsetNote, parseClock,
} from '../recipient-settings-model.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const pref = (over: Partial<{ revokedAt: string | null; expiresAt: string; consentVersion: number }> = {}) => ({
  pairId: 'p1', supportModes: ['short_call' as const], availability: [], consentVersion: 3,
  expiresAt: '2026-11-01T00:00:00Z', revokedAt: null, ...over,
});

test('every offered consent duration stays inside the server lifetime cap', () => {
  for (const d of CONSENT_DURATION_DAYS) {
    const ms = Date.parse(consentExpiry(NOW, d)) - NOW;
    assert.ok(ms > 0 && ms < PREFERENCE_MAX_LIFETIME_MS, `${d} days`);
  }
});

test('clock parsing accepts HH:MM only and round-trips', () => {
  assert.equal(parseClock('22:30'), 1350);
  assert.equal(parseClock('00:00'), 0);
  for (const bad of ['24:00', '7:00', '12:60', 'noon', '']) assert.equal(parseClock(bad), null, bad);
  assert.equal(formatClock(1350), '22:30');
  assert.equal(formatClock(null), '');
});

test('delivery draft without quiet hours builds a payload the module accepts', () => {
  const r = buildDelivery('p1', { optedIn: true, quietStart: '', quietEnd: '' }, 120);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, { pairId: 'p1', optedIn: true, quietStartMinute: null, quietEndMinute: null, utcOffsetMinutes: 120 });
    assert.equal(validRecipientDelivery(r.value), true);
  }
});

test('delivery draft rejects half-set or malformed quiet hours before calling the reducer', () => {
  assert.equal(buildDelivery('p1', { optedIn: true, quietStart: '22:00', quietEnd: '' }, 0).ok, false);
  assert.equal(buildDelivery('p1', { optedIn: true, quietStart: '25:00', quietEnd: '07:00' }, 0).ok, false);
  const ok = buildDelivery('p1', { optedIn: false, quietStart: '22:00', quietEnd: '07:00' }, -300);
  assert.equal(ok.ok && validRecipientDelivery(ok.value), true);
});

test('utc offset uses the module sign convention (east of UTC is positive)', () => {
  const fake = { getTimezoneOffset: () => -120 } as Date;
  assert.equal(localUtcOffsetMinutes(fake), 120);
});

test('consent is active only when unrevoked and unexpired; version 0 creates', () => {
  assert.equal(isConsentActive(undefined, NOW), false);
  assert.equal(isConsentActive(pref(), NOW), true);
  assert.equal(isConsentActive(pref({ revokedAt: '2026-10-23T00:00:00Z' }), NOW), false);
  assert.equal(isConsentActive(pref({ expiresAt: '2026-10-24T11:59:59Z' }), NOW), false);
  assert.equal(expectedConsentVersion(undefined), 0);
  assert.equal(expectedConsentVersion(pref({ revokedAt: '2026-10-23T00:00:00Z', consentVersion: 4 })), 4);
});

test('form enums match the module validator (no drift)', () => {
  assert.equal(validSupportPreferences({ supportModes: ['short_call', 'encouraging_note', 'shared_activity'], availability: ['today', 'this_week', 'no_preference'] }), true);
  assert.equal(validSupportPreferences({ supportModes: [], availability: [] }), false);
});

test('offset note names the stored zone and flags drift after a clock change', () => {
  assert.equal(formatUtcOffset(120), 'UTC+2');
  assert.equal(formatUtcOffset(-420), 'UTC-7');
  assert.equal(formatUtcOffset(330), 'UTC+5:30');
  assert.match(offsetNote(null, 60), /will use UTC\+1/);
  assert.match(offsetNote(-420, -420), /set in UTC-7\.$/);
  assert.match(offsetNote(-420, -480), /now UTC-8\. Save again/);
});
