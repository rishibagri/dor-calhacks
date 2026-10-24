# DS — Context quality and evaluation

Branch: `role/ds-context`

Ownership: src/evaluation/, scenario fixtures, ranking module, contracts/fixtures/ (shared changes reviewed by consumers)

Design the eight-question skippable preference quiz and deterministic editable connection profile; suggest draft partner/friend/family presets without granting consent. Implement enum matching, .ics sample analysis, evaluation cases for different presets, and relevance feedback.

## Deliverables
Hour 3: quiz/profile fixture and three relationship scenarios. Hour 7: deterministic quiz mapping and ranking adapter. Hour 17: scenario and preset combinations. Hour 22: 30-case evaluation. Hour 31: regression report.

## Dependencies
AI supplies candidate outputs; Cyber signs off safe fixture boundaries; CS supplies the integrated application. DS never receives raw real journals for analytics.

Before coding: read AGENTS.md and all contracts. Post handoffs to docs/updates/ds.md. Open small compatible PRs, include verification, and read the other role logs every hour.

Handoff file: docs/handoffs/ds.md. Shared interfaces: contracts/README.md; do not fork contract types into role directories.
