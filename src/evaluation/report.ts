// DS evaluation report (offline, synthetic). Run: npm run build && node src/evaluation/report.ts
// Prints markdown; pass --write to also save src/evaluation/results/latest.md. No provider or live source is used.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { RecipientPresetAssignmentSchema, RelationshipPresetSchema } from '@kinetic/contracts';
import { FakeClock, FakeDisclosurePolicy } from '@kinetic/contracts/fakes';
import { buildPreview, matchSignal } from './matching.ts';
import { RANKERS, evaluate, type CaseFile, type CatalogueFile } from './metrics.ts';
import { rankActivities } from './rank.ts';

const load = async (f: string) => JSON.parse(await readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const support = await load('evaluation-cases.json');
const cases: CaseFile = await load('activity-cases.json');
const catalogue: CatalogueFile = await load('activity-catalogue.json');
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
