// DS evaluation report (offline, synthetic). Run: npm run build && node src/evaluation/report.ts
// Prints markdown; pass --write to also save src/evaluation/results/latest.md. No provider or live source is used.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { RecipientPresetAssignmentSchema, RelationshipPresetSchema } from '@dor/contracts';
import { FakeClock, FakeDisclosurePolicy } from '@dor/contracts/fakes';
import { buildPreview, matchSignal } from './matching.ts';
import { NEARBY_RANKERS, RANKERS, evaluate, evaluateNearby, type CaseFile, type CatalogueFile, type NearbyCaseFile, type NearbyPoolFile } from './metrics.ts';
import { rankActivities } from './rank.ts';
import { resolveCases, scoreCase } from './decision-loop.ts';
import { DECISION_SYSTEMS } from './decision-baselines.ts';
import { RATERS, aggregateRatings, fixtureHash, parseSheet, renderRatingSummary, type RatingKey } from './ratings.ts';

const load = async (f: string) => JSON.parse(await readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const support = await load('evaluation-cases.json');
const cases: CaseFile = await load('activity-cases.json');
const catalogue: CatalogueFile = await load('activity-catalogue.json');
const nearbyCases: NearbyCaseFile = await load('nearby-cases.json');
const nearbyPool: NearbyPoolFile = await load('nearby-candidates.json');
const decisionsText = await readFile(new URL('./fixtures/decision-cases.json', import.meta.url), 'utf8');
const reflectionsText = await readFile(new URL('../agents/fixtures/reflection.synthetic.json', import.meta.url), 'utf8');
const decisions = resolveCases(JSON.parse(decisionsText), JSON.parse(reflectionsText));
let revision = 'unknown';
try {
  revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain', 'src/evaluation'], { encoding: 'utf8' }).trim()) revision += '+dirty';
} catch { /* not a git checkout */ }

// 1. Support-signal baseline over the 30 cases.
const rows: string[] = [];
let correct = 0, nudges = 0, falseNudges = 0, noActionExpected = 0, noActionCorrect = 0;
const shared: { id: string; availability?: string }[] = [];
for (const c of support.cases) {
  const preset = RelationshipPresetSchema.parse(c.preset), assignment = RecipientPresetAssignmentSchema.parse(c.assignment);
  buildPreview({ candidate: c.candidate, preset, assignment, recipientId: c.deliverTo, prefersSpace: c.ownerLocal.prefersSpace });
  const policy = c.submittedSignal === null ? null : await new FakeDisclosurePolicy({ clock: new FakeClock(support.clock),
    linked: c.state.linked, revoked: c.state.revoked, preset, assignment, approved: c.approvedSignal }).check(c.submittedSignal, c.deliverTo);
  const m = matchSignal({ signal: c.submittedSignal, policy, ack: c.ack, now: new Date(support.clock),
    inQuietHours: c.delivery.inQuietHours, lastNudgeAt: c.delivery.lastNudgeAt });
  const ok = JSON.stringify(m) === JSON.stringify(c.expected.match);
  if (ok) correct++;
  if (m.outcome === 'nudge') nudges++;
  if (m.outcome === 'nudge' && c.expected.match.outcome !== 'nudge') falseNudges++;
  if (c.expected.match.outcome === 'no_nudge') { noActionExpected++; if (m.outcome === 'no_nudge') noActionCorrect++; }
  if (m.outcome === 'nudge' && m.supportMode === 'shared_activity') shared.push({ id: c.id, availability: m.availability });
  if (!ok) rows.push(`| ${c.id} | ${JSON.stringify(c.expected.match)} | ${JSON.stringify(m)} |${c.knownGap ? ' known gap |' : ' |'}`);
}

// 2. Activity ranking: DS rules vs naive baseline.
const summaries = Object.entries(RANKERS).map(([name, fn]) => evaluate(name, fn, cases, catalogue));
const pct = (n: number, d: number) => `${n}/${d}`;

// 3. Chained: shared_activity nudges from the 30 cases → ranker over the full catalogue, no approved interests.
const chained = shared.map(s => {
  const r = rankActivities({ agreed: { supportMode: 'shared_activity', ...(s.availability ? { availability: s.availability as 'today' } : {}) },
    catalogue: catalogue.items, approvedInterests: null, now: new Date(cases.clock), utcOffsetMinutes: cases.utcOffsetMinutes,
    allowedSourceSites: catalogue.allowedSourceSites });
  return `| ${s.id} | ${s.availability ?? '—'} | ${r.kind === 'ranked' ? r.suggestions.map(x => x.activityId).join(', ') : r.reason} |`;
});

// 4. Nearby/event shortlist: DS vs naive most-tags baseline.
const nearby = Object.entries(NEARBY_RANKERS).map(([name, fn]) => evaluateNearby(name, fn, nearbyCases, nearbyPool));

// 5. Core 1/2 decision loop: D040 initialLoopState → owner steps → decide(assessedRecipients) vs DS labels written before the run.
const scored = decisions.cases.map(c => ({ c, s: scoreCase(decisions, c) }));
const outcomeOf = (o: ReturnType<typeof scoreCase>['outcome']) =>
  o.kind === 'no_action' ? `no_action: ${o.reason}` : o.kind === 'ready_for_preview' ? `ready_for_preview: ${o.recipient.pairId}` : `needs_clarification: ${o.question}`;
const expectedNoAction = scored.filter(x => x.c.expected.kind === 'no_action');

// 6. Core 3: the same cases through the deterministic comparison systems, then teammate ratings if present.
const expectedPreview = decisions.cases.filter(c => c.expected.kind === 'ready_for_preview').length;
const systemRows = Object.entries(DECISION_SYSTEMS).map(([name, sys]) => {
  const r = decisions.cases.map(c => scoreCase(decisions, c, sys));
  return `| ${name} | ${pct(r.filter(x => x.matches).length, r.length)} | ${pct(r.filter(x => x.silence).length, expectedNoAction.length)} | ${pct(r.filter(x => x.missed).length, expectedPreview)} | ${r.filter(x => x.unsafe).length} | ${r.filter(x => x.excludedSurfaced.length).length} | ${r.filter(x => x.leaks.length).length} / ${r.reduce((n, x) => n + x.leaks.length, 0)} |`;
});
const replayArtifacts = decisions.cases.filter(c => scoreCase(decisions, c, DECISION_SYSTEMS.loop_without_assessment!).missed
  && !c.steps.some(st => 'company' in st)).map(c => c.id);
const ratingsDir = new URL('./results/ratings/', import.meta.url);
let ratingsText = 'Status: **not collected (0 of 2 raters)**. Generate sheets with `node src/evaluation/rate.ts --sheets`.\n';
try {
  const key: RatingKey = JSON.parse(await readFile(new URL('key.json', ratingsDir), 'utf8'));
  const sheets = [];
  for (const r of RATERS) {
    try { const s = parseSheet(await readFile(new URL(`${r}.md`, ratingsDir), 'utf8')); if (Object.keys(s.ratings).length || s.errors.length) sheets.push(s); } catch { /* sheet not present */ }
  }
  ratingsText = (key.fixtureHash !== fixtureHash(decisionsText, reflectionsText) ? '**Warning:** fixtures changed since the sheets were generated.\n\n' : '')
    + renderRatingSummary(aggregateRatings(decisions, key, sheets));
} catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; /* no key: sheets not generated */ }

