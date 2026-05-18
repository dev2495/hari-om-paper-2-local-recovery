"use client"

import { useMemo, useState } from "react"

import { useReelIssues, useReels, useReelScans } from "@/hooks/use-inventory"

export default function InventoryReelTracePage() {
  const [selectedReelId, setSelectedReelId] = useState<string>("")
  const reelsQuery = useReels()
  const issuesQuery = useReelIssues()
  const scansQuery = useReelScans(selectedReelId, { limit: 50 })

  const reels = useMemo(() => (Array.isArray(reelsQuery.data) ? reelsQuery.data : []), [reelsQuery.data])
  const selectedReel = reels.find((row: any) => row.id === selectedReelId) || null
  const scans = useMemo(() => (Array.isArray(scansQuery.data) ? scansQuery.data : []), [scansQuery.data])
  const linkedIssues = useMemo(() => {
    const all = Array.isArray(issuesQuery.data) ? issuesQuery.data : []
    return all.filter((row: any) => row.reel_id === selectedReelId)
  }, [issuesQuery.data, selectedReelId])

  return (
    <div className="space-y-4">
      <section className="page-hero">
        <h1 className="page-title">Reel Trace Timeline</h1>
        <p className="page-subtitle">Track inward, issue, close, and scan timeline for each reel.</p>
      </section>

      <section className="erp-panel p-4">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Select Reel</label>
        <select
          value={selectedReelId}
          onChange={(event) => setSelectedReelId(event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm md:max-w-xl"
        >
          <option value="">Select reel code</option>
          {reels.map((reel: any) => (
            <option key={reel.id} value={reel.id}>
              {reel.reel_code} | {reel.status} | {Number(reel.current_weight_kg || 0).toFixed(2)}kg
            </option>
          ))}
        </select>
      </section>

      {selectedReel && (
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="erp-panel p-4">
            <h2 className="text-lg font-semibold">Reel Snapshot</h2>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-4"><dt>Code</dt><dd className="font-medium">{selectedReel.reel_code}</dd></div>
              <div className="flex justify-between gap-4"><dt>Status</dt><dd>{selectedReel.status}</dd></div>
              <div className="flex justify-between gap-4"><dt>Current kg</dt><dd>{Number(selectedReel.current_weight_kg || 0).toFixed(2)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Inward kg</dt><dd>{Number(selectedReel.inward_weight_kg || 0).toFixed(2)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Vendor</dt><dd>{selectedReel.supplier_name || "-"}</dd></div>
            </dl>
          </article>

          <article className="erp-panel p-4">
            <h2 className="text-lg font-semibold">Linked Reel Issues</h2>
            <div className="mt-3 erp-table-wrap">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Issue ID</th>
                    <th>Section</th>
                    <th>Machine Ref</th>
                    <th>Shift</th>
                    <th>Status</th>
                    <th>Issued kg</th>
                    <th>Remaining kg</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedIssues.map((issue: any) => (
                    <tr key={issue.id}>
                      <td className="font-medium">{issue.id}</td>
                      <td>{issue.issue_section || "-"}</td>
                      <td>{issue.machine_id || "-"}</td>
                      <td>{issue.shift}</td>
                      <td>{issue.status}</td>
                      <td>{Number(issue.issued_weight_kg || 0).toFixed(2)}</td>
                      <td>{Number(issue.remaining_weight_kg || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {linkedIssues.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-slate-500">No issues linked</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {selectedReel && (
        <section className="erp-panel p-4">
          <h2 className="text-lg font-semibold">Scan Events</h2>
          <div className="mt-3 erp-table-wrap">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Operator</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((event: any) => (
                  <tr key={event.id}>
                    <td>{event.timestamp || "-"}</td>
                    <td>{event.event_type}</td>
                    <td>{event.source}</td>
                    <td>{event.operator_id || "-"}</td>
                    <td className="font-mono text-xs text-slate-600">{JSON.stringify(event.metadata || {})}</td>
                  </tr>
                ))}
                {scans.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-500">No scan events</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
