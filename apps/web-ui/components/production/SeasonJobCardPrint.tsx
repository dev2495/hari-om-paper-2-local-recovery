"use client"
import { QRCodeSVG } from "qrcode.react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { seasonLabel } from "@/lib/season-api"
import { ContinuousJobCard } from "./ContinuousJobCard"

export function SeasonJobCardPrint({card}:{card:any}) {
  const spec=card.spec_snapshot || {}
  const document=card.document_snapshot || {}
  const header=document.header || {}
  const recipe=card.material_plan_snapshot?.recipe_snapshot || {}
  const rows=recipe.sheet_rows?.length?recipe.sheet_rows:(recipe.layers || []).map((layer:any)=>({code:layer.paper_code_snapshot || layer.paper_id,variety:layer.variety_snapshot || "Paper",gsm:layer.gsm_snapshot,bfPerPly:layer.bf_snapshot,plyCount:1,positionsText:layer.ply_no,weightAllPly:null}))
  const dimension=(min:any,max:any,unit:string)=>`${min ?? "—"} to ${max ?? "—"} ${unit}`
  return <article className="mx-auto max-w-5xl bg-white p-6 text-black print:max-w-none print:p-0">
    <div className="mb-5 flex flex-wrap justify-end gap-2 print:hidden"><Button asChild variant="outline"><Link href={`/production/job-cards/${card.id}`}>Back to job card</Link></Button><Button onClick={()=>window.print()}>Print / save PDF</Button></div>
    <header className="flex items-start justify-between border-b-2 border-black pb-4"><div><p className="text-sm font-semibold">Hari Om Paper</p><h1 className="text-2xl font-bold">Production job card · {card.job_card_no}</h1><p>{header.customer_name || spec.customer_name_snapshot || spec.customer_name}</p><p className="text-sm">{seasonLabel(spec.season)} · recipe r{recipe.season_revision} · QC v{spec.qc_profile?.provenance?.rule_set_version} · release epoch {spec.season_epoch}</p></div><QRCodeSVG value={`/production/job-cards/${card.id}`} size={72}/></header>
    <dl className="my-5 grid grid-cols-3 gap-4 text-sm">{[["Sales order",header.sales_order_no || card.sales_order_ref],["Product / specification",header.product_code || spec.spec_reference],["Released lot quantity",`${card.released_qty ?? card.planned_qty} pcs`],["Sales order quantity",`${header.order_quantity_pcs ?? card.sales_order?.order_qty ?? "—"} pcs`],["Job card target",`${card.planned_qty} pcs`],["Lot",header.lot_number || spec.lot_number]].map(([name,value])=><div key={name}><dt className="font-semibold">{name}</dt><dd>{value || "—"}</dd></div>)}</dl>
    <h2 className="mb-2 font-bold">Frozen customer specification</h2><div className="grid grid-cols-3 gap-3 border border-black p-3 text-sm">{[["I.D.",dimension(spec.id_min_mm,spec.id_max_mm,"mm")],["O.D.",dimension(spec.od_min_mm,spec.od_max_mm,"mm")],["Length",dimension(spec.length_min_mm,spec.length_max_mm,"mm")],["Weight",`${spec.target_tube_weight ?? "—"} g target`],["C.S.",`${spec.cs_min_n ?? spec.required_cs ?? "—"} N minimum`],["Bamboo length",`${spec.selected_bamboo_length_mm ?? "—"} mm`]].map(([name,value])=><p key={name}><strong>{name}</strong> · {value}</p>)}</div>
    <h2 className="mb-2 mt-5 font-bold">Selected paper recipe · {seasonLabel(spec.season)} r{recipe.season_revision}</h2><table className="w-full border-collapse text-left text-sm"><thead><tr>{["Paper code / variety","GSM","BF","Plies","Positions","Weight per tube (g)"].map(h=><th className="border border-black p-2" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row:any,index:number)=><tr key={index}>{[`${row.code} · ${row.variety}`,row.gsm,row.bfPerPly,row.plyCount,row.positionsText,row.weightAllPly==null?"—":Number(row.weightAllPly).toFixed(3)].map((value,i)=><td className="border border-black p-2" key={i}>{value}</td>)}</tr>)}</tbody></table>
    <p className="mt-3 break-all text-xs">Recipe content {recipe.content_hash} · QC fingerprint {spec.qc_profile?.fingerprint}</p>
    <ContinuousJobCard card={card} print/>
  </article>
}
