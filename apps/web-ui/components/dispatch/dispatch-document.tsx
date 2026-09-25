"use client"

import { businessDate } from "@/lib/business-date"

import React from "react"

export interface DispatchDocumentProps {
    dispatchData: any
    onChange?: (data: any) => void
    printMode?: boolean
}

export function DispatchDocument({ dispatchData, onChange, printMode = false }: DispatchDocumentProps) {
    const company = dispatchData.company || {}
    const updateTransporter = (field: string, value: string) => {
        if (!onChange) return
        onChange({
            ...dispatchData,
            transporter: {
                ...(dispatchData.transporter || {}),
                [field]: value
            }
        })
    }

    const updateRemarks = (value: string) => {
        if (!onChange) return
        onChange({
            ...dispatchData,
            remarks: value
        })
    }

    const updateItemRemark = (index: number, value: string) => {
        if (!onChange) return
        const newItems = [...(dispatchData.items || [])]
        newItems[index] = { ...newItems[index], remarks: value }
        onChange({ ...dispatchData, items: newItems })
    }

    // Pre-calculate sums if missing
    const items = dispatchData.items || []
    const summary = dispatchData.summary || {
        total_units: items.reduce((sum: number, item: any) => sum + (Number(item.qty_units) || 0), 0),
        total_pcs: items.reduce((sum: number, item: any) => sum + (Number(item.total_pcs) || 0), 0),
        total_weight: items.reduce((sum: number, item: any) => sum + (Number(item.net_weight) || 0), 0),
    }

    return (
        <div className="w-full min-w-0">
        <div className={`min-w-0 bg-card text-foreground break-words ${printMode ? "p-0" : "p-4 sm:p-8 border rounded-lg shadow-sm"}`}>
            {/* Header Block */}
            <div className="flex flex-col gap-5 md:flex-row print:flex-row justify-between items-start mb-8 border-b-2 border-slate-800 pb-4">
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-3xl font-bold uppercase tracking-tight">{company.legal_name || company.name}</h1>
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{company.address}</p>
                    <p className="text-sm text-muted-foreground">GSTIN: {company.gstin}</p>
                </div>
                <div className="min-w-0 text-left md:text-right print:text-right">
                    <h2 className="text-lg sm:text-2xl font-bold bg-slate-900 text-white px-4 py-1 inline-block uppercase tracking-widest rounded-sm">
                        Delivery Challan
                    </h2>
                    <div className="mt-4 text-sm space-y-1">
                        <p><span className="font-semibold text-muted-foreground mr-2">Challan No:</span>{dispatchData.challan_no || dispatchData.dispatch_ref || "Generated on seal"}</p>
                        <p><span className="font-semibold text-muted-foreground mr-2">Challan Date:</span>{dispatchData.date || businessDate()}</p>
                        <p><span className="font-semibold text-muted-foreground mr-2">Job Card Ref:</span> {dispatchData.job_card_no}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4 sm:gap-8 mb-8">
                {/* Customer Block */}
                <div className="border border-border rounded p-4">
                    <h3 className="font-semibold text-xs uppercase text-muted-foreground mb-2 border-b pb-1">Billed To</h3>
                    <p className="font-bold text-lg">{dispatchData.customer?.name}</p>
                    <div className="text-sm mt-2 whitespace-pre-line text-muted-foreground">
                        {dispatchData.customer?.address}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">GSTIN: {dispatchData.customer?.gstin}</p>
                </div>

                {/* Transporter Block */}
                <div className="border border-border rounded p-4">
                    <h3 className="font-semibold text-xs uppercase text-muted-foreground mb-2 border-b pb-1">Transport Details</h3>
                    <div className="space-y-3 mt-3">
                        <div className="flex items-center">
                            <span className="text-sm font-medium w-24 shrink-0 text-muted-foreground">Vehicle No:</span>
                            {printMode || !onChange ? (
                                <span className="text-sm font-semibold">{dispatchData.transporter?.vehicle_no || "—"}</span>
                            ) : (
                                <input
                                    type="text"
                                    aria-label="Vehicle number"
                                    className="min-w-0 flex-1 h-10 px-2 border border-border rounded text-sm focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
                                    value={dispatchData.transporter?.vehicle_no || ""}
                                    onChange={(e) => updateTransporter("vehicle_no", e.target.value)}
                                    placeholder="Enter vehicle no."
                                />
                            )}
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-medium w-24 shrink-0 text-muted-foreground">LR No:</span>
                            {printMode || !onChange ? (
                                <span className="text-sm font-semibold">{dispatchData.transporter?.lr_no || "—"}</span>
                            ) : (
                                <input
                                    type="text"
                                    aria-label="LR number"
                                    className="min-w-0 flex-1 h-10 px-2 border border-border rounded text-sm focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
                                    value={dispatchData.transporter?.lr_no || ""}
                                    onChange={(e) => updateTransporter("lr_no", e.target.value)}
                                    placeholder="Enter LR no."
                                />
                            )}
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-medium w-24 shrink-0 text-muted-foreground">Transporter:</span>
                            {printMode || !onChange ? (
                                <span className="text-sm font-semibold">{dispatchData.transporter?.name || "—"}</span>
                            ) : (
                                <input
                                    type="text"
                                    aria-label="Transporter name"
                                    className="min-w-0 flex-1 h-10 px-2 border border-border rounded text-sm focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
                                    value={dispatchData.transporter?.name || ""}
                                    onChange={(e) => updateTransporter("name", e.target.value)}
                                    placeholder="Enter transporter name"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Material Table */}
            <div className="space-y-3 mb-8 md:hidden print:hidden">
                {items.map((item: any, idx: number) => (
                    <section key={idx} className="rounded-lg border border-border p-4 space-y-3">
                        <h3 className="text-sm font-semibold">{idx + 1}. {item.description}</h3>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <div><dt className="text-muted-foreground">Packing</dt><dd>{item.packing_type}</dd></div>
                            <div><dt className="text-muted-foreground">Units</dt><dd>{item.qty_units}</dd></div>
                            <div><dt className="text-muted-foreground">Pieces / unit</dt><dd>{item.pcs_per_unit}</dd></div>
                            <div><dt className="text-muted-foreground">Total pieces</dt><dd className="font-semibold">{item.total_pcs}</dd></div>
                            <div><dt className="text-muted-foreground">Weight (kg)</dt><dd>{Number(item.net_weight).toFixed(2)}</dd></div>
                        </dl>
                        {printMode || !onChange ? <p className="text-sm text-muted-foreground">{item.remarks}</p> : (
                            <label className="block text-sm">Item remarks
                                <input className="mt-1 w-full min-w-0 rounded border border-border bg-transparent px-3 h-10 focus-visible:ring-2 focus-visible:ring-ring" value={item.remarks || ""} onChange={(e) => updateItemRemark(idx, e.target.value)} placeholder="Optional remark..." />
                            </label>
                        )}
                    </section>
                ))}
                {items.length === 0 && <p className="text-sm text-muted-foreground">No items available for dispatch</p>}
                <p className="rounded-lg bg-muted p-4 text-sm font-semibold">Total: {summary.total_pcs} pieces · {summary.total_units} units · {Number(summary.total_weight).toFixed(2)} kg</p>
            </div>
            <div className="hidden md:block print:block overflow-x-auto mb-8">
            <table className="w-full text-sm mb-8 border border-border">
                <thead className="bg-muted border-b border-border">
                    <tr>
                        <th className="py-2 px-3 text-left font-semibold border-r border-border">No.</th>
                        <th className="py-2 px-3 text-left font-semibold border-r border-border">Description</th>
                        <th className="py-2 px-3 text-left font-semibold border-r border-border">Packing</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-border">Units</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-border">PCS/Unit</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-border">Total PCS</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-border">Weight (KG)</th>
                        <th className="py-2 px-3 text-left font-semibold">Remarks</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {items.map((item: any, idx: number) => (
                        <tr key={idx}>
                            <td className="py-2 px-3 border-r border-border">{idx + 1}</td>
                            <td className="py-2 px-3 border-r border-border font-medium">{item.description}</td>
                            <td className="py-2 px-3 border-r border-border">{item.packing_type}</td>
                            <td className="py-2 px-3 text-right border-r border-border">{item.qty_units}</td>
                            <td className="py-2 px-3 text-right border-r border-border">{item.pcs_per_unit}</td>
                            <td className="py-2 px-3 text-right border-r border-border font-semibold">{item.total_pcs}</td>
                            <td className="py-2 px-3 text-right border-r border-border font-semibold">{Number(item.net_weight).toFixed(2)}</td>
                            <td className="py-1 px-2">
                                {printMode || !onChange ? (
                                    <span className="text-muted-foreground">{item.remarks}</span>
                                ) : (
                                    <input
                                        type="text"
                                        className="w-full h-7 px-2 text-xs border-b border-transparent hover:border-border focus:border-amber-500 focus:outline-none bg-transparent"
                                        placeholder="Optional remark..."
                                        value={item.remarks || ""}
                                        onChange={(e) => updateItemRemark(idx, e.target.value)}
                                    />
                                )}
                            </td>
                        </tr>
                    ))}
                    {items.length === 0 && (
                        <tr>
                            <td colSpan={8} className="py-8 text-center text-muted-foreground italic">No items available for dispatch</td>
                        </tr>
                    )}
                </tbody>
                <tfoot className="bg-muted border-t-2 border-slate-800">
                    <tr>
                        <td colSpan={3} className="py-3 px-3 text-right font-bold border-r border-border">TOTAL</td>
                        <td className="py-3 px-3 text-right font-bold border-r border-border">{summary.total_units}</td>
                        <td className="py-3 px-3 border-r border-border"></td>
                        <td className="py-3 px-3 text-right font-bold border-r border-border">{summary.total_pcs}</td>
                        <td className="py-3 px-3 text-right font-bold border-r border-border">{Number(summary.total_weight).toFixed(2)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
            </div>

            {/* Footer / Notes */}
            <div className="mb-12">
                <h4 className="font-semibold text-sm mb-2">Dispatch Notes:</h4>
                {printMode || !onChange ? (
                    <div className="text-sm text-muted-foreground min-h-12 whitespace-pre-line">{dispatchData.remarks || "—"}</div>
                ) : (
                    <textarea
                        className="w-full border border-border rounded p-3 text-sm focus:outline-amber-500 leading-relaxed"
                        rows={3}
                        placeholder="Add any additional notes for the transporter or customer..."
                        value={dispatchData.remarks || ""}
                        onChange={(e) => updateRemarks(e.target.value)}
                    />
                )}
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 md:grid-cols-4 print:grid-cols-4 gap-x-4 gap-y-8 mt-16 pt-8 border-t border-border text-center">
                <div>
                    <p className="text-sm font-semibold mb-8">Prepared By</p>
                    <div className="border-b border-slate-400 w-full max-w-32 mx-auto"></div>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-8">Supervisor</p>
                    <div className="border-b border-slate-400 w-full max-w-32 mx-auto"></div>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-8">Transporter&apos;s Sign</p>
                    <div className="border-b border-slate-400 w-full max-w-32 mx-auto"></div>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-8">Receiver&apos;s Sign</p>
                    <div className="border-b border-slate-400 w-full max-w-32 mx-auto"></div>
                </div>
            </div>
        </div>
        </div>
    )
}
