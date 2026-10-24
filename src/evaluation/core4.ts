// DS Core 4: a small, reproducible summary over a curated selection of existing synthetic cases (by reference).
// Offline and deterministic: no provider, worker, reducer or live database runs, and policy decisions come from the C6
// fake. Run: `node src/evaluation/core4.ts --write` (writes results/core4.md) or `--check` (fails if it is stale).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import {
  FORBIDDEN_LABELS, d040Loop, nudgeAfterApproval, resolveCases, scoreCase, surfacesOf, type DecisionCase, type DecisionFile,
  type DecisionSystem,
} from './decision-loop.ts';
import { fixtureHash } from './ratings.ts';
import { crossedTerms, runSupportCase } from './support-pipeline.ts';
import type { Outcome } from '../components/feature/decision-loop-model.ts';

export interface Core4Example {
  suite: 'decision' | 'support'; id: string; relationship: string; covers: string[]; why: string;
}
export interface Core4File {
  coverage: string[]; doneCriteria: Record<string, string[]>; examples: Core4Example[];
}
export interface Core4Row {
  example: Core4Example;
  expected: string;
  actual: string;
  matches: boolean;
  /** Each privacy check that ran for this case, and whether it held. */
  privacy: { check: string; ok: boolean }[];
  /** Fixed template copy the recipient would see, or null when nothing is delivered. */
  recipientCopy: string | null;
  knownGap: string | null;
}
export interface Core4Inputs {
  core4: Core4File;
  decision: DecisionFile;
  support: { clock: string; cases: any[] };
  texts: string[];
}

const describeOutcome = (o: Outcome) => o.kind === 'no_action' ? `no_action: ${o.reason}`
  : o.kind === 'needs_clarification' ? `needs_clarification: ${o.question} [${o.options.map((r) => r.pairId).join(', ')}]`
    : `ready_for_preview: ${o.recipient.pairId}`;

const describeExpected = (e: DecisionCase['expected']) => [e.kind, e.reason, e.question, e.recipient].filter(Boolean).join(': ')
  + (e.options ? ` [${e.options.join(', ')}]` : '');

const storyTerms = (c: DecisionCase) => FORBIDDEN_LABELS.filter((l) => l !== 'unapproved_recipient').flatMap((l) => c.forbidden[l] ?? []);

function decisionRow(file: DecisionFile, example: Core4Example, c: DecisionCase, system: DecisionSystem): Core4Row {
  const s = scoreCase(file, c, system);
  const surfaces = surfacesOf(file, s.outcome);
  const nudge = nudgeAfterApproval(file, s.outcome, surfaces, `core4-${c.id}`) as { copy?: string; templateId?: string } | null;
  const copy = nudge && typeof nudge.copy === 'string' ? nudge.copy : null;
  const terms = storyTerms(c);
  const privacy = [
    { check: 'no forbidden-disclosure term on any owner, recipient or offered surface', ok: s.leaks.length === 0 },
    { check: 'no excluded or paused person offered or previewed', ok: s.excludedSurfaced.length === 0 },
    { check: 'no preview for a person the owner did not choose', ok: !s.unsafe },
  ];
  if (copy !== null) privacy.push({
    check: 'after simulated approval, the nudge is fixed template copy with no story term',
    ok: Object.values(NUDGE_TEMPLATE_COPY).includes(copy) && !terms.some((t) => copy.toLowerCase().includes(t.toLowerCase())),
  });
  return {
    example, expected: describeExpected(c.expected), actual: describeOutcome(s.outcome), matches: s.matches, privacy,
    recipientCopy: copy, knownGap: c.knownGap ?? null,
  };
}

async function supportRow(support: Core4Inputs['support'], example: Core4Example, c: any): Promise<Core4Row> {
  const r = await runSupportCase(support, c);
  const show = (m: { outcome: string; reason?: string; templateId?: string }) =>
    m.outcome === 'nudge' ? `nudge: ${m.templateId}` : `no_nudge: ${m.reason}`;
  const matches = JSON.stringify(r.match) === JSON.stringify(c.expected.match)
    && (r.policy?.reason ?? null) === c.expected.policyReason;
  const copy = r.match.outcome === 'nudge' ? NUDGE_TEMPLATE_COPY[r.match.templateId] : null;
  return {
    example, expected: show(c.expected.match), actual: show(r.match), matches,
    privacy: [
      { check: 'no forbidden story term crossed to the recipient side (preview, envelope, ACK, nudge)',
        ok: crossedTerms(r.crossed, c.forbiddenDisclosures).length === 0 },
    ],
    recipientCopy: copy, knownGap: c.knownGap ?? null,
  };
}

