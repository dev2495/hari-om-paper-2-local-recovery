import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { salesApi } from "@/lib/api"

function asArray<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.rows)) return value.rows
  return []
}

export function normalizeSalesOrder(order: any) {
  const normalizedLines = asArray(order?.lines).map((line: any) => {
    const qty = Number(line?.qty ?? line?.quantity ?? 0)
    const releasedQty = Number(line?.released_qty ?? line?.qty_released ?? line?.planned_release_qty ?? 0)
    const fulfilledQty = Number(line?.fulfilled_qty ?? 0)
    const remainingQty = Number(line?.remaining_qty ?? qty - fulfilledQty)
    const releaseRemainingQty = Number(line?.release_remaining_qty ?? qty - releasedQty)

    return {
      ...line,
      line_no: Number(line?.line_no ?? 0),
      product_code: line?.product_code || null,
      rate_per_pc: line?.rate_per_pc ?? null,
      qty,
      released_qty: releasedQty,
      release_remaining_qty: releaseRemainingQty,
      release_lots: asArray(line?.release_lots),
      fulfilled_qty: fulfilledQty,
      remaining_qty: remainingQty,
      due_date: line?.due_date || null,
      parchment_color: line?.parchment_color || line?.parchment_pattern || null,
    }
  })

  return {
    ...order,
    po_number: order?.po_number || null,
    po_date: order?.po_date || null,
    lines: normalizedLines,
    status: String(order?.status || "draft").toLowerCase(),
    customer_name: order?.customer_name || order?.customer_id || "Customer",
    line_count: normalizedLines.length,
    total_qty: normalizedLines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    remaining_qty: normalizedLines.reduce((sum, line) => sum + Number(line.remaining_qty || 0), 0),
    released_qty: normalizedLines.reduce((sum, line) => sum + Number(line.released_qty || 0), 0),
    fulfilled_qty: normalizedLines.reduce((sum, line) => sum + Number(line.fulfilled_qty || 0), 0),
  }
}

function normalizeOrdersPayload(data: any) {
  return asArray(data).map(normalizeSalesOrder)
}

function fallbackTimeline(order: any) {
  if (!order) return []
  return [
    order.created_at
      ? {
          id: `${order.id}:created`,
          event_type: "SALES_ORDER_CREATED",
          title: "Sales order created",
          message: "Commercial demand entered into the queue.",
          created_at: order.created_at,
          actor: order.created_by || "system",
        }
      : null,
    order.approved_at
      ? {
          id: `${order.id}:approved`,
          event_type: "SALES_ORDER_APPROVED",
          title: "Sales order approved",
          message: "Maker-checker approval completed.",
          created_at: order.approved_at,
          actor: order.approved_by || "approver",
        }
      : null,
    order.released_at
      ? {
          id: `${order.id}:released`,
          event_type: "SALES_ORDER_RELEASED",
          title: "Released to production",
          message: "Order is eligible for planning sync and job-card creation.",
          created_at: order.released_at,
          actor: order.released_by || "approver",
        }
      : null,
  ].filter(Boolean)
}

function invalidateSalesQueries(queryClient: ReturnType<typeof useQueryClient>, orderId?: string) {
  queryClient.invalidateQueries({ queryKey: ["sales", "orders"] })
  queryClient.invalidateQueries({ queryKey: ["sales", "released-lines"] })
  if (orderId) {
    queryClient.invalidateQueries({ queryKey: ["sales", "order", orderId] })
    queryClient.invalidateQueries({ queryKey: ["sales", "timeline", orderId] })
  }
}

function normalizeReleasedLines(orders: any[]) {
  return (orders || []).flatMap((order: any) =>
    (order.lines || [])
      .filter((line: any) => {
        const releasedQty = Number(line.released_qty || line.qty_released || line.planned_release_qty || 0)
        const remainingQty = Number(line.remaining_qty ?? line.remainingQty ?? line.qty ?? 0)
        return releasedQty > 0 || remainingQty > 0 || order.status === "released" || order.status === "partially_released"
      })
      .map((line: any) => ({
        ...line,
        order_id: order.id,
        order_no: order.order_no || order.sales_order_no || order.so_no || order.id,
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        status: line.status || order.status,
        qty: Number(line.qty ?? line.quantity ?? line.remaining_qty ?? 0),
        released_qty: Number(line.released_qty || line.qty_released || 0),
        release_remaining_qty: Number(line.release_remaining_qty ?? line.remaining_qty ?? line.remainingQty ?? line.qty ?? 0),
        remaining_qty: Number(line.remaining_qty ?? line.remainingQty ?? line.qty ?? 0),
        parchment_color: line.parchment_color || line.parchment_pattern || line.parchment || null,
      })),
  )
}

export function useReleasedSalesLines() {
  return useQuery({
    queryKey: ["sales", "released-lines"],
    queryFn: async () => {
      const { data } = await salesApi.getOrders({ limit: 500 })
      return normalizeReleasedLines(normalizeOrdersPayload(data))
    },
  })
}

export function useSalesOrders(params?: any) {
  return useQuery({
    queryKey: ["sales", "orders", params || {}],
    queryFn: async () => {
      const { data } = await salesApi.getOrders(params)
      return normalizeOrdersPayload(data)
    },
  })
}

export function useSalesOrder(orderId?: string) {
  return useQuery({
    queryKey: ["sales", "order", orderId],
    queryFn: async () => {
      const { data } = await salesApi.getOrder(String(orderId))
      return normalizeSalesOrder(data)
    },
    enabled: Boolean(orderId),
  })
}

export function useSalesOrderTimeline(orderId?: string) {
  return useQuery({
    queryKey: ["sales", "timeline", orderId],
    queryFn: async () => {
      try {
        const { data } = await salesApi.getOrderTimeline(String(orderId))
        return asArray(data)
      } catch {
        const { data } = await salesApi.getOrder(String(orderId))
        return fallbackTimeline(normalizeSalesOrder(data))
      }
    },
    enabled: Boolean(orderId),
  })
}

export function useCreateSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => salesApi.createOrder(data),
    onSuccess: (response) => {
      const orderId = String(response?.data?.id || "")
      invalidateSalesQueries(queryClient, orderId || undefined)
    },
  })
}

export function useApproveSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: string | { orderId: string; plantId?: string }) => {
      const orderId = typeof input === "string" ? input : input.orderId
      const plantId = typeof input === "string" ? undefined : input.plantId
      return salesApi.approveOrder(orderId, plantId)
    },
    onSuccess: (_response, input) => {
      const orderId = typeof input === "string" ? input : input.orderId
      invalidateSalesQueries(queryClient, orderId)
    },
  })
}

export function useReleaseSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: string | { orderId: string; plantId?: string }) => {
      const orderId = typeof input === "string" ? input : input.orderId
      const plantId = typeof input === "string" ? undefined : input.plantId
      return salesApi.releaseOrder(orderId, plantId)
    },
    onSuccess: (_response, input) => {
      const orderId = typeof input === "string" ? input : input.orderId
      invalidateSalesQueries(queryClient, orderId)
    },
  })
}

export function useReleaseSalesOrderLine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, data, plantId }: { lineId: string; data: any; plantId?: string }) => salesApi.releaseOrderLine(lineId, data, plantId),
    onSuccess: (response) => {
      const orderId = String(response?.data?.order_id || "")
      invalidateSalesQueries(queryClient, orderId || undefined)
    },
  })
}
