# Reasons second pass: Agent JOB's reason inputs (owner decision 4), as built on 1 Nov 2026

The first pass converted every reason input outside Agent JOB's files. This second pass converted the inputs inside them, after Agent JOB had finished; every file was re-read first. Nothing is committed.

## Building blocks (first pass, unchanged)

- **Categories and standard codes:** `masterdata-service/src/reason_catalog.py`. They are seeded once per plant and list by `reason_seed.py` (table `reason_seed_log`).
- **Master data endpoint:** `POST /master/reason-codes/validate` with `{category, reason_code, reason_note, plant_id}`. It checks that the code is active, in the right list and of the record's plant, and that an OTHER code has a note of 5+ characters.
- **Server helper:** `src/reasons.py` in the production, sales and inventory services (`resolve_reason`, `reason_input`, `token_of`). It refuses free text alone (422) and answers 503 if master data is down.
- **UI:** `@/components/reasons`: `ReasonPicker` (use `compact` on floor screens and dialogs), `useReasonChoice`, `storedReasonText`.
- **Storage:** every record keeps the code, the label at that moment and the note. The old text field still gets "Label — note", so older screens and prints read the same.
- **Tests:**
  - The production and sales `tests/conftest.py` answer the master check under pytest: any code is valid, with its code in words as the label; a code starting with `BAD` is refused.
  - Inventory has the same stand-in.

## What was converted