export async function loadCore4(): Promise<Core4Inputs> {
  const read = (u: string) => readFile(new URL(u, import.meta.url), 'utf8');
  const texts = await Promise.all([read('./fixtures/core4-examples.json'), read('./fixtures/decision-cases.json'),
    read('../agents/fixtures/reflection.synthetic.json'), read('./fixtures/evaluation-cases.json'), read('./results/ratings/key.json')]);
  const [core4, decisionRaw, reflections, support] = texts.slice(0, 4).map((t) => JSON.parse(t));
  return { core4, decision: resolveCases(decisionRaw, reflections), support, texts };
}

/** `system` defaults to the current loop; a baseline is passed only by negative-control tests. */
export async function buildCore4(inputs: Core4Inputs, system: DecisionSystem = d040Loop): Promise<Core4Row[]> {
  const rows: Core4Row[] = [];
  for (const example of inputs.core4.examples) {
    if (example.suite === 'decision') {
      const c = inputs.decision.cases.find((k) => k.id === example.id);
      if (!c) throw new Error(`core4: unknown decision case ${example.id}`);
      rows.push(decisionRow(inputs.decision, example, c, system));
    } else {
      const c = inputs.support.cases.find((k: { id: string }) => k.id === example.id);
      if (!c) throw new Error(`core4: unknown support case ${example.id}`);
      rows.push(await supportRow(inputs.support, example, c));
    }
  }
  return rows;
}

const md = (s: string) => s.replace(/\|/g, '\\|');