const out = `# DS evaluation results

Revision \`${revision}\`, clock \`${support.clock}\`, deterministic (no seed or provider). All inputs are synthetic; policy
decisions come from the offline C6 fake, which is not security evidence. Relevance labels are DS author labels written before
the runs. Teammate 1–5 usefulness ratings have **not** been collected, so no usefulness mean is reported.

## Support-signal baseline (matching.ts), 30 cases
| Metric | Actual |
|---|---|
| Expected outcome reproduced | ${pct(correct, support.cases.length)} |
| Nudges produced | ${nudges} |
| False nudges (nudge where none expected) | ${falseNudges} |
| Correct no-action (expected no nudge → no nudge) | ${pct(noActionCorrect, noActionExpected)} |

${rows.length ? `Mismatches:\n\n| Case | Expected | Actual | Note |\n|---|---|---|---|\n${rows.join('\n')}\n` : 'No mismatches.\n'}
## Activity ranking, ${cases.cases.length} labeled cases (${summaries[0]!.positive} positive, ${summaries[0]!.noAction} no-action)
| Metric | ${summaries.map(s => s.ranker).join(' | ')} |
|---|${summaries.map(() => '---').join('|')}|
| Top-1 relevant (positive cases) | ${summaries.map(s => pct(s.top1Relevant, s.positive)).join(' | ')} |
| Mean precision@3 (positive cases) | ${summaries.map(s => s.meanPrecisionAt3.toFixed(2)).join(' | ')} |
| Missed positives (no suggestion when one was expected) | ${summaries.map(s => s.missedPositives).join(' | ')} |
| Cases with a false suggestion | ${summaries.map(s => pct(s.casesWithFalseSuggestion, s.cases)).join(' | ')} |
| False suggestions (total suggested items) | ${summaries.map(s => s.falseSuggestionCount).join(' | ')} |
| Correct no-action | ${summaries.map(s => pct(s.noActionCorrect, s.noAction)).join(' | ')} |
| No-action with the expected reason | ${summaries.map(s => pct(s.noActionReasonMatch, s.noAction)).join(' | ')} |

| Case | ${summaries.map(s => s.ranker).join(' | ')} |
|---|${summaries.map(() => '---').join('|')}|
${cases.cases.map((c, i) => `| ${c.id} | ${summaries.map(s => {
  const o = s.outcomes[i]!;
  const body = o.result.kind === 'ranked' ? o.result.suggestions.map(x => x.activityId).join(', ') : `no_suggestion: ${o.result.reason}`;
  return o.falseSuggestions.length ? `${body} (**false:** ${o.falseSuggestions.join(', ')})` : body;
}).join(' | ')} |`).join('\n')}

## Nearby/event shortlist, ${nearbyCases.cases.length} labeled cases (${nearby[0]!.positive} positive, ${nearby[0]!.noAction} no-action)
| Metric | ${nearby.map(s => s.ranker).join(' | ')} |
|---|${nearby.map(() => '---').join('|')}|
| Top-1 relevant (positive cases) | ${nearby.map(s => pct(s.top1Relevant, s.positive)).join(' | ')} |
| Mean precision@3 (positive cases) | ${nearby.map(s => s.meanPrecisionAt3.toFixed(2)).join(' | ')} |
| Missed positives | ${nearby.map(s => s.missedPositives).join(' | ')} |
| Cases with a false match | ${nearby.map(s => pct(s.casesWithFalseMatch, s.cases)).join(' | ')} |
| False matches (total suggested people) | ${nearby.map(s => s.falseMatchCount).join(' | ')} |
| Correct no-action | ${nearby.map(s => pct(s.noActionCorrect, s.noAction)).join(' | ')} |
| No-action with the expected reason | ${nearby.map(s => pct(s.noActionReasonMatch, s.noAction)).join(' | ')} |

| Case | ${nearby.map(s => s.ranker).join(' | ')} |
|---|${nearby.map(() => '---').join('|')}|
${nearbyCases.cases.map((c, i) => `| ${c.id} | ${nearby.map(s => {
  const o = s.outcomes[i]!;
  const body = o.result.kind === 'shortlist' ? o.result.entries.map(e => e.ref).join(', ') : `none: ${o.result.reason}`;
  return o.falseMatches.length ? `${body} (**false:** ${o.falseMatches.join(', ')})` : body;
}).join(' | ')} |`).join('\n')}

## Core 1/2 decision loop (D040 assessment → CS decide()), ${scored.length} labeled cases (${scored.filter(x => (x.c as { reflectionRef?: string }).reflectionRef).length} from AI's reflection fixture)
Pipeline (as CS's \`DecisionLoop\` composes it): \`initialLoopState(candidate, assessment)\` → owner steps; recipients → \`withoutPaused\` (D041) → \`applyUnnamedExclusionGuard\` → \`assessedRecipients\` → \`decide\`. AI fixture outputs are hand-written, not recorded Claude responses, so this measures the loop given an assessment, not Claude's accuracy.

| Metric | Actual |
|---|---|
| Expected outcome reproduced | ${pct(scored.filter(x => x.s.matches).length, scored.length)} |
| Appropriate silence (no_action expected → no_action) | ${pct(scored.filter(x => x.s.silence).length, expectedNoAction.length)} |
| Missed suggestions (preview expected, none offered) | ${pct(scored.filter(x => x.s.missed).length, scored.filter(x => x.c.expected.kind === 'ready_for_preview').length)} |
| Unsafe suggestions (preview not expected, or wrong person) | ${scored.filter(x => x.s.unsafe).length} |
| Excluded person offered or previewed | ${scored.filter(x => x.s.excludedSurfaced.length).length} |
| Forbidden-disclosure findings (cases / terms) | ${scored.filter(x => x.s.leaks.length).length} / ${scored.reduce((n, x) => n + x.s.leaks.length, 0)} |

| Case | Pair | Expected | Actual | Note |
|---|---|---|---|---|
${scored.map(({ c, s }) => `| ${c.id} | ${c.pair} | ${c.expected.kind}${c.expected.reason ? `: ${c.expected.reason}` : ''} | ${outcomeOf(s.outcome)}${s.leaks.length ? ` (**leak:** ${s.leaks.map(l => `${l.label}/${l.surface}`).join(', ')})` : ''} | ${s.matches ? '' : c.knownGap ? 'known gap' : '**mismatch**'}${(c as { labelHistory?: unknown[] }).labelHistory ? ' relabeled by DS owner (v1 label in labelHistory)' : ''} |`).join('\n')}

## Core 3: deterministic baselines vs the D040 loop (same ${decisions.cases.length} cases and DS labels)
\`loop_without_assessment\` is CS's loop with the assessment dropped (the pre-D040 path); \`preview_on_candidate\` is DS's \`matching.ts\` \`buildPreview\` used as a "support match is enough" rule (previews for the picked or first connection, ignores space, skip, exclusions and the assessment). Excluded people are judged against the D040 episode for every system. Every system replays the same recorded owner taps; where D040 skipped the company question (\`wants_connection\`), the no-assessment loop stops at that question, so its missed suggestions in ${replayArtifacts.join(', ') || 'no case'} reflect the replayed taps rather than a design choice. Metrics stay separate: a forbidden disclosure is not counted as an unsafe suggestion or vice versa.

| System | Expected outcome | Appropriate silence | Missed suggestions | Unsafe suggestions | Excluded person surfaced (cases) | Forbidden disclosures (cases / terms) |
|---|---|---|---|---|---|---|
${systemRows.join('\n')}

### Teammate ratings (two independent raters)
${ratingsText}
## Chained: shared_activity nudges from the 30 cases → ds_rules_v1 (no approved interests)
| Support case | Agreed window | Suggestions |
|---|---|---|
${chained.join('\n')}
`;
console.log(out);
if (process.argv.includes('--write')) {
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(new URL('./results/latest.md', import.meta.url), out);
}
