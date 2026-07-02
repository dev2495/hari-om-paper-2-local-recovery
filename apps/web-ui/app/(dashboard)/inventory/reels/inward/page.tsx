"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { Barcode, FileText, MapPin, PlusCircle, ShieldCheck } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import { InventoryLabelPrint } from "@/components/inventory/InventoryLabelPrint"
import { useApp } from "@/context/AppContext"
import { useCreateReelInward, useInventoryItems, useInventoryLocations, useInwardStockAsOn } from "@/hooks/use-inventory"
import { usePapers, useVendors } from "@/hooks/use-master-data"

function getErrorMessage(error: any): string {
  return error?.response?.data?.detail || error?.response?.data?.message || error?.message || "Action failed"
}

function cleanText(value: unknown) {
  return String(value || "").trim()
}

function numberText(value: unknown, digits = 2) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed) || parsed === 0) return "-"
  return parsed.toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function paperSnapshot(paper: any) {
  if (!paper) return null
  return {
    id: String(paper.id || ""),
    code: cleanText(paper.code),
    variety: cleanText(paper.variety),
    gsm: Number(paper.gsm || 0),
    bf: Number(paper.bf || 0),
    ply_bond: Number(paper.ply_bond || 0),
    bulk_factor: Number(paper.bulk_factor || 0),
    thickness_mm: Number(paper.thickness_mm || 0),
  }
}

