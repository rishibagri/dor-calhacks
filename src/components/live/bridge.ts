/**
 * Live bridge (CS seam, D051 proposal): drives the Claude Design room (public/live, built by scripts/build-live-ui.mjs)
 * from the real backend. The design keeps its own look and animation; this replaces its sample data with caller-filtered
 * views and its buttons with the same guarded port calls and pure models the room UI uses. Nothing here decides
 * authorization: every write goes through SharedStatePort, and the reducers re-check it.
 *
 * The design component is a plain class instance (`inst`): its sample tables are instance fields, its handlers are
 * arrow-function fields and `renderVals()` builds every template value, so each is replaced on the instance.
 */
import { NUDGE_TEMPLATE_COPY, DEFAULT_RECIPIENT_DELIVERY, type PrivateAssessment, type SignalCandidate } from '@dor/contracts';
import { talkingPointText } from '@dor/contracts/policy';
import type { PairView, ReducerResult, SharedStatePort, ReflectionPort } from '@/lib/backend/ports';
import { reasonLive, type LiveContext, type LivePerson, type ModelReasoning } from '@/reasoning/runtime/live';
import { applyMemoryUpdate, memoryForModel, readMemory, saveMemory, type MemoryItem, type MemoryStore } from '@/reasoning/runtime/memory';
import { fallbackPicks, rankCandidates, type SuggestionItem, type SuggestionPick } from '@/reasoning/runtime/suggestions';
import { ACTION_SUPPORT_MODES, ACTION_SURFACE, type CandidateAction } from '@/reasoning/core/vocabulary';
import type { ReasoningDecision } from '@/reasoning/core/types';
import { prepareShare, requestIdFor, shareRecipients, describeNotReady, type ApprovalDraft } from '@/components/feature/share-review-model';
import { pauseFor, pauseVersion, isPauseInForce } from '@/components/feature/pause-model';
import { readPref, sessionStore, writePref, TRANSITIONS, type TransitionId } from '@/components/feature/transition-model';
import { exclusionMatches, nameMatches, requiresImmediateSupport } from '@/features/voice/assessment';
import { splitReflection, textToReflect, reflectFailureCopy, voiceFailureCopy } from '@/features/voice/model';
import { isIntentActive, nextIntentVersion } from '@/components/feature/events-model';
import { areaLabel, DISCOVERY_TAGS, LAUNCH_AREAS } from '@/lib/discovery/config';
import { captureAreaOnce } from '@/lib/discovery/area';
import { checkProfileDraft, discoverStage, newIntroductionRequestId, publicationExpiry } from '@/components/feature/discover-model';
import { knownThrough, type FofCard } from '@/lib/network/types';
import type { CatalogueEventView, CataloguePlaceView, DiscoveryCardRow } from '@/lib/backend/ports';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Inst = any;

export interface BridgeDeps {
  shared: SharedStatePort;
  reflection: ReflectionPort;
  signedIn: boolean;
  /** Clerk first name (or username) used to register the dor account once. */
  accountName: string | null;
  openSignIn(): void;
  signOut(): Promise<void>;
  /** Cartesia dictation owned by the host page (mic permission lives there). */
  voice: {
    start(): Promise<void>; stop(): Promise<string>; cancel(): void; partial: string;
    /** Call synchronously inside a tap so later read-aloud can play on phones. */
    unlock(): void;
    /** Cartesia read-aloud of dor's own words (never the journal). */
    say(text: string): Promise<{ stop(): void; done: Promise<void> }>;
  };
}

/** The design's book/postcard palette, assigned to real people by a stable index. */
const PALETTE = [
  { spine: '#D98B80', wash: '#F2A7B8', shade: '#A3455D' },
  { spine: '#DDB65C', wash: '#F6D77A', shade: '#7E6210' },
  { spine: '#9FC3AE', wash: '#A8DCC4', shade: '#2F6B52' },
  { spine: '#B7A7CF', wash: '#C3B1E1', shade: '#5E4B85' },
  { spine: '#E2A47C', wash: '#F7B98B', shade: '#9A5524' },
  { spine: '#A9BB7C', wash: '#F6D77A', shade: '#7E6210' },
];
const SLOTS = [{ x: 66, tilt: -3, h: 170, w: 44 }, { x: 122, tilt: 1.5, h: 156, w: 50 }, { x: 184, tilt: 6, h: 176, w: 40 },
  { x: 230, tilt: -2, h: 182, w: 46 }, { x: 276, tilt: 3, h: 164, w: 42 }, { x: 320, tilt: -1, h: 172, w: 48 }];

// Design chapter labels ↔ the local-only transition preference (D045; never sent anywhere).
const CHAPTER_OF: Record<TransitionId, string> = { college: 'Starting college', 'new-city': 'New city', 'new-job': 'New job', graduating: 'Just graduated' };
const TRANSITION_OF: Record<string, TransitionId> = Object.fromEntries(Object.entries(CHAPTER_OF).map(([k, v]) => [v, k as TransitionId]));
const PAUSE_MS = 3 * 24 * 60 * 60 * 1000;
const INVITE_KEY = 'dor-live-invite';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const failText = (r: ReducerResult) => (r.ok ? '' : r.message || r.code);
const tagLabel = (slug: string) => slug.replace(/-/g, ' ');
const tagSlug = (label: string) => label.trim().toLowerCase().replace(/\s+/g, '-');
const listTags = (tags: readonly string[]) => tags.map(tagLabel).join(', ');
// The quiz's interest question offers only tags the server publishes (the design's "studying" is not one).
const QUIZ_TAGS = ['board-games', 'hiking', 'coffee', 'live-music', 'cooking', 'running', 'books', 'climbing'].filter((t) => DISCOVERY_TAGS.includes(t));
const SENT_KEY = 'dor-live-sent';
/**
 * D056 cross-entry memory: distilled facts only, on this device (localStorage), keyed by the signed-in account. D058:
 * signing out wipes every account's memory on this device, so a shared or borrowed phone never keeps them.
 */
const MEMORY_KEY = 'dor-reasoning-memory';
function clearAllMemory(): void {
  try {
    for (let n = localStorage.length - 1; n >= 0; n--) {
      const key = localStorage.key(n);
      if (key?.startsWith(`${MEMORY_KEY}:`)) localStorage.removeItem(key);
    }
  } catch { /* storage blocked: nothing was kept */ }
}
function memoryStore(owner: string | null): MemoryStore {
  const key = `${MEMORY_KEY}:${owner ?? 'anon'}`;
  return {
    read: () => { try { return localStorage.getItem(key); } catch { return null; } },
    write: (v) => { try { localStorage.setItem(key, v); } catch { /* storage blocked: memory lasts this session */ } },
  };
}
const PLACE_WHY: Record<CataloguePlaceView['kind'], string> = { food: 'well reviewed · food', coffee: 'well reviewed · coffee', dessert: 'well reviewed · dessert', study: 'good for studying',
  bar: 'well reviewed · drinks', park: 'outdoors nearby', books: 'bookstore nearby', museum: 'museum nearby', fitness: 'move with others', music: 'live music nearby',
  art: 'art nearby', games: 'games nearby' };
const FLYER_SLOTS = [{ l: 14, t: 118, rot: -5, pin: '#F2A7B8' }, { l: 246, t: 196, rot: 4, pin: '#A8DCC4' },
  { l: 26, t: 356, rot: -2, pin: '#C3B1E1' }, { l: 236, t: 392, rot: 3, pin: '#F6D77A' }];

/** What Reasoning left for the owner: a note it will send on "yes" (`send`), or a moment that is theirs (`owner`). */
interface PendingNudge { kind: 'send' | 'owner'; approval: ApprovalDraft | null; pairId: string; name: string; copy: string; question: string; hook: string | null }
/** The last reflection, kept in memory only so a deferred decision can be reassessed from scratch this session. */
interface LastReflection { text: string; candidate: SignalCandidate | null; assessment: PrivateAssessment | null }

