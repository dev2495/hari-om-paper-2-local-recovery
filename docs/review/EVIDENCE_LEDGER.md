# Evidence ledger — Hari Om correction pass

Date: 2026-09-17  
Branch: `cursor/ui-polish-nav-c5f9`  
Base SHA: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`

## Commands run (this machine)

Local venv: repo-root `.venv` (Python 3.11). Not committed.

```text
PYTHONPATH=src pytest tests/test_quality_eval.py tests/test_quality_pass_rate.py
# production-service → 18 passed

PYTHONPATH=src pytest tests/test_due_risk.py tests/test_pending_by_order.py tests/test_quality_eval.py tests/test_quality_pass_rate.py
# production-service → 24 passed

PYTHONPATH=src pytest tests/test_pending_and_schedules.py tests/test_sales_commercial.py
# sales-service → 24 passed

PYTHONPATH=src pytest tests/test_sales_logic.py tests/test_open_demand.py
# sales-service → 13 passed

PYTHONPATH=src pytest tests/test_qc_profile.py
# spec-service → 4 passed

PYTHONPATH=src pytest tests/test_concession_and_profile.py
# inventory-service → 7 passed

PYTHONPATH=src pytest tests/test_notification_plant_scope.py
# auth-service → 8 passed

PYTHONPATH=src pytest tests/test_demand_coverage.py
# analytics-service → 5 passed

cd apps/web-ui && npm ci --include=dev && npm run test:unit
# 23+2+20+sales-order-entry+2+8+13+10 passed
```

`python -m py_compile` on all touched Python modules: **PASS** after repairing a missing `}` in `inward.py`.

## Playwright

```text
npx playwright test --list
```

**NOT_RUN / blocked.** Specs load runtime fixtures at import:

- missing `hariom-erp/.runtime/runtime_manifest.json`
- missing `reports/browser_e2e_fixture_latest.json`

No local UI at `http://127.0.0.1:13000` was exercised. Browser/UAT remains an owner gate.

## Intentionally not run

| Gate | Why |
| --- | --- |
| Full named 192 V2 suite | Additive RR tests only; pack not substituted |
| `test_quality_typed_validator.py`, planning router tests | Local `.venv` lacks `pydantic_settings` (no extra pip in this pass) |
| Overlapping Postgres workers (RR03/RR13) | Needs live DB + two sessions |
| Docker image boot (RR35) | No rebuild/deploy |
| Merge / retarget / production mutate (RR36) | Owner approval required |

## Defect found during compile

`inventory-service/src/routers/inward.py` had an unclosed dict after the pin insert. Closed before commit. Receipt pin still runs after metadata is built.
