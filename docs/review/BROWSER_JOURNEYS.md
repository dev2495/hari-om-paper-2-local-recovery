# Browser journeys

Additive BJ01–BJ13. These are **not** the original 192 V2 cases.

## Chromium (Google Chrome channel)

- Binding: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:23000`, `PLAYWRIGHT_CHROME_CHANNEL=chrome`
- Harness SHA: `5dd8b9b35ba647fe06fac2758609886bb4bf8e67`
- Served origin: `http://127.0.0.1:23000` BUILD_ID `Yz4l4-NEecxcN4k1Xtf_H` product `d071d12`
- Full gate: **15 passed / 0 failed** (BJ01–BJ12) — `output/playwright/5dd8b9b35ba647fe06fac2758609886bb4bf8e67-full/`
- Theme / a11y / print add-on (`e2e/theme-a11y-print.spec.cjs`): **6 passed** (3 light + 3 `chromium-dark` emulated `colorScheme`) — `output/playwright/6f50a76d65b5715427b57ec05e53b0ce12d4ea8f-theme/` and `reports/nverify-6f50a-exec/playwright_chromium_theme.txt`
- PLAN-09 keyboard / 390px (`e2e/planner-keyboard-narrow.spec.cjs`): **1 passed** on Chromium against `http://127.0.0.1:23000` — `reports/nverify-5187a-exec/plan09_pw.txt`
- Dual visual theme toggle is **not** a product feature (porcelain light CSS). Emulated light/dark remains readable; that is not BJ13.

## Playwright WebKit (not Safari.app)

- Status: **BLOCKED**. `playwright install webkit` did not finish extracting the browser (`libwebrtc.dylib` only; no `pw_run.sh`). Theme spec failed with “Executable doesn't exist”.
- Evidence: `reports/nverify-6f50a-exec/playwright_webkit.txt`
- Next: complete `npx playwright install webkit` in `apps/web-ui`, then rerun `--project=webkit`.

## Actual Safari.app

- Status: **BLOCKED** pending owner permission.
- `safaridriver --enable` prompted for an administrator password and failed (`Password is not valid`) in this sandbox.
- Playwright WebKit is not a substitute for Safari.app on client devices (BJ13).

## Human UAT (open)

- BJ13 Safari / dual implemented visual themes: **NOT_RUN**
- QCT-120 full client cycle: **NOT_RUN**
