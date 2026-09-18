# Evidence ledger — Hari Om correction pass

Date: 2026-09-18  
Branch: `cursor/ui-polish-nav-c5f9`  
Base SHA: `30263a4ef6592c7bf6e672ca3c2a9b411f39f63f`  
Remote PR10 HEAD: `74f5b45300ce1f121b5efd89f319b0d4e1027b33`  
Local candidate: `5dd8b9b35ba647fe06fac2758609886bb4bf8e67` (**not pushed**)

## Runtime identity

- Isolated UI `http://127.0.0.1:23000` Next 15.5.25 release, BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H`
- BFF `http://127.0.0.1:24000`, services `28001–28008`
- Foreign `127.0.0.1:13000` pid 69663 left running
- node v26.5.0, npm 11.17.0, Playwright 1.59.1, python 3.11.15, pydantic-settings 2.14.2
- `PLAYWRIGHT_CHROME_CHANNEL=chrome`
- Schema tables: auth 10, master 23, spec 8, sales 8, production 22, inventory 32, analytics 1
- Manifest: `hariom-erp/runtime-verify/runtime_manifest.json` consistency PASS 29/29
- Docker: inventory `sha256:eef5d9c383457d8a4d5314317422d7c936a0510b1e3c75f5b6612b242b04e842` tag `hariom-nverify-inventory:faee2ab`; production `sha256:e17529ec1aa42e4ef30df53b7c134eb4a6839fa8800b1baae35ed24e8eebd546` tag `hariom-nverify-production:faee2ab`; mounts `[]`

## Live Postgres (venv-verify, `HARI_OM_LIVE_PG=1`)

```text
inventory live+QC     17 passed
sales live            4 passed
production live+typed+planning+eval  61 passed
auth live+notifications  9 passed
auth test_user_lifecycle.py on hariom_nverify_hardening_test  7 passed
analytics deep_cuts+demand_coverage  8 passed
```

Skipped auth name: `test_user_lifecycle.py` module skip `Requires isolated hardening_test PostgreSQL database` when `DATABASE_URL` lacks `hardening_test`. Closed on `hariom_nverify_hardening_test`.

## Playwright

```text
PLAYWRIGHT_BASE_URL=http://127.0.0.1:23000 PLAYWRIGHT_CHROME_CHANNEL=chrome PLAYWRIGHT_VIDEO=off PLAYWRIGHT_TRACE=retain-on-failure
./node_modules/.bin/playwright test --config playwright.config.cjs --project=chromium --workers=1
# 15 passed (1.3m)
# output/playwright/5dd8b9b35ba647fe06fac2758609886bb4bf8e67-full/
```

Job-card print: `reports/job-card-print.png`. Fixture passwords stay in gitignored `reports/browser_e2e_fixture_latest.json`.

## Intentionally not run / not claimed

| Gate | Why |
| --- | --- |
| Named 56 + original 192 V2 suite | Source gitignored/missing; titles not invented (`docs/review/V2_PACK_PROVENANCE.md`) |
| Live 501+ job-card export | RR28 stays CODE |
| Production/supplier calendar UI | RR27 stays CODE |
| Safari / dual theme (BJ13) | Human UAT |
| Merge / retarget / production mutate (RR36) | Owner approval required |
| git push of this branch | Railway/Render GitHub-app deploy unproven |

## Push blocker

Repo contains `railway.toml` and `hariom-erp/render.yaml`. GitHub Actions, repo hooks, and Environments are empty; `main` is unprotected. That is not enough to prove a push of `cursor/ui-polish-nav-c5f9` will not trigger Railway/Render production. Local commits only.
