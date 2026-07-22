# Specification Sheet Print Design QA

Date: 2026-07-22

## Compared states

- Client markup: `WhatsApp Image 2026-07-22 at 14.06.40.jpeg`
- Client hand sketch: `WhatsApp Image 2026-07-22 at 14.24.49.jpeg`
- Browser implementation: `output/audit/spec-print-client-2026-07-22/local-print-sheet-final-font.png`
- Rendered one-page PDF: `output/pdf/rendered/spec-sheet-client-layout.png`

## Client-layout coverage

- Uses the supplied Amigo Industries / Hariom Paper Products logo asset rather than a placeholder mark.
- Header is limited to customer, version, status, prepared date, and validity.
- The requested production strip contains mandrel/ID, OD, length, dry weight, CS, thickness, moisture loss, and pieces per bamboo.
- Removed the crossed-out calculated KPI strip from the print document.
- Paper recipe contains code, variety, GSM, plybond, bulk, weight, and number of plies; row count and total plies are visible.
- Adhesive breakdown contains code, integer ply allocation, percentage part, live weight, total adhesive, and parchment.
- Wet and dry bamboo targets contain ID, OD, length, weight, and CS.
- Bamboo allowance shows usable length, finished length, trim length, finished wet/dry, and trim wet/dry.
- Notch/tooling and packing are compact side-by-side blocks in the exact requested operating order.
- Prepared-by, production sign-off, notes, release blockers, controlled-document identity, and live status remain visible.

## Visual and print checks

- Browser print sheet measured 1,122.52 px by 755.90 px with `scrollHeight === clientHeight` (754 px); no content overflows the print sheet.
- A4 landscape PDF inspection reports exactly one page at 841.92 x 595.20 points.
- The rendered PDF has no cropped tables, overlapping labels, broken borders, split rows, or detached footer.
- Dense recipe text remains legible while the page preserves the client's compact factory-document hierarchy.
- Empty recipe/tool/packing capacity stays inside its assigned panel rather than creating extra pages.

## Data and behavior checks

- Approved legacy recipe snapshots now fall back to authoritative recipe layers when old JSON rows do not carry paper IDs, preserving real master data in print.
- Paper rows retain distinct master identity and group only matching papers; the populated QA record renders six paper rows and fourteen plies.
- Adhesive percentage splits are converted to whole-number plies with a largest-remainder allocation, and the allocated plies always equal total recipe plies.
- Paper and adhesive limits remain supported by the production form: ten distinct paper masters, twenty-five total plies, and six adhesive components.

final result: passed
