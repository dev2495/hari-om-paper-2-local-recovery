# Hari Om TubeOS help bot: set it up in Google NotebookLM (10 minutes)

Everything NotebookLM needs to answer staff questions about TubeOS in plain words, with steps, screen names, rules and worked samples. Accurate as of 8 November 2026 (gate desk, Doc Vault, incoming QC by bill and weight-short debit notes included).

## What is in this pack

| Item | What it is | Use |
|---|---|---|
| `sources/` (31 PDFs) | One PDF per handbook chapter (S00 to S29, with screenshots and flow diagrams), S30 the 2 Nov 2026 add-on (operator scan, phone screens, possible duplicate customers), S31 Gate desk and visitors, S32 Doc Vault, S90 glossary, statuses and number formats, S91 all questions and answers, S92 all worked samples, S93 page index with who can see what | **Upload all 31 as sources** |
| `BOT_INSTRUCTIONS.txt` | The bot's personality and answering rules | Paste into chat settings (step 3) |
| `Hari-Om-TubeOS-Help-Guide.html` | The same handbook as one searchable web page with clickable screenshots | Share with users so they can see pictures (the bot cannot show images) |
| `sources-markdown/` | Plain-text copies of the same 31 sources | Backup only. Use these if a PDF ever fails to import |

31 sources fit NotebookLM's free limit of 50 per notebook, leaving room for about 19 more (for example your own SOPs).

## Steps

1. Open https://notebooklm.google.com and sign in with the Google account that will own the bot. Click **New notebook**.
2. **Add sources**: select all 31 files in `sources/` and drop them in together. Wait until every file shows a tick.
3. Open the chat settings (Configure chat). Choose **Custom** style, paste all of `BOT_INSTRUCTIONS.txt` into the box, set response length to **Default** (or **Longer** for more detail) and save.
4. Test with the questions below. Open a citation to confirm the answer comes from the right source.
5. **Share**: click **Share**, add the staff emails (or turn on link sharing) and choose **Chat only** so people can ask questions but cannot see or change the sources. Button names change from time to time; pick the option that lets people chat without editing.
6. Give users the handbook too: the Guide page inside TubeOS (sidebar **Guide**), or the `.html` file. The bot ends its answers with "See the handbook: Chapter NN".

## Test questions

- How do I release a sales order to the winder queue?
- The operator logged a run but the card says "not planned yet". Is that a problem?
- A reel failed incoming QC. Can the store still issue it?
- What does "Flagged QC" mean on a job card?
- Who can approve a purchase order and where do I do it?
- Why is my GRN number P/26/014 in January?
- What do I do on the phone when I scan a job card?
- Explain the whole flow from customer PO to dispatch.
- A truck is leaving. What does the watchman do, and who types the Tally bill number?
- QC weighed a bill 30 kg short. What happens now?
- Where do I find the photo of a vendor bill for reel AIT 06283?
- मुझे ओवन में रीडिंग फ्लैग हुई है, अब क्या करें? (Hindi)

## Keep it up to date

1. Edit the chapter in `docs/help-guide/chapters/`.
2. From the repo root run `python3 docs/help-guide/build_guide.py` (needs the `markdown` package), then in `apps/web-ui` run `NODE_PATH=$PWD/node_modules node ../../docs/help-guide/make_pdf.cjs` and `NODE_PATH=$PWD/node_modules node ../../docs/help-guide/make_chapter_pdfs.cjs` (they use the Playwright shell, or Google Chrome if that is missing), then `python3 docs/help-guide/build_guide.py --publish` (this also updates the in-app Guide page files). If you replaced a screenshot under an old name, delete its copy in `dist/.small/` first.
3. In NotebookLM delete each changed source and upload the new PDF.

## Good to know

- NotebookLM answers only from the uploaded sources. If something is not covered the bot should say so (the instructions ask for that).
- Sample names (Sharma Tubes Pvt Ltd, Bharat Paper Mills) and numbers are examples. Real customer names were replaced in every screenshot.
- Do not upload passwords, live customer data or anything private.

## Add-ons

When TubeOS changes after the handbook, a short add-on PDF is added to `sources/` (for example `S30_addon-2026-11-02-...pdf`). If the notebook already exists, just upload the new add-on as one more source; nothing else needs to change. Larger updates come with an `UPDATE_<date>.md` that lists exactly which sources to delete, replace and add (latest: `UPDATE_2026-11-08.md`).