| Action | Category | Server (owning service) | Stored | UI |
|---|---|---|---|---|
| Job card **close early / cancel**, bulk close | JOB_CARD_CLOSE | `production lifecycle.py` force-close; code required | `job_cards.close_reason` (text) + new `close_reason_code`, `close_reason_label`, `close_reason_note`; audit has code + label; code + label sent to the sales return of the balance | `job-card-actions.tsx` (quick-reason buttons removed), bulk close in `job-card-manager.tsx` |
| **Split**, **edit qty / colour**, **emergency insert** | JOB_CARD_CHANGE | `lifecycle.py`; code required (split and edit used to be optional on the server) | audit payload code / label / note; the edit's text goes to the sales release-lot audit | `job-card-actions.tsx` dialogs |
| **Stage closed short (V2)** | STAGE_SHORT_CLOSE | `entries.py` close stage; code required only when the stage closes short | stage `actuals_snapshot`: `close_reason` + `close_reason_code`, `_label`, `_note`; the balance returned to the order carries code + label (`short_close.apply_short_close(..., reason_code, reason_label, reason_note)`) | `CloseStageDialog.tsx` (`close-stage`) |
| **Leftover input** hold / scrap at stage close; resolving held leftover | LEFTOVER_INPUT | `entries.py`; required when leftover qty > 0 (`residual_reason_code` / `residual_reason_note`) | snapshot `residual_reason*`; `continuous_residual_wip.reason` + new `reason_code`, `reason_label` | `CloseStageDialog.tsx` (`close-stage:leftover`), `ResidualWipPanel.tsx` (`residual-resolve`) |
| **Floor rejection** (any stage, phone and PC) | SCRAP ("Floor rejection") | `entries.py`: a code is required when rejected qty > 0 or for a cutting loss (`details.reject_code` + `reject_note`); old `OT` maps to `RJ-OTHER` | `details.reject_code`, `reject_label`, `reject_note`, `reject_reason` (text) | `LogOutputForm.tsx` (`log-output:reject`) replaces the fixed 11-code list; `rejectCodeText` kept only to read old runs; whole-card form (`whole-card:reject`) |
| **Overrides**: over-production, carryover, QC / planner gate | OVERRIDE | `entries.py`: each override takes `<key>_code` / `<key>_note` (`overproduction_reason_code`, `carryover_reason_code`, `qc_gate_override_reason_code`); one shared `override_reason_code` / `override_reason_note` covers any override without its own code | text key + `_code`, `_label`, `_note` in entry `details` | `LogOutputForm.tsx` (`log-output:override`), whole-card form (`whole-card:override`) |
| **Void an entry**, **correct readings**, **reopen a stage** | ENTRY_CORRECTION | `entries.py`; code required | `continuous_entry_revisions.reason` + new `reason_code`, `reason_label`; reopen keeps `reopen_reason*` on the stage snapshot | `RunList.tsx` (`run-void`), `JobCardPage.tsx` (`reopen-stage`), `LogQcForm.tsx` (`log-qc:correction`) |
| Retry posting, "Reviewed draft" submit, first QC readings | none (system text) | A code is checked only if one is sent | as before | none |
| **Old-form (V1) stage completed below plan** | STAGE_SHORT_CLOSE | `planning.py` stage output: `short_reason_code` / `short_reason_note`. Nothing sent gives 409 `SHORT_REASON_REQUIRED`; free text alone gives 422; it no longer falls back to `override_reason` | `short_reason` text + code / label / note; balance return carries them | V1 stage form: picker `v1-short-<STAGE>`, server message shown on the form at `v1-short-<STAGE>-message` (no longer swallowed) |
| Old-form **override** (hold / prior stage / final QC / capacity gates) | OVERRIDE | `planning.py`: `override_reason_code` + `override_reason_note`. Any override sent is checked once; free text alone gets 422. Gate logic and role checks are unchanged (an Operator who sends an override now gets its 403 earlier in the request) | `override_reason` = "Label — note" wherever it was used; code / label / note in the stage `actuals_snapshot`; code + label on the audit | `JobCardDocument.tsx` (`v1-override-<STAGE>`) |
| Old-form **rejected pieces** (Winder, Oven, Process) | SCRAP | `planning.py`: rejected qty > 0 needs a code (`reject_reason_code` or `rejection_code`; note from `reject_reason_note` or the old `reject_reason`); `OT` maps to `RJ-OTHER`. New for Winder and Oven, which did not ask before | entry snapshot `reject_reason_code`, `_label`, `_note`, `reject_reason` | `JobCardDocument.tsx` (`v1-reject-WINDER`, `v1-reject-OVEN`, `v1-reject-PROCESS`) |
| **Retain surplus** | SURPLUS_RETAIN | `dispatch_surplus.py`; code required | settlement + audit code / label / note; the box-return reason "Boxes kept as surplus: Label — note" | `RetainSurplusButton.tsx` |
| **Card shortage at final QC** | SHORT_CLOSE | already strict (`operations.py`); now also passes label + note to the sales line short close | `job_card_short_close.reason_label`, `reason_note` | `JobCardShortagePanel.tsx` now uses `ReasonPicker` and sends `reason_note` |
| **Sales: stage / force-close returns** (`release_returns.py`, reverse too) | (production's code) | sales stores what production checked; no second master call | `sales_order_release_lot_returns.reason_code`, `reason_label`, `reason_note`, `reverse_reason_code`, `reverse_reason_label`; `sales_order_release_lots.returned_reason*` | order timeline "balance returned … — Label" |
| **Sales: SO line short close from a card shortage** | SHORT_CLOSE | `sales_orders.py` accepts `reason_label` / `reason_note` | order notes line "Label (CODE) — note" + audit | none |
| **Store books unlock** (inventory `books.py`) | BOOKS_UNLOCK | code now required for every caller. Production's re-open passes the Owner's code. Production's automatic undo of a close that did not finish sends `rollback: true`, which is accepted without a code only while the lock is under 15 minutes old, and records the fixed text "Month-end close did not finish (undone automatically)" | lock history code / label / note | month-end re-open dialog (first pass) |
| Missed slot (36 h sweep) | none | system flag, nobody is asked | | |

**V1 note.** The old form shows the below-plan reason picker only after the server's 409 `SHORT_REASON_REQUIRED`, and shows that message on the form. Working out "below plan" in the browser would copy the server's target logic (effective target, previous stage output).

**Checked in the browser on the local stack, 1 Nov 2026:**
- **Floor rejection:** Save stays off until a code is picked. WL + note stored `reject_label` "Winding loose".
- **Process closed short:** SS-MATERIAL-SHORT + LI-NEXT-RUN closed it. The 610 pcs returned to the order carry the code and label in sales.
- **Card cancelled** with JC-RELEASED-TWICE: `close_reason_code`, `_label` and `_note` stored.
- **Split** with CH-MACHINE-LOAD saved.
- **Bulk force close:** the picker shows. No local V1 card is part-made, and batch-entry cards close through Close stage, so force close was checked by tests and curl.
- **Retain surplus:** no card on the local stack can retain surplus yet; checked by tests.

Other fixes:
- Inline picker errors carry `data-no-mirror`, so the bottom-right banner no longer repeats "Choose a reason…".
- The live QC tests (`test_original_qc_live.py`, `qct051`, `qct065`) now release holds with a QC_RELEASE code.

## Columns added in this pass (startup DDL + models)

- **production:**
  - `job_cards`: `close_reason_code`, `close_reason_label`, `close_reason_note`
  - `continuous_entry_revisions`: `reason_code`, `reason_label`
  - `continuous_residual_wip`: `reason_code`, `reason_label`
- **sales:**
  - `sales_order_release_lots`: `returned_reason`, `returned_reason_code`, `returned_reason_label`, `returned_reason_note`
  - `sales_order_release_lot_returns`: `reason_code`, `reason_label`, `reason_note`, `reverse_reason_code`, `reverse_reason_label`

## Tests

- **New:**
  - production `test_reason_codes_job_cards.py` and `test_reason_codes_floor.py`
  - sales: additions in the reason and stage-return tests
  - inventory: books rollback tests
- **Updated:** the existing lifecycle, entries, floor-round, box short-close, card-time and V1 tests, plus `apps/web-ui/__tests__/floor-drafts.test.ts`.