export default function ReelInwardPage() {
  const { showToast } = useApp()
  const [form, setForm] = useState({
    amigo_no: "",
    paper_master_id: "",
    paper_id: "",
    supplier_id: "",
    location_id: "",
    inward_weight_kg: "",
    unit_cost: "",
    inward_date: dayjs().format("YYYY-MM-DD"),
    stock_status: "QC_HOLD",
    mill: "",
    source_reel_no: "",
    slitting_status: "REGULAR",
    po_no: "",
    bill_no: "",
    bill_date: dayjs().format("YYYY-MM-DD"),
  })
  const [lastLabel, setLastLabel] = useState<any>(null)

  const itemsQuery = useInventoryItems()
  const papersQuery = usePapers()
  const vendorsQuery = useVendors()
  const locationsQuery = useInventoryLocations()
  const stockReportQuery = useInwardStockAsOn({ material: "REEL", limit: 30 })
  const createReelInward = useCreateReelInward()

  const paperItems = useMemo(() => {
    const rows = Array.isArray(itemsQuery.data) ? itemsQuery.data : []
    return rows.filter((item: any) => String(item.type || "").toUpperCase() === "RAW_PAPER")
  }, [itemsQuery.data])
  const paperMasters = useMemo(() => (Array.isArray(papersQuery.data) ? papersQuery.data : []), [papersQuery.data])
  const vendors = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const locations = useMemo(() => (Array.isArray(locationsQuery.data) ? locationsQuery.data : []), [locationsQuery.data])
  const stockRows = useMemo(() => {
    const raw = stockReportQuery.data
    const rows = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
    return rows.slice(0, 20)
  }, [stockReportQuery.data])

  const selectedPaperMaster = useMemo(
    () => paperMasters.find((paper: any) => String(paper.id) === form.paper_master_id) || null,
    [form.paper_master_id, paperMasters],
  )
  const selectedSnapshot = useMemo(() => paperSnapshot(selectedPaperMaster), [selectedPaperMaster])
  const selectedVendor = useMemo(
    () => vendors.find((vendor: any) => String(vendor.id) === form.supplier_id) || null,
    [form.supplier_id, vendors],
  )
  const autoMatchedItem = useMemo(() => {
    const code = cleanText(selectedPaperMaster?.code).toUpperCase()
    if (!code) return null
    return paperItems.find((item: any) => cleanText(item.item_code).toUpperCase() === code) || null
  }, [paperItems, selectedPaperMaster])

  function updateForm(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function selectPaperMaster(masterId: string) {
    const paper = paperMasters.find((row: any) => String(row.id) === masterId)
    const code = cleanText(paper?.code).toUpperCase()
    const matchedItem = paperItems.find((item: any) => cleanText(item.item_code).toUpperCase() === code)
    updateForm({ paper_master_id: masterId, paper_id: matchedItem?.id || "" })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selectedPaperMaster || !selectedSnapshot) {
      showToast("Select paper master so GSM/BF/Plybond are locked from master.", "error")
      return
    }
    if (!form.paper_id) {
      showToast("Select the inventory paper item linked to this master paper.", "error")
      return
    }
    if (!selectedVendor) {
      showToast("Select a vendor before posting reel inward.", "error")
      return
    }
    if (!form.location_id) {
      showToast("Select storage location before printing the label.", "error")
      return
    }
    if (!form.unit_cost) {
      showToast("Enter inward rate so this reel carries its purchase price.", "error")
      return
    }

    try {
      const result = await createReelInward.mutateAsync({
        amigo_no: form.amigo_no || null,
        paper_id: form.paper_id,
        supplier_id: form.supplier_id,
        supplier_name: selectedVendor.name,
        location_id: form.location_id,
        inward_weight_kg: Number(form.inward_weight_kg),
        unit_cost: Number(form.unit_cost),
        rate: Number(form.unit_cost),
        cost_source: "SUPPLIER",
        inward_date: form.inward_date,
        stock_status: form.stock_status,
        mill: form.mill || selectedVendor.name,
        source_reel_no: form.source_reel_no || null,
        slitting_status: form.slitting_status,
        po_no: form.po_no || null,
        bill_no: form.bill_no || null,
        bill_date: form.bill_date || null,
        paper_master_snapshot: selectedSnapshot,
      })
      setLastLabel(result?.data?.qr_payload || null)
      showToast("Reel inward posted and QR label is ready.", "success")
      updateForm({
        amigo_no: "",
        inward_weight_kg: "",
        unit_cost: "",
        source_reel_no: "",
        po_no: "",
        bill_no: "",
        stock_status: "QC_HOLD",
      })
      stockReportQuery.refetch()
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-xl shadow-slate-900/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/80">Store receipt / reel stock</p>
            <h1 className="mt-2 text-2xl font-semibold">Reel Inward With Amigo QR Label</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-200">
              Paper quality is locked from master data. Store captures mill reel, weight, bill, PO, location, and incoming QC hold before production can issue it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/purchase" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-white/10">
              Purchase
            </Link>
            <Link href="/inventory/raw-material-inward" className="rounded-xl bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-950">
              Adhesive / Parchment
            </Link>
          </div>
        </div>
      </section>

      <InventoryLabelPrint label={lastLabel} title="Amigo Reel QR Label" />

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Receipt Entry</h2>
              <p className="text-sm text-slate-500">Amigo no can be typed from sheet or system generated if blank.</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-cyan-800" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amigo no / QR label</span>
              <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
                <Barcode className="h-4 w-4 text-slate-500" />
                <input
                  value={form.amigo_no}
                  onChange={(event) => updateForm({ amigo_no: event.target.value.toUpperCase() })}
                  placeholder="Blank = system generated"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none"
                />
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inward date</span>
              <input required type="date" value={form.inward_date} onChange={(event) => updateForm({ inward_date: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paper master - locked facts</span>
              <select required value={form.paper_master_id} onChange={(event) => selectPaperMaster(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select paper master</option>
                {paperMasters.map((paper: any) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.code} - {paper.variety} - {paper.gsm} GSM - BF {paper.bf || "-"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inventory item</span>
              <select required value={form.paper_id} onChange={(event) => updateForm({ paper_id: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">{autoMatchedItem ? "Matched item" : "Select item"}</option>
                {paperItems.map((item: any) => (
                  <option key={item.id} value={item.id}>{item.item_code} - {item.name}</option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 rounded-xl border border-cyan-100 bg-cyan-50/60 p-3 md:col-span-3 md:grid-cols-5">
              {[
                ["GSM", selectedSnapshot?.gsm],
                ["BF", selectedSnapshot?.bf],
                ["Plybond", selectedSnapshot?.ply_bond],
                ["Bulk", selectedSnapshot?.bulk_factor],
                ["Thickness", selectedSnapshot?.thickness_mm ? `${selectedSnapshot.thickness_mm} mm` : "-"],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-900/60">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">{value || "-"}</p>
                </div>
              ))}
            </div>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mill</span>
              <input value={form.mill} onChange={(event) => updateForm({ mill: event.target.value })} placeholder="Vendor/mill name" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mill reel no</span>
              <input value={form.source_reel_no} onChange={(event) => updateForm({ source_reel_no: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slitted / regular</span>
              <select value={form.slitting_status} onChange={(event) => updateForm({ slitting_status: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="REGULAR">Regular</option>
                <option value="SLITTED">Slitted</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weight kg</span>
              <input required type="number" min="0.01" step="0.01" value={form.inward_weight_kg} onChange={(event) => updateForm({ inward_weight_kg: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate / kg</span>
              <input required type="number" min="0.01" step="0.01" value={form.unit_cost} onChange={(event) => updateForm({ unit_cost: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</span>
              <select required value={form.supplier_id} onChange={(event) => updateForm({ supplier_id: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select vendor</option>
                {vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.supplier_code} - {vendor.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location</span>
              <select required value={form.location_id} onChange={(event) => updateForm({ location_id: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select location</option>
                {locations.map((location: any) => <option key={location.id} value={location.id}>{location.code} - {location.warehouse}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">QC stock status</span>
              <select value={form.stock_status} onChange={(event) => updateForm({ stock_status: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="QC_HOLD">Incoming QC hold</option>
                <option value="BLOCKED">Blocked stock</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">PO</span>
              <input value={form.po_no} onChange={(event) => updateForm({ po_no: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill</span>
              <input value={form.bill_no} onChange={(event) => updateForm({ bill_no: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill date</span>
              <input type="date" value={form.bill_date} onChange={(event) => updateForm({ bill_date: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
          </div>

          <button type="submit" disabled={createReelInward.isPending} className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-cyan-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            <PlusCircle className="h-4 w-4" />
            {createReelInward.isPending ? "Posting..." : "Post reel inward"}
          </button>
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">How This Is Controlled</h2>
              <p className="mt-1 text-sm text-slate-500">These controls match the client inward sheet and current QR issue flow.</p>
            </div>
            <MapPin className="h-5 w-5 text-cyan-800" />
          </div>
          <div className="mt-4 space-y-3">
            {[
              ["Master locked", "GSM, BF, plybond, bulk, and thickness come from paper master and are not typed here."],
              ["QC blocked", "New reels post as QC_HOLD/Blocked and cannot be issued to production until QC passes."],
              ["Label first", "Amigo no is the same human label and QR value printed after inward."],
              ["Trace ready", "Mill reel no, bill, PO, rate, vendor, and location remain with the reel row."],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-semibold text-slate-950">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Reel Stock As On</h2>
            <p className="text-sm text-slate-500">Same columns as the client sheet, with live QC/location status.</p>
          </div>
          <FileText className="h-5 w-5 text-cyan-800" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {["Date", "Mill", "Plybond", "Variety", "GSM", "Reel no", "Reel kg", "Amigo no", "Slitted/Regular", "Issued", "Issued date", "PO", "Bill", "Rate", "Location", "QC"].map((head) => (
                  <th key={head} className="py-2 pr-3">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stockRows.map((row: any) => (
                <tr key={row.entity_id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{row.date || "-"}</td>
                  <td className="py-2 pr-3">{row.mill || "-"}</td>
                  <td className="py-2 pr-3">{numberText(row.plybond)}</td>
                  <td className="py-2 pr-3">{row.variety || "-"}</td>
                  <td className="py-2 pr-3">{numberText(row.gsm, 0)}</td>
                  <td className="py-2 pr-3">{row.reel_no || "-"}</td>
                  <td className="py-2 pr-3">{numberText(row.reel_weight)}</td>
                  <td className="py-2 pr-3 font-semibold text-slate-950">{row.amigo_no || "-"}</td>
                  <td className="py-2 pr-3">{row.slitted_regular || "-"}</td>
                  <td className="py-2 pr-3">{row.issued || "-"}</td>
                  <td className="py-2 pr-3">{row.issued_date || "-"}</td>
                  <td className="py-2 pr-3">{row.po || "-"}</td>
                  <td className="py-2 pr-3">{row.bill || "-"}</td>
                  <td className="py-2 pr-3">{numberText(row.rate)}</td>
                  <td className="py-2 pr-3">{row.location || "-"}</td>
                  <td className="py-2 pr-3">{row.stock_status || "-"}</td>
                </tr>
              ))}
              {!stockRows.length ? (
                <tr>
                  <td colSpan={16} className="py-6 text-center text-slate-500">No reel stock rows yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
