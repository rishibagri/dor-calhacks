// DS Core 3 rating workflow (offline, synthetic). See src/evaluation/README.md "Teammate ratings".
//   node src/evaluation/rate.ts --sheets   write blinded rater sheets + key to src/evaluation/results/ratings/
//   node src/evaluation/rate.ts --score    parse the filled sheets and print the per-system summary
// --sheets refuses to overwrite a sheet that already has ratings unless --force is given.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { DECISION_SYSTEMS } from './decision-baselines.ts';
import { resolveCases } from './decision-loop.ts';
import {
  RATERS, aggregateRatings, buildRatingItems, fixtureHash, keyOf, parseSheet, renderRatingSummary, renderSheet, type RatingKey,
} from './ratings.ts';

const here = (p: string) => new URL(p, import.meta.url);
const casesText = await readFile(here('./fixtures/decision-cases.json'), 'utf8');
const reflectionsText = await readFile(here('../agents/fixtures/reflection.synthetic.json'), 'utf8');
const file = resolveCases(JSON.parse(casesText), JSON.parse(reflectionsText));
const hash = fixtureHash(casesText, reflectionsText);
const dir = here('./results/ratings/');
const exists = (u: URL) => access(u).then(() => true, () => false);

if (process.argv.includes('--sheets')) {
  const items = buildRatingItems(file, DECISION_SYSTEMS);
  await mkdir(dir, { recursive: true });
  for (const rater of RATERS) {
    const target = new URL(`${rater}.md`, dir);
    if (await exists(target) && Object.keys(parseSheet(await readFile(target, 'utf8')).ratings).length && !process.argv.includes('--force')) {
      console.error(`${rater}.md already has ratings; not overwritten (pass --force to replace).`);
      process.exit(1);
    }
    await writeFile(target, renderSheet(file, items, rater, hash));
  }
  await writeFile(new URL('key.json', dir), `${JSON.stringify(keyOf(items, Object.keys(DECISION_SYSTEMS), hash), null, 2)}\n`);
  console.log(`Wrote ${RATERS.map((r) => `${r}.md`).join(', ')} and key.json (${items.length} items) to src/evaluation/results/ratings/.`);
} else if (process.argv.includes('--score')) {
  const key: RatingKey = JSON.parse(await readFile(new URL('key.json', dir), 'utf8'));
  if (key.fixtureHash !== hash) console.warn('WARNING: fixtures changed since the sheets were generated; ratings may not match the current cases.');
  const sheets = [];
  for (const rater of RATERS) {
    const u = new URL(`${rater}.md`, dir);
    if (await exists(u)) { const s = parseSheet(await readFile(u, 'utf8')); if (Object.keys(s.ratings).length || s.errors.length) sheets.push(s); }
  }
  console.log(renderRatingSummary(aggregateRatings(file, key, sheets)));
} else {
  console.error('usage: node src/evaluation/rate.ts --sheets [--force] | --score');
  process.exit(2);
}
