"use client"

import { Printer } from "lucide-react"

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
    bf: number
    thickness: number
    weight: number
    plies: number
    positions: string
  }>
  adhesive: Array<{ name: string; ratio: number; weight: number }>
  totals: {
    paper: number
    adhesive: number
    parchment: number
    wet: number
    dry: number
    targetDry: number
    variance: number
    idDelta: number
    odDelta: number
  }
  process: Array<{ label: string; value: string }>
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

export function SpecSheetPrint({ enabled, data }: SpecSheetPrintProps) {
  if (!enabled) return null

  const variancePass = Math.abs(data.totals.variance) <= 5

  return (
    <div className="spec-print-preview">
      <div className="spec-print-actions no-print">
        <div>
          <strong>One-page production specification</strong>
          <span> A4 landscape · all release-critical details</span>
        </div>
        <button type="button" onClick={() => window.print()}>
          <Printer size={16} /> Print specification
        </button>
      </div>

      <article className="spec-print-sheet" aria-label="Production specification sheet">
        <header className="spec-print-header">
          <div>
            <p className="spec-print-eyebrow">Controlled production document</p>
            <h1>{valueOrDash(data.company)}</h1>
            <h2>Tube Specification Sheet</h2>
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

        <section className="spec-print-geometry">
          {data.geometry.map((item) => (
            <div key={item.label}><span>{item.label}</span><strong>{valueOrDash(item.value)}</strong></div>
          ))}
        </section>

        <section className="spec-print-kpis">
          <div><span>Selected paper</span><strong>{data.totals.paper.toFixed(2)} g</strong></div>
          <div><span>Adhesive + parchment</span><strong>{data.totals.adhesive.toFixed(2)} + {data.totals.parchment.toFixed(2)} g</strong></div>
          <div><span>Wet / modeled dry</span><strong>{data.totals.wet.toFixed(2)} / {data.totals.dry.toFixed(2)} g</strong></div>
          <div className={variancePass ? "spec-print-pass" : "spec-print-fail"}>
            <span>Dry target / variance</span>
            <strong>{data.totals.targetDry.toFixed(2)} g · {data.totals.variance >= 0 ? "+" : ""}{data.totals.variance.toFixed(2)} g</strong>
          </div>
          <div><span>ID / OD delta</span><strong>{data.totals.idDelta >= 0 ? "+" : ""}{data.totals.idDelta.toFixed(2)} / {data.totals.odDelta >= 0 ? "+" : ""}{data.totals.odDelta.toFixed(2)} mm</strong></div>
        </section>

        <div className="spec-print-body">
          <div className="spec-print-left">
            <section className="spec-print-panel spec-print-recipe">
              <div className="spec-print-section-title"><strong>Applied paper recipe</strong><span>{data.recipe.length} paper(s) · {data.recipe.reduce((sum, row) => sum + row.plies, 0)} plies</span></div>
              <table>
                <thead><tr><th>Code / variety</th><th>GSM</th><th>BF</th><th>Thick / ply</th><th>Weight</th><th>Ply</th><th>Ply no.</th></tr></thead>
                <tbody>
                  {data.recipe.map((row, index) => (
                    <tr key={`${row.code}-${index}`}>
                      <td><strong>{valueOrDash(row.code)}</strong><small>{valueOrDash(row.variety)}</small></td>
                      <td>{row.gsm.toFixed(0)}</td><td>{row.bf.toFixed(2)}</td><td>{row.thickness.toFixed(4)} mm</td>
                      <td><strong>{row.weight.toFixed(2)} g</strong></td><td>{row.plies}</td><td>{valueOrDash(row.positions)}</td>
                    </tr>
                  ))}
                  <tr className="spec-print-total"><td>Total selected paper</td><td colSpan={3}>{data.recipe.reduce((sum, row) => sum + row.gsm * row.plies, 0).toFixed(0)} combined GSM</td><td>{data.totals.paper.toFixed(2)} g</td><td>{data.recipe.reduce((sum, row) => sum + row.plies, 0)}</td><td>—</td></tr>
                </tbody>
              </table>
            </section>

            <section className="spec-print-panel">
              <div className="spec-print-section-title"><strong>Weight and bamboo calculation</strong><span>finished-good trim excluded</span></div>
              <div className="spec-print-detail-grid">
                {data.process.map((item) => <div key={item.label}><span>{item.label}</span><strong>{valueOrDash(item.value)}</strong></div>)}
              </div>
            </section>
          </div>

          <div className="spec-print-right">
            <section className="spec-print-panel">
              <div className="spec-print-section-title"><strong>Additions breakdown</strong><span>adhesive split totals 100%</span></div>
              <table>
                <thead><tr><th>Adhesive</th><th>Split</th><th>Live weight</th></tr></thead>
                <tbody>
                  {data.adhesive.map((row, index) => <tr key={`${row.name}-${index}`}><td>{valueOrDash(row.name)}</td><td>{row.ratio.toFixed(2)}%</td><td><strong>{row.weight.toFixed(2)} g</strong></td></tr>)}
                  <tr className="spec-print-total"><td>Total adhesive</td><td>{data.adhesive.reduce((sum, row) => sum + row.ratio, 0).toFixed(2)}%</td><td>{data.totals.adhesive.toFixed(2)} g</td></tr>
                  <tr><td>Parchment</td><td>dry basis</td><td><strong>{data.totals.parchment.toFixed(2)} g</strong></td></tr>
                </tbody>
              </table>
            </section>

            <section className="spec-print-panel spec-print-two-col">
              <div>
                <div className="spec-print-section-title"><strong>Notch & tooling</strong></div>
                <dl>{data.tooling.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{valueOrDash(item.value)}</dd></div>)}</dl>
              </div>
              <div>
                <div className="spec-print-section-title"><strong>Packing</strong></div>
                <dl>{data.packing.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{valueOrDash(item.value)}</dd></div>)}</dl>
              </div>
            </section>

            <section className="spec-print-panel spec-print-release">
              <div className="spec-print-section-title"><strong>Release control</strong><span>{data.blockers.length ? `${data.blockers.length} blocker(s)` : "Ready for production"}</span></div>
              <div className="spec-print-release-grid">
                <div><span>Prepared by</span><strong>{valueOrDash(data.preparedBy)}</strong></div>
                <div><span>Sign-off</span><strong>{valueOrDash(data.signOff)}</strong></div>
              </div>
              <p><strong>Notes:</strong> {valueOrDash(data.notes)}</p>
              {data.blockers.length ? <p className="spec-print-blockers"><strong>Blockers:</strong> {data.blockers.join(" · ")}</p> : null}
            </section>
          </div>
        </div>
      </article>

      <style jsx global>{`
        .spec-print-preview{color:#102832;margin:0 auto;max-width:297mm}.spec-print-actions{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border:1px solid #d7dfdc;border-radius:12px;background:#fff;padding:10px 14px;font-size:13px}.spec-print-actions span{color:#64748b}.spec-print-actions button{display:flex;align-items:center;gap:7px;border:0;border-radius:9px;background:#102832;color:#fff;padding:9px 13px;font-weight:800}.spec-print-sheet{box-sizing:border-box;width:297mm;height:200mm;overflow:hidden;border:1.5px solid #102832;background:#fff;padding:4mm;font-family:Arial,sans-serif;box-shadow:0 20px 70px rgba(15,23,42,.12)}.spec-print-header{display:grid;grid-template-columns:1.15fr 1fr 1.15fr;gap:3mm;align-items:stretch;border-bottom:1.5px solid #102832;padding-bottom:2mm}.spec-print-eyebrow,.spec-print-sheet span,.spec-print-sheet dt{margin:0;font-size:5.8pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b}.spec-print-header h1{margin:0;font-size:14pt;font-weight:950;letter-spacing:.08em;text-transform:uppercase}.spec-print-header h2{margin:.5mm 0 0;font-size:7pt;letter-spacing:.22em;text-transform:uppercase;color:#475569}.spec-print-customer{border-left:1px solid #cbd5e1;padding-left:3mm}.spec-print-customer strong{display:block;margin-top:1mm;font-size:10pt}.spec-print-customer small{display:block;margin-top:1mm;font-size:6pt;color:#475569}.spec-print-doc-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #102832}.spec-print-doc-grid div{padding:1.2mm 1.6mm;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1}.spec-print-doc-grid div:nth-child(2n){border-right:0}.spec-print-doc-grid div:nth-last-child(-n+2){border-bottom:0}.spec-print-doc-grid strong{display:block;margin-top:.5mm;font-size:7pt}.spec-print-geometry{display:grid;grid-template-columns:repeat(8,1fr);margin-top:2mm;border:1px solid #102832}.spec-print-geometry div{min-width:0;border-right:1px solid #cbd5e1;padding:1mm 1.4mm}.spec-print-geometry div:last-child{border-right:0}.spec-print-geometry strong{display:block;margin-top:.5mm;font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.spec-print-kpis{display:grid;grid-template-columns:repeat(5,1fr);margin-top:2mm;background:#102832;color:#fff}.spec-print-kpis div{border-right:1px solid rgba(255,255,255,.18);padding:1.5mm 2mm}.spec-print-kpis span{color:#9bb7bd}.spec-print-kpis strong{display:block;margin-top:.8mm;font-size:8pt}.spec-print-kpis .spec-print-pass{background:#166b51}.spec-print-kpis .spec-print-fail{background:#9f1239}.spec-print-body{display:grid;grid-template-columns:1.45fr 1fr;gap:2mm;margin-top:2mm}.spec-print-left,.spec-print-right{display:flex;flex-direction:column;gap:2mm;min-width:0}.spec-print-panel{overflow:hidden;border:1px solid #102832}.spec-print-section-title{display:flex;align-items:center;justify-content:space-between;gap:2mm;background:#e8efed;padding:1.1mm 1.8mm}.spec-print-section-title strong{font-size:6.5pt;letter-spacing:.08em;text-transform:uppercase}.spec-print-section-title span{font-size:5.2pt}.spec-print-sheet table{width:100%;border-collapse:collapse;font-size:6pt}.spec-print-sheet th,.spec-print-sheet td{height:5.2mm;border-right:1px solid #cbd5e1;border-top:1px solid #cbd5e1;padding:.65mm 1.2mm;text-align:left;vertical-align:middle}.spec-print-sheet th{height:4.5mm;background:#f8fafc;font-size:5.3pt;text-transform:uppercase;letter-spacing:.05em}.spec-print-sheet th:last-child,.spec-print-sheet td:last-child{border-right:0}.spec-print-sheet td small{display:block;max-width:44mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#64748b}.spec-print-total{background:#f1f5f9;font-weight:800}.spec-print-detail-grid{display:grid;grid-template-columns:repeat(4,1fr)}.spec-print-detail-grid div{min-height:7.2mm;border-right:1px solid #cbd5e1;border-top:1px solid #cbd5e1;padding:1mm 1.4mm}.spec-print-detail-grid div:nth-child(4n){border-right:0}.spec-print-detail-grid strong{display:block;margin-top:.7mm;font-size:6.4pt}.spec-print-two-col{display:grid;grid-template-columns:1fr 1fr}.spec-print-two-col>div+div{border-left:1px solid #102832}.spec-print-sheet dl{margin:0}.spec-print-sheet dl div{display:grid;grid-template-columns:.85fr 1.3fr;border-top:1px solid #cbd5e1}.spec-print-sheet dt,.spec-print-sheet dd{margin:0;padding:.8mm 1.2mm}.spec-print-sheet dd{border-left:1px solid #cbd5e1;font-size:5.8pt;font-weight:750}.spec-print-release-grid{display:grid;grid-template-columns:1fr 1fr}.spec-print-release-grid>div{border-top:1px solid #cbd5e1;border-right:1px solid #cbd5e1;padding:1mm 1.5mm}.spec-print-release-grid>div:last-child{border-right:0}.spec-print-release-grid strong{display:block;margin-top:.8mm;font-size:6pt}.spec-print-release p{margin:0;border-top:1px solid #cbd5e1;padding:1mm 1.5mm;font-size:5.8pt;line-height:1.25}.spec-print-blockers{color:#9f1239}.spec-print-sheet *{box-sizing:border-box}
        @media print{@page{size:A4 landscape;margin:5mm}html,body{width:297mm!important;height:210mm!important;margin:0!important;padding:0!important;background:#fff!important}body>*{visibility:hidden}.spec-print-preview,.spec-print-preview *{visibility:visible}.spec-print-preview{position:absolute;inset:0;width:287mm!important;max-width:none!important;height:200mm!important;margin:0!important}.no-print,aside,nav,[data-print-hidden="true"]{display:none!important}.spec-print-sheet{width:287mm!important;height:200mm!important;margin:0!important;border-width:1px!important;padding:3mm!important;box-shadow:none!important;break-inside:avoid!important;break-after:avoid!important;page-break-inside:avoid!important;page-break-after:avoid!important}.spec-print-sheet table{break-inside:avoid!important}}
      `}</style>
    </div>
  )
}
