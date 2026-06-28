"use client"

import dayjs from "dayjs"
import { Barcode, PackageCheck } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import { useApp } from "@/context/AppContext"
import { useCloseReelIssue, useCreateReelIssue, useCreateReelScan, useReelIssues, useReels } from "@/hooks/use-inventory"
import { useMachines } from "@/hooks/use-production"

function getErrorMessage(error: any): string {
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    "Action failed"
  )
}

function parseInventoryQr(raw: string) {
  const trimmed = raw.trim()
  const parts = trimmed.split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") {
    return {
      entityType: parts[1].toUpperCase(),
      entityId: parts[3],
      code: parts[4],
    }
  }
  return { entityType: "", entityId: "", code: trimmed }
}

export default function ReelIssuePage() {
  const { showToast } = useApp()
  const [scanCode, setScanCode] = useState("")
  const [form, setForm] = useState({
    reel_id: "",
    winder_machine_id: "",
    shift: "A",
    issue_date: dayjs().format("YYYY-MM-DD"),
    issued_weight_kg: "",
  })
  const [logScanEvent, setLogScanEvent] = useState(true)
  const [closeWeights, setCloseWeights] = useState<Record<string, string>>({})

  const reelsQuery = useReels()
  const machinesQuery = useMachines()
  const reelIssuesQuery = useReelIssues({ status: "OPEN" })
  const createIssue = useCreateReelIssue()
  const closeIssue = useCloseReelIssue()
  const createReelScan = useCreateReelScan()

  const reels = useMemo(() => {
    const rows = Array.isArray(reelsQuery.data) ? reelsQuery.data : []
    return rows.filter((row: any) => row.status !== "CONSUMED" && row.status !== "SCRAP")
  }, [reelsQuery.data])

  const winderMachines = useMemo(() => {
    const rows = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
    return rows.filter(
      (machine: any) =>
        machine.department === "WINDER" &&
        String(machine.status || "UP").toUpperCase() === "UP",
    )
  }, [machinesQuery.data])

  const openIssues = useMemo(() => {
    const rows = Array.isArray(reelIssuesQuery.data) ? reelIssuesQuery.data : []
    return rows
  }, [reelIssuesQuery.data])

  const resolveReelByCode = () => {
    const parsed = parseInventoryQr(scanCode)
    if (parsed.entityType && parsed.entityType !== "REEL") {
      showToast("Scan a reel QR label for reel issue", "error")
      return
    }
    const scanId = parsed.entityId.trim().toUpperCase()
    const scanReelCode = parsed.code.trim().toUpperCase()
    const matched = reels.find((row: any) =>
      String(row.id || "").toUpperCase() === scanId ||
      String(row.reel_code || "").toUpperCase() === scanReelCode
    )
    if (!matched) {
      showToast("Reel code not found", "error")
      return
    }
    setForm((current) => ({ ...current, reel_id: matched.id }))
    showToast("Reel selected", "success")
  }

  const handleCreateIssue = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.reel_id || !form.winder_machine_id) {
      showToast("Select reel and winder machine", "error")
      return
    }

    try {
      const response = await createIssue.mutateAsync({
        reel_id: form.reel_id,
        winder_machine_id: form.winder_machine_id,
        shift: form.shift,
        issue_date: form.issue_date,
        issued_weight_kg: Number(form.issued_weight_kg),
      })

      if (logScanEvent && form.reel_id) {
        await createReelScan.mutateAsync({
          reelId: form.reel_id,
          data: {
            event_type: "ISSUE_SCAN",
            source: "INVENTORY",
            metadata: { issue_id: response?.data?.id, shift: form.shift },
          },
        })
      }

      showToast("Reel issue created", "success")
      setForm((current) => ({ ...current, issued_weight_kg: "" }))
      reelIssuesQuery.refetch()
      reelsQuery.refetch()
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  const handleCloseIssue = async (issueId: string) => {
    const consumedWeight = Number(closeWeights[issueId] || 0)
    if (consumedWeight < 0) {
      showToast("Consumed weight cannot be negative", "error")
      return
    }
    try {
      await closeIssue.mutateAsync({
        id: issueId,
        data: {
          consumed_weight_kg: consumedWeight,
        },
      })
      showToast("Issue closed", "success")
      setCloseWeights((current) => ({ ...current, [issueId]: "" }))
      reelIssuesQuery.refetch()
      reelsQuery.refetch()
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-cyan-200/70 bg-gradient-to-r from-slate-900 via-cyan-900 to-cyan-700 p-5 text-white shadow-xl">
        <h1 className="text-2xl font-semibold">Reel Issue to Winder</h1>
        <p className="mt-1 text-sm text-cyan-100">Scan reel, assign winder + shift, and issue without job-card locking.</p>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Create Reel Issue</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="flex items-center gap-2">
            <Barcode className="h-4 w-4 text-slate-500" />
            <input
              value={scanCode}
              onChange={(event) => setScanCode(event.target.value)}
              placeholder="Scan reel QR or enter reel code"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
          <button
            onClick={resolveReelByCode}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
          >
            <PackageCheck className="h-4 w-4" />
            Select Reel
          </button>
        </div>

        <form onSubmit={handleCreateIssue} className="mt-4 grid gap-3 md:grid-cols-3">
          <select
            required
            value={form.reel_id}
            onChange={(event) => setForm((current) => ({ ...current, reel_id: event.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          >
            <option value="">Select reel</option>
            {reels.map((reel: any) => (
              <option key={reel.id} value={reel.id}>
                {reel.reel_code} | {Number(reel.current_weight_kg || 0).toFixed(2)}kg | {reel.status}
              </option>
            ))}
          </select>

          <select
            required
            value={form.winder_machine_id}
            onChange={(event) => setForm((current) => ({ ...current, winder_machine_id: event.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          >
            <option value="">Select winder machine</option>
            {winderMachines.map((machine: any) => (
              <option key={machine.id} value={machine.id}>
                {machine.code} - {machine.name}
              </option>
            ))}
          </select>

          <select
            value={form.shift}
            onChange={(event) => setForm((current) => ({ ...current, shift: event.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="GENERAL">GENERAL</option>
            <option value="DAY">DAY</option>
            <option value="NIGHT">NIGHT</option>
          </select>

          <input
            required
            type="date"
            value={form.issue_date}
            onChange={(event) => setForm((current) => ({ ...current, issue_date: event.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          />

          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Issued weight (kg)"
            value={form.issued_weight_kg}
            onChange={(event) => setForm((current) => ({ ...current, issued_weight_kg: event.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
          />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={logScanEvent}
              onChange={(event) => setLogScanEvent(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Log issue scan event
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createIssue.isPending || createReelScan.isPending}
              className="h-10 rounded-lg bg-cyan-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              Create Reel Issue
            </button>
          </div>
        </form>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Open Reel Issues</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Issue</th>
                <th className="py-2">Reel</th>
                <th className="py-2">Shift</th>
                <th className="py-2">Issued/Remaining</th>
                <th className="py-2">Close</th>
              </tr>
            </thead>
            <tbody>
              {openIssues.map((issue: any) => (
                <tr key={issue.id} className="border-b border-slate-100">
                  <td className="py-2 text-xs">{issue.id.slice(0, 8)}</td>
                  <td className="py-2 text-xs">{issue.reel_id.slice(0, 8)}</td>
                  <td className="py-2">{issue.shift}</td>
                  <td className="py-2">
                    {Number(issue.issued_weight_kg || 0).toFixed(2)} / {Number(issue.remaining_weight_kg || 0).toFixed(2)}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Consumed kg"
                        value={closeWeights[issue.id] || ""}
                        onChange={(event) => setCloseWeights((current) => ({ ...current, [issue.id]: event.target.value }))}
                        className="h-8 w-28 rounded border border-slate-200 px-2 text-xs"
                      />
                      <button
                        onClick={() => handleCloseIssue(issue.id)}
                        className="h-8 rounded bg-slate-900 px-3 text-xs font-semibold text-white"
                      >
                        Close
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {openIssues.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    No open reel issues
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
