import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VoiceDictation, VoiceError, speak, streamingSttUrl, toPcm16 } from '../dist/client.js';

const voice = JSON.parse(await readFile(new URL('../fixtures/voice.synthetic.json', import.meta.url), 'utf8'));
const session = voice.session;
const tick = () => new Promise(r => setImmediate(r));

class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.closedWith = null;
    this.onopen = this.onmessage = this.onerror = this.onclose = null; this.binaryType = 'blob'; }
  send(data) { this.sent.push(data); }
  close(code) { this.closedWith = code; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  serverClose(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}

function harness({ mic, getSession } = {}) {
  const sockets = [], snapshots = [];
  let frame = null, micStopped = 0;
  const dictation = new VoiceDictation({
    getSession: getSession ?? (async () => session),
    onChange: (s) => snapshots.push(s),
    socket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    mic: mic ?? (async (onFrame) => { frame = onFrame; return { stop: () => { micStopped++; } }; }),
  });
  return { dictation, sockets, snapshots, push: (samples, rate = 48000) => frame(new Float32Array(samples), rate),
    micStopped: () => micStopped };
}

test('PCM conversion downsamples to 16 kHz s16 and clamps', () => {
  const pcm = toPcm16(new Float32Array([1, 1, 1, -1, -1, -1, 0, 0, 0, 2, 2, 2]), 48000);
  assert.deepEqual([...pcm], [32767, -32768, 0, 32767]);
  assert.equal(toPcm16(new Float32Array(4800), 48000).length, 1600);
});

test('streaming URL carries the scoped session settings, never a master key', () => {
  const url = new URL(streamingSttUrl(session));
  assert.equal(`${url.origin}${url.pathname}`, 'wss://api.cartesia.ai/stt/turns/websocket');
  assert.deepEqual(Object.fromEntries(url.searchParams), { model: 'ink-2', encoding: 'pcm_s16le', sample_rate: '16000',
    cartesia_version: '2026-08-14', access_token: session.accessToken });
});

test('dictation: queues audio until open, streams 100 ms chunks, accumulates turns, finalizes on stop', async () => {
  const h = harness();
  await h.dictation.start();
  assert.equal(h.dictation.current.state, 'listening');
  const [socket] = h.sockets;
  h.push(new Array(4800).fill(0.1));           // 100 ms at 48 kHz before the socket opens
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].length, 1600);
  socket.emit({ type: 'connected', request_id: 'r' });
  socket.emit({ type: 'turn.start', request_id: 'r' });
  assert.equal(h.dictation.current.speaking, true);
  socket.emit({ type: 'turn.update', request_id: 'r', transcript: 'synthetic first' });
  assert.equal(h.dictation.current.partial, 'synthetic first');
  socket.emit({ type: 'turn.end', request_id: 'r', transcript: 'synthetic first turn' });
  socket.emit({ type: 'turn.update', request_id: 'r', transcript: 'and a second' });
  const done = h.dictation.stop();
  assert.equal(h.micStopped(), 1);
  assert.equal(h.dictation.current.state, 'finalizing');
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'close' });
  socket.emit({ type: 'turn.end', request_id: 'r', transcript: 'and a second one' });
  socket.serverClose(1000);
  assert.equal(await done, 'synthetic first turn and a second one');
  assert.equal(h.dictation.current.state, 'stopped');
});

test('dictation: cancel discards text and closes everything immediately', async () => {
  const h = harness();
  await h.dictation.start();
  const [socket] = h.sockets;
  socket.open();
  socket.emit({ type: 'turn.end', request_id: 'r', transcript: 'synthetic discard me' });
  h.dictation.cancel();
  assert.deepEqual(h.dictation.current, { state: 'stopped', transcript: '', partial: '', speaking: false, error: null });
  assert.equal(socket.closedWith, 4000);
  assert.equal(h.micStopped(), 1);
  socket.emit({ type: 'turn.end', request_id: 'r', transcript: 'late' });
  assert.equal(h.dictation.current.transcript, '', 'late events after cancel are ignored');
});

test('dictation: denied mic, failed session, provider error and dropped connection all offer typed fallback', async () => {
  const denied = harness({ mic: async () => { throw new VoiceError('mic_denied'); } });
  await denied.dictation.start();
  assert.deepEqual([denied.dictation.current.state, denied.dictation.current.error], ['error', 'mic_denied']);
  assert.equal(denied.sockets.length, 0);

  const unauth = harness({ getSession: async () => { throw Object.assign(new Error('x'), { status: 401 }); } });
  await unauth.dictation.start();
  assert.equal(unauth.dictation.current.error, 'unauthenticated');

  const provider = harness();
  await provider.dictation.start();
  provider.sockets[0].open();
  provider.sockets[0].emit({ type: 'error', message: 'synthetic', status_code: 429 });
  assert.deepEqual([provider.dictation.current.state, provider.dictation.current.error], ['error', 'rate_limited']);
  assert.equal(provider.micStopped(), 1);

  const dropped = harness();
  await dropped.dictation.start();
  dropped.sockets[0].open();
  dropped.sockets[0].emit({ type: 'turn.end', request_id: 'r', transcript: 'kept text' });
  dropped.sockets[0].serverClose(1006);
  assert.deepEqual([dropped.dictation.current.error, dropped.dictation.current.transcript], ['network', 'kept text']);
});

test('speak: browser TTS request uses the scoped token, save=false, and stop() interrupts playback', async () => {
  const requests = [];
  let played = null;
  const fakeFetch = async (url, init) => { requests.push({ url, init }); return new Response(new Uint8Array([1, 2, 3])); };
  const play = (wav, signal) => new Promise(resolve => { played = wav.byteLength; signal.addEventListener('abort', resolve); });
  const handle = speak(session, 'SYNTHETIC reply', { fetch: fakeFetch, play });
  await tick(); await tick();
  assert.equal(played, 3);
  const [{ url, init }] = requests;
  assert.equal(url, 'https://api.cartesia.ai/tts/bytes');
  assert.equal(init.headers.authorization, `Bearer ${session.accessToken}`);
  const body = JSON.parse(init.body);
  assert.equal(body.save, false);
  assert.deepEqual(body.voice, { mode: 'id', id: session.ttsVoiceId });
  handle.stop();
  await handle.done;
  const failed = speak(session, 'x', { fetch: async () => new Response('', { status: 401 }), play });
  await assert.rejects(failed.done, (e) => e instanceof VoiceError && e.code === 'unauthenticated');
});
