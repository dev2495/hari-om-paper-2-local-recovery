import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { useSalesOrders } from "@/hooks/use-sales"
import { productionApi } from "@/lib/api"

const PAGE_SIZE = 500
const MAX_PAGES = 8

/**
 * Every job card of the plant (client 2026-10-27: the list and the manager must not stop at a
 * page): loaded in pages of 500 until the server has no more, up to 4,000 cards. The key starts
 * with "planning-job-cards", so every lifecycle change refreshes it.
 */
export function useAllJobCards(params: Record<string, string | undefined> = {}, enabled = true) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value)) as Record<string, string>
  return useQuery({
    queryKey: ["planning-job-cards", "all", clean],
    queryFn: async () => {
      const seen = new Set<string>()
      const rows: any[] = []
      let complete = false
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data } = await productionApi.getPlanningJobCards({ ...clean, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        const batch: any[] = Array.isArray(data) ? data : []
        for (const row of batch) {
          const id = String(row?.id || "")
          if (!id || seen.has(id)) continue
          seen.add(id)
          rows.push(row)
        }
        if (batch.length < PAGE_SIZE) {
          complete = true
          break
        }
      }
      return { rows, complete }
    },
    enabled,
  })
}

export type OrderInfo = { id: string; order_no: string; po_number: string | null; customer_name: string | null; lines: Map<string, { qty: number; line_no: number | null }> }

/** Sales order number, PO and line quantities by order id (the job card rows only carry the id). */
export function useOrderIndex(enabled = true) {
  const query = useSalesOrders({ limit: 500 })
  const index = useMemo(() => {
    const map = new Map<string, OrderInfo>()
    if (!enabled) return map
    for (const order of Array.isArray(query.data) ? query.data : []) {
      const id = String(order?.id || "")
      if (!id) continue
      const lines = new Map<string, { qty: number; line_no: number | null }>()
      ;(Array.isArray(order?.lines) ? order.lines : []).forEach((line: any, position: number) => {
        if (line?.id) lines.set(String(line.id), { qty: Number(line.qty || 0), line_no: Number(line.line_no || line.line_number || position + 1) || null })
      })
      map.set(id, { id, order_no: String(order.order_no || ""), po_number: order.po_number || null, customer_name: order.customer_name || null, lines })
    }
    return map
  }, [query.data, enabled])
  return { index, isLoading: query.isLoading }
}

/** The job card rows with the sales order number, PO and line qty filled in (search finds them too). */
export function useJobCardRows(params: Record<string, string | undefined> = {}, enabled = true) {
  const cards = useAllJobCards(params, enabled)
  const { index } = useOrderIndex(enabled)
  const rows = useMemo(() => {
    const list: any[] = cards.data?.rows || []
    if (!index.size) return list
    return list.map((job) => {
      const order = index.get(String(job.sales_order_id || ""))
      if (!order) return job
      const line = job.sales_order_line_id ? order.lines.get(String(job.sales_order_line_id)) : undefined
      return {
        ...job,
        sales_order_no: job.sales_order_no || order.order_no || undefined,
        po_number: job.po_number || order.po_number || undefined,
        order_line_qty: line ? line.qty : undefined,
        order_line_no: line ? line.line_no : undefined,
      }
    })
  }, [cards.data, index])
  return { ...cards, rows, complete: cards.data?.complete ?? true }
}
