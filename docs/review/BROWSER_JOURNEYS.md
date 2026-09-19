# Browser journeys

Additive BJ01–BJ13. These are **not** the original 192 V2 cases.

## Chromium (Google Chrome channel)

- Binding: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:23000`, `PLAYWRIGHT_CHROME_CHANNEL=chrome`
- Served origin: `http://127.0.0.1:23000` BUILD_ID `Jsi64h520Xs_8mFfUP9Qr` (QCT-056 correction audit). Prior `peLxekyXOJkjRqV0nc9oN` unknown-cause + common-cause + Tab-from-FAIL-reading.
- Focused QCT-056: **1 passed / 0 failed** in 5.2s — `output/playwright/Jsi64h520Xs_8mFfUP9Qr-qct056-after-books/`
- Focused QCT-051+053 after that bind: **2 passed / 0 failed** in 6.1s — `output/playwright/Jsi64h520Xs_8mFfUP9Qr-qct051-053-after-056/`
- Focused QCT-045+051/053/054/055 on peLxeky: **5 passed / 0 failed** in 12.5s — `output/playwright/peLxekyXOJkjRqV0nc9oN-qct045-055/`
- Full Chromium on peLxeky: **34 passed / 8 failed** in 6.9m after isolated auth `:28001` died — `output/playwright/peLxekyXOJkjRqV0nc9oN-full/`
- Those 8 BJ logins re-ran **8 passed / 0 failed** in 13.2s after auth restore — `output/playwright/peLxekyXOJkjRqV0nc9oN-bj-tail/`
- Combined bind on peLxeky is 42/42 across two process groups, not one uninterrupted 42/42. Full Chromium on `Jsi64h520Xs_8mFfUP9Qr`: **42 passed / 1 failed** in 4.2m — `output/playwright/Jsi64h520Xs_8mFfUP9Qr-full-after-056/` (QCT-037 GET status empty).
- Includes BJ01–BJ12 surfaces plus `e2e/original-partials.spec.cjs` (QC-01, COMM-08, INC-02, QCT-029–056)
- First failures on earlier served UIs (diagnosed, then patched):
  1. QC-01 — `getByText('Quality Control')` strict-mode 4 matches; scoped to `page-header` exact text
  2. COMM-08 — `localStorage` before a document (SecurityError); cookie login after `/login`
  3. INC-02 — password `fill` detached during login rerender; cookie/API login for the QC 403 path
  4. QCT-029 — overlay `onKeyDown` Escape never fired while a spinbutton had focus; Back is the original close, capture-phase window Escape added
  5. Tooling BJ — compact job card omitted Physical Tool Issue; always render `data-testid=physical-tool-issue`
  6. QCT-031 — empty-threshold Save draft was treated as QC setup missing instead of an assigned incomplete draft
- Theme / a11y / print add-on still 6 passed historically (3 light + 3 `chromium-dark`)
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
