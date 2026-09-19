# Browser journeys

Additive BJ01–BJ13. These are **not** the original 192 V2 cases.

## Chromium (Google Chrome channel)

- Binding: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:23000`, `PLAYWRIGHT_CHROME_CHANNEL=chrome`
- Served origin: `http://127.0.0.1:23000` BUILD_ID `RuDVwRuPutn9QGHEBn6so` (QCT-050 complete job card returns hidden-stage issues; form data stays)
- Full Chromium project through QCT-053: **40 passed / 0 failed** (`--workers=1`, 2.0m) — `output/playwright/RuDVwRuPutn9QGHEBn6so-full-after-051-053/`
- Focused QCT-051/053 Chromium: **2 passed / 0 failed** in 5.6s — `output/playwright/RuDVwRuPutn9QGHEBn6so-qct051-053-csrf/`
- Includes BJ01–BJ12 surfaces plus `e2e/original-partials.spec.cjs` (QC-01, COMM-08, INC-02, QCT-029–053)
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
