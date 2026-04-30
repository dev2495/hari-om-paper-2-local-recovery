"use client"

import React from "react"

export interface DispatchDocumentProps {
    dispatchData: any
    onChange?: (data: any) => void
    printMode?: boolean
}

export function DispatchDocument({ dispatchData, onChange, printMode = false }: DispatchDocumentProps) {
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
        <div className={`bg-white text-slate-900 ${printMode ? "p-0" : "p-8 border rounded-lg shadow-sm"}`}>
            {/* Header Block */}
            <div className="flex justify-between items-start mb-8 border-b-2 border-slate-800 pb-4">
                <div>
                    <h1 className="text-3xl font-bold uppercase tracking-tight">HARI OM PAPER</h1>
                    <p className="text-sm text-slate-600 mt-1">GIDC Vapi, Gujarat, India</p>
                    <p className="text-sm text-slate-600">GSTIN: 24XXXXXXXXXX1Z5</p>
                </div>
                <div className="text-right">
                    <h2 className="text-2xl font-bold bg-slate-900 text-white px-4 py-1 inline-block uppercase tracking-widest rounded-sm">
                        Delivery Challan
                    </h2>
                    <div className="mt-4 text-sm space-y-1">
                        <p><span className="font-semibold text-slate-500 mr-2">Challan Date:</span>{dispatchData.date || new Date().toISOString().split("T")[0]}</p>
                        <p><span className="font-semibold text-slate-500 mr-2">Job Card Ref:</span> {dispatchData.job_card_no}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
                {/* Customer Block */}
                <div className="border border-slate-300 rounded p-4">
                    <h3 className="font-semibold text-xs uppercase text-slate-500 mb-2 border-b pb-1">Billed To</h3>
                    <p className="font-bold text-lg">{dispatchData.customer?.name || "Unknown Customer"}</p>
                    <div className="text-sm mt-2 whitespace-pre-line text-slate-700">
                        {dispatchData.customer?.address || "Address not specified"}
                    </div>
                </div>

                {/* Transporter Block */}
                <div className="border border-slate-300 rounded p-4">
                    <h3 className="font-semibold text-xs uppercase text-slate-500 mb-2 border-b pb-1">Transport Details</h3>
                    <div className="space-y-3 mt-3">
                        <div className="flex items-center">
                            <span className="text-sm font-medium w-24 text-slate-600">Vehicle No:</span>
                            {printMode || !onChange ? (
                                <span className="text-sm font-semibold">{dispatchData.transporter?.vehicle_no || "—"}</span>
                            ) : (
                                <input
                                    type="text"
                                    className="flex-1 h-8 px-2 border border-slate-200 rounded text-sm focus:border-amber-500 focus:outline-none"
                                    value={dispatchData.transporter?.vehicle_no || ""}
                                    onChange={(e) => updateTransporter("vehicle_no", e.target.value)}
                                    placeholder="Enter vehicle no."
                                />
                            )}
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-medium w-24 text-slate-600">LR No:</span>
                            {printMode || !onChange ? (
                                <span className="text-sm font-semibold">{dispatchData.transporter?.lr_no || "—"}</span>
                            ) : (
                                <input
                                    type="text"
                                    className="flex-1 h-8 px-2 border border-slate-200 rounded text-sm focus:border-amber-500 focus:outline-none"
                                    value={dispatchData.transporter?.lr_no || ""}
                                    onChange={(e) => updateTransporter("lr_no", e.target.value)}
                                    placeholder="Enter LR no."
                                />
                            )}
                        </div>
                        <div className="flex items-center">
                            <span className="text-sm font-medium w-24 text-slate-600">Transporter:</span>
                            {printMode || !onChange ? (
                                <span className="text-sm font-semibold">{dispatchData.transporter?.name || "—"}</span>
                            ) : (
                                <input
                                    type="text"
                                    className="flex-1 h-8 px-2 border border-slate-200 rounded text-sm focus:border-amber-500 focus:outline-none"
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
            <table className="w-full text-sm mb-8 border border-slate-300">
                <thead className="bg-slate-100 border-b border-slate-300">
                    <tr>
                        <th className="py-2 px-3 text-left font-semibold border-r border-slate-300">No.</th>
                        <th className="py-2 px-3 text-left font-semibold border-r border-slate-300">Description</th>
                        <th className="py-2 px-3 text-left font-semibold border-r border-slate-300">Packing</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-slate-300">Units</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-slate-300">PCS/Unit</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-slate-300">Total PCS</th>
                        <th className="py-2 px-3 text-right font-semibold border-r border-slate-300">Weight (KG)</th>
                        <th className="py-2 px-3 text-left font-semibold">Remarks</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {items.map((item: any, idx: number) => (
                        <tr key={idx}>
                            <td className="py-2 px-3 border-r border-slate-300">{idx + 1}</td>
                            <td className="py-2 px-3 border-r border-slate-300 font-medium">{item.description}</td>
                            <td className="py-2 px-3 border-r border-slate-300">{item.packing_type}</td>
                            <td className="py-2 px-3 text-right border-r border-slate-300">{item.qty_units}</td>
                            <td className="py-2 px-3 text-right border-r border-slate-300">{item.pcs_per_unit}</td>
                            <td className="py-2 px-3 text-right border-r border-slate-300 font-semibold">{item.total_pcs}</td>
                            <td className="py-2 px-3 text-right border-r border-slate-300 font-semibold">{Number(item.net_weight).toFixed(2)}</td>
                            <td className="py-1 px-2">
                                {printMode || !onChange ? (
                                    <span className="text-slate-600">{item.remarks}</span>
                                ) : (
                                    <input
                                        type="text"
                                        className="w-full h-7 px-2 text-xs border-b border-transparent hover:border-slate-300 focus:border-amber-500 focus:outline-none bg-transparent"
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
                            <td colSpan={8} className="py-8 text-center text-slate-500 italic">No items available for dispatch</td>
                        </tr>
                    )}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-800">
                    <tr>
                        <td colSpan={3} className="py-3 px-3 text-right font-bold border-r border-slate-300">TOTAL</td>
                        <td className="py-3 px-3 text-right font-bold border-r border-slate-300">{summary.total_units}</td>
                        <td className="py-3 px-3 border-r border-slate-300"></td>
                        <td className="py-3 px-3 text-right font-bold border-r border-slate-300">{summary.total_pcs}</td>
                        <td className="py-3 px-3 text-right font-bold border-r border-slate-300">{Number(summary.total_weight).toFixed(2)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>

            {/* Footer / Notes */}
            <div className="mb-12">
                <h4 className="font-semibold text-sm mb-2">Dispatch Notes:</h4>
                {printMode || !onChange ? (
                    <div className="text-sm text-slate-700 min-h-12 whitespace-pre-line">{dispatchData.remarks || "—"}</div>
                ) : (
                    <textarea
                        className="w-full border border-slate-200 rounded p-3 text-sm focus:outline-amber-500 leading-relaxed"
                        rows={3}
                        placeholder="Add any additional notes for the transporter or customer..."
                        value={dispatchData.remarks || ""}
                        onChange={(e) => updateRemarks(e.target.value)}
                    />
                )}
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-4 gap-4 mt-16 pt-8 border-t border-slate-300 text-center">
                <div>
                    <p className="text-sm font-semibold mb-8">Prepared By</p>
                    <div className="border-b border-slate-400 w-32 mx-auto"></div>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-8">Supervisor</p>
                    <div className="border-b border-slate-400 w-32 mx-auto"></div>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-8">Transporter&apos;s Sign</p>
                    <div className="border-b border-slate-400 w-32 mx-auto"></div>
                </div>
                <div>
                    <p className="text-sm font-semibold mb-8">Receiver&apos;s Sign</p>
                    <div className="border-b border-slate-400 w-32 mx-auto"></div>
                </div>
            </div>
        </div>
    )
}
