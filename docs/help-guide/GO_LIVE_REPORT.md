# Go-live report: help guide, global Help page and flagged fixes

Prepared 31 Oct 2026 on branch `release/2026-10-18-qc-floor-issue`, built on `2cb8028`. **Nothing is committed or pushed yet.** No backend, database or migration changes. No change to any business flow.

## 1. What goes live

### A. Flagged issues, fixed without changing any flow
These only change wording or which sidebar links are shown. What a role can actually do is unchanged.

| Issue found while writing the guide | Fix | File |
|---|---|---|
| Manual FG link shown to Store, but the server refuses Store when posting | Link now shows for Owner, Admin and Plant Manager only | `app/(dashboard)/layout.tsx` |
| Slitting report link shown to RM issue, but the Reports area blocks that role | Link removed for RM issue | `app/(dashboard)/layout.tsx` |
| Quality analytics link shown to In-process QC, but the Reports area blocks that role | Link removed for In-process QC; the Analytics tab on the QC desk is hidden for In-process-only users | `app/(dashboard)/layout.tsx`, `components/qc/QualityDeskNav.tsx` |
| Customer and Vendor Delete dialogs said "permanently removed", but the server only deactivates | Dialog now says the record is deactivated, history is kept and it can be reactivated | `masters/customers/page.tsx`, `masters/vendors/page.tsx` |
| Holds & inspections said a batch that fails stage QC is held, which contradicts flag-not-hold | Text now describes manual holds only and says stage readings are flagged, not held | `quality/results/page.tsx` |

Left alone on purpose (report only): Accounts role (out of scope), Time reconciliation has no menu link, Debit note Void has no button, Intelligence date boxes do not drive the tiles, sealing a card without plant challan details only warns, wrong-reel issue has no undo.

### B. Global Help
- **Guide page (`/help`) now has three tabs**: *This page's guide*, *Full handbook* and *Chapter PDFs*.
  - The sidebar **Guide** link opens *Full handbook* (all 24 chapters inside TubeOS, searchable, dark mode follows the app).
  - The header book icon still opens *This page's guide* for the page you are on, with a new **Read the full chapter** button.
  - *Chapter PDFs* downloads the whole handbook, any one chapter, or the glossary, Q&A, samples and page index.
- **Sign-in page** has a link, "New here? Read the help guide", that opens the handbook without signing in.
- **In-app page guides rewritten**: 45 guides (was 28), checked against the handbook. 17 new guides (Inbox, Production season, Planning overview, Job card manager, Floor entry, Incoming QC, In-process QC, Holds, Customer complaints, QC standards, PO approvals, Purchase requisitions, GRN register, Reel issue, Issue history, Opening stock). Every guide links to its chapter. Two route changes: `/inventory/raw-material-inward` opens the Raw inward guide and `/settings/production-season` opens the Production season guide.
- **Handbook**: 24 chapters, about 115 screenshots, 48 flow diagrams, worked samples and common questions per chapter.

### C. Files
- Changed: `app/(auth)/login/page.tsx`, `app/(dashboard)/help/page.tsx`, `components/workspace/help-page-client.tsx`, `lib/guide-content.ts`, `lib/workspace-jump.ts`, `e2e/release-gate.spec.cjs` (one expectation moved to the renamed Material issue guide), plus the five files in table A.
- New: `lib/handbook-chapters.ts` (generated), `public/docs/handbook/` (web handbook plus screenshots, 7.8 MB), `public/docs/chapters/` (28 PDFs, about 22 MB), `public/docs/Hari-Om-TubeOS-Help-Guide.pdf` (14.7 MB).
- Removed: `public/docs/Hari-Om-TubeOS-Client-Guide.html` and `.pdf` (22 Sep versions, kept in `docs/help-guide/_previous-22-sep/`).
- Docs and tools (not part of the app): `docs/help-guide/` (chapters, screenshots, build scripts, NotebookLM pack, tools report).

## 2. Checked
- `tsc --noEmit`: clean.
- `npm test` (static validators including help coverage, route canonical and dark theme, plus the unit suites): all pass.
- `next lint` on the changed files: clean.
- In the browser (local stack): all three Help tabs, the chapter deep link, the iframe handbook, the login link, guide pages for Sales, Purchase and Material issue. The assertions of the guide e2e test were replayed by hand and pass.
- Screenshots were scanned for real customer, vendor and user names and emails; all were replaced with fictional ones before publishing.

**Not run:** the Playwright e2e suites (they need the runtime manifest and fixture files), `next build`, and Python tests (no backend change).

## 3. Things to know before release
- **Public files.** Everything under `public/docs` is served without signing in (same as the old guide). The handbook explains how TubeOS works and uses fictional sample names; it contains no live data. The sign-in link is deliberate. Remove it from `login/page.tsx` if you prefer the handbook to be sign-in only (then it also needs to move out of `public`).
- **Size.** About 45 MB of new static files. Fine for the image, but it grows the repository by that much. If that matters, the 21 MB of chapter PDFs can be dropped from the app (they stay in the NotebookLM pack) and the tab hidden.
- **Disk.** Check free disk of at least 10 GB on the host before the release, as in earlier releases.
- **Rollback.** Front-end only. The previous image tag restores the old Guide page.

## 4. Release steps (you run these)
1. Review `git status`, commit on `release/2026-10-18-qc-floor-issue` (ask Claude to commit with a message if wanted) and push.
2. In CloudShell: `curl -fsSL https://raw.githubusercontent.com/dev2495/hari-om-paper-2-local-recovery/<new-sha>/deploy/aws-ec2/cloudshell_release.sh | bash -s <new-sha> <currently-live-sha>`. The live sha is `2cb8028` if that release was accepted, otherwise the last confirmed one (`9b58a04`). A wrong second value stops safely with "Live release changed; stop and review".
3. Success line: "Release accepted".
4. Smoke test: sign in, open **Guide** (three tabs, handbook loads, a chapter PDF downloads), open a page guide with the book icon, open the sign-in page in a private window and click the help link, check Orders and Quality still open as before.

## 5. NotebookLM
`docs/help-guide/notebooklm-pack/`: upload the 28 PDFs in `sources/`, paste `BOT_INSTRUCTIONS.txt` into chat settings, share as chat only. Steps are in `README_SETUP_NOTEBOOKLM.md`. A zip of the pack is at `docs/help-guide/dist/Hari-Om-TubeOS-NotebookLM-Pack.zip`.

## 6. Tools
See `docs/help-guide/TOOLS_REPORT.md` (read-only report, no change made).
