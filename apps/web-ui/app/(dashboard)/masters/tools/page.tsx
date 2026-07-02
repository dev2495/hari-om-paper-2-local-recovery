"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Activity, AlertTriangle, ClipboardList, Plus, Recycle, Search, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  useTools,
  useUpdateTool,
  useUpdateToolStatus,
} from "@/hooks/use-master-data"
import { TOOL_CATEGORY_LABELS } from "@/lib/spec-sheet"

const CATEGORY_LABELS = TOOL_CATEGORY_LABELS
const CATEGORY_ORDER = Object.keys(TOOL_CATEGORY_LABELS)

function statusClass(status: string) {
  if (status === "SCRAP") return "border-rose-200 bg-rose-50 text-rose-800"
  if (status === "MAINTENANCE") return "border-amber-200 bg-amber-50 text-amber-800"
  return "border-emerald-200 bg-emerald-50 text-emerald-800"
}

function formatDate(value: any) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

export default function ToolsPage() {
  const { activePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("ALL")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editTool, setEditTool] = useState<any>(null)
  const writeBlocked = activePlant === "ALL"

  const { data = [], isLoading } = useTools({ include_unavailable: true, include_inactive: true })
  const { data: logs = [] } = useToolLogs({ limit: 30 })
  const createMutation = useCreateTool()
  const updateMutation = useUpdateTool()
  const deleteMutation = useDeleteTool()
  const statusMutation = useUpdateToolStatus()

  const rows = useMemo(() => {
    const searchText = search.trim().toLowerCase()
    return (data as any[])
      .filter((row) => (category === "ALL" ? true : row.category === category))
      .filter((row) => {
        if (!searchText) return true
        return [row.category, row.name, row.code, row.department, row.location, row.status]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(searchText))
      })
      .sort((left, right) => {
        const categorySort = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category)
        if (categorySort !== 0) return categorySort
        return String(left.name || "").localeCompare(String(right.name || ""))
      })
  }, [category, data, search])

  const counts = useMemo(() => {
    const base = { total: 0, active: 0, maintenance: 0, scrap: 0 }
    for (const row of data as any[]) {
      base.total += 1
      const status = String(row.status || "ACTIVE").toUpperCase()
      if (status === "MAINTENANCE") base.maintenance += 1
      else if (status === "SCRAP") base.scrap += 1
      else base.active += 1
    }
    return base
  }, [data])

  const handleAdd = async (payload: any) => {
    await createMutation.mutateAsync(payload)
    setIsAddOpen(false)
  }

  const handleEdit = async (payload: any) => {
    if (!editTool?.id) return
    await updateMutation.mutateAsync({ id: editTool.id, data: payload })
    setEditTool(null)
  }

  const setStatus = async (row: any, status: "ACTIVE" | "MAINTENANCE" | "SCRAP") => {
    await statusMutation.mutateAsync({
      id: row.id,
      data: {
        status,
        notes:
          status === "MAINTENANCE"
            ? "Moved to maintenance from Tools master"
            : status === "SCRAP"
              ? "Scrapped from Tools master"
              : "Returned to active use from Tools master",
      },
    })
  }

  return (
    <div className="space-y-6 px-6 pb-10 pt-2">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_50%,#ecfeff_100%)] shadow-premium">
        <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_360px] lg:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Master Data Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Tooling Master</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Notch sheet dropdowns are controlled here. Active tools appear in the spec sheet; maintenance and scrap records stay in history and reports.
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
              { label: "Maintenance", value: counts.maintenance, icon: Wrench, tone: "border-amber-200 bg-amber-50" },
              { label: "Scrap", value: counts.scrap, icon: Recycle, tone: "border-rose-200 bg-rose-50" },
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
                placeholder="Search tools, code, location, status"
              />
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900"
            >
              <option value="ALL">All notch categories</option>
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
            <div className="grid grid-cols-[1.1fr_1fr_0.8fr_0.9fr_0.9fr_1.3fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <div>Tool</div>
              <div>Category</div>
              <div>Status</div>
              <div>Usage</div>
              <div>Location</div>
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
                    <div key={row.id} className="grid grid-cols-[1.1fr_1fr_0.8fr_0.9fr_0.9fr_1.3fr] gap-3 px-4 py-4 text-sm">
                  <div>
                    <p className="font-semibold text-slate-950">{row.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.code || row.spec_text || "-"}</p>
                  </div>
                  <div className="font-medium text-slate-700">{CATEGORY_LABELS[row.category] || row.category}</div>
                  <div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(status)}`}>{status}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{Number(row.usage_count || 0).toLocaleString("en-IN")}</p>
                    <p className="text-xs text-slate-500">spec/job logs</p>
                  </div>
                  <div className="text-slate-700">{row.location || "-"}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditTool(row)} disabled={writeBlocked}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setStatus(row, "MAINTENANCE")} disabled={writeBlocked || status === "MAINTENANCE"}>
                      Maintain
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setStatus(row, "ACTIVE")} disabled={writeBlocked || status === "ACTIVE"}>
                      Active
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setStatus(row, "SCRAP")} disabled={writeBlocked || status === "SCRAP"}>
                      Scrap
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
