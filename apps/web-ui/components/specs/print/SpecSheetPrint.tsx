"use client"

import { Printer } from "lucide-react"
import Image from "next/image"

import { allocateAdhesivePlies } from "@/lib/spec-print"

export type SpecSheetPrintData = {
  company: string
  customer: string
  reference: string
  version: string
  status: string
  preparedDate: string
  validUntil: string
  preparedBy: string
  geometry: Array<{ label: string; value: string }>
  recipe: Array<{
    code: string
    variety: string
    gsm: number
    plyBond: number
    bulk: number
    weight: number
    plies: number
  }>
  adhesive: Array<{ code: string; ratio: number; weight: number }>
  totals: {
    paper: number
    adhesive: number
    parchment: number
  }
  bamboo: {
    wet: Array<{ label: string; value: string }>
    dry: Array<{ label: string; value: string }>
    allowance: Array<{ label: string; value: string }>
  }
  tooling: Array<{ label: string; value: string }>
  packing: Array<{ label: string; value: string }>
  blockers: string[]
  notes: string
  signOff: string
}

type SpecSheetPrintProps = {
  enabled: boolean
  data: SpecSheetPrintData
}

function valueOrDash(value: unknown) {
  const text = String(value ?? "").trim()
  return text || "—"
}

function DetailTable({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value: string }>
}) {
  return (
    <div className="spec-print-mini-table">
      <div className="spec-print-mini-heading">{title}</div>
      <dl>
        {rows.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{valueOrDash(item.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function SpecSheetPrint({ enabled, data }: SpecSheetPrintProps) {
  if (!enabled) return null

  const totalPlies = data.recipe.reduce((sum, row) => sum + row.plies, 0)
  const adhesivePlyCounts = allocateAdhesivePlies(data.adhesive, totalPlies)
  const combinedGsm = data.recipe.reduce((sum, row) => sum + row.gsm * row.plies, 0)

  return (
    <div className="spec-print-preview">
      <div className="spec-print-actions no-print">
        <div>
          <strong>Client-approved one-page specification</strong>
          <span> A4 landscape · live specification values</span>
        </div>
        <button type="button" onClick={() => window.print()}>
          <Printer size={16} /> Print specification
        </button>
      </div>

      <article className="spec-print-sheet" aria-label="Production specification sheet">
        <header className="spec-print-header">
          <div className="spec-print-brand">
            <Image src="/amigo-hariom-logo.svg" alt={valueOrDash(data.company)} width={696} height={102} priority />
            <span>Tube specification sheet</span>
          </div>
          <div className="spec-print-customer">
            <span>Customer</span>
            <strong>{valueOrDash(data.customer)}</strong>
            <small>{valueOrDash(data.reference)}</small>
          </div>
          <div className="spec-print-doc-grid">
            <div><span>Version</span><strong>{valueOrDash(data.version)}</strong></div>
            <div><span>Status</span><strong>{valueOrDash(data.status)}</strong></div>
            <div><span>Prepared</span><strong>{valueOrDash(data.preparedDate)}</strong></div>
            <div><span>Valid until</span><strong>{valueOrDash(data.validUntil)}</strong></div>
          </div>
        </header>

        <section className="spec-print-geometry" aria-label="Finished tube production targets">
          {data.geometry.map((item) => (
            <div key={item.label}><span>{item.label}</span><strong>{valueOrDash(item.value)}</strong></div>
          ))}
        </section>

        <div className="spec-print-four-grid">
          <section className={`spec-print-panel spec-print-recipe ${data.recipe.length > 8 ? "spec-print-compact" : ""}`} data-print-section="recipe">
            <div className="spec-print-section-title">
              <strong>Applied paper recipe</strong>
              <span>{data.recipe.length} paper(s) · {totalPlies} plies</span>
            </div>
            <table>
              <thead>
                <tr><th>Code</th><th>Variety</th><th>GSM</th><th>Plybond</th><th>Bulk</th><th>Weight</th><th>No. of ply</th></tr>
              </thead>
              <tbody>
                {data.recipe.map((row, index) => (
                  <tr key={`${row.code}-${index}`}>
                    <td><strong>{valueOrDash(row.code)}</strong></td>
                    <td>{valueOrDash(row.variety)}</td>
                    <td>{row.gsm.toFixed(0)}</td>
                    <td>{row.plyBond.toFixed(2)}</td>
                    <td>{row.bulk.toFixed(2)}</td>
                    <td><strong>{row.weight.toFixed(2)} g</strong></td>
                    <td><strong>{row.plies}</strong></td>
                  </tr>
                ))}
                <tr className="spec-print-total">
                  <td colSpan={2}>Total selected paper</td>
                  <td>{combinedGsm.toFixed(0)}</td>
                  <td colSpan={2}>Combined GSM</td>
                  <td>{data.totals.paper.toFixed(2)} g</td>
                  <td>{totalPlies}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className={`spec-print-panel spec-print-adhesive ${data.adhesive.length > 4 ? "spec-print-compact" : ""}`} data-print-section="adhesive">
            <div className="spec-print-section-title">
              <strong>Adhesive</strong>
              <span>Parts total 100%</span>
            </div>
            <table>
              <thead><tr><th>Code</th><th>No. of ply</th><th>Part</th><th>Weight</th></tr></thead>
              <tbody>
                {data.adhesive.map((row, index) => (
                  <tr key={`${row.code}-${index}`}>
                    <td>{valueOrDash(row.code)}</td>
                    <td><strong>{adhesivePlyCounts[index]}</strong></td>
                    <td>{row.ratio.toFixed(2)}%</td>
                    <td><strong>{row.weight.toFixed(2)} g</strong></td>
                  </tr>
                ))}
                <tr className="spec-print-total">
                  <td>Total adhesive</td><td>{totalPlies}</td>
                  <td>{data.adhesive.reduce((sum, row) => sum + row.ratio, 0).toFixed(2)}%</td>
                  <td>{data.totals.adhesive.toFixed(2)} g</td>
                </tr>
                <tr className="spec-print-parchment">
                  <td>Parchment</td><td>—</td><td>Dry basis</td><td><strong>{data.totals.parchment.toFixed(2)} g</strong></td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="spec-print-panel spec-print-bamboo-release" data-print-section="bamboo-release">
            <div className="spec-print-section-title"><strong>Wet / dry bamboo targets</strong><span>Whole wound bamboo</span></div>
            <table className="spec-print-bamboo-table">
              <thead><tr><th>State</th>{data.bamboo.wet.map((item) => <th key={item.label}>{item.label}</th>)}</tr></thead>
              <tbody>
                <tr><td><strong>Wet bamboo</strong></td>{data.bamboo.wet.map((item) => <td key={item.label}>{valueOrDash(item.value)}</td>)}</tr>
                <tr><td><strong>Dry bamboo</strong></td>{data.bamboo.dry.map((item) => <td key={item.label}>{valueOrDash(item.value)}</td>)}</tr>
              </tbody>
            </table>

            <div className="spec-print-subheading"><strong>Bamboo allowance</strong><span>Cut, yield and trim control</span></div>
            <div className="spec-print-allowance-grid">
              {data.bamboo.allowance.map((item) => (
                <div key={item.label}><span>{item.label}</span><strong>{valueOrDash(item.value)}</strong></div>
              ))}
            </div>

            <div className="spec-print-release-grid">
              <div><span>Prepared by</span><strong>{valueOrDash(data.preparedBy)}</strong></div>
              <div><span>Production sign-off</span><strong>{valueOrDash(data.signOff)}</strong></div>
              <p><strong>Notes:</strong> {valueOrDash(data.notes)}</p>
              {data.blockers.length ? <p className="spec-print-blockers"><strong>Release blockers:</strong> {data.blockers.join(" · ")}</p> : <p className="spec-print-ready"><strong>Release:</strong> Ready for production</p>}
            </div>
          </section>

          <section className="spec-print-panel spec-print-operations" data-print-section="operations">
            <DetailTable title="Notch & tooling" rows={data.tooling} />
            <DetailTable title="Packing" rows={data.packing} />
          </section>
        </div>

        <footer className="spec-print-footer">
          <span>Controlled production specification · {valueOrDash(data.reference)}</span>
          <strong>{valueOrDash(data.status)}</strong>
        </footer>
      </article>

      <style jsx global>{`
        .spec-print-preview {
          color: #17252d;
          margin: 0 auto;
          max-width: 297mm;
        }
        .spec-print-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          border: 1px solid #d5d9d7;
          border-radius: 12px;
          background: #fff;
          padding: 10px 14px;
          font-size: 13px;
        }
        .spec-print-actions span { color: #64748b; }
        .spec-print-actions button {
          display: flex;
          align-items: center;
          gap: 7px;
          border: 0;
          border-radius: 9px;
          background: #173b47;
          color: #fff;
          padding: 9px 13px;
          font-weight: 800;
        }
        .spec-print-sheet {
          box-sizing: border-box;
          display: flex;
          width: 297mm;
          height: 200mm;
          flex-direction: column;
          overflow: hidden;
          border: 1.2px solid #263740;
          background: #fff;
          padding: 3mm 3.4mm 2mm;
          font-family: Arial, Helvetica, sans-serif;
          box-shadow: 0 20px 70px rgba(15, 23, 42, .12);
        }
        .spec-print-sheet * { box-sizing: border-box; }
        .spec-print-sheet span,
        .spec-print-sheet dt {
          margin: 0;
          color: #526168;
          font-size: 6.2pt;
          font-weight: 800;
          letter-spacing: .055em;
          line-height: 1.15;
          text-transform: uppercase;
        }
        .spec-print-header {
          display: grid;
          grid-template-columns: 1.08fr 1fr 1.08fr;
          align-items: stretch;
          border-bottom: 1.2px solid #263740;
          padding-bottom: 1.8mm;
        }
        .spec-print-brand {
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding-right: 4mm;
        }
        .spec-print-brand img {
          display: block;
          width: 56mm;
          max-width: 100%;
          height: auto;
          object-fit: contain;
          object-position: left center;
        }
        .spec-print-brand span {
          margin-top: 1mm;
          letter-spacing: .18em;
        }
        .spec-print-customer {
          min-width: 0;
          border-left: 1px solid #aeb8bc;
          padding: 1.2mm 3mm;
        }
        .spec-print-customer strong {
          display: block;
          margin-top: 1.1mm;
          font-size: 11pt;
          line-height: 1.05;
          overflow-wrap: anywhere;
        }
        .spec-print-customer small {
          display: -webkit-box;
          margin-top: 1mm;
          overflow: hidden;
          color: #3f4f57;
          font-size: 6.8pt;
          line-height: 1.2;
          overflow-wrap: anywhere;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .spec-print-doc-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border: 1px solid #263740;
        }
        .spec-print-doc-grid div {
          padding: 1.2mm 1.6mm;
          border-right: 1px solid #aeb8bc;
          border-bottom: 1px solid #aeb8bc;
        }
        .spec-print-doc-grid div:nth-child(2n) { border-right: 0; }
        .spec-print-doc-grid div:nth-last-child(-n+2) { border-bottom: 0; }
        .spec-print-doc-grid strong {
          display: block;
          margin-top: .65mm;
          font-size: 7.6pt;
          line-height: 1.1;
          overflow-wrap: anywhere;
        }
        .spec-print-geometry {
          display: grid;
          grid-template-columns: 1.14fr repeat(7, 1fr);
          margin-top: 1.8mm;
          border: 1px solid #263740;
        }
        .spec-print-geometry div {
          min-width: 0;
          border-right: 1px solid #aeb8bc;
          padding: 1.1mm 1.25mm;
        }
        .spec-print-geometry div:last-child { border-right: 0; }
        .spec-print-geometry strong {
          display: block;
          margin-top: .7mm;
          font-size: 8.15pt;
          line-height: 1.08;
          overflow-wrap: anywhere;
        }
        .spec-print-four-grid {
          display: grid;
          min-height: 0;
          flex: 1;
          grid-template-columns: 1.62fr 1fr;
          grid-template-rows: minmax(0, 1.06fr) minmax(0, .94fr);
          gap: 1.8mm;
          margin-top: 1.8mm;
        }
        .spec-print-panel {
          min-width: 0;
          min-height: 0;
          overflow: hidden;
          border: 1px solid #263740;
        }
        .spec-print-section-title,
        .spec-print-subheading {
          display: flex;
          min-height: 5.8mm;
          align-items: center;
          justify-content: space-between;
          gap: 2mm;
          background: #e8edeb;
          padding: 1mm 1.5mm;
        }
        .spec-print-subheading {
          min-height: 5.2mm;
          border-top: 1px solid #7f8b90;
          background: #f5f7f6;
        }
        .spec-print-section-title strong,
        .spec-print-subheading strong,
        .spec-print-mini-heading {
          font-size: 7pt;
          font-weight: 850;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .spec-print-section-title span,
        .spec-print-subheading span { font-size: 5.8pt; }
        .spec-print-sheet table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 7.35pt;
          line-height: 1.12;
        }
        .spec-print-sheet th,
        .spec-print-sheet td {
          border-right: 1px solid #b2bdc1;
          border-top: 1px solid #b2bdc1;
          padding: .7mm 1mm;
          text-align: left;
          vertical-align: middle;
          overflow-wrap: anywhere;
        }
        .spec-print-sheet th {
          background: #fafbfb;
          color: #3e4d54;
          font-size: 6.15pt;
          font-weight: 850;
          letter-spacing: .035em;
          line-height: 1.1;
          text-transform: uppercase;
        }
        .spec-print-sheet th:last-child,
        .spec-print-sheet td:last-child { border-right: 0; }
        .spec-print-recipe table,
        .spec-print-adhesive table { height: calc(100% - 5.8mm); }
        .spec-print-recipe th:nth-child(1) { width: 17%; }
        .spec-print-recipe th:nth-child(2) { width: 20%; }
        .spec-print-recipe th:nth-child(3) { width: 8%; }
        .spec-print-recipe th:nth-child(4) { width: 11%; }
        .spec-print-recipe th:nth-child(5) { width: 10%; }
        .spec-print-recipe th:nth-child(6) { width: 16%; }
        .spec-print-recipe th:nth-child(7) { width: 11%; }
        .spec-print-recipe td:nth-child(1),
        .spec-print-recipe td:nth-child(2),
        .spec-print-adhesive td:first-child {
          line-height: 1.08;
          overflow-wrap: anywhere;
        }
        .spec-print-adhesive th:first-child { width: 47%; }
        .spec-print-adhesive th:nth-child(2) { width: 16%; }
        .spec-print-adhesive th:nth-child(3) { width: 17%; }
        .spec-print-total {
          background: #edf1ef;
          font-weight: 850;
        }
        .spec-print-parchment { background: #fbfaf5; }
        .spec-print-compact table { font-size: 6.55pt; }
        .spec-print-compact th { font-size: 5.75pt; }
        .spec-print-compact th,
        .spec-print-compact td { padding: .45mm .7mm; }
        .spec-print-bamboo-release {
          display: flex;
          flex-direction: column;
        }
        .spec-print-bamboo-table th:first-child { width: 19%; }
        .spec-print-bamboo-table th:not(:first-child),
        .spec-print-bamboo-table td:not(:first-child) { text-align: center; }
        .spec-print-bamboo-table th,
        .spec-print-bamboo-table td { height: 5.4mm; }
        .spec-print-allowance-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
        }
        .spec-print-allowance-grid div {
          min-width: 0;
          border-right: 1px solid #b2bdc1;
          border-top: 1px solid #b2bdc1;
          padding: 1mm 1.05mm;
        }
        .spec-print-allowance-grid div:last-child { border-right: 0; }
        .spec-print-allowance-grid strong {
          display: block;
          margin-top: .6mm;
          font-size: 7.25pt;
          line-height: 1.08;
          overflow-wrap: anywhere;
        }
        .spec-print-release-grid {
          display: grid;
          min-height: 0;
          flex: 1;
          grid-template-columns: 1fr 1fr;
          align-content: stretch;
          border-top: 1px solid #7f8b90;
        }
        .spec-print-release-grid > div {
          padding: 1.1mm 1.4mm;
        }
        .spec-print-release-grid > div + div { border-left: 1px solid #b2bdc1; }
        .spec-print-release-grid > div strong {
          display: block;
          margin-top: .75mm;
          font-size: 7.4pt;
          line-height: 1.08;
          overflow-wrap: anywhere;
        }
        .spec-print-release-grid p {
          grid-column: 1 / -1;
          margin: 0;
          border-top: 1px solid #b2bdc1;
          padding: .8mm 1.4mm;
          font-size: 6.4pt;
          line-height: 1.2;
          overflow-wrap: anywhere;
        }
        .spec-print-blockers { color: #9f1239; }
        .spec-print-ready { color: #126146; }
        .spec-print-operations {
          display: grid;
          height: 100%;
          grid-template-columns: 1.08fr .92fr;
        }
        .spec-print-mini-table {
          display: flex;
          min-width: 0;
          min-height: 0;
          flex-direction: column;
        }
        .spec-print-mini-table + .spec-print-mini-table { border-left: 1px solid #263740; }
        .spec-print-mini-heading {
          display: flex;
          min-height: 5.8mm;
          align-items: center;
          background: #e8edeb;
          padding: 1mm 1.5mm;
        }
        .spec-print-sheet dl {
          display: flex;
          min-height: 0;
          flex: 1;
          flex-direction: column;
          margin: 0;
        }
        .spec-print-sheet dl div {
          display: grid;
          min-height: 0;
          flex: 1;
          grid-template-columns: .86fr 1.14fr;
          align-items: stretch;
          border-top: 1px solid #b2bdc1;
        }
        .spec-print-sheet dt,
        .spec-print-sheet dd {
          display: flex;
          min-width: 0;
          align-items: center;
          margin: 0;
          padding: .65mm 1mm;
          line-height: 1.15;
          overflow-wrap: anywhere;
        }
        .spec-print-sheet dd {
          border-left: 1px solid #b2bdc1;
          font-size: 7pt;
          font-weight: 750;
        }
        .spec-print-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 1.35mm;
          border-top: 1px solid #263740;
          padding-top: .9mm;
        }
        .spec-print-footer strong {
          font-size: 6.5pt;
          letter-spacing: .07em;
        }
        .spec-print-footer span { font-size: 5.7pt; }
        @media print {
          @page { size: A4 landscape; margin: 5mm; }
          html,
          body {
            width: 287mm !important;
            height: 200mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: #fff !important;
          }
          body > * { visibility: hidden; }
          .spec-print-preview,
          .spec-print-preview * { visibility: visible; }
          .spec-print-preview {
            position: absolute;
            inset: 0;
            width: 287mm !important;
            max-width: none !important;
            height: 200mm !important;
            margin: 0 !important;
          }
          .no-print,
          aside,
          nav,
          [data-print-hidden="true"] { display: none !important; }
          .spec-print-sheet {
            width: 287mm !important;
            height: 200mm !important;
            margin: 0 !important;
            border-width: 1px !important;
            padding: 3mm 3.2mm 2mm !important;
            box-shadow: none !important;
            break-inside: avoid !important;
            break-after: avoid !important;
            page-break-inside: avoid !important;
            page-break-after: avoid !important;
          }
          .spec-print-sheet table { break-inside: avoid !important; }
        }
      `}</style>
    </div>
  )
}