const ACTION_WORDS: Partial<Record<CandidateAction, string>> = {
  DIRECT_CHECK_IN: 'a check-in', CASUAL_INVITE: 'a casual invite', SHARED_ACTIVITY: 'a plan together', CELEBRATE: 'a celebration',
  PRACTICAL_HELP: 'some practical help', RECONNECT: 'a low-pressure hello',
};
const REASON_WORDS: Record<string, string> = {
  high_reveal_value: 'this one is yours to share', sensitive_topic: 'that topic is sensitive with them', low_confidence: 'dor isn’t sure',
  unnamed_target: 'you didn’t mention them', no_delivery_path: 'dor can’t send that kind of note yet',
};
/** One sill postcard: a discovery card (`c:`) or a friend-of-friend card (`f:`); the design keys everything by id. */
type SillCard = { id: string; kind: 'discovery'; row: DiscoveryCardRow } | { id: string; kind: 'fof'; row: FofCard };
/** What slid under the door: an incoming introduction or friend-of-friend request. */
interface Envelope { key: string; kind: 'intro' | 'fof'; id: string; name: string; tags: string[]; via: string | null }

export class LiveBridge {
  private inst: Inst | null = null;
  private deps: BridgeDeps | null = null;
  private orig: Record<string, any> = {};
  private registering = false;
  private inviteTried = false;
  private seenNudges = new Set<string>();
  private pending: PendingNudge | null = null;
  private live: Record<string, any> = {};
  private colors = new Map<string, number>();

  update(deps: BridgeDeps) {
    this.deps = deps;
    this.sync();
  }

  attach(inst: Inst) {
    this.inst = inst;
    for (const k of ['renderVals', 'signOut', 'chapterLine', 'pinText']) this.orig[k] = inst[k].bind(inst);
    this.install(inst);
    const pref = readPref(sessionStore());
    const chapter = pref.transition ? CHAPTER_OF[pref.transition] : null;
    // Returning from Clerk's sign-in: continue at the chapter or key step instead of the closed door.
    if (this.deps?.signedIn) inst.setState({ signedIn: true, chapter, doorStep: chapter ? 'key' : 'chapter' });
    else if (chapter) inst.setState({ chapter });
    this.captureInvite();
    this.sync();
  }

  detach() { this.inst = null; }

  private get shared() { return this.deps!.shared; }
  private ownerHex(): string | null {
    const c = this.shared.connection;
    return c.phase === 'connected' ? c.identityHex : null;
  }

