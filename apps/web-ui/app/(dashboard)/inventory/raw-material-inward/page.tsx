"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { FileText, FlaskConical, Layers3, MapPin, PackageCheck, PlusCircle, QrCode } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import { InventoryLabelPrint } from "@/components/inventory/InventoryLabelPrint"
import { useCreateInward, useInventoryItems, useInventoryLocations, useInwardStockAsOn } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"

function formatNumber(value: unknown, digits = 2) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed) || parsed === 0) return "-"
  return parsed.toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function materialKindForItem(item: any) {
  const type = String(item?.type || "").toUpperCase()
  if (type === "ADHESIVE") return "ADHESIVE"
  if (type === "PARCHMENT") return "PARCHMENT"
  return "BULK"
}

export default function RawMaterialInwardPage() {
  const { data: items } = useInventoryItems()
  const { data: locations = [] } = useInventoryLocations()
  const { data: vendors = [] } = useVendors()
  const [inward, setInward] = useState({
    item_id: "",
    amigo_no: "",
    qty: "",
    unit_cost: "",
    supplier_id: "",
    location_id: "",
    stock_status: "QC_HOLD",
    inward_date: dayjs().format("YYYY-MM-DD"),
    product: "",
    item_name_snapshot: "",
    tank_no: "",
    po_no: "",
    bill_no: "",
    bill_date: dayjs().format("YYYY-MM-DD"),
    weight_out: "",
    wastage: "",
    color: "",
    thickness: "",
    pattern_code: "",
  })
  const [submitError, setSubmitError] = useState("")
  const [lastLabel, setLastLabel] = useState<any>(null)
  const createInward = useCreateInward()

  const rmItems = useMemo(
    () => (Array.isArray(items) ? items : []).filter((item: any) => String(item.type || "").toUpperCase() !== "FINISHED_GOOD" && String(item.tracking_mode || "").toUpperCase() !== "REEL"),
    [items],
  )
  const selectedItem = useMemo(() => rmItems.find((item: any) => String(item.id) === inward.item_id) || null, [rmItems, inward.item_id])
  const selectedVendor = useMemo(
    () => (Array.isArray(vendors) ? vendors : []).find((vendor: any) => String(vendor.id) === inward.supplier_id) || null,
    [inward.supplier_id, vendors],
  )
  const materialKind = materialKindForItem(selectedItem)
  const stockReportQuery = useInwardStockAsOn({ material: materialKind, limit: 30 })
  const stockRows = useMemo(() => {
    const data = stockReportQuery.data
    const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data?.rows) ? data.rows : []
    return rows.slice(0, 20)
  }, [stockReportQuery.data])

  function setField(patch: Partial<typeof inward>) {
    setInward((current) => ({ ...current, ...patch }))
  }

  async function submitInward(event: FormEvent) {
    event.preventDefault()
    setSubmitError("")
    if (!selectedItem) {
      setSubmitError("Select material before posting inward.")
      return
    }
    if (!selectedVendor) {
      setSubmitError("Vendor is required before posting inward.")
      return
    }
    if (!inward.location_id) {
      setSubmitError("Location is required so QR scan can find the stock.")
      return
    }
    if (!inward.unit_cost) {
      setSubmitError("Inward rate is required so this batch carries its purchase price.")
      return
    }
    try {
      const result = await createInward.mutateAsync({
        item_id: inward.item_id,
        amigo_no: inward.amigo_no || undefined,
        batch_no: inward.amigo_no || undefined,
        qty: Number(inward.qty),
        supplier_id: inward.supplier_id,
        supplier_name: selectedVendor.name,
        unit_cost: Number(inward.unit_cost),
        rate: Number(inward.unit_cost),
        cost_source: "SUPPLIER",
        stock_status: inward.stock_status,
        location_id: inward.location_id,
        reference_type: "PURCHASE",
        effective_date: inward.inward_date,
        material_form: materialKind,
        product: inward.product || selectedItem.type,
        item_name_snapshot: inward.item_name_snapshot || selectedItem.name,
        tank_no: inward.tank_no || undefined,
        po_no: inward.po_no || undefined,
        bill_no: inward.bill_no || undefined,
        bill_date: inward.bill_date || undefined,
        weight_out: inward.weight_out ? Number(inward.weight_out) : undefined,
        wastage: inward.wastage ? Number(inward.wastage) : undefined,
        color: inward.color || undefined,
        thickness: inward.thickness || undefined,
        pattern_code: inward.pattern_code || undefined,
        external_ref: inward.po_no || inward.bill_no || undefined,
      })
      setLastLabel(result?.data?.label || null)
      setField({
        amigo_no: "",
        qty: "",
        unit_cost: "",
        tank_no: "",
        po_no: "",
        bill_no: "",
        weight_out: "",
        wastage: "",
        color: "",
        thickness: "",
        pattern_code: "",
        stock_status: "QC_HOLD",
      })
      stockReportQuery.refetch()
    } catch (error: any) {
      setSubmitError(error?.response?.data?.detail || error?.message || "Inward posting failed.")
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-xl shadow-slate-900/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-100/80">Stores receipt / direct GRN</p>
            <h1 className="mt-2 text-2xl font-semibold">Adhesive, Parchment, and Bulk Inward</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-200">
              Capture the client sheet fields, assign location, print the Amigo QR label, and hold stock for incoming QC before production issue.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/purchase" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-white/10">
              Purchase
            </Link>
            <Link href="/inventory/reels/inward" className="rounded-xl bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-950">
              Reel inward
            </Link>
          </div>
        </div>
      </section>

      <InventoryLabelPrint label={lastLabel} title="Amigo Batch QR Label" />

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <form onSubmit={submitInward} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Material Receipt Entry</h2>
              <p className="text-sm text-slate-500">Fields change by material type after selecting the item.</p>
            </div>
            {materialKind === "ADHESIVE" ? <FlaskConical className="h-5 w-5 text-cyan-800" /> : materialKind === "PARCHMENT" ? <Layers3 className="h-5 w-5 text-cyan-800" /> : <PackageCheck className="h-5 w-5 text-cyan-800" />}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Material</span>
              <select required value={inward.item_id} onChange={(event) => setField({ item_id: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select material</option>
                {rmItems.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} - {item.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amigo no / QR label</span>
              <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
                <QrCode className="h-4 w-4 text-slate-500" />
                <input value={inward.amigo_no} onChange={(event) => setField({ amigo_no: event.target.value.toUpperCase() })} placeholder="Blank = system generated" className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inward date</span>
              <input required type="date" value={inward.inward_date} onChange={(event) => setField({ inward_date: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qty / weight</span>
              <input required type="number" min="0.001" step="0.001" value={inward.qty} onChange={(event) => setField({ qty: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</span>
              <input required type="number" min="0.01" step="0.01" value={inward.unit_cost} onChange={(event) => setField({ unit_cost: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</span>
              <select required value={inward.supplier_id} onChange={(event) => setField({ supplier_id: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select vendor</option>
                {(Array.isArray(vendors) ? vendors : []).map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.supplier_code} - {vendor.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location</span>
              <select required value={inward.location_id} onChange={(event) => setField({ location_id: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Select location</option>
                {(Array.isArray(locations) ? locations : []).map((location: any) => <option key={location.id} value={location.id}>{location.code} - {location.warehouse}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">QC stock status</span>
              <select value={inward.stock_status} onChange={(event) => setField({ stock_status: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="QC_HOLD">Incoming QC hold</option>
                <option value="BLOCKED">Blocked stock</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">PO</span>
              <input value={inward.po_no} onChange={(event) => setField({ po_no: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill</span>
              <input value={inward.bill_no} onChange={(event) => setField({ bill_no: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill date</span>
              <input type="date" value={inward.bill_date} onChange={(event) => setField({ bill_date: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
            </label>

            {materialKind === "ADHESIVE" ? (
              <>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product</span>
                  <input value={inward.product} onChange={(event) => setField({ product: event.target.value.toUpperCase() })} placeholder="ADHESIVE" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tank no</span>
                  <input value={inward.tank_no} onChange={(event) => setField({ tank_no: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weight out</span>
                  <input type="number" min="0" step="0.001" value={inward.weight_out} onChange={(event) => setField({ weight_out: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wastage</span>
                  <input type="number" min="0" step="0.001" value={inward.wastage} onChange={(event) => setField({ wastage: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
              </>
            ) : null}

            {materialKind === "PARCHMENT" ? (
              <>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Color</span>
                  <input value={inward.color} onChange={(event) => setField({ color: event.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thickness</span>
                  <input value={inward.thickness} onChange={(event) => setField({ thickness: event.target.value })} placeholder="Micron / mm" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pattern code</span>
                  <input value={inward.pattern_code} onChange={(event) => setField({ pattern_code: event.target.value.toUpperCase() })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
              </>
            ) : null}
          </div>

          <button disabled={createInward.isPending} className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-cyan-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            <PlusCircle className="h-4 w-4" />
            {createInward.isPending ? "Posting..." : "Post inward"}
          </button>
          {submitError ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitError}</p> : null}
          {createInward.isSuccess ? <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Inward posted. Batch {createInward.data?.data?.batch_no}</p> : null}
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Use Flow</h2>
              <p className="mt-1 text-sm text-slate-500">All fresh stock is held until QC clears it.</p>
            </div>
            <MapPin className="h-5 w-5 text-cyan-800" />
          </div>
          <div className="mt-4 grid gap-3">
            {[
              ["1. Inward", "Enter client sheet fields plus location and print the QR label."],
              ["2. QC", "Open Quality, select the pending batch, enter incoming readings, and pass or block."],
              ["3. Issue", "Production issue only sees stock once QC changes it to unrestricted."],
              ["4. Trace", "Reports show Amigo no, bill, PO, vendor, location, and live balance."],
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
            <h2 className="text-lg font-semibold text-slate-950">{materialKind === "ADHESIVE" ? "Adhesive/Tank Stock As On" : materialKind === "PARCHMENT" ? "Parchment Stock As On" : "Bulk Stock As On"}</h2>
            <p className="text-sm text-slate-500">Client-format stock rows with QR label number and location.</p>
          </div>
          <FileText className="h-5 w-5 text-cyan-800" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {["Date", "Party", "Product", "Item", "Tank", "Qty", "Amigo no", "Issued", "PO", "Bill", "Bill date", "Rate", "Weight out", "Wastage", "Color", "Thickness", "Pattern", "Location", "QC"].map((head) => (
                  <th key={head} className="py-2 pr-3">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stockRows.map((row: any) => (
                <tr key={row.entity_id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{row.date || "-"}</td>
                  <td className="py-2 pr-3">{row.party_name || "-"}</td>
                  <td className="py-2 pr-3">{row.product || "-"}</td>
                  <td className="py-2 pr-3">{row.item_name || "-"}</td>
                  <td className="py-2 pr-3">{row.tank_no || "-"}</td>
                  <td className="py-2 pr-3">{formatNumber(row.tank_weight || row.current_qty)}</td>
                  <td className="py-2 pr-3 font-semibold text-slate-950">{row.amigo_no || "-"}</td>
                  <td className="py-2 pr-3">{row.issued || "-"}</td>
                  <td className="py-2 pr-3">{row.po || "-"}</td>
                  <td className="py-2 pr-3">{row.bill || "-"}</td>
                  <td className="py-2 pr-3">{row.bill_date || "-"}</td>
                  <td className="py-2 pr-3">{formatNumber(row.rate)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.weight_out)}</td>
                  <td className="py-2 pr-3">{formatNumber(row.wastage)}</td>
                  <td className="py-2 pr-3">{row.color || "-"}</td>
                  <td className="py-2 pr-3">{row.thickness || "-"}</td>
                  <td className="py-2 pr-3">{row.pattern_code || "-"}</td>
                  <td className="py-2 pr-3">{row.location || "-"}</td>
                  <td className="py-2 pr-3">{row.stock_status || "-"}</td>
                </tr>
              ))}
              {!stockRows.length ? (
                <tr>
                  <td colSpan={19} className="py-6 text-center text-slate-500">No stock rows yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
