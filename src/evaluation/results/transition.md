# DS transition evaluation: Berkeley newcomers (synthetic)

**Data:** SYNTHETIC personas (`fixtures/berkeley-newcomers.json`, 17 people) and catalogue (SYNTHETIC (hand-written fixture; no Actor run)). Clock 2026-10-24T18:00:00Z.
Server views are a DS stand-in over Cyber's real guards; ranking is the shipped DS code as CS calls it; reconnect episodes are decision-cases.json cases by reference. Labels: one DS annotator, written before the first run. Not live, not rated by teammates.
Regenerate with `node src/evaluation/transition.ts --write`.

## Discovery cases

Expected 9/9; nearby top-1 relevant 2/2; false matches 0; correct no-action 5/5.
Publications refused by guardPublicationDraft: mal (tag_not_allowlisted), ben (invalid_schema).

| Case | Expected | Got | OK |
|---|---|---|---|
| b1-maya-nearby | shortlist pub-rae, pub-jun, pub-priya | shortlist pub-rae, pub-jun, pub-priya | yes |
| b2-maya-events | events evt-hk-1: pub-priya; evt-bg-1: pub-jun | events evt-hk-1: pub-priya; evt-bg-1: pub-jun | yes |
| b3-tomas-nearby | shortlist pub-tess | shortlist pub-tess | yes |
| b3e-tomas-events | events evt-lm-1: pub-tess | events evt-lm-1: pub-tess | yes |
| b4-ben-cold-start | none: not_published | none: not_published | yes |
| b5-uma-lurker | none: not_published | none: not_published | yes |
| b6-nadia-sparse | none: empty_area | none: empty_area | yes |
| b7-ines-no-fit | none: no_fit | none: no_fit | yes |
| b8-ines-no-intent | none: viewer_no_event_intent | none: viewer_no_event_intent | yes |

## New connection vs reconnect (paired)

Useful next step: new 5/7 (introduce), reconnect 3/7 (owner preview), reconnect pending an owner answer 0; both paths silent 1. Expected 7/7; reconnect labels from decision-cases.json met 7/7.
A "none" is a correct, honest result when labeled so; reconnecting is never offered as a fallback for an empty discovery result, and nothing here measures loneliness or AI use.

| Pair | Discovery | Reconnect case | New | Reconnect | OK |
|---|---|---|---|---|---|
| tp1-maya-new-and-reconnect | b1-maya-nearby | a2-positive-sam-owner-picks | introduce | preview | yes |
| tp2-maya-refusal-does-not-touch-discovery | b1-maya-nearby | r2-refused-person-cannot-be-chosen-or-fallen-through | introduce | none | yes |
| tp3-maya-no-journal | b1-maya-nearby | n1-nothing-to-share | introduce | none | yes |
| tp4-maya-private-party | b2-maya-events | pp1-private-party-no-hint | introduce | none | yes |
| tp5-cold-start-reconnect-available | b4-ben-cold-start | g1-company-and-this-friend | none | preview | yes |
| tp6-sparse-both-silent | b6-nadia-sparse | t2-ambiguous-timing-skip-is-silence | none | none | yes |
| tp7-downtown-both-useful | b3-tomas-nearby | a19-family-tiring-week-seed | introduce | preview | yes |

## Limits

- Synthetic people and events; the stand-in is not the deployed module (Cyber's module tests cover the real views).
- Current DISCOVERY_TAGS has no transition tags, so transitions stay device-local; D046 would allow ordinary, non-sensitive transition tags if CS adds them to the allowlist.
- Rerun against a saved approved Actor dataset with `--dataset <file>` (event-mode labels then no longer apply, because source ids differ).
