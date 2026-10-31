# Hari Om TubeOS help guide

Everything for user help, built from the 24 chapters in `chapters/`.

| Path | What |
|---|---|
| `chapters/*.md` | The chapters (source of truth). Format rules are in `AUTHORING.md`. |
| `screens/*.jpg` | 110+ live screenshots (1440x900; `m-*` are phone). |
| `glossary.md` | Plain-word glossary. Goes into the NotebookLM pack. |
| `build_guide.py` | Builds `dist/` (HTML handbook) and `notebooklm-pack/sources/`. |
| `make_pdf.cjs` | Prints the HTML to PDF with Playwright. |
| `dist/` | `Hari-Om-TubeOS-Help-Guide.html` (self-contained) and `.pdf`. |
| `notebooklm-pack/` | Sources, bot instructions and setup steps for Google NotebookLM. |

Rebuild:
```bash
python3 -m venv /tmp/hg && /tmp/hg/bin/pip install markdown
/tmp/hg/bin/python docs/help-guide/build_guide.py
cd apps/web-ui && NODE_PATH=$PWD/node_modules node ../../docs/help-guide/make_pdf.cjs
```