export function renderCore4(inputs: Core4Inputs, rows: Core4Row[]): string {
  const { core4, decision, support } = inputs;
  const reflectionIds = new Set(decision.cases.map((c) => (c as { reflectionRef?: string }).reflectionRef).filter(Boolean));
  const raw = JSON.parse(inputs.texts[1]!) as { cases: { id: string; reflectionRef?: string }[] };
  const refOf = (id: string) => raw.cases.find((c) => c.id === id)?.reflectionRef;
  const bySuite = (s: string) => rows.filter((r) => r.example.suite === s).length;
  const fromAi = rows.filter((r) => r.example.suite === 'decision' && refOf(r.example.id));
  const count = (label: string) => rows.filter((r) => r.example.covers.includes(label)).length;
  const rel = (name: string) => rows.filter((r) => r.example.relationship === name).length;
  const allPrivacy = rows.every((r) => r.privacy.every((p) => p.ok));
  const rated = new Set((JSON.parse(inputs.texts[4]!) as { items: { caseId: string }[] }).items.map((i) => i.caseId));
  const decisionRows = rows.filter((r) => r.example.suite === 'decision');
  const inSheets = decisionRows.filter((r) => rated.has(r.example.id)).length;
  const lines: string[] = [];
  lines.push('# Core 4 evaluation summary (DS)', '');
  lines.push(`Fixture hash \`${fixtureHash(...inputs.texts)}\`, decision clock \`${decision.clock}\`, support clock \`${support.clock}\`. Deterministic and offline: no provider, worker, reducer or live database ran, and policy decisions come from the C6 fake (not security evidence). Regenerate with \`node src/evaluation/core4.ts --write\`; \`--check\` fails if this file is stale.`, '');
  lines.push('## Sample size (real counts)', '');
  lines.push('| | Cases |', '|---|---|');
  lines.push(`| Core 4 examples (this summary) | **${rows.length}** (${bySuite('decision')} decision-loop, ${bySuite('support')} support-signal) |`);
  lines.push(`| Synthetic | ${rows.length} of ${rows.length} (no real people, journals or recorded model outputs) |`);
  lines.push(`| Reused from Core 1–3 | ${rows.length} of ${rows.length}: every example is an existing labeled case, referenced by ID; none is new or relabeled here |`);
  lines.push(`| Reused across suites | ${fromAi.length} decision examples take their story, candidate and assessment from AI's \`reflection.synthetic.json\` by reference (${fromAi.map((r) => `${r.example.id} ← ${refOf(r.example.id)}`).join(', ')}); AI's own assessment and adapter tests use the same fixture. ${inSheets} of ${decisionRows.length} decision examples also appear in the blinded Core 3 rater sheets (\`results/ratings/key.json\`). |`);
  lines.push(`| Full DS sets they come from | ${decision.cases.length} decision-loop cases (${decision.cases.filter((c) => refOf(c.id)).length} referencing ${reflectionIds.size} AI reflection cases) + ${support.cases.length} support-signal cases = ${decision.cases.length + support.cases.length} labeled synthetic cases |`);
  lines.push(`| Relationships | partners ${rel('partners')}, friends ${rel('friends')}, family ${rel('family')} (private-party cases are friends) |`);
  lines.push(`| Coverage | ${core4.coverage.map((c) => `${c} ${count(c)}`).join(', ')} |`, '');
  lines.push('## Results', '');
  lines.push(`Expected outcome reproduced: **${rows.filter((r) => r.matches).length}/${rows.length}**. Privacy checks held: **${rows.reduce((n, r) => n + r.privacy.filter((p) => p.ok).length, 0)}/${rows.reduce((n, r) => n + r.privacy.length, 0)}**${allPrivacy ? '' : ' (**failures listed below**)'}. Known gaps among the examples: ${rows.filter((r) => r.knownGap).map((r) => r.example.id).join(', ') || 'none'}.`, '');
  lines.push('| Case | Suite | Relationship | Covers | Expected (source label) | Actual | Privacy checks | Recipient would see |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const p = `${r.privacy.filter((x) => x.ok).length}/${r.privacy.length}${r.privacy.some((x) => !x.ok) ? ` **failed:** ${r.privacy.filter((x) => !x.ok).map((x) => x.check).join('; ')}` : ''}`;
    lines.push(`| ${r.example.id} | ${r.example.suite} | ${r.example.relationship} | ${r.example.covers.join(', ')} | ${md(r.expected)} | ${md(r.actual)}${r.matches ? '' : ' **mismatch**'} | ${md(p)} | ${r.recipientCopy ? `"${md(r.recipientCopy)}"` : 'nothing'} |`);
  }
  lines.push('', '## README "Core definition of done", offline evidence', '');
  for (const [k, ids] of Object.entries(core4.doneCriteria)) {
    const ok = ids.every((id) => { const r = rows.find((x) => x.example.id === id); return r && r.matches && r.privacy.every((p) => p.ok); });
    lines.push(`- **${k.replace(/_/g, ' ')}:** ${ids.join(', ')}: ${ok ? 'reproduced offline' : '**not reproduced**'}.`);
  }
  lines.push('', 'Why each case was chosen:', '');
  for (const r of rows) lines.push(`- \`${r.example.id}\`: ${r.example.why}`);
  lines.push('', '## Privacy checks applied', '');
  lines.push('- Decision-loop cases: no forbidden-disclosure term (unapproved recipient, private activity, location, excuse, relationship tension, timing detail) on any owner, recipient or offered surface; no excluded or paused person offered or previewed; no preview for a person the owner did not choose. (That recipient-visible copy appears only at a preview holds by construction here and is asserted on every screen of every case in `decision-loop.test.ts`.) For previews, the nudge after a *simulated* approval is fixed template copy with no story term.');
  lines.push('- Support-signal cases: no forbidden story term in anything that crosses to the recipient side (preview, envelope, ACK, nudge). The expected outcome itself encodes the delivery gate (policy, recipient consent, ACK); the release-bar tests of the 30-case suite cover that no revoked, expired, unlinked, attack or no-action case produces a nudge.');
  lines.push('- Each check above has a negative control in `__tests__/core4.test.ts` (a deliberately leaking variant or a baseline system) that must make it fail, so a clean result is not vacuous.');
  lines.push('', '## Limitations', '');
  lines.push(`- ${rows.length} examples is a small, hand-picked sample chosen to cover the README categories; the rates above describe these cases, not a population.`);
  lines.push('- Every case is synthetic. Labels come from one DS annotator, written before the Core 1–3 runs; teammate ratings have **not** been collected.');
  lines.push("- AI's reflection outputs are hand-written fixtures, not recorded Claude responses, so this measures the loop given an assessment, not Claude's accuracy.");
  lines.push('- "Approval" for decision-loop previews is simulated (fixed consent, no quiet hours, no cooldown); support cases use the C6 fake policy. No reducer, worker, Droid, Clerk session or SpacetimeDB host ran, so nothing here is live or deployed evidence.');
  lines.push('- Not covered here: timing and batching of live delivery (DS mirrors the D043 `my_nudges` row in `matching.ts` `recipientNudgeRow`, offline only; it reveals the approval hour, an accepted D043 residual reported by the DS owner, and hides the exact approval minute), browser UI copy, microphone/provider failures.');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const inputs = await loadCore4();
  const out = renderCore4(inputs, await buildCore4(inputs));
  const path = new URL('./results/core4.md', import.meta.url);
  if (process.argv.includes('--check')) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== out) { console.error('results/core4.md is stale: run node src/evaluation/core4.ts --write'); process.exit(1); }
    console.log('results/core4.md is current');
  } else if (process.argv.includes('--write')) {
    await writeFile(path, out);
    console.log('wrote src/evaluation/results/core4.md');
  } else process.stdout.write(out);
}
