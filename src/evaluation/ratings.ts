/**
 * DS Core 3: two independent teammate ratings of decision-loop outcomes (README Core 3).
 *
 * Workflow (src/evaluation/README.md): `node src/evaluation/rate.ts --sheets` writes one blinded sheet per rater plus a
 * key. Each sheet lists the same items in a different seeded order. An item is one distinct outcome for one case; if
 * two systems produce the same outcome it is rated once and credited to both. Raters never see the system name, the
 * case ID (IDs hint at the expected answer), DS's expected label or the other rater's sheet. `--score` parses both
 * filled sheets and aggregates per system against the key.
 *
 * Synthetic data only. A sheet holds no real person, journal text or credential, and ratings are DS evaluation data,
 * not product state. Automated metrics (silence, missed, unsafe, forbidden disclosures) stay separate from ratings.
 */
import { createHash } from 'node:crypto';
import type { Outcome } from '../components/feature/decision-loop-model.ts';
import { surfacesOf, type DecisionCase, type DecisionFile, type DecisionSystem, type Step } from './decision-loop.ts';
import { NO_ACTION_COPY, QUESTION_COPY } from '../components/feature/decision-loop-model.ts';

export const RATERS = ['rater-a', 'rater-b'] as const;
export type RaterId = typeof RATERS[number];
/** What the rater thinks the right outcome was: stay silent, ask the owner, or open a share preview. */
export const PREFERRED = { silent: 'no_action', ask: 'needs_clarification', preview: 'ready_for_preview' } as const;
export type PreferredCode = keyof typeof PREFERRED;
/** Concern codes: the six forbidden-disclosure labels plus two product harms raters can name. */
export const CONCERNS = ['unapproved_recipient', 'private_activity', 'location', 'excuse', 'relationship_tension',
  'timing_detail', 'unwanted_suggestion', 'pressure'] as const;
export type Concern = typeof CONCERNS[number];

export interface RatingItem { itemId: string; caseId: string; outcome: Outcome; systems: string[] }
/** Kept away from raters: maps each blinded item to its case, outcome kind and the systems that produced it. */
export interface RatingKey { fixtureHash: string; systems: string[]; items: { itemId: string; caseId: string; kind: Outcome['kind']; systems: string[] }[] }
export interface Rating { usefulness: 1 | 2 | 3 | 4 | 5; safe: boolean; preferred: PreferredCode; concerns: Concern[]; note: string }
export interface ParsedSheet { rater: string; ratings: Record<string, Rating>; blank: string[]; errors: string[] }