  // ---------- handlers installed on the design instance ----------
  private install(i: Inst) {
    const toast = (m: string) => i.toast(m);

    // door: Clerk owns sign-in; the design's sheet and its fake form never collect credentials.
    i.tapTag = () => {
      const s = i.state;
      if (!this.deps?.signedIn) return this.deps?.openSignIn();
      i.setState({ signedIn: true, doorStep: s.chapter ? 'key' : 'chapter' });
    };
    i.signIn = () => this.deps?.openSignIn();
    i.pickChapter = (c: string) => {
      if (i.state.doorStep !== 'chapter') return;
      i.setState({ chapter: c });
      const t = TRANSITION_OF[c];
      const store = sessionStore();
      writePref(store, { ...readPref(store), transition: t ?? null });
      setTimeout(() => i.setState({ doorStep: 'key' }), 1000);
    };
    i.signOut = async () => { clearAllMemory(); this.resetEntry(); await this.orig.signOut(); await this.deps?.signOut(); };
    i.chapterLine = () => `${i.state.chapter || 'New here'} · ${areaLabel(this.shared.myDiscoveryProfile()?.areaKey ?? null) ?? 'Berkeley'}`;
    i.pinText = (k: string) => (k === 'name' ? this.myName() : k === 'chapter' ? i.chapterLine() : this.orig.pinText(k));

    // sample-only scheduled events never fire in live mode.
    i.envArrive = () => {};
    i.addHome = () => {};
    i.planeArrive = () => {
      if (i.state.planeIn) return;
      i.setState({ planeIn: true, planeStep: 0 });
      setTimeout(() => i.anim('planeWorld', [{ transform: 'translate(-150px,-150px) rotate(-12deg) scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 1400, easing: i.EZ.expo }), 30);
      toast('A paper plane flew in through the window.');
    };

    // from-home box: a real invite link instead of packed sample books.
    i.openHomeBox = () => { i.go('boxes'); setTimeout(() => i.openBox('home'), 500); };
    const origOpenBox = i.openBox.bind(i);
    i.openBox = (k: string) => {
      origOpenBox(k);
      if (k === 'home' && this.shared.myInvites().length === 0 && this.ownerHex()) void this.shared.createPairInvite();
    };

    // shelf: real pause (sender-side, D041) and the recipient's own nudge switch (D050).
    i.bookPause = async () => {
      const pairId = i.state.bookOpen; if (!pairId) return;
      const pauses = this.shared.myRecipientPauses();
      const active = isPauseInForce(pauseFor(pauses, pairId), new Date());
      const name = i.person(pairId).name;
      const r = active ? await this.shared.resumeRecipient(pairId, pauseVersion(pauses, pairId))
        : await this.shared.pauseRecipient(pairId, new Date(Date.now() + PAUSE_MS).toISOString(), pauseVersion(pauses, pairId));
      if (!r.ok) return toast(`Couldn’t change that: ${failText(r)}`);
      i.log(pairId, active ? { k: 'pause', t: 'Resumed', note: 'nudges can go to them again' } : { k: 'pause', t: `Paused ${name}`, note: 'for 3 days · only you see this' });
      toast(active ? 'Resumed.' : `${name} is paused for 3 days. Only you see this.`);
    };
    i.bookRule = async () => {
      const pairId = i.state.bookOpen; if (!pairId) return;
      const on = this.deliveryOn(pairId);
      const cur = this.shared.myNudgeDelivery().find((d) => d.pairId === pairId);
      const r = await this.shared.setNudgeDelivery({ ...(cur ?? { ...DEFAULT_RECIPIENT_DELIVERY, utcOffsetMinutes: -new Date().getTimezoneOffset() }), pairId, optedIn: !on });
      if (!r.ok) return toast(`Couldn’t change that: ${failText(r)}`);
      toast(on ? `Notes from ${i.person(pairId).name} are off. They aren’t told.` : `Notes from ${i.person(pairId).name} are back on.`);
    };
    i.bookPlan = () => toast('Plans start from an event you both marked at the window.');

    // notebook: tap to talk, tap again to stop. Nothing leaves the page until the writer taps Send; "Keep talking" asks
    // one follow-up question, read aloud, so they can say more first.
    i.micTap = async () => {
      const s = i.state, voice = this.deps?.voice;
      if (!voice || s.nbMode === 'transcribing') return;
      if (s.nbMode === 'recording') {
        clearInterval(i.recT);
        i.setState({ nbMode: 'transcribing' });
        let text = '';
        try { text = await voice.stop(); } catch { /* reported below */ }
        const nbText = [i.state.nbText, text].filter((t: string) => t && t.trim()).join(' ').trim();
        i.setState((st: any) => ({ nbMode: nbText ? 'review' : 'idle', nbText, nbEditing: false, wordsKey: st.wordsKey + 1 }));
        this.scrollWords();
        if (!text) toast('I didn’t catch that. Try again, or write instead.');
        return;
      }
      this.stopSpeaking();
      i.setState({ nbMode: 'recording', nbSecs: 0, nbEditing: false, margin: null });
      clearInterval(i.recT);
      i.recT = setInterval(() => i.setState((st: any) => ({ nbSecs: st.nbSecs + 1 })), 1000);
      try { await voice.start(); } catch (e) {
        clearInterval(i.recT);
        i.setState({ nbMode: i.state.nbText ? 'review' : 'idle' });
        toast(voiceFailureCopy(e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'unavailable'));
      }
    };

    // window: real public events; "show my interest" is an event intent others nearby can match on (D039).
    i.confirmShare = async () => {
      const id = i.state.flyerOpen, ev = this.events.find((e) => e.eventId === id); if (!ev) return;
      const row = this.shared.myEventIntents().find((x) => x.eventId === id) ?? null;
      i.setState({ flyerStep: null });
      const r = await this.shared.publishEventIntent(id, 'interested', nextIntentVersion(row));
      toast(r.ok ? 'Shown nearby. It can now be a shared reason.' : `Couldn’t show it: ${failText(r)}`);
    };
    i.shareInterest = async () => {
      const id = i.state.flyerOpen;
      if (String(id).startsWith('p:')) return toast('Places are suggestions only. Showing interest works for events.');
      if (!i.state.shared[id]) return i.setState({ flyerStep: 'share' });
      const r = await this.shared.revokeEventIntent(id);
      toast(r.ok ? 'Withdrawn. It’s gone from your postcard everywhere.' : `Couldn’t withdraw: ${failText(r)}`);
    };

    // drawer: the same controls, with D050 wording and real resume/withdraw.
    const origDrawer = i.drawerItemsList.bind(i);
    i.drawerItemsList = () => {
      const o = origDrawer();
      const pauses = this.shared.myRecipientPauses().filter((p) => isPauseInForce(p, new Date()));
      const intents = this.shared.myEventIntents().filter((x) => isIntentActive(x, Date.now()));
      o.ribbons = { ...o.ribbons, title: 'Notes to your people are automatic', status: 'dor’s agents decide; turn notes off per person on their book', action: '', tap: () => {} };
      o.pencil = { ...o.pencil, title: pauses.length ? pauses.map((p) => `${this.nameOf(p.pairId)} · until ${shortDate(p.expiresAt)}`).join(', ') : 'No one paused',
        action: pauses.length ? 'Resume all' : '', tap: async () => {
          for (const p of pauses) await this.shared.resumeRecipient(p.pairId, p.version);
          toast('Resumed.');
        } };
      o.folded = { ...o.folded, status: 'silent, both ways · blocks stay in place', action: '', tap: () => {} };
      o.ticket = { ...o.ticket, title: intents.length ? intents.map((x) => this.events.find((e) => e.eventId === x.eventId)?.title ?? 'An event').join(', ') : 'No interest shown',
        action: intents.length ? 'Withdraw' : '', tap: async () => {
          for (const x of intents) await this.shared.revokeEventIntent(x.eventId);
          toast('Withdrawn everywhere.');
        } };
      o.all = ['key', 'sign', 'ribbons', 'pencil', 'folded', 'map', 'ticket', 'index', 'door'].map((k, n) => ({ span: 'auto', ...o[k], rot: n % 2 ? .8 : -.8, d: (.5 + n * .05).toFixed(2) }));
      return o;
    };
    i.nbDone = () => { i.setState((st: any) => ({ nbEditing: false, nbMode: st.nbText.trim() ? 'review' : 'idle' })); this.scrollWords(); };
    // Reasoning asked only because it was unsure: "yes" sends right away (no stamp step); an owner moment sends nothing.
    i.marginYes = () => {
      const p = this.pending; i.setState({ margin: 'done' });
      if (!p) return;
      if (p.kind === 'owner') {
        this.pending = null;
        i.log(p.pairId, { k: 'nudge', t: `You’ll tell ${p.name} yourself`, note: 'dor kept this moment for you · nothing was sent' });
        return toast(`It’s yours to tell. Nothing was sent to ${p.name}.`);
      }
      void this.send(false);
    };
    i.marginSkip = () => { this.pending = null; i.setState({ margin: 'done' }); toast('Okay. Nothing will happen.'); };
    i.stampIt = () => this.send(false);

    // tray: the recipient's real nudge (my_nudges); "done" dismisses it, the off switch is their own delivery setting.
    i.planeDone = async () => {
      const n = this.shared.myNudges()[0];
      i.setState({ planeIn: false, planeStep: 0 });
      if (n) { this.seenNudges.add(n.id); await this.shared.dismissNudge(n.id); }
      toast('Noted. The plane is folded away.');
    };
    i.planePause = async () => {
      const n = this.shared.myNudges()[0];
      i.setState({ planeIn: false, planeStep: 0 });
      if (!n) return;
      this.seenNudges.add(n.id);
      const cur = this.shared.myNudgeDelivery().find((d) => d.pairId === n.pairId);
      await this.shared.setNudgeDelivery({ ...(cur ?? { ...DEFAULT_RECIPIENT_DELIVERY, utcOffsetMinutes: -new Date().getTimezoneOffset() }), pairId: n.pairId, optedIn: false });
      await this.shared.dismissNudge(n.id);
      toast(`Notes from ${this.nameOf(n.pairId)} are off. They aren’t told.`);
    };

    // area box: one coarse area key (D045); coordinates are coarsened on the device and never sent.
    const setArea = async (key: string) => {
      const r = await this.shared.setDiscoveryArea(key);
      if (!r.ok) return toast(`Couldn’t set your area: ${failText(r)}`);
      i.setState({ areaName: areaLabel(key), areaPicking: false });
    };
    this.setArea = setArea;
    i.useLocation = async () => {
      toast('Checking roughly where you are, once…');
      const c = await captureAreaOnce();
      if (c.kind === 'area') return setArea(c.areaKey);
      i.setState({ areaPicking: true });
      toast(c.kind === 'outside' ? 'You’re outside the launch areas. Pick the closest one.' : 'Location isn’t available. Pick an area instead.');
    };
    i.QS = i.QS.map((q: any) => (q.key === 'interests' ? { ...q, opts: QUIZ_TAGS.map(tagLabel) } : q));

    // pinboard: the postcard is exactly the published discovery profile (name + interests); the sign publishes/withdraws.
    i.publish = async () => {
      const me = this.shared.myDiscoveryProfile();
      i.setState({ signStep: null });
      if (!me?.discoveryEnabled) return toast('Seeing people nearby is switched off right now.');
      if (!me.areaActive) { toast('Unpack the area box first, so people nearby can find you.'); return; }
      const interestTags = this.pinnedTags();
      const expiresAt = publicationExpiry(Date.now(), 7);
      const check = checkProfileDraft({ displayName: this.myName(), interestTags }, expiresAt, Date.now());
      if (!check.ok) return toast(check.message);
      const r = await this.shared.publishDiscoveryProfile({ displayName: this.myName(), interestTags, expiresAt, expectedRevision: me.revision });
      if (!r.ok) return toast(`Couldn’t put it up: ${failText(r)}`);
      toast('Visible nearby for 7 days. Light from the window falls on your board.');
    };
    i.signTap = async () => {
      if (!i.state.visible) return i.setState({ signStep: 'preview' });
      const r = await this.shared.withdrawDiscoveryProfile();
      toast(r.ok ? 'Taken down. Your postcard left every sill at once.' : `Couldn’t take it down: ${failText(r)}`);
    };

    // sill: real postcards; an introduction is a request only, the other person decides (D038/D045).
    i.sendIntro = async () => {
      const id = i.state.cardOpen, card = this.cards.find((c) => c.id === id);
      if (!card) return;
      i.setState({ sealing: true, introStep: null });
      navigator.vibrate?.(10);
      const r = card.kind === 'discovery'
        ? await this.shared.sendIntroductionRequest(card.row.cardRef, newIntroductionRequestId())
        : await this.shared.sendNudgeRequest(card.row.candidateRef, `would like to ${(i.state.introReason || 'say hello').toLowerCase()}`);
      await i.anim('cardBig', [{ transform: 'none', opacity: 1 }, { transform: 'translate(0,-20px) scale(.92)', opacity: 1, offset: .25 }, { transform: 'translate(170px,-520px) scale(.25) rotate(-22deg)', opacity: 0 }], { duration: 900, easing: i.EZ.exit, fill: 'forwards' });
      i.setState({ cardOpen: null, sealing: false });
      if (!r.ok) return toast(`It didn’t go out: ${failText(r)}`);
      this.markSent(id, true);
      toast('Introduction sent. It flew out the window. They decide.');
    };
    i.recall = async () => {
      const id = i.state.cardOpen, card = this.cards.find((c) => c.id === id);
      if (!card) return;
      let r: ReducerResult | null = null;
      if (card.kind === 'discovery') {
        const intro = this.shared.myIntroductions().find((x) => x.direction === 'outgoing' && x.status === 'pending' && x.counterpartName === card.row.displayName);
        if (intro) r = await this.shared.cancelIntroductionRequest(intro.introId);
      } else {
        const req = this.shared.myNudgeRequests().find((x) => x.direction === 'outgoing' && x.status === 'pending' && x.viaName === card.row.viaName);
        if (req) r = await this.shared.cancelNudgeRequest(req.requestId);
      }
      if (r && !r.ok) return toast(`Couldn’t recall it: ${failText(r)}`);
      this.markSent(id, false);
      toast('Recalled. Nothing was shown.');
    };
    i.blockCard = async () => {
      const id = i.state.cardOpen, card = this.cards.find((c) => c.id === id);
      i.setState((s: any) => ({ blocked: [...s.blocked, id], cardOpen: null }));
      if (card?.kind === 'discovery') {
        const r = await this.shared.blockDiscoveryUser(card.row.cardRef);
        if (!r.ok) return toast(`Couldn’t block: ${failText(r)}`);
      }
      toast('Blocked. You’re gone from each other’s rooms. They aren’t told.');
    };

    // mat: the recipient's own accept/decline; declining is silent.
    i.openEnv = () => i.setState({ envOpened: true });
    i.acceptEnv = async () => {
      const e = this.env; if (!e) return;
      await i.anim('matEnv', [{ transform: 'none', opacity: 1 }, { transform: 'translate(-240px,-260px) scale(.3) rotate(-20deg)', opacity: 0 }], { duration: 750, easing: i.EZ.exit, fill: 'forwards' });
      const r = e.kind === 'intro' ? await this.shared.respondIntroductionRequest(e.id, true) : await this.shared.respondNudgeRequest(e.id, true);
      this.seenEnv.add(e.key);
      i.setState({ envelope: false });
      if (!r.ok) return toast(`Couldn’t accept: ${failText(r)}`);
      toast(e.kind === 'fof' ? `Accepted. ${e.name} is on your shelf.` : `Accepted. ${e.name} is a loose page on your shelf, under new here.`);
      setTimeout(() => i.go('shelf'), 250);
    };
    i.declineEnv = async () => {
      const e = this.env; if (!e) return;
      await i.anim('matEnv', [{ transform: 'none', opacity: 1 }, { transform: 'translateY(120px)', opacity: 0 }], { duration: 450, easing: i.EZ.exit, fill: 'forwards' });
      const r = e.kind === 'intro' ? await this.shared.respondIntroductionRequest(e.id, false) : await this.shared.respondNudgeRequest(e.id, false);
      this.seenEnv.add(e.key);
      i.setState({ envelope: false });
      toast(r.ok ? `Done. ${e.name} won’t be told.` : `Couldn’t answer: ${failText(r)}`);
    };

    i.renderVals = () => this.renderVals(i);
  }

  private setArea: ((key: string) => Promise<void>) | null = null;
  private cards: SillCard[] = [];
  private events: CatalogueEventView[] = [];
  private places: CataloguePlaceView[] = [];
  /** D057 "for you" picks over the catalogue, refreshed when interests or the catalogue change. Memory only. */
  private picks: SuggestionPick[] = [];
  private picksKey = '';
  private picksBusy = false;
  private env: Envelope | null = null;
  private seenEnv = new Set<string>();
  private pinsSeeded = false;

  private pinnedTags(): string[] {
    const pins: string[] = this.inst?.state.pins ?? [];
    return [...new Set(pins.filter((k) => k.startsWith('i:')).map((k) => tagSlug(k.slice(2))).filter((t) => DISCOVERY_TAGS.includes(t)))];
  }
  private sentMap(): Record<string, boolean> {
    try { return JSON.parse(sessionStorage.getItem(SENT_KEY) || '{}'); } catch { return {}; }
  }
  private markSent(id: string, on: boolean) {
    const m = this.sentMap(); if (on) m[id] = true; else delete m[id];
    try { sessionStorage.setItem(SENT_KEY, JSON.stringify(m)); } catch { /* session only */ }
    this.inst?.setState((s: any) => ({ sent: { ...s.sent, [id]: on } }));
  }

  // ---------- conversation: send, keep talking, start over ----------
  /**
   * dor's questions in this entry, each placed after the writer's words so far (`at` = length of nbText when asked), so
   * the page reads as a conversation. Memory only; cleared on send, reset, sign-out or reload. Only the writer's own
   * words (nbText) are ever sent for reflection.
   */
  private asks: { at: number; q: string }[] = [];
  private speaking: { stop(): void } | null = null;
  private conversing = false;

  private stopSpeaking() { this.speaking?.stop(); this.speaking = null; }

  /** Keeps the newest words in view: the right page scrolls instead of running off the book. */
  private scrollWords() {
    requestAnimationFrame(() => {
      const el = this.inst && (document.querySelector('iframe') as HTMLIFrameElement | null)?.contentDocument?.querySelector('[data-nbscroll]');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private sendEntry() {
    const i = this.inst; if (!i) return;
    this.stopSpeaking();
    if (i.state.justMe) return i.toast('Just for me is on: nothing was read or sent.');
    this.asks = [];
    this.live = { ...this.live, nbAsk: '' };
    void this.reflect();
  }

  private async keepTalking() {
    const i = this.inst; const d = this.deps; if (!i || !d || this.conversing) return;
    const text: string = (i.state.nbText ?? '').trim();
    if (!text) return i.toast('Say or write something first.');
    if (i.state.justMe) return i.toast('Just for me is on, so dor won’t reply. Turn it off to keep talking.');
    d.voice.unlock(); // inside the tap, before any network wait
    if (requiresImmediateSupport(text)) { this.live = { ...this.live, support: true }; return i.forceUpdate(); }
    this.conversing = true;
    this.live = { ...this.live, nbAsking: true };
    i.forceUpdate();
    let question = '';
    try {
      const res = await fetch('/api/journal/followup', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry: text.slice(-8000), asked: this.asks.map((a) => a.q).slice(-8) }) });
      const out = res.ok ? await res.json() as { question?: string; distress?: boolean } : null;
      if (out?.distress) { this.live = { ...this.live, support: true, nbAsking: false }; this.conversing = false; return i.forceUpdate(); }
      question = out?.question ?? '';
    } catch { /* reported below */ }
    this.live = { ...this.live, nbAsking: false };
    this.conversing = false;
    if (!question) { i.forceUpdate(); return i.toast('dor couldn’t think of a question just now. Keep going, or send it.'); }
    this.asks.push({ at: (i.state.nbText ?? '').length, q: question });
    this.live = { ...this.live, nbAsk: question };
    i.forceUpdate();
    this.scrollWords();
    try {
      const s = await d.voice.say(question);
      this.speaking = s;
      await s.done;
    } catch { /* the question stays on the page even if read-aloud fails */ }
    this.speaking = null;
  }

  private resetEntry() {
    const i = this.inst; if (!i) return;
    this.deps?.voice.cancel();
    this.stopSpeaking();
    clearInterval(i.recT);
    if (this.reassessTimer) { clearTimeout(this.reassessTimer); this.reassessTimer = null; }
    this.pending = null;
    this.last = null;
    this.asks = [];
    this.live = { ...this.live, nbAsk: '', nbAsking: false, thinking: false };
    i.setState((st: any) => ({ nbMode: 'idle', nbText: '', nbEditing: false, nbSecs: 0, margin: null, nudge: null, wordsKey: st.wordsKey + 1 }));
    i.toast('Cleared. Nothing was saved or sent.');
  }

  // ---------- reflection → Reasoning (D052) → act / ask / defer / abstain ----------
  private last: LastReflection | null = null;
  private reassessTimer: ReturnType<typeof setTimeout> | null = null;

  private async reflect() {
    const i = this.inst; if (!i || !this.deps) return;
    const text: string = i.state.nbText ?? '';
    this.pending = null;
    if (this.reassessTimer) { clearTimeout(this.reassessTimer); this.reassessTimer = null; }
    if (i.state.justMe || !text.trim()) return;
    const input = textToReflect(text);
    if (!input.ok) return i.toast(input.reason === 'too_long' ? 'That entry is too long to reflect on.' : 'Write something first.');
    this.live = { ...this.live, thinking: true };
    i.setState({ margin: null });
    i.toast('Claude is reading it, privately…');
    try {
      const reply = await this.deps.reflection.reflect(input.text, crypto.randomUUID());
      const { memoryOnly, assessment: modelAssessment } = splitReflection(reply);
      const support = requiresImmediateSupport(input.text);
      const assessment: PrivateAssessment | undefined = support
        ? { intent: 'wants_space', risk: 'urgent_support', mentionedNames: [], excludedNames: [], preferredNames: [] } : modelAssessment;
      if (assessment?.risk === 'urgent_support') { this.live = { ...this.live, support: true }; i.setState({ margin: 'done' }); return; }
      this.last = { text: input.text, candidate: support ? null : memoryOnly, assessment: assessment ?? null };
      await this.decideAndAct(false);
    } catch (e) {
      i.toast(reflectFailureCopy(e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'unavailable'));
    } finally {
      this.live = { ...this.live, thinking: false };
      i.forceUpdate();
    }
  }

  /** People as the owner's device sees them. Names are matched here and never sent; the model gets refs and flags. */
  private livePeople(a: PrivateAssessment | null): (LivePerson & { name: string })[] {
    const now = new Date();
    const pairs = shareRecipients(this.shared.myPairs());
    const hasExclusion = (a?.excludedNames.length ?? 0) > 0;
    const said = a ? [...a.mentionedNames, ...a.preferredNames] : [];
    return pairs.filter((p) => !(hasExclusion && p.unnamed)).map((p) => {
      const literal = p.unnamed ? undefined : said.find((n) => nameMatches(n, p.name) && pairs.filter((q) => nameMatches(n, q.name)).length === 1);
      return {
        ref: p.pairId, name: p.name, mentionedAs: literal ?? null,
        excluded: !p.unnamed && (a?.excludedNames.some((n) => exclusionMatches(n, p.name)) ?? false),
        paused: isPauseInForce(pauseFor(this.shared.myRecipientPauses(), p.pairId), now),
        presetRevoked: false,
      };
    });
  }

  /** The model port: one Claude call through /api/reasoning; null on any failure (the runtime then falls back). */
  private modelPort(text: string, memory: readonly MemoryItem[]) {
    return async (req: { people: { ref: string; mentionedAs: string | null; excluded: boolean; paused: boolean }[] }): Promise<ModelReasoning | null> => {
      const res = await fetch('/api/reasoning', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, localTime: new Date().toString().slice(0, 33), people: req.people, memory: memoryForModel(memory, new Date()) }) });
      if (!res.ok) return null;
      const out = await res.json() as ModelReasoning;
      return out && out.situation && Array.isArray(out.proposals) ? out : null;
    };
  }

  private async decideAndAct(reassessing: boolean) {
    const i = this.inst; const last = this.last; if (!i || !last) return;
    const people = this.livePeople(last.assessment);
    const store = memoryStore(this.ownerHex());
    const now = new Date();
    const memory = readMemory(store, now);
    const ctx: LiveContext = { now: now.toISOString(), episodeId: `ep-${crypto.randomUUID()}`, candidate: last.candidate,
      assessment: last.assessment, people: people.map(({ name: _n, ...p }) => p), memoryIds: memory.map((m) => m.id) };
    const { decision, actions, memory: update, source } = await reasonLive(ctx, this.modelPort(last.text, memory));
    // D056: remember across entries (on this device only), even when nothing is sent this time.
    if (!reassessing) saveMemory(store, applyMemoryUpdate(memory, update, now, () => crypto.randomUUID().slice(0, 12), new Set(people.map((p) => p.ref))));
    const named = (ref: string | undefined) => (ref ? people.find((p) => p.ref === ref)?.name ?? null : null);
    let outcome: string;
    if (decision.mode === 'act' && actions.length > 0) {
      const results: string[] = [];
      for (const a of actions) results.push(await this.applyDecision(a.decision, named(a.decision.targetRef), reassessing, a.talkingPoint));
      const who = (code: string) => actions.filter((_, n) => results[n] === code).map((a) => named(a.decision.targetRef)).filter(Boolean) as string[];
      const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
      const sent = who('sent'), held = who('scheduled');
      if (sent.length + held.length > 1) {
        this.inst?.toast([sent.length ? `dor nudged ${list(sent)} to reach out` : '', held.length ? `${sent.length ? 'and will nudge' : 'dor will nudge'} ${list(held)} once you've had some time` : '']
          .filter(Boolean).join(', ') + '.');
      }
      outcome = results.includes('sent') ? 'sent' : results.includes('scheduled') ? 'scheduled' : results[0] ?? 'failed';
    } else {
      outcome = await this.applyDecision(decision, named(decision.targetRef), reassessing, null);
    }
    void this.shared.recordReasoningDecision({
      episodeId: decision.episodeId, pairId: decision.targetRef ?? null, mode: decision.mode, action: decision.action ?? null,
      surface: decision.surface ?? null, reasons: decision.reasons.slice(0, 8),
      rejected: decision.rejected.slice(0, 16).map((r) => `${r.action}:${r.reason}`), reassessAfterMinutes: decision.reassess?.afterMinutes ?? null,
      source, outcome,
    }).catch(() => undefined);
  }

  /** Turns the core's decision into the room's behavior. Returns a content-free outcome code for the decision log. */
  private async applyDecision(d: ReasoningDecision, name: string | null, reassessing: boolean, hook: string | null): Promise<string> {
    const i = this.inst!;
    const why = d.capped ? REASON_WORDS[d.capped.by] : undefined;
    if (d.mode === 'abstain') {
      i.setState({ margin: 'done' });
      if (!reassessing) i.toast('dor looked and decided nothing needs doing. That’s a good outcome.');
      return 'quiet';
    }
    if (d.mode === 'defer' && d.reassess) {
      i.setState({ margin: 'done' });
      const mins = d.reassess.afterMinutes;
      i.toast(`Not the right moment. dor will look again in about ${mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`}, from scratch.`);
      this.reassessTimer = setTimeout(() => { this.reassessTimer = null; void this.decideAndAct(true); }, mins * 60_000);
      return 'deferred';
    }
    if (!d.targetRef || !name || !d.action) {
      i.setState({ margin: 'done' });
      i.toast('dor wasn’t sure who you meant, so it did nothing. You can send a note from their book.');
      return 'quiet';
    }
    // D056: nothing is put to the owner as a question. A moment that must be theirs is noted on the book, quietly.
    if (ACTION_SURFACE[d.action] === 'owner') {
      i.setState({ margin: 'done' });
      i.log(d.targetRef, { k: 'nudge', t: `This one is yours to tell ${name}`, note: 'dor kept this moment for you · nothing was sent' });
      if (!reassessing) i.toast(`This is something ${name} should hear from you. dor didn’t send anything.`);
      return 'owner_note';
    }
    const mode = d.deliveryMapping?.supportMode ?? ACTION_SUPPORT_MODES[d.action]?.[0];
    if (!mode) { i.setState({ margin: 'done' }); return 'quiet'; }
    const pair = this.shared.myPairs().find((p) => p.pairId === d.targetRef);
    const owner = this.ownerHex();
    if (!pair || !owner) { i.setState({ margin: 'done' }); return 'failed'; }
    const prepared = prepareShare({ candidate: { supportMode: mode, availability: this.last?.candidate?.availability ?? 'no_preference' },
      ownerHex: owner, pair, presets: this.shared.myPresets(), assignments: this.shared.myPresetAssignments(), now: new Date() }, name);
    if (prepared.kind !== 'ready') { i.setState({ margin: 'done' }); i.toast(describeNotReady(prepared)); return 'failed'; }
    this.pending = { kind: 'send', approval: prepared.approval, pairId: pair.pairId, name, hook,
      copy: prepared.preview.recipientCopy ?? NUDGE_TEMPLATE_COPY.offer_note,
      question: `want dor to send ${name.toLowerCase()} ${ACTION_WORDS[d.action] ?? 'a note'}?${why ? ` ${why}.` : ''}` };
    // D056: autonomous. An `ask` that still reaches here (older core options) sends too; every gate already passed.
    // D059: the reasoning timed it: bad news is held on the server for `timingDelayMinutes`, anything else goes now.
    const delay = d.timing === 'after_delay' && d.timingDelayMinutes ? d.timingDelayMinutes : 0;
    if (!(await this.send(true, delay))) return 'failed';
    return delay ? 'scheduled' : 'sent';
  }

  /** Approve and hand to dor's agents. `auto` = Reasoning decided on its own (no tap). */
  private async send(auto: boolean, delayMinutes = 0): Promise<boolean> {
    const i = this.inst; const p = this.pending;
    if (!i || !p || p.kind !== 'send' || !p.approval) { i?.setState({ nudge: null }); return false; }
    i.setState({ margin: 'done', nudge: 'stamped', holding: false });
    navigator.vibrate?.(14);
    const requestId = requestIdFor(p.approval, null).id;
    const r = await this.shared.approveSignal({ ...p.approval, clientRequestId: requestId, ...(delayMinutes ? { delayMinutes } : {}) });
    // D056: the friend's nudge says what to bring up. A failed hook never blocks the nudge itself.
    if (r.ok && p.hook) await this.shared.attachSignalHook(requestId, p.hook).catch(() => undefined);
    this.pending = null;
    await i.wait(500);
    await i.anim('nudgeEnv', [{ transform: 'none', opacity: 1 }, { transform: 'translate(0,-16px) rotate(2deg)', opacity: 1, offset: .2 }, { transform: 'translate(90px,-620px) rotate(-16deg) scale(.4)', opacity: 0 }], { duration: 900, easing: i.EZ.exit, fill: 'forwards' });
    i.setState({ nudge: null });
    if (!r.ok) { i.toast(`No nudge was started: ${failText(r)}`); return false; }
    const when = delayMinutes ? `in about ${delayMinutes >= 90 ? `${Math.round(delayMinutes / 60)} h` : `${delayMinutes} min`}` : '';
    i.log(p.pairId, { k: 'nudge', t: delayMinutes ? `dor will nudge ${p.name} ${when}` : auto ? `dor nudged ${p.name} to reach out` : `A note for ${p.name} went to dor’s agents`, q: p.copy,
      note: delayMinutes ? 'held so you have time to process first' : talkingPointText(p.hook) ? `their nudge suggests: “${talkingPointText(p.hook)}”` : 'their agent still checks it fits' });
    i.toast(delayMinutes ? `dor will nudge ${p.name} ${when}, once you've had some time.` : `dor nudged ${p.name} to reach out.`);
    return true;
  }

  // ---------- live data → design state ----------
  private myName(): string {
    return this.shared.myAccount()?.displayName || this.deps?.accountName || 'You';
  }
  private nameOf(pairId: string): string {
    return this.shared.myPairs().find((p) => p.pairId === pairId)?.counterpartDisplayName || 'your connection';
  }
  private deliveryOn(pairId: string): boolean {
    const d = this.shared.myNudgeDelivery().find((x) => x.pairId === pairId);
    return d ? d.optedIn : DEFAULT_RECIPIENT_DELIVERY.optedIn;
  }
  private colorFor(id: string): (typeof PALETTE)[number] {
    if (!this.colors.has(id)) this.colors.set(id, this.colors.size);
    return PALETTE[this.colors.get(id)! % PALETTE.length];
  }

  private captureInvite() {
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('invite');
      if (token) { sessionStorage.setItem(INVITE_KEY, token); url.searchParams.delete('invite'); history.replaceState(null, '', url.toString()); }
    } catch { /* storage blocked: the link can be opened again */ }
  }

  /** Registers the account once, accepts a pending invite link, and pushes every view into the design. */
  sync() {
    const i = this.inst, d = this.deps;
    if (!i || !d) return;
    const shared = d.shared;
    const connected = shared.connection.phase === 'connected';

    if (connected && !shared.myAccount() && !this.registering && d.accountName) {
      this.registering = true;
      void shared.registerAccount(d.accountName.slice(0, 60)).finally(() => { this.registering = false; });
    }
    if (connected && shared.myAccount() && !this.inviteTried) {
      let token: string | null = null;
      try { token = sessionStorage.getItem(INVITE_KEY); } catch { /* none */ }
      if (token) {
        this.inviteTried = true;
        void shared.acceptPairInvite(token).then((r) => {
          try { sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
          i.toast(r.ok ? 'Linked. Their book is on your shelf.' : `That invite didn’t work: ${failText(r)}`);
        });
      }
    }

    const pairs: PairView[] = shared.myPairs().filter((p) => p.status === 'accepted' && p.counterpartIdentityHex);
    const PEOPLE: Record<string, any> = {}, BOXSLOT: Record<string, any> = {}, SINCE: Record<string, string> = {};
    pairs.forEach((p, n) => {
      const slot = SLOTS[n % SLOTS.length];
      PEOPLE[p.pairId] = { ...this.colorFor(p.pairId), name: p.counterpartDisplayName || `Connection ${n + 1}`, rel: 'Connected on dor', w: slot.w, h: slot.h, tilt: slot.tilt };
      BOXSLOT[p.pairId] = { x: slot.x, tilt: slot.tilt, h: slot.h };
      SINCE[p.pairId] = `Paired ${shortDate(p.createdAt)}`;
    });
    const now = new Date();
    const me = shared.myDiscoveryProfile();
    const stage = discoverStage(me, now.getTime());
    const visible = stage === 'ready' || stage === 'needs_area';

    // Sill: discovery cards (most shared interests first, no model) then friend-of-friend cards; the design holds three.
    const discovery: SillCard[] = [...shared.discoveryCards()].sort((a, b) => b.sharedTags.length - a.sharedTags.length)
      .map((row) => ({ id: `c:${row.cardRef}`, kind: 'discovery', row }));
    const fof: SillCard[] = shared.fofCards().filter((c) => c.requestStatus !== 'closed' && c.requestStatus !== 'incoming')
      .map((row) => ({ id: `f:${row.candidateRef}`, kind: 'fof', row }));
    this.cards = [...discovery, ...fof].slice(0, 3);
    const CARDS = this.cards.map((c) => {
      const color = this.colorFor(c.id);
      if (c.kind === 'discovery') {
        PEOPLE[c.id] = { ...color, name: c.row.displayName, rel: 'Nearby' };
        return { id: c.id, name: c.row.displayName, chapter: c.row.sharedTags.length ? `You share ${listTags(c.row.sharedTags)}` : 'Nearby, new here too',
          stamp: 'nearby', wash: color.wash, pins: [c.row.displayName, ...c.row.interestTags.map(tagLabel)], suggest: 'say hello. they decide.' };
      }
      const name = knownThrough(c.row);
      PEOPLE[c.id] = { ...color, name, rel: `Through ${c.row.viaName}` };
      return { id: c.id, name, chapter: c.row.sharedTags.length ? `You share ${listTags(c.row.sharedTags)}` : 'Nearby',
        stamp: `via ${c.row.viaName.toLowerCase()}`, wash: color.wash, pins: [name, ...c.row.sharedTags.map(tagLabel)],
        suggest: `meet through ${c.row.viaName}. they decide.` };
    });
    const sent: Record<string, boolean> = { ...this.sentMap() };
    for (const c of this.cards) if (c.kind === 'fof' && c.row.requestStatus === 'pending') sent[c.id] = true;

    // Accepted introductions (no pair) are loose pages under "new here".
    const loose = shared.myIntroductions().filter((x) => x.status === 'accepted').map((x) => {
      const id = `i:${x.introId}`;
      PEOPLE[id] = { ...this.colorFor(id), name: x.counterpartName || 'Someone new', rel: 'Met through dor' };
      return { id, how: x.sharedTags.length ? tagLabel(x.sharedTags[0]) : 'say hello' };
    });

    // Door mat: the first incoming request still waiting for this person's answer.
    const intro = shared.myIntroductions().find((x) => x.direction === 'incoming' && x.status === 'pending');
    const req = shared.myNudgeRequests().find((x) => x.direction === 'incoming' && x.status === 'pending');
    this.env = intro ? { key: `i:${intro.introId}`, kind: 'intro', id: intro.introId, name: intro.counterpartName || 'Someone nearby', tags: intro.sharedTags, via: null }
      : req ? { key: `r:${req.requestId}`, kind: 'fof', id: req.requestId, name: req.counterpartName || 'Someone nearby', tags: req.sharedTags, via: req.viaName } : null;
    // Window: upcoming public events (Apify-ingested, D039) in this person's area first; the design pins four flyers.
    const myArea = me?.areaActive ? me.areaKey : null;
    const allEvents = shared.catalogueEvents().filter((e) => Date.parse(e.startsAt) > now.getTime())
      .sort((a, b) => Number(b.areaKey === myArea) - Number(a.areaKey === myArea) || a.startsAt.localeCompare(b.startsAt));
    // Places (D051 proposal): the viewer's area first, then rating weighted by how many people reviewed it. No model.
    const score = (p: CataloguePlaceView) => p.rating * Math.log10(10 + p.reviewCount);
    const allPlaces = shared.cataloguePlaces().filter((p) => !myArea || p.areaKey === myArea).sort((a, b) => score(b) - score(a));
    // D057: when "for you" picks exist they choose the four flyers, in pick order; otherwise two events and two places.
    this.maybeSuggest(me, myArea, now);
    const pickWhy = new Map(this.picks.map((p) => [p.id, p.why]));
    const pickedEvents = shared.catalogueEvents().filter((e) => pickWhy.has(e.eventId) && Date.parse(e.startsAt) > now.getTime());
    const pickedPlaces = shared.cataloguePlaces().filter((p) => pickWhy.has(`p:${p.placeId}`));
    if (pickedEvents.length + pickedPlaces.length > 0) {
      const order = (id: string) => this.picks.findIndex((p) => p.id === id);
      const chosen = [...pickedEvents.map((e) => ({ id: e.eventId, e })), ...pickedPlaces.map((pl) => ({ id: `p:${pl.placeId}`, pl }))]
        .sort((a, b) => order(a.id) - order(b.id)).slice(0, 4);
      this.events = chosen.flatMap((c) => ('e' in c && c.e ? [c.e] : []));
      this.places = chosen.flatMap((c) => ('pl' in c && c.pl ? [c.pl] : []));
    } else {
      const nPlaces = Math.min(allPlaces.length, Math.max(2, 4 - allEvents.length));
      this.places = allPlaces.slice(0, nPlaces);
      this.events = allEvents.slice(0, 4 - this.places.length);
    }
    const placeFly = this.places.map((p, n) => ({ id: `p:${p.placeId}`, title: p.name, day: `★ ${p.rating.toFixed(1)} · ${p.reviewCount.toLocaleString()} reviews`,
      time: p.label || tagLabel(p.kind), area: areaLabel(p.areaKey) ?? 'Nearby', src: 'Google Maps', why: pickWhy.get(`p:${p.placeId}`) ?? PLACE_WHY[p.kind],
      ...FLYER_SLOTS[this.events.length + n], sample: false }));
    const FLY = [...this.events.map((e, n) => {
      const at = new Date(e.startsAt), pos = FLYER_SLOTS[n];
      const host = e.sourceUrl ? new URL(e.sourceUrl).hostname.replace(/^www\./, '') : 'source';
      return { id: e.eventId, title: e.title, day: at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        time: at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), area: areaLabel(e.areaKey) ?? 'Nearby',
        src: /lu\.?ma/.test(host) ? 'Luma' : host === 'source' ? 'Google' : host,
        why: pickWhy.get(e.eventId) ?? (e.topics.length ? e.topics.map(tagLabel).join(' · ') : 'nearby'), ...pos, sample: false };
    }), ...placeFly];
    const sharedEvents = Object.fromEntries(shared.myEventIntents().filter((x) => isIntentActive(x, now.getTime())).map((x) => [x.eventId, true]));
    Object.assign(i, { PEOPLE, BOXSLOT, SINCE, HIST: {}, PHOTOS: {}, HOME: [], CARDS, FLY, PLANS: [] });

    // The pinboard starts from what is actually published.
    if (!this.pinsSeeded && me) {
      this.pinsSeeded = true;
      if (me.interestTags.length) i.setState({ pins: ['name', 'chapter', ...me.interestTags.map((t) => `i:${tagLabel(t)}`)] });
    }
    const paused: Record<string, boolean> = {};
    for (const p of pairs) paused[p.pairId] = isPauseInForce(pauseFor(shared.myRecipientPauses(), p.pairId), now);

    const nudges = shared.myNudges();
    const first = nudges[0];
    this.live = {
      ...this.live,
      myName: this.myName(),
      plate: this.myName().toLowerCase(),
      planeText: first ? [NUDGE_TEMPLATE_COPY[first.templateId], talkingPointText(first.hook)].filter(Boolean).join(' ') : '',
      planeName: first ? this.nameOf(first.pairId) : '',
      planeWho: first ? this.nameOf(first.pairId).toLowerCase() : '',
      nudgeName: this.pending?.name ?? '',
      nudgeText: this.pending?.copy ?? '',
      nudgeHelp: this.pending ? `This is the kind of note ${this.pending.name} may get. dor’s agents still decide whether it fits.` : '',
      supportClose: () => { this.live = { ...this.live, support: false }; i.forceUpdate(); },
      nbSend: () => this.sendEntry(),
      nbMore: () => void this.keepTalking(),
      nbReset: () => this.resetEntry(),
      feedAge: this.feedAge(),
      // The event's own public page (host-allowlisted at ingest, D039); opened in a new tab, nothing is sent.
      openListing: () => {
        const id = i.state.flyerOpen;
        const url = this.events.find((e) => e.eventId === id)?.sourceUrl ?? this.places.find((p) => `p:${p.placeId}` === id)?.sourceUrl;
        if (url) window.open(url, '_blank', 'noopener'); else i.toast('This listing has no public link.');
      },
      envName: this.env?.name ?? '',
      envLine: this.env ? (this.env.via ? `Through ${this.env.via}` : 'Nearby · new here too') : '',
      envAsk: this.env ? (this.env.kind === 'fof' ? 'would like to meet' : 'would like to say hello') : '',
      envBody: this.env ? `${this.env.name} would like to meet${this.env.via ? `, through ${this.env.via}` : ''}.${this.env.tags.length ? ` You both like ${listTags(this.env.tags)}.` : ''}` : '',
    };

    const areaKey = me?.areaActive ? me.areaKey : null;
    i.setState((s: any) => ({
      homeAdded: pairs.map((p) => p.pairId), homeOk: Object.fromEntries(pairs.map((p) => [p.pairId, true])), paused,
      visible, everPublished: s.everPublished || visible, sent, loose, shared: sharedEvents,
      interested: { ...s.interested, ...sharedEvents },
      accepted: Object.fromEntries(loose.map((l) => [l.id, true])),
      areaName: areaKey ? areaLabel(areaKey) : s.areaName,
      boxes: { ...s.boxes, area: s.boxes.area || !!areaKey },
      ...(nudges.length === 0 && s.planeIn ? { planeIn: false, planeStep: 0 } : {}),
      ...(!this.env && s.envelope ? { envelope: false } : {}),
    }));
    if (i.state.nbMode === 'recording') this.scrollWords(); // live transcript keeps the newest words in view
    if (first && !this.seenNudges.has(first.id) && !i.state.planeIn && !i.state.doorOn) i.planeArrive();
    if (this.env && !this.seenEnv.has(this.env.key) && !i.state.envelope && !i.state.doorOn) {
      this.seenEnv.add(this.env.key);
      i.setState({ envelope: true, envOpened: false });
      i.toast('Something slid under the door.');
      setTimeout(() => i.anim('envWorld', [{ transform: 'translate(0,60px) rotate(-7deg)', opacity: 0 }, { transform: 'rotate(-7deg)', opacity: 1 }], { duration: 900, easing: i.EZ.pop }), 30);
    }
  }

  /**
   * D057: ask for "for you" picks when the person's interests or the catalogue change. The device pre-ranks public
   * catalogue items against their published interests and device-only memory; /api/suggestions picks with reasons; on
   * failure the deterministic ranking is used. Picks live in memory only.
   */
  private maybeSuggest(me: { interestTags: readonly string[] } | null, areaKey: string | null, now: Date) {
    if (this.picksBusy || !this.deps?.signedIn) return;
    const details = new Map(this.shared.catalogueDetails().map((d) => [d.itemId, d]));
    const items: SuggestionItem[] = [
      ...this.shared.catalogueEvents().map((e): SuggestionItem => ({ id: e.eventId, kind: 'event', title: e.title, tags: [...e.topics],
        keywords: details.get(e.eventId)?.keywords ?? [], summary: details.get(e.eventId)?.summary ?? '', areaKey: e.areaKey, startsAt: e.startsAt,
        rating: null, reviews: null, label: details.get(e.eventId)?.venue ?? '' })),
      ...this.shared.cataloguePlaces().map((p): SuggestionItem => ({ id: `p:${p.placeId}`, kind: 'place', title: p.name, tags: [p.kind],
        keywords: details.get(p.placeId)?.keywords ?? [], summary: details.get(p.placeId)?.summary ?? '', areaKey: p.areaKey, startsAt: null,
        rating: p.rating, reviews: p.reviewCount, label: p.label })),
    ];
    if (items.length === 0) return;
    const interests = [...(me?.interestTags ?? []), ...this.pinnedTags()].filter((t, n, a) => a.indexOf(t) === n);
    const memory = readMemory(memoryStore(this.ownerHex()), now).filter((m) => m.kind !== 'feeling').map((m) => m.text).slice(0, 12);
    const ctx = { interests, memory, areaKey, now: now.toISOString() };
    const ranked = rankCandidates(items, ctx);
    const key = `${interests.join(',')}|${memory.length}|${ranked.slice(0, 25).map((r) => r.id).join(',')}`;
    if (key === this.picksKey) return;
    this.picksKey = key;
    this.picksBusy = true;
    void fetch('/api/suggestions', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interests, memory, areaLabel: areaLabel(areaKey), localTime: now.toString().slice(0, 33),
        items: ranked.map((r) => ({ ...r, title: r.title.slice(0, 200), summary: r.summary.slice(0, 300), label: r.label.slice(0, 80) })) }) })
      .then(async (res) => (res.ok ? ((await res.json()) as { picks: SuggestionPick[] }).picks : null))
      .catch(() => null)
      .then((picks) => { this.picks = picks && picks.length ? picks : fallbackPicks(ranked, ctx); })
      .finally(() => { this.picksBusy = false; this.sync(); });
  }

  /** When the newest catalogue feed last succeeded (catalogue_status), so the window never claims freshness it lacks. */
  private feedAge(): string {
    const ok = this.shared.catalogueStatus().map((f) => f.lastSuccessAt).filter((x): x is string => !!x).sort().pop();
    if (!ok) return 'not checked yet';
    const h = Math.max(0, Math.round((Date.now() - Date.parse(ok)) / 3_600_000));
    return h < 1 ? 'checked within the hour' : `checked ${h} h ago`;
  }

  private age(flyerId: string): string {
    const e = this.events.find((x) => x.eventId === flyerId) ?? this.places.find((p) => `p:${p.placeId}` === flyerId);
    if (!e) return 'recently';
    const h = Math.max(0, Math.round((Date.now() - Date.parse(e.fetchedAt)) / 3_600_000));
    return h < 1 ? 'under 1 h' : `${h} h`;
  }

  /** Notebook template values: the words so far (plus what's being said right now), labels for the two-tap mic. */
  private notebookVals(i: Inst, nb: any) {
    const s = i.state;
    const partial = s.nbMode === 'recording' ? (this.deps?.voice.partial ?? '').trim() : '';
    const text: string = s.nbText ?? '';
    const mine = (chunk: string) => chunk.split(/\s+/).filter(Boolean).map((t) => ({ t, c: 'inherit', f: 'inherit' }));
    const dors = (q: string) => q.split(/\s+/).filter(Boolean).map((t) => ({ t, c: '#2F5C91', f: "400 23px/1.2 'Reenie Beanie'" }));
    const tokens: { t: string; c: string; f: string }[] = [];
    let from = 0;
    for (const a of this.asks) {
      const at = Math.min(Math.max(a.at, from), text.length);
      tokens.push(...mine(text.slice(from, at)), ...dors(`dor: ${a.q}`));
      from = at;
    }
    tokens.push(...mine(text.slice(from)), ...mine(partial));
    // Only the newest words animate in, so a long entry doesn't replay its whole history on every update.
    const words = tokens.map((w, n) => ({ ...w, d: Math.max(0, n - tokens.length + 12) * 25 }));
    const stateLabel = this.live.thinking ? 'claude is reading · privately' : this.live.nbAsking ? 'dor is thinking of a question'
      : s.nbMode === 'recording' ? 'listening · tap the mic to stop' : nb.stateLabel;
    const micLabel = s.nbMode === 'recording' ? 'Tap to stop' : s.nbMode === 'transcribing' ? 'One moment'
      : this.live.nbAsk && s.nbMode === 'review' ? 'Tap to answer' : s.nbText ? 'Tap to add more' : 'Tap to speak';
    return { ...nb, marginQ: this.pending?.question ?? '', stateLabel, micLabel, words, showWords: !s.nbEditing && words.length > 0,
      placeholder: !s.nbEditing && words.length === 0 };
  }

  private notebookLive(i: Inst) {
    const s = i.state;
    const busy = this.live.thinking || this.live.nbAsking || s.nbMode === 'recording' || s.nbMode === 'transcribing';
    const hasText = !!(s.nbText ?? '').trim();
    return { ...this.live, nbActions: hasText && !busy && !s.nbEditing, nbAskOn: !!this.live.nbAsk && !this.live.thinking,
      nbCanReset: hasText || !!this.live.nbAsk || s.nbMode === 'recording' };
  }

  private cardReasons(id: string): { t: string }[] {
    const c = this.cards.find((x) => x.id === id);
    if (!c) return [];
    const out = c.row.sharedTags.length ? [{ t: `You both pinned ${listTags(c.row.sharedTags)}` }] : [{ t: 'You’re both new nearby' }];
    if (c.kind === 'fof') out.push({ t: `${c.row.mutualCount > 1 ? `${c.row.mutualCount} people you know` : c.row.viaName} know${c.row.mutualCount > 1 ? '' : 's'} them` });
    return out;
  }

  private renderVals(i: Inst) {
    const v = this.orig.renderVals();
    const s = i.state;
    const invite = this.shared.myInvites()[0] ?? null;
    const link = invite ? `${window.location.origin}/?invite=${encodeURIComponent(invite.inviteToken)}` : null;
    const share = () => {
      if (!link) return i.toast('Making your invite link…');
      const data = { title: 'Come sit in my room on dor', url: link };
      if (navigator.share) void navigator.share(data).catch(() => {});
      else void navigator.clipboard?.writeText(link).then(() => i.toast('Invite link copied. Send it to someone from home.'));
    };
    const book = { name: link ? 'share' : 'invite', aria: 'Invite someone from home', x: 122, w: 50, h: 170, tilt: 0, y: s.boxStage === 'open' ? -60 : 130, d: '.25',
      bg: PALETTE[0].spine, img: i.SPINE, tap: share };
    const bookOpen = s.bookOpen && i.PEOPLE[s.bookOpen];
    const on = bookOpen ? this.deliveryOn(s.bookOpen) : true;
    return {
      ...v,
      boxBooks: [book],
      boxEmpty: false,
      boxHint: link ? 'tap the book to send your invite link · it links your accounts only' : 'making your invite…',
      bo: bookOpen ? { ...v.bo, note: s.paused[s.bookOpen] ? 'paused · 3 days · only you see this' : on ? 'notes from them can reach you' : 'notes from them are off',
        ruleOn: false, ruleLabel: on ? 'Turn off notes from them' : 'Turn notes from them back on' } : v.bo,
      nb: this.notebookVals(i, v.nb),
      live: this.notebookLive(i),
      feedLabel: i.FLY.length ? `events & places · ${i.FLY.length} nearby` : 'events & places',
      flyers: v.flyers.map((f: any) => ({ ...f, stamp: `${f.src} · ${this.age(f.id)}` })),
      fo: v.flyerOpen ? { ...v.fo, stampLong: `from ${v.fo.src} · checked ${this.age(s.flyerOpen)} ago` } : v.fo,
      planeName: this.live.planeName,
      areaOpts: LAUNCH_AREAS.map((a) => ({ label: a.label, tap: () => void this.setArea?.(a.key) })),
      // The postcard preview shows exactly what publishing sends: your name and the interests you pinned.
      previewFields: this.pinnedTags().map((t) => ({ text: tagLabel(t) })),
      chapterLine: 'nearby · your area and chapter aren’t shown',
      signBody: s.visible ? 'People nearby who are also visible see your name and pinned interests. Take it down any time.'
        : 'Pin interests you’d like to share. Only your name and those interests go up, and only when you flip the sign.',
      co: v.cardOpen ? { ...v.co, reasons: this.cardReasons(s.cardOpen) } : v.co,
      intro: { ...v.intro, canAttach: false, attachOn: false, line2: 'would like to say hello.', line3: 'your reason stays with you · they choose whether to meet' },
    };
  }
}
