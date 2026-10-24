import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateReflectionSchema } from '@kinetic/contracts';
import { MAX_REFLECT_CHARS, MAX_SPEAK_CHARS, describeCandidate, insertTranscript, reflectFailureCopy, speakableText,
  splitReflection, textToReflect, voiceFailureCopy } from '../model.ts';

test('a transcript lands at the caret, spaced from its neighbours, and can replace a selection', () => {
  assert.deepEqual(insertTranscript('', ' rough day '), { text: 'rough day', caret: 9 });
  assert.equal(insertTranscript('Today was', 'a rough day').text, 'Today was a rough day');
  assert.equal(insertTranscript('Hi.Bye.', 'middle', { start: 3, end: 3 }).text, 'Hi. middle Bye.');
  assert.equal(insertTranscript('I feel bad today', 'tired', { start: 7, end: 10 }).text, 'I feel tired today');
  assert.deepEqual(insertTranscript('keep', '   '), { text: 'keep', caret: 4 }, 'an empty recording changes nothing');
  assert.equal(insertTranscript('abc', 'x', { start: 99, end: -5 }).text, 'abc x', 'out-of-range caret is clamped');
});

test('only the highlighted text is sent; otherwise the whole entry; empty and oversized input are refused', () => {
  const entry = 'Private part. Share this bit.';
  assert.deepEqual(textToReflect(entry, { start: 14, end: 29 }), { ok: true, text: 'Share this bit.', scope: 'selection' });
  assert.deepEqual(textToReflect(entry), { ok: true, text: entry, scope: 'entry' });
  assert.deepEqual(textToReflect(entry, { start: 5, end: 5 }), { ok: true, text: entry, scope: 'entry' }, 'a caret is not a selection');
  assert.deepEqual(textToReflect('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(textToReflect('x'.repeat(MAX_REFLECT_CHARS + 1)), { ok: false, reason: 'too_long' });
});

test('the candidate is separated from what may be persisted', () => {
  const reply = PrivateReflectionSchema.parse({ schemaVersion: 1, reflection: 'It sounds like a long week.',
    candidate: { supportMode: 'short_call', availability: 'today' } });
  const { persist, memoryOnly } = splitReflection(reply);
  assert.deepEqual(Object.keys(persist), ['reflection'], 'only reflection text is persistable');
  assert.equal(JSON.stringify(persist).includes('short_call'), false);
  assert.deepEqual(memoryOnly, { supportMode: 'short_call', availability: 'today' });
});

test('candidate copy is a suggestion; no candidate means no suggestion', () => {
  assert.equal(describeCandidate({ supportMode: 'short_call', availability: 'today' }), 'You might welcome a short call, today.');
  assert.equal(describeCandidate({ supportMode: 'encouraging_note' }), 'You might welcome an encouraging note.');
  assert.equal(describeCandidate({ availability: 'this_week' }), 'You mentioned being free this week.');
  assert.equal(describeCandidate(null), null);
  assert.equal(describeCandidate({}), null);
});

test('read-aloud input is bounded at a sentence or word boundary', () => {
  assert.equal(speakableText('  Short.  '), 'Short.');
  const long = 'One sentence here. '.repeat(200);
  const spoken = speakableText(long);
  assert.ok(spoken.length <= MAX_SPEAK_CHARS);
  assert.ok(spoken.endsWith('.'));
  const words = speakableText('word '.repeat(1000));
  assert.ok(words.length <= MAX_SPEAK_CHARS && !words.endsWith(' '));
});

test('failure copy keeps typed entry available and never echoes provider detail', () => {
  for (const code of ['mic_denied', 'mic_unavailable', 'rate_limited', 'network', 'provider', 'anything']) {
    assert.match(voiceFailureCopy(code), /typ/);
  }
  assert.match(reflectFailureCopy('unavailable'), /unchanged/);
  assert.equal(reflectFailureCopy('anthropic 500 body'), reflectFailureCopy('unavailable'));
});
