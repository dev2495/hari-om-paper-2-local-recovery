"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Activity, AlertTriangle, ClipboardList, MapPin, Plus, Recycle, ScanLine, Search, PackagePlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToolForm } from "@/components/forms/master-forms"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateTool,
  useDeleteTool,
  useToolLogs,
  useToolOptions,
  useCreateToolOption,
  useUpdateToolOption,
  useTools,
  useUpdateTool,
  useUpdateToolStatus,
} from "@/hooks/use-master-data"
import {
  useCompleteToolMaintenance,
  useGrindingOutToolAsset,
  useGrindingReturnToolAsset,
  useInventoryLocations,
  useIssueToolAsset,
  useMoveToolAsset,
  useMaintainToolAsset,
  useReceiveToolAssets,
  useReturnToolAsset,
  useScrapToolAsset,
  useToolAssets,
  useToolAssetReport,
} from "@/hooks/use-inventory"
import { TOOL_CATEGORY_LABELS, formatToolMasterSpecText } from "@/lib/spec-sheet"

const CATEGORY_LABELS = TOOL_CATEGORY_LABELS
const CATEGORY_ORDER = Object.keys(TOOL_CATEGORY_LABELS)

function statusClass(status: string) {
  if (status === "DISCONTINUED") return "border-slate-300 bg-slate-100 text-slate-700"
  return "border-emerald-200 bg-emerald-50 text-emerald-800"
}

function assetStatusClass(status: string) {
  if (status === "ISSUED") return "border-cyan-200 bg-cyan-50 text-cyan-800"
  if (status === "MAINTENANCE") return "border-amber-200 bg-amber-50 text-amber-800"
  if (status === "GRINDING_OUT") return "border-orange-200 bg-orange-50 text-orange-800"
  if (status === "SCRAP") return "border-rose-200 bg-rose-50 text-rose-800"
  return "border-emerald-200 bg-emerald-50 text-emerald-800"
}

function formatDate(value: any) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

function toolDetailText(row: any) {
  const formatted = formatToolMasterSpecText(row?.category, row?.spec_text)
  return [formatted].map((value) => String(value || "").trim()).filter(Boolean).join(" · ") || "-"
}

