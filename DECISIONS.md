# Hari Om ERP Decisions

## Decision Log

### 2026-04-14: Keep the direct runtime as the primary local boot path

Reason:

- it matches the user’s last known working flow
- it keeps the original local ports stable
- it avoids reintroducing Docker-only assumptions during recovery

### 2026-04-14: Treat Codex session history as evidence for business rules

Reason:

- git history for the exact April state was unavailable
- the March rollout files still contained the original user prompts for spec math, planner expectations, and master-data scope

Recovered prompts that matter:

- 2026-03-03: wet-weight, bamboo, adhesive, and parchment formula brief
- 2026-03-15: beautiful end-to-end spec sheet, notch diagram, planner, and job-card truth brief
- 2026-03-30: master-data expansion for customer, paper, adhesive, and packaging

### 2026-04-14: Fix plant alias filtering at the service level

Reason:

- recovered master rows existed in PostgreSQL but did not appear in the UI
- root cause was case-sensitive alias filtering against mixed-case plant IDs

Decision:

- expand alias resolution to include canonical, lowercase, uppercase, and exact input forms

### 2026-04-14: Make the spec sheet more derived and less manually editable

Reason:

- the recovered UI had drifted toward editable snapshots
- the original brief consistently asked for master-driven dropdowns and derived manufacturing truth

Decision:

- keep only high-signal manual inputs
- derive ID, OD, paper target, wet weight, wet weight per mm, and bamboo metrics
- keep preview visible while editing

### 2026-04-14: Use fixed dry-weight allowances for adhesive and parchment

Reason:

- the recovered prompt language repeatedly described adhesive as a global `15%` and parchment as a global `1.5%`

Decision:

- compute adhesive total from dry tube weight
- compute parchment total from dry tube weight
- split only the adhesive total by user-selected mix ratio

### 2026-04-14: Keep packaging bound to masters

Reason:

- the user explicitly asked for packaging to be master-data driven

Decision:

- box, plastic sheet, and fadda remain master-backed selectors
- free-text packing fields are reduced to quantity and instruction decisions only

## Known Gaps

- the current repo is not yet proven to be the exact final April 10 source state
- some surfaces may still differ visually from the last polished UI
- recovered datasets may still require more cleanup or import work beyond what survives in the local databases

## Next Recovery Priorities

1. continue checking editor-history artifacts for any later premium UI files
2. keep closing the gap between current spec-sheet fidelity and the last known polished build
3. verify planner, reports, dashboard, and job-card surfaces against surviving screenshots and prompts
