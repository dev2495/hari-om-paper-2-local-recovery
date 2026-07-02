# Purchase, Inward, QC, QR Lifecycle Plan

Date: 2026-07-03

## Client Inputs Captured

- Reel inward screenshot columns: serial no, inward date, mill, plybond, variety, GSM, mill reel no, reel weight, Amigo no, slitted/regular, issued flag, issued date, PO, bill, bill date, rate.
- Adhesive/tank inward screenshot columns: serial no, inward date, party name, product, item name, tank no, tank weight, Amigo no, issued flag, issued date, bill, bill date, rate, weight out, wastage.
- Purchase order sample fields: PO no/date, vendor name/contact/address/GST, item, width, GSM, plybond, bulk, COBB, rate, quantity, amount, delivery/payment/test-report terms, special instruction.
- User decision: add location to inward capture.
- User decision: Amigo no is the human-readable item label and QR label identifier.
- User decision: paper quality details come from master, are shown as locked facts during inward, and are not edited on the inward screen.
- User decision: same inward pattern will support reel, adhesive, parchment, and bulk. Parchment capture is kept to vendor, color, thickness, pattern code, quantity/rate, bill, location, and QC status until client sends more detail.

## Implementation Decisions

- Keep the existing inventory lifecycle: purchase order, direct inward, reel inward, QC hold, labels, stock issue, and reports.
- Store client-specific inward fields in structured metadata snapshots on the existing stock objects instead of creating a separate ledger.
- For reels, use `paper_reels.reel_code` as the Amigo number. The QR payload and printed label display this same Amigo number.
- For bulk materials, use `stock_batch.batch_no` as the Amigo number unless the operator enters one. Labels print the same batch/Amigo number.
- Fresh inward remains `QC_HOLD` or `BLOCKED`. Production issue can only use `UNRESTRICTED` stock after QC release.
- Paper quality values shown on reel inward come from the master paper selection in the UI and are submitted as a locked master snapshot. Free GSM/BF entry is removed from the page.
- Purchase order generation is expanded with printable business fields while preserving the current approval and GRN API.
- Reports must surface stock-as-on style rows with Amigo no, supplier/vendor, bill, PO, location, QC status, issue date, rate, and item-specific fields.

## Build Checklist

- [x] Backend schema supports inward metadata on reels, stock batches, purchase orders, and purchase lines.
- [x] Reel inward API accepts client screenshot fields, locks paper facts into snapshots, forces QC hold, and returns a QR label using Amigo no.
- [x] Bulk/raw inward API accepts adhesive/parchment/bulk template fields, forces QC hold, and returns a QR label using Amigo no.
- [x] Purchase API accepts printable PO fields and line quality/description metadata.
- [x] Stock report API returns reel/batch stock rows matching the client stock-as-on format.
- [x] Reel inward UI shows locked master paper facts, client fields, location, QC hold, QR label preview, and recent stock report rows.
- [x] Raw inward UI shows material-type-specific fields for adhesive, parchment, and bulk with QR label output.
- [x] Purchase UI can create, approve, print, and receive POs with the sample business fields.
- [x] Frontend and backend tests cover the new lifecycle contracts.
- [x] Local verification passes.
- [ ] Git commit is created.
- [ ] Railway deployment succeeds and live smoke checks pass.
- [ ] Final client-ready non-technical report is written only after all items above are done.