export default function ToolsPage() {
  const { activePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("ALL")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editTool, setEditTool] = useState<any>(null)
  const [isReceiveOpen, setIsReceiveOpen] = useState(false)
  const [receiveForm, setReceiveForm] = useState<any>({ receipt_date: new Date().toISOString().slice(0, 10), quantity: 1, location_id: "" })
  const [optionDraft, setOptionDraft] = useState<any>({ category: "NOTCH", field_key: "type", value: "" })
  const [assetSearch, setAssetSearch] = useState("")
  const [actionDialog, setActionDialog] = useState<any>(null)
  const [actionForm, setActionForm] = useState<any>({ job_card_id: "", stage_type: "PROCESS", location_id: "", value: "" })
  const [isScanOpen, setIsScanOpen] = useState(false)
  const [scanError, setScanError] = useState("")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanStreamRef = useRef<MediaStream | null>(null)
  const writeBlocked = activePlant === "ALL"

  const { data = [], isLoading } = useTools({ include_unavailable: true, include_inactive: true })
  const { data: logs = [] } = useToolLogs({ limit: 30 })
  const { data: options = [] } = useToolOptions({ include_inactive: true })
  const { data: locations = [] } = useInventoryLocations()
  const { data: assets = [] } = useToolAssets({ search: assetSearch.trim() || undefined })
  const { data: assetReport = { summary: {} } } = useToolAssetReport()
  const createMutation = useCreateTool()
  const updateMutation = useUpdateTool()
  const deleteMutation = useDeleteTool()
  const statusMutation = useUpdateToolStatus()
  const receiveMutation = useReceiveToolAssets()
  const createOptionMutation = useCreateToolOption()
  const updateOptionMutation = useUpdateToolOption()
  const issueMutation = useIssueToolAsset()
  const moveMutation = useMoveToolAsset()
  const returnMutation = useReturnToolAsset()
  const grindingOutMutation = useGrindingOutToolAsset()
  const grindingReturnMutation = useGrindingReturnToolAsset()
  const maintainMutation = useMaintainToolAsset()
  const maintenanceCompleteMutation = useCompleteToolMaintenance()
  const scrapMutation = useScrapToolAsset()

  const canonicalData = useMemo(
    () => (data as any[]).filter((row) => CATEGORY_ORDER.includes(String(row?.category || "").toUpperCase())),
    [data],
  )

  const rows = useMemo(() => {
    const searchText = search.trim().toLowerCase()
    return canonicalData
      .filter((row) => (category === "ALL" ? true : row.category === category))
      .filter((row) => {
        if (!searchText) return true
        return [row.category, row.name, row.department, row.status, JSON.stringify(row.attribute_values || {})]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(searchText))
      })
      .sort((left, right) => {
        const categorySort = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category)
        if (categorySort !== 0) return categorySort
        return String(left.name || "").localeCompare(String(right.name || ""))
      })
  }, [canonicalData, category, search])

  const counts = useMemo(() => {
    const base = { total: 0, active: 0, discontinued: 0 }
    for (const row of canonicalData) {
      base.total += 1
      const status = String(row.status || "ACTIVE").toUpperCase()
      if (status === "DISCONTINUED") base.discontinued += 1
      else base.active += 1
    }
    return base
  }, [canonicalData])

  const handleAdd = async (payload: any) => {
    await createMutation.mutateAsync(payload)
    setIsAddOpen(false)
  }

  const handleEdit = async (payload: any) => {
    if (!editTool?.id) return
    await updateMutation.mutateAsync({ id: editTool.id, data: payload })
    setEditTool(null)
  }

  const setStatus = async (row: any, status: "ACTIVE" | "DISCONTINUED") => {
    await statusMutation.mutateAsync({
      id: row.id,
      data: {
        status,
        notes: status === "DISCONTINUED" ? "Discontinued from tooling definitions" : "Returned to active dropdown use",
      },
    })
  }

  const openReceive = (row: any) => {
    setReceiveForm({
      receipt_date: new Date().toISOString().slice(0, 10),
      quantity: 1,
      location_id: "",
      tool_definition_id: row.id,
      definition_name: row.name,
      category: row.category,
      attribute_snapshot: row.attribute_values || {},
    })
    setIsReceiveOpen(true)
  }

  const receive = async (event: FormEvent) => {
    event.preventDefault()
    await receiveMutation.mutateAsync({ ...receiveForm, quantity: Number(receiveForm.quantity) })
    setIsReceiveOpen(false)
  }

  const optionFields: Record<string, string[]> = {
    NOTCH: ["type", "design", "degree", "notch_direction", "notch_distance_mm", "notch_depth_mm"],
    BLADE: ["type"],
    HOLDER: [],
    V_FLAT: [],
    PUNCH: ["punch"],
  }

  const addOption = async (event: FormEvent) => {
    event.preventDefault()
    if (!optionDraft.value.trim()) return
    await createOptionMutation.mutateAsync({ ...optionDraft, value: optionDraft.value.trim() })
    setOptionDraft({ ...optionDraft, value: "" })
  }

  const editOption = (row: any) => {
    setActionForm({ job_card_id: "", stage_type: "PROCESS", value: row.value })
    setActionDialog({ kind: "edit-option", option: row })
  }

  const action = async (mutation: any, asset: any, data?: any) => {
    await mutation.mutateAsync({ id: asset.id, data: data || {} })
  }

  const submitActionDialog = async (event: FormEvent) => {
    event.preventDefault()
    if (!actionDialog) return
    if (actionDialog.kind === "edit-option") {
      const value = String(actionForm.value || "").trim()
      if (!value) return
      await updateOptionMutation.mutateAsync({ id: actionDialog.option.id, data: { value } })
    } else if (actionDialog.kind === "issue") {
      const jobCardId = String(actionForm.job_card_id || "").trim()
      const stageType = String(actionForm.stage_type || "").trim()
      if (!jobCardId || !stageType) return
      await action(issueMutation, actionDialog.asset, { job_card_id: jobCardId, stage_type: stageType })
    } else if (actionDialog.kind === "move") {
      const locationId = String(actionForm.location_id || "").trim()
      if (!locationId) return
      await action(moveMutation, actionDialog.asset, { location_id: locationId, notes: "Moved from tooling ledger" })
    }
    setActionDialog(null)
  }

  useEffect(() => {
    if (!isScanOpen) return
    let cancelled = false
    const video = videoRef.current
    const startScan = async () => {
      setScanError("")
      const BarcodeDetectorCtor = (window as any).BarcodeDetector
      if (!BarcodeDetectorCtor) {
        setScanError("Camera QR scanning is not available in this browser. Type or paste the QR value in the search box.")
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError("Camera access is not available. Type or paste the QR value in the search box.")
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        scanStreamRef.current = stream
        if (!video) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        video.srcObject = stream
        await video.play()
        const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] })
        const poll = async () => {
          if (cancelled) return
          try {
            const detected = await detector.detect(video)
            const value = String(detected?.[0]?.rawValue || "").trim()
            if (value) {
              setAssetSearch(value)
              setIsScanOpen(false)
              return
            }
          } catch {
            // Keep polling; camera frames can be undecodable while moving.
          }
          window.requestAnimationFrame(poll)
        }
        window.requestAnimationFrame(poll)
      } catch (error: any) {
        setScanError(error?.message || "Camera permission was not granted. Type or paste the QR value in the search box.")
      }
    }
    startScan()
    return () => {
      cancelled = true
      scanStreamRef.current?.getTracks().forEach((track) => track.stop())
      scanStreamRef.current = null
      if (video) video.srcObject = null
    }
  }, [isScanOpen])

  return (
    <div className="space-y-6 px-6 pb-10 pt-2">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_50%,#ecfeff_100%)] shadow-premium">
        <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_360px] lg:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Master Data Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Tooling Master</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Five fixed tooling categories define the spec-sheet dropdowns. Physical units are inwarded and controlled below with QR, location, issue, return, grinding, and production usage.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/specifications" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                Spec sheets
              </Link>
              <Link href="/reports/tooling" className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-900">
                Tooling report
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Total", value: counts.total, icon: ClipboardList, tone: "border-slate-200 bg-white" },
              { label: "Active", value: counts.active, icon: Activity, tone: "border-emerald-200 bg-emerald-50" },
              { label: "Discontinued", value: counts.discontinued, icon: Recycle, tone: "border-slate-200 bg-slate-100" },
            ].map((metric) => {
              const Icon = metric.icon
              return (
                <div key={metric.label} className={`rounded-2xl border p-4 ${metric.tone}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{metric.label}</p>
                    <Icon className="h-4 w-4 text-slate-500" />
                  </div>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">{metric.value}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Search tools, attributes, status"
              />
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900"
            >
              <option value="ALL">All categories</option>
              {CATEGORY_ORDER.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button disabled={writeBlocked} className="h-10 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
                <Plus className="mr-2 h-4 w-4" />
                Add Tool
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add Tooling Master</DialogTitle>
                <DialogDescription>New active records appear in the spec sheet dropdown for the selected category.</DialogDescription>
              </DialogHeader>
              <ToolForm onSubmit={handleAdd} onCancel={() => setIsAddOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
        {writeBlocked ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Pick one plant before adding or changing tooling masters.
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[1.3fr_1fr_0.9fr_0.9fr_1.6fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <div>Tool</div>
              <div>Category</div>
              <div>Status</div>
              <div>Usage</div>
              <div>Actions</div>
            </div>
            <div className="divide-y divide-slate-100">
              {isLoading ? (
                <div className="px-4 py-8 text-sm text-slate-500">Loading tools...</div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-8 text-sm text-slate-500">No tools found.</div>
              ) : (
                rows.map((row) => {
                  const status = String(row.status || "ACTIVE").toUpperCase()
                  return (
                    <div key={row.id} className="grid grid-cols-[1.3fr_1fr_0.9fr_0.9fr_1.6fr] gap-3 px-4 py-4 text-sm">
                  <div>
                    <p className="font-semibold text-slate-950">{row.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{toolDetailText(row)}</p>
                  </div>
                  <div className="font-medium text-slate-700">{CATEGORY_LABELS[row.category] || row.category}</div>
                  <div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(status)}`}>{status}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{Number(row.usage_count || 0).toLocaleString("en-IN")}</p>
                    <p className="text-xs text-slate-500">spec/job logs</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditTool(row)} disabled={writeBlocked}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openReceive(row)} disabled={writeBlocked || status !== "ACTIVE"}>
                      <PackagePlus className="mr-1 h-3.5 w-3.5" /> Inward
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setStatus(row, status === "ACTIVE" ? "DISCONTINUED" : "ACTIVE")} disabled={writeBlocked}>
                      {status === "ACTIVE" ? "Discontinue" : "Reactivate"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(row.id)} disabled={writeBlocked || row.active === false}>
                      Disable
                    </Button>
                  </div>
                </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Editable dropdown registry</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Tool attributes</h2>
              <p className="mt-1 text-sm text-slate-500">Only these option values feed the five tooling definitions and the notch process fields.</p>
            </div>
            <form onSubmit={addOption} className="flex flex-wrap gap-2">
              <select
                value={optionDraft.category}
                onChange={(event) => {
                  const nextCategory = event.target.value
                  setOptionDraft({ category: nextCategory, field_key: optionFields[nextCategory]?.[0] || "", value: "" })
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                {CATEGORY_ORDER.map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
              </select>
              <select value={optionDraft.field_key} onChange={(event) => setOptionDraft({ ...optionDraft, field_key: event.target.value })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                {(optionFields[optionDraft.category] || []).map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
              <Input value={optionDraft.value} onChange={(event) => setOptionDraft({ ...optionDraft, value: event.target.value })} placeholder="New option" className="h-9 w-32" />
              <Button type="submit" size="sm" disabled={writeBlocked || !optionDraft.field_key || !optionDraft.value.trim()}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
            </form>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(options as any[]).map((option) => (
              <div key={option.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${option.active === false ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-200 bg-slate-50"}`}>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{CATEGORY_LABELS[option.category] || option.category} · {option.field_key}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{option.value}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => editOption(option)} disabled={writeBlocked}>Edit</Button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[1.7rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Physical tool control</p>
          <h2 className="mt-1 text-lg font-semibold">QR asset ledger</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              ["Total", assetReport.summary?.total_assets || 0],
              ["Available", assetReport.summary?.available || 0],
              ["Issued", assetReport.summary?.issued || 0],
              ["Grinding", assetReport.summary?.grinding_out || 0],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-[10px] uppercase tracking-[0.15em] text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-300">Inward a physical unit against a definition, assign its Location Master position, and use the QR asset number for issue, return, grinding, and trace reports.</p>
        </div>
      </section>

      <section className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Physical register</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Inwarded tools and lifecycle</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search QR / asset no." className="h-9 w-64 pl-9" />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsScanOpen(true)} title="Scan a physical tool QR code">
              <ScanLine className="mr-1.5 h-4 w-4" /> Scan QR
            </Button>
            <Link href="/reports/tooling" className="text-sm font-semibold text-cyan-800 hover:underline">Open tooling report</Link>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500"><th className="py-2 pr-3">Asset / QR</th><th className="py-2 pr-3">Definition</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Location</th><th className="py-2 pr-3">Grinding</th><th className="py-2 pr-3">Produced</th><th className="py-2">Action</th></tr></thead>
            <tbody>{(assets as any[]).slice(0, 100).map((asset) => <tr key={asset.id} className="border-b border-slate-100"><td className="py-3 pr-3"><p className="font-semibold text-slate-950">{asset.asset_no}</p><p className="text-xs text-slate-500">{asset.qr_value}</p></td><td className="py-3 pr-3">{asset.definition_name}<p className="text-xs text-slate-500">{CATEGORY_LABELS[asset.category] || asset.category}</p></td><td className="py-3 pr-3"><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${assetStatusClass(asset.status)}`}>{asset.status}</span></td><td className="py-3 pr-3 text-slate-700">{asset.location_label || "-"}</td><td className="py-3 pr-3 font-semibold">V{asset.grind_version || 0}</td><td className="py-3 pr-3">{Number(asset.produced_qty || 0).toLocaleString("en-IN")}</td><td className="py-3"><div className="flex flex-wrap gap-1.5">{asset.status !== "SCRAP" ? <Button size="sm" variant="ghost" onClick={() => { setActionForm({ job_card_id: "", stage_type: "PROCESS", location_id: asset.location_id || "", value: "" }); setActionDialog({ kind: "move", asset }) }}><MapPin className="mr-1 h-3.5 w-3.5" />Move</Button> : null}{asset.status === "AVAILABLE" ? <><Button size="sm" variant="outline" onClick={() => { setActionForm({ job_card_id: "", stage_type: "PROCESS", location_id: "", value: "" }); setActionDialog({ kind: "issue", asset }) }}>Issue</Button><Button size="sm" variant="outline" onClick={() => action(maintainMutation, asset)}>Maintain</Button>{asset.category === "BLADE" ? <Button size="sm" variant="outline" onClick={() => action(grindingOutMutation, asset)}>Grinding out</Button> : null}<Button size="sm" variant="outline" onClick={() => action(scrapMutation, asset)}>Scrap</Button></> : null}{asset.status === "ISSUED" ? <Button size="sm" variant="outline" onClick={() => action(returnMutation, asset)}>Return</Button> : null}{asset.status === "MAINTENANCE" ? <Button size="sm" variant="outline" onClick={() => action(maintenanceCompleteMutation, asset)}>Complete maintenance</Button> : null}{asset.status === "GRINDING_OUT" ? <Button size="sm" variant="outline" onClick={() => action(grindingReturnMutation, asset)}>Grinding return</Button> : null}</div></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Inward physical tool</DialogTitle><DialogDescription>This creates a GRN-style receipt and one QR asset per quantity at the selected Location Master position.</DialogDescription></DialogHeader>
          <form onSubmit={receive} className="space-y-4">
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-3 text-sm"><p className="font-semibold text-cyan-950">{receiveForm.definition_name}</p><p className="mt-1 text-xs text-cyan-800">{CATEGORY_LABELS[receiveForm.category] || receiveForm.category}</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium">Receipt date<input type="date" required value={receiveForm.receipt_date} onChange={(event) => setReceiveForm({ ...receiveForm, receipt_date: event.target.value })} className="h-10 w-full rounded-lg border border-slate-200 px-3" /></label><label className="space-y-1 text-sm font-medium">Quantity<input type="number" min="1" max="500" required value={receiveForm.quantity} onChange={(event) => setReceiveForm({ ...receiveForm, quantity: event.target.value })} className="h-10 w-full rounded-lg border border-slate-200 px-3" /></label></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium">Supplier<input value={receiveForm.supplier_name || ""} onChange={(event) => setReceiveForm({ ...receiveForm, supplier_name: event.target.value })} className="h-10 w-full rounded-lg border border-slate-200 px-3" /></label><label className="space-y-1 text-sm font-medium">Receipt / GRN no<input value={receiveForm.receipt_no || ""} onChange={(event) => setReceiveForm({ ...receiveForm, receipt_no: event.target.value })} placeholder="Auto-generated if blank" className="h-10 w-full rounded-lg border border-slate-200 px-3" /></label></div>
            <label className="space-y-1 text-sm font-medium">Location Master position<select required value={receiveForm.location_id} onChange={(event) => setReceiveForm({ ...receiveForm, location_id: event.target.value })} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="">Select location</option>{(locations as any[]).map((location) => <option key={location.id} value={location.id}>{[location.code, location.warehouse, location.zone, location.bin].filter(Boolean).join(" · ")}</option>)}</select></label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsReceiveOpen(false)}>Cancel</Button><Button type="submit" disabled={receiveMutation.isPending || writeBlocked}><PackagePlus className="mr-2 h-4 w-4" />Post inward</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(actionDialog)} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionDialog?.kind === "edit-option" ? "Edit dropdown value" : actionDialog?.kind === "move" ? "Move physical tool" : "Issue physical tool"}</DialogTitle>
            <DialogDescription>{actionDialog?.kind === "edit-option" ? "This changes the master option for future tool definitions and spec sheets." : actionDialog?.kind === "move" ? `Move ${actionDialog?.asset?.asset_no || "the physical asset"} to a Location Master position.` : `Assign ${actionDialog?.asset?.asset_no || "the scanned asset"} to a job card before production starts.`}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitActionDialog} className="space-y-4">
            {actionDialog?.kind === "edit-option" ? (
              <label className="space-y-1 text-sm font-medium">Value<Input autoFocus value={actionForm.value} onChange={(event) => setActionForm({ ...actionForm, value: event.target.value })} /></label>
            ) : actionDialog?.kind === "move" ? (
              <label className="space-y-1 text-sm font-medium">Location Master position<select required value={actionForm.location_id} onChange={(event) => setActionForm({ ...actionForm, location_id: event.target.value })} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Select location</option>{(locations as any[]).map((location) => <option key={location.id} value={location.id}>{[location.code, location.warehouse, location.zone, location.bin].filter(Boolean).join(" · ")}</option>)}</select></label>
            ) : (
              <>
                <label className="space-y-1 text-sm font-medium">Job card number<Input autoFocus required value={actionForm.job_card_id} onChange={(event) => setActionForm({ ...actionForm, job_card_id: event.target.value })} placeholder="JC-2026-0001" /></label>
                <label className="space-y-1 text-sm font-medium">Stage<select required value={actionForm.stage_type} onChange={(event) => setActionForm({ ...actionForm, stage_type: event.target.value })} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="SLITTING">Slitting</option><option value="WINDER">Winder</option><option value="OVEN">Oven</option><option value="PROCESS">Process</option><option value="PACKING">Packing</option><option value="QC">QC</option></select></label>
              </>
            )}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button><Button type="submit" disabled={updateOptionMutation.isPending || issueMutation.isPending || moveMutation.isPending}>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isScanOpen} onOpenChange={setIsScanOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scan physical tool QR</DialogTitle>
            <DialogDescription>Point the camera at the label. The matching asset will be loaded into the ledger search.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
            <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />
          </div>
          {scanError ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{scanError}</p> : null}
          <p className="text-xs leading-5 text-slate-500">You can also close this window and paste the QR value into the search field. QR values are searchable even when the printed label is scanned from a different device.</p>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setIsScanOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Ledger</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Recent Tool Events</h2>
          </div>
          <Link href="/reports/tooling" className="text-sm font-semibold text-cyan-800 hover:underline">
            Open report
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Tool</th>
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Reference</th>
              </tr>
            </thead>
            <tbody>
              {(logs as any[]).slice(0, 12).map((log) => (
                <tr key={log.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-500">{formatDate(log.created_at)}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">{log.tool_name}</td>
                  <td className="py-2 pr-3 text-slate-700">{log.event_type}</td>
                  <td className="py-2 pr-3 text-slate-700">{log.source_type}</td>
                  <td className="py-2 pr-3 text-slate-700">{log.source_ref || log.source_id || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={Boolean(editTool)} onOpenChange={(open) => !open && setEditTool(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Tooling Master</DialogTitle>
            <DialogDescription>Changes affect future spec sheet dropdown selections only.</DialogDescription>
          </DialogHeader>
          <ToolForm initialData={editTool} onSubmit={handleEdit} onCancel={() => setEditTool(null)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
