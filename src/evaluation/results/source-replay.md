# DS source replay (catalogue → eligible events)

**Data:** SYNTHETIC (hand-written fixture; no Actor run). Dataset `fixtures/berkeley-luma.synthetic.json`; replay clock 2026-10-24T18:00:00.000Z.
Pipeline: CS `normalizeCatalogue` (or saved ingest output) → `catalogue_events` view rule → DS `eligibleEvents` per launch area.
No titles, URLs, hosts or guests are printed. Regenerate with `node src/evaluation/source-replay.ts [--dataset <file>] --write`.

- Normalized rows: 5; normalizer drops: already_started 1, instruction_like_title 1, outside_region 1, outside_window 1, unsafe_source_url 1
- Dropped by the view rule: none
- Served by `catalogue_events`: 5

| Area | Eligible events (id: topics) | Withheld (reason count) |
|---|---|---|
| berkeley-campus | `apify:20d2fc7814e5…`: hiking<br>`apify:ed932210bcc0…`: board-games+hiking | starts_too_soon 1 |
| berkeley-downtown | `apify:60aa9b94e1d3…`: board-games<br>`apify:eafaf9062239…`: live-music | none |
| sf-mission | — | none |

**Synthetic:** this proves the pipeline shape only. Rerun with a saved approved Actor dataset before any usefulness claim.
