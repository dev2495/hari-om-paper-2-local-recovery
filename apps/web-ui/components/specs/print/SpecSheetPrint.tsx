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

        <div className="spec-print-primary-grid">
          <section className="spec-print-panel spec-print-recipe">
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

          <section className="spec-print-panel spec-print-adhesive">
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
        </div>

        <div className="spec-print-secondary-grid">
          <div className="spec-print-bamboo-column">
            <section className="spec-print-panel spec-print-bamboo">
              <div className="spec-print-section-title"><strong>Wet bamboo / dry bamboo targets</strong><span>Whole wound bamboo</span></div>
              <table>
                <thead><tr><th>State</th>{data.bamboo.wet.map((item) => <th key={item.label}>{item.label}</th>)}</tr></thead>
                <tbody>
                  <tr><td><strong>Wet bamboo</strong></td>{data.bamboo.wet.map((item) => <td key={item.label}>{valueOrDash(item.value)}</td>)}</tr>
                  <tr><td><strong>Dry bamboo</strong></td>{data.bamboo.dry.map((item) => <td key={item.label}>{valueOrDash(item.value)}</td>)}</tr>
                </tbody>
              </table>
            </section>

            <section className="spec-print-panel spec-print-allowance">
              <div className="spec-print-section-title"><strong>Bamboo allowance</strong><span>Cut, yield and trim control</span></div>
              <div className="spec-print-allowance-grid">
                {data.bamboo.allowance.map((item) => (
                  <div key={item.label}><span>{item.label}</span><strong>{valueOrDash(item.value)}</strong></div>
                ))}
              </div>
            </section>

            <section className="spec-print-panel spec-print-prepared">
              <div><span>Prepared by</span><strong>{valueOrDash(data.preparedBy)}</strong></div>
              <div><span>Production sign-off</span><strong>{valueOrDash(data.signOff)}</strong></div>
              <p><strong>Notes:</strong> {valueOrDash(data.notes)}</p>
              {data.blockers.length ? <p className="spec-print-blockers"><strong>Release blockers:</strong> {data.blockers.join(" · ")}</p> : <p className="spec-print-ready"><strong>Release:</strong> Ready for production</p>}
            </section>
          </div>

          <section className="spec-print-panel spec-print-operations">
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
        .spec-print-preview{color:#17252d;margin:0 auto;max-width:297mm}.spec-print-actions{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border:1px solid #d5d9d7;border-radius:12px;background:#fff;padding:10px 14px;font-size:13px}.spec-print-actions span{color:#64748b}.spec-print-actions button{display:flex;align-items:center;gap:7px;border:0;border-radius:9px;background:#173b47;color:#fff;padding:9px 13px;font-weight:800}.spec-print-sheet{box-sizing:border-box;width:297mm;height:200mm;overflow:hidden;border:1.2px solid #263740;background:#fff;padding:3mm 3.4mm 2mm;font-family:Arial,sans-serif;box-shadow:0 20px 70px rgba(15,23,42,.12)}.spec-print-sheet *{box-sizing:border-box}.spec-print-sheet span,.spec-print-sheet dt{margin:0;font-size:5.6pt;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#68767d}.spec-print-header{display:grid;grid-template-columns:1.08fr 1fr 1.08fr;align-items:stretch;border-bottom:1.2px solid #263740;padding-bottom:1.7mm}.spec-print-brand{display:flex;min-width:0;flex-direction:column;justify-content:center;padding-right:4mm}.spec-print-brand img{display:block;width:54mm;max-width:100%;height:auto;object-fit:contain;object-position:left center}.spec-print-brand span{margin-top:1mm;letter-spacing:.2em}.spec-print-customer{min-width:0;border-left:1px solid #aeb8bc;padding:1mm 3mm}.spec-print-customer strong{display:block;margin-top:1.2mm;font-size:10pt;line-height:1.05}.spec-print-customer small{display:block;margin-top:1mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:6pt;color:#4a5961}.spec-print-doc-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #263740}.spec-print-doc-grid div{padding:1mm 1.5mm;border-right:1px solid #aeb8bc;border-bottom:1px solid #aeb8bc}.spec-print-doc-grid div:nth-child(2n){border-right:0}.spec-print-doc-grid div:nth-last-child(-n+2){border-bottom:0}.spec-print-doc-grid strong{display:block;margin-top:.5mm;font-size:7pt}.spec-print-geometry{display:grid;grid-template-columns:1.12fr repeat(7,1fr);margin-top:1.7mm;border:1px solid #263740}.spec-print-geometry div{min-width:0;border-right:1px solid #aeb8bc;padding:1mm 1.25mm}.spec-print-geometry div:last-child{border-right:0}.spec-print-geometry strong{display:block;margin-top:.65mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7pt}.spec-print-primary-grid{display:grid;height:70mm;grid-template-columns:1.62fr 1fr;align-items:stretch;gap:1.8mm;margin-top:1.8mm}.spec-print-primary-grid>.spec-print-panel{height:100%}.spec-print-recipe table{height:calc(100% - 5.2mm)}.spec-print-secondary-grid{display:grid;height:64mm;grid-template-columns:1.42fr 1fr;align-items:stretch;gap:1.8mm;margin-top:1.8mm}.spec-print-bamboo-column{display:flex;height:100%;min-width:0;flex-direction:column;gap:1.5mm}.spec-print-panel{min-width:0;overflow:hidden;border:1px solid #263740}.spec-print-section-title{display:flex;min-height:5.2mm;align-items:center;justify-content:space-between;gap:2mm;background:#edf0ef;padding:.9mm 1.5mm}.spec-print-section-title strong,.spec-print-mini-heading{font-size:6.3pt;font-weight:850;letter-spacing:.07em;text-transform:uppercase}.spec-print-section-title span{font-size:5pt}.spec-print-sheet table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:6.6pt}.spec-print-sheet th,.spec-print-sheet td{height:4.5mm;border-right:1px solid #bdc5c8;border-top:1px solid #bdc5c8;padding:.55mm 1mm;text-align:left;vertical-align:middle}.spec-print-sheet th{height:4.1mm;background:#fafbfb;font-size:5.4pt;letter-spacing:.04em;text-transform:uppercase}.spec-print-sheet th:last-child,.spec-print-sheet td:last-child{border-right:0}.spec-print-recipe th:nth-child(1){width:17%}.spec-print-recipe th:nth-child(2){width:20%}.spec-print-recipe th:nth-child(3){width:8%}.spec-print-recipe th:nth-child(4){width:11%}.spec-print-recipe th:nth-child(5){width:10%}.spec-print-recipe th:nth-child(6){width:16%}.spec-print-recipe th:nth-child(7){width:11%}.spec-print-recipe td:nth-child(1),.spec-print-recipe td:nth-child(2),.spec-print-adhesive td:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spec-print-adhesive th:first-child{width:47%}.spec-print-adhesive th:nth-child(2){width:16%}.spec-print-adhesive th:nth-child(3){width:17%}.spec-print-total{background:#f1f3f3;font-weight:800}.spec-print-parchment{background:#fbfaf6}.spec-print-bamboo th:first-child{width:19%}.spec-print-bamboo th:not(:first-child),.spec-print-bamboo td:not(:first-child){text-align:center}.spec-print-allowance-grid{display:grid;grid-template-columns:repeat(6,1fr)}.spec-print-allowance-grid div{min-width:0;border-right:1px solid #bdc5c8;border-top:1px solid #bdc5c8;padding:.8mm 1mm}.spec-print-allowance-grid div:last-child{border-right:0}.spec-print-allowance-grid strong{display:block;margin-top:.5mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:6pt}.spec-print-prepared{display:grid;flex:1;grid-template-columns:1fr 1fr}.spec-print-prepared>div{padding:1mm 1.4mm}.spec-print-prepared>div+div{border-left:1px solid #bdc5c8}.spec-print-prepared>div strong{display:block;margin-top:.8mm;font-size:6.5pt}.spec-print-prepared p{grid-column:1/-1;margin:0;border-top:1px solid #bdc5c8;padding:.8mm 1.4mm;font-size:5.6pt;line-height:1.25}.spec-print-blockers{color:#9f1239}.spec-print-ready{color:#166b51}.spec-print-operations{display:grid;height:100%;grid-template-columns:1.08fr .92fr}.spec-print-mini-table+ .spec-print-mini-table{border-left:1px solid #263740}.spec-print-mini-heading{display:flex;min-height:5.2mm;align-items:center;background:#edf0ef;padding:.9mm 1.5mm}.spec-print-sheet dl{margin:0}.spec-print-sheet dl div{display:grid;grid-template-columns:.86fr 1.14fr;border-top:1px solid #bdc5c8}.spec-print-sheet dt,.spec-print-sheet dd{min-width:0;margin:0;padding:.64mm 1mm;line-height:1.2}.spec-print-sheet dd{overflow:hidden;border-left:1px solid #bdc5c8;text-overflow:ellipsis;white-space:nowrap;font-size:5.7pt;font-weight:750}.spec-print-footer{display:flex;align-items:center;justify-content:space-between;margin-top:1.5mm;border-top:1px solid #263740;padding-top:1mm}.spec-print-footer strong{font-size:5.8pt;letter-spacing:.08em}.spec-print-footer span{font-size:5pt}
        @media print{@page{size:A4 landscape;margin:5mm}html,body{width:297mm!important;height:210mm!important;margin:0!important;padding:0!important;background:#fff!important}body>*{visibility:hidden}.spec-print-preview,.spec-print-preview *{visibility:visible}.spec-print-preview{position:absolute;inset:0;width:287mm!important;max-width:none!important;height:200mm!important;margin:0!important}.no-print,aside,nav,[data-print-hidden="true"]{display:none!important}.spec-print-sheet{width:287mm!important;height:200mm!important;margin:0!important;border-width:1px!important;padding:3mm 3.2mm 2mm!important;box-shadow:none!important;break-inside:avoid!important;break-after:avoid!important;page-break-inside:avoid!important;page-break-after:avoid!important}.spec-print-sheet table{break-inside:avoid!important}}
      `}</style>
    </div>
  )
}