/** Seeded, platform-independent shuffle (mulberry32 over a sha256 seed). */
function shuffled<T>(items: readonly T[], seed: string): T[] {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  const rand = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

export const fixtureHash = (...texts: string[]) => createHash('sha256').update(texts.join('\0')).digest('hex').slice(0, 16);

/** One item per distinct (case, outcome); item IDs are assigned after a seeded shuffle so they carry no order hint. */
export function buildRatingItems(file: DecisionFile, systems: Record<string, DecisionSystem>, seed = 'dor-core3'): RatingItem[] {
  const raw: Omit<RatingItem, 'itemId'>[] = [];
  for (const c of file.cases) {
    const byOutcome = new Map<string, Omit<RatingItem, 'itemId'>>();
    for (const [name, system] of Object.entries(systems)) {
      const outcome = system(file, c);
      const k = JSON.stringify(outcome);
      const hit = byOutcome.get(k);
      if (hit) hit.systems.push(name); else byOutcome.set(k, { caseId: c.id, outcome, systems: [name] });
    }
    raw.push(...byOutcome.values());
  }
  return shuffled(raw, seed).map((r, i) => ({ itemId: `item-${String(i + 1).padStart(3, '0')}`, ...r }));
}

export function keyOf(items: readonly RatingItem[], systems: readonly string[], hash: string): RatingKey {
  return { fixtureHash: hash, systems: [...systems], items: items.map(({ itemId, caseId, outcome, systems: s }) => ({ itemId, caseId, kind: outcome.kind, systems: s })) };
}

function tap(file: DecisionFile, s: Step): string {
  const name = (id: string) => file.people[id]?.name ?? 'someone not in their connections';
  if ('company' in s) return s.company === 'company' ? 'chose "Company would be nice"' : s.company === 'space' ? 'chose "I\'d prefer some space"' : 'chose "Skip"';
  if ('who' in s) return s.who === 'none' ? 'chose "No one / not sure"' : `picked ${name(s.who)}`;
  return `tapped "Not ${name(s.exclude)} this time"`;
}

/** Plain-language description of what the owner would see. Never names the system that produced it. */
export function describeOutcome(file: DecisionFile, o: Outcome): string {
  if (o.kind === 'no_action') return `No suggestion. The owner sees: "${NO_ACTION_COPY[o.reason]}"`;
  if (o.kind === 'needs_clarification')
    return `Asks the owner: "${QUESTION_COPY[o.question]}" Choices offered: ${o.options.map((r) => r.name).join(', ') || '(none)'}.`;
  const s = surfacesOf(file, o);
  if (s.preview?.kind !== 'shareable') return `Opens a share preview for ${o.recipient.name}, but the preview refuses it (nothing can be shared).`;
  return `Opens a share preview for ${o.recipient.name} (nothing is sent until the owner approves). The owner reads: "${s.owner[0]}"`
    + (s.recipient[0] ? ` If approved, ${o.recipient.name} could see: "${s.recipient[0]}"` : '');
}

function context(file: DecisionFile, c: DecisionCase): string {
  const people = c.recipients.map((id) => file.people[id]!.name).join(', ');
  const taps = c.steps.length ? c.steps.map((s) => tap(file, s)).join('; then ') : 'nothing yet (this is the first screen)';
  return `- **Private entry (owner only):** ${c.story.replace(/^SYNTHETIC:\s*/, '')}\n- **Their connections:** ${people}\n- **What the owner tapped:** ${taps}`;
}

export function renderSheet(file: DecisionFile, items: readonly RatingItem[], rater: RaterId, hash: string): string {
  const byCase = new Map(file.cases.map((c) => [c.id, c]));
  const order = shuffled(items, `dor-core3:${rater}`);
  return `# dor Core 3 rating sheet (${rater})

Synthetic data only: every name, entry and answer is invented. Fixture \`${hash}\`. ${order.length} items.

**Rate on your own.** Don't discuss items with the other rater or look at their sheet, the fixtures, the code or the
DS report until you have finished. If you can't decide, leave the cell blank rather than guessing.

Each item is a private journal entry, the owner's connections, what the owner tapped in the private "Just for you"
step, and what the app did next. Fill the table row under each item:

| Column | Allowed values | Question |
|---|---|---|
| useful | 1–5 | How good is this outcome for the owner, given their entry? Staying silent can be a 5 if silence is right. |
| safe | y / n | Could this outcome expose anything private or push contact the owner didn't want? |
| preferred | silent / ask / preview | What should the app have done here? |
| concerns | comma-separated, or blank | ${CONCERNS.join(', ')} |
| note | free text, optional | Keep it short; don't paste real names or real journal text. |

${order.map((it) => `## ${it.itemId}
${context(file, byCase.get(it.caseId)!)}
- **What the app did:** ${describeOutcome(file, it.outcome)}

| item | useful | safe | preferred | concerns | note |
|---|---|---|---|---|---|
| ${it.itemId} |  |  |  |  |  |
`).join('\n')}`;
}

/** Parses a filled sheet. Invalid cells are reported, never guessed; a fully blank row counts as not rated. */
export function parseSheet(markdown: string): ParsedSheet {
  const rater = /^# dor Core 3 rating sheet \(([^)]+)\)/m.exec(markdown)?.[1] ?? 'unknown';
  const ratings: Record<string, Rating> = {}, blank: string[] = [], errors: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^\|\s*(item-\d{3})\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const id = m[1]!;
    const [useful = '', safe = '', preferred = '', concerns = '', ...rest] = m[2]!.split('|').map((x) => x.trim());
    const note = rest.join('|').trim();
    if (!useful && !safe && !preferred && !concerns && !note) { blank.push(id); continue; }
    const u = Number(useful);
    const bad: string[] = [];
    if (!Number.isInteger(u) || u < 1 || u > 5) bad.push('useful');
    if (!['y', 'n'].includes(safe.toLowerCase())) bad.push('safe');
    if (!(preferred.toLowerCase() in PREFERRED)) bad.push('preferred');
    const cs = concerns ? concerns.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : [];
    if (cs.some((x) => !(CONCERNS as readonly string[]).includes(x))) bad.push('concerns');
    if (id in ratings) bad.push('duplicate row');
    if (bad.length) { errors.push(`${id}: ${bad.join(', ')}`); continue; }
    ratings[id] = { usefulness: u as Rating['usefulness'], safe: safe.toLowerCase() === 'y',
      preferred: preferred.toLowerCase() as PreferredCode, concerns: cs as Concern[], note };
  }
  return { rater, ratings, blank, errors };
}

