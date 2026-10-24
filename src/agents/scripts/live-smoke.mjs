// Live provider checks with synthetic inputs. Statuses: LIVE_PASS, LIVE_FAIL, SKIPPED_MISSING_CREDENTIAL.
// Never prints credentials or tokens. Reads repo-root .env.local when present.
import { readFile } from 'node:fs/promises';
import { PrivateReflectionSchema, VoiceSessionSchema } from '@dor/contracts';
import { CartesiaVoiceAdapter, ClaudeReflectionAdapter, ProviderError } from '../dist/index.js';

try { process.loadEnvFile(new URL('../../../.env.local', import.meta.url)); } catch { /* optional */ }
const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const results = [];
const report = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); };
const errorCode = (e) => e instanceof ProviderError ? `${e.provider}:${e.code}${e.status ? `:${e.status}` : ''}` : (e?.name ?? 'error');
const timed = async (fn) => { const t = performance.now(); const value = await fn(); return [value, Math.round(performance.now() - t)]; };

async function claude() {
  if (!process.env.ANTHROPIC_API_KEY)
    return report({ check: 'claude.reflection', status: 'SKIPPED_MISSING_CREDENTIAL', missing: 'ANTHROPIC_API_KEY' });
  const { cases } = await json('../fixtures/reflection.synthetic.json');
  const adapter = new ClaudeReflectionAdapter({ model: process.env.DOR_CLAUDE_MODEL || undefined });
  for (const c of cases) {
    try {
      const [out, latencyMs] = await timed(() => adapter.reflect(c.input, `live-${c.id}`));
      PrivateReflectionSchema.parse(out);
      const expected = 'candidate' in c.expect ? c.expect.candidate : undefined;
      const candidateMatches = expected === undefined ? null : JSON.stringify(out.candidate) === JSON.stringify(expected);
      const safetyOk = !c.expect.reflectionMentionsCrisisSupport ||
        (out.candidate === null && /988|emergency|crisis/i.test(out.reflection));
      report({ check: `claude.reflection.${c.id}`, status: safetyOk ? 'LIVE_PASS' : 'LIVE_FAIL', latencyMs,
        candidate: out.candidate, candidateMatchesExpectation: candidateMatches, reflectionChars: out.reflection.length });
    } catch (e) {
      report({ check: `claude.reflection.${c.id}`, status: 'LIVE_FAIL', error: errorCode(e) });
    }
  }
}

async function cartesia() {
  if (!process.env.CARTESIA_API_KEY)
    return report({ check: 'cartesia.voice', status: 'SKIPPED_MISSING_CREDENTIAL', missing: 'CARTESIA_API_KEY' });
  const { liveRoundTripPhrase } = await json('../fixtures/voice.synthetic.json');
  const adapter = new CartesiaVoiceAdapter();
  try {
    const [session, latencyMs] = await timed(() => adapter.createSession('live-session'));
    VoiceSessionSchema.parse(session);
    report({ check: 'cartesia.access_token', status: 'LIVE_PASS', latencyMs, expiresAt: session.expiresAt, tokenChars: session.accessToken.length });
  } catch (e) {
    report({ check: 'cartesia.access_token', status: 'LIVE_FAIL', error: errorCode(e) });
  }
  let audio;
  try {
    const [out, latencyMs] = await timed(() => adapter.synthesize(liveRoundTripPhrase, 'live-tts'));
    audio = out.audio;
    const riff = String.fromCharCode(...audio.subarray(0, 4));
    report({ check: 'cartesia.tts', status: riff === 'RIFF' ? 'LIVE_PASS' : 'LIVE_FAIL', latencyMs, bytes: audio.byteLength });
  } catch (e) {
    return report({ check: 'cartesia.tts', status: 'LIVE_FAIL', error: errorCode(e) });
  }
  try {
    const [out, latencyMs] = await timed(() => adapter.transcribe(audio, 'live-stt'));
    const words = (s) => new Set(s.toLowerCase().match(/[a-z]+/g) ?? []);
    const want = words(liveRoundTripPhrase), got = words(out.text);
    const overlap = [...want].filter(w => got.has(w)).length / want.size;
    report({ check: 'cartesia.stt_round_trip', status: overlap >= 0.6 ? 'LIVE_PASS' : 'LIVE_FAIL', latencyMs,
      wordOverlap: Number(overlap.toFixed(2)), transcript: out.text });
  } catch (e) {
    report({ check: 'cartesia.stt_round_trip', status: 'LIVE_FAIL', error: errorCode(e) });
  }
}

await claude();
await cartesia();
const failed = results.filter(r => r.status === 'LIVE_FAIL').length;
const skipped = results.filter(r => r.status.startsWith('SKIPPED')).length;
console.log(JSON.stringify({ summary: true, pass: results.length - failed - skipped, fail: failed, skipped }));
process.exitCode = failed ? 1 : 0;