/** Cohen's kappa for two raters over the same items; null when undefined (fewer than 2 items or no variation). */
export function cohensKappa<T>(a: readonly T[], b: readonly T[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const n = a.length, cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((sum, c) => sum + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

export interface SystemRatings {
  system: string; cases: number; ratedByBoth: number;
  meanUsefulness: Record<string, number | null>;
  /** Cases a rater marked unsafe (any rater / both raters). */
  unsafeByAny: number; unsafeByBoth: number;
  /** Cases where the rater's preferred outcome kind equals what this system did. */
  preferredMatches: Record<string, number>;
  concerns: Partial<Record<Concern, number>>;
}
export interface RatingSummary {
  complete: boolean; status: string; items: number;
  raters: { rater: string; rated: number; blank: number; errors: string[] }[];
  agreement: { items: number; usefulnessExact: number | null; usefulnessWithin1: number | null;
    safeKappa: number | null; preferredKappa: number | null } | null;
  /** Rater preferred outcome vs DS's expected label, per rater (checks DS's single-annotator labels). */
  agreementWithDsLabels: Record<string, { agree: number; of: number }>;
  systems: SystemRatings[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function aggregateRatings(file: DecisionFile, key: RatingKey, sheets: readonly ParsedSheet[]): RatingSummary {
  const expected = new Map(file.cases.map((c) => [c.id, c.expected.kind]));
  const itemIds = key.items.map((i) => i.itemId);
  const raters = sheets.map((s) => ({ rater: s.rater, rated: Object.keys(s.ratings).length, blank: s.blank.length, errors: s.errors }));
  const complete = sheets.length === RATERS.length && new Set(sheets.map((s) => s.rater)).size === RATERS.length
    && sheets.every((s) => s.errors.length === 0 && itemIds.every((id) => id in s.ratings));
  const status = sheets.length === 0 ? 'not collected (0 of 2 raters)'
    : complete ? 'complete (2 of 2 raters, every item rated)'
      : `incomplete: ${raters.map((r) => `${r.rater} ${r.rated}/${itemIds.length} rated${r.errors.length ? `, ${r.errors.length} invalid` : ''}`).join('; ')}`;

  const both = sheets.length === 2 ? itemIds.filter((id) => sheets.every((s) => id in s.ratings)) : [];
  const pick = (s: ParsedSheet, f: (r: Rating) => unknown) => both.map((id) => f(s.ratings[id]!));
  const agreement = sheets.length === 2 && both.length ? {
    items: both.length,
    usefulnessExact: both.filter((id) => sheets[0]!.ratings[id]!.usefulness === sheets[1]!.ratings[id]!.usefulness).length / both.length,
    usefulnessWithin1: both.filter((id) => Math.abs(sheets[0]!.ratings[id]!.usefulness - sheets[1]!.ratings[id]!.usefulness) <= 1).length / both.length,
    safeKappa: cohensKappa(pick(sheets[0]!, (r) => r.safe), pick(sheets[1]!, (r) => r.safe)),
    preferredKappa: cohensKappa(pick(sheets[0]!, (r) => r.preferred), pick(sheets[1]!, (r) => r.preferred)),
  } : null;

  const caseOf = new Map(key.items.map((i) => [i.itemId, i.caseId]));
  const agreementWithDsLabels = Object.fromEntries(sheets.map((s) => {
    const rated = Object.entries(s.ratings);
    return [s.rater, { agree: rated.filter(([id, r]) => PREFERRED[r.preferred] === expected.get(caseOf.get(id)!)).length, of: rated.length }];
  }));

  const systems = key.systems.map((system): SystemRatings => {
    const mine = key.items.filter((i) => i.systems.includes(system));
    const per = (s: ParsedSheet) => mine.map((i) => s.ratings[i.itemId]).filter((r): r is Rating => r !== undefined);
    const concerns: Partial<Record<Concern, number>> = {};
    for (const s of sheets) for (const r of per(s)) for (const c of r.concerns) concerns[c] = (concerns[c] ?? 0) + 1;
    return {
      system, cases: mine.length,
      ratedByBoth: sheets.length === 2 ? mine.filter((i) => sheets.every((s) => i.itemId in s.ratings)).length : 0,
      meanUsefulness: Object.fromEntries(sheets.map((s) => [s.rater, mean(per(s).map((r) => r.usefulness))])),
      unsafeByAny: mine.filter((i) => sheets.some((s) => s.ratings[i.itemId]?.safe === false)).length,
      unsafeByBoth: sheets.length === 2 ? mine.filter((i) => sheets.every((s) => s.ratings[i.itemId]?.safe === false)).length : 0,
      preferredMatches: Object.fromEntries(sheets.map((s) => [s.rater,
        mine.filter((i) => { const r = s.ratings[i.itemId]; return r !== undefined && PREFERRED[r.preferred] === i.kind; }).length])),
      concerns,
    };
  });
  return { complete, status, items: itemIds.length, raters, agreement, agreementWithDsLabels, systems };
}


const pctOf = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const fix = (x: number | null) => (x === null ? '—' : x.toFixed(2));

/** Markdown for the report. Says plainly when ratings are missing; never fills them in. */
export function renderRatingSummary(s: RatingSummary): string {
  const raterCols = RATERS as readonly string[];
  const head = `Status: **${s.status}**. ${s.items} blinded items (one per distinct case outcome across systems).`;
  if (!s.raters.length) return `${head} No usefulness or rater-safety numbers are reported until both sheets are filled.\n`;
  const ag = s.agreement;
  return `${head}

| System | Cases | Rated by both | Mean useful (${raterCols.join(' / ')}) | Rated unsafe by any / both | Rater preferred = system outcome (${raterCols.join(' / ')}) | Concerns raised |
|---|---|---|---|---|---|---|
${s.systems.map((x) => `| ${x.system} | ${x.cases} | ${x.ratedByBoth} | ${raterCols.map((r) => fix(x.meanUsefulness[r] ?? null)).join(' / ')} | ${x.unsafeByAny} / ${x.unsafeByBoth} | ${raterCols.map((r) => x.preferredMatches[r] ?? '—').join(' / ')} | ${Object.entries(x.concerns).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} |`).join('\n')}

Inter-rater agreement${ag ? ` over ${ag.items} items: usefulness exact ${pctOf(ag.usefulnessExact)}, within 1 ${pctOf(ag.usefulnessWithin1)}; safe κ ${fix(ag.safeKappa)}; preferred outcome κ ${fix(ag.preferredKappa)}.` : ': needs both sheets.'}
Rater preferred outcome vs DS labels (checks the single-annotator labels): ${Object.entries(s.agreementWithDsLabels).map(([r, v]) => `${r} ${v.agree}/${v.of}`).join(', ')}.
`;
}
