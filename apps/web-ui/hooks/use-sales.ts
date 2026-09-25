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
      parchment_required: Boolean(line?.parchment_required),
      parchment_color_id: line?.parchment_required ? line?.parchment_color_id || null : null,
      parchment_color: line?.parchment_required ? line?.parchment_color || line?.parchment_pattern || null : null,
    }
  })

  return {
    ...order,
    po_number: order?.po_number || null,
    po_date: order?.po_date || null,
    origin: String(order?.origin || "CUSTOMER_PO").toUpperCase(),
    origin_review_required: Boolean(order?.origin_review_required),
    internal_order_date: order?.internal_order_date || null,
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
          message: "Commercial approval completed.",
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
  queryClient.invalidateQueries({ queryKey: ["sales", "order-aggregates"] })
  queryClient.invalidateQueries({ queryKey: ["sales", "pending-orders"] })
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
        parchment_required: Boolean(line.parchment_required),
        parchment_color: line.parchment_required ? line.parchment_color || line.parchment_pattern || line.parchment || null : null,
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

export function useSalesOrderAggregates() {
  return useQuery({
    queryKey: ["sales", "order-aggregates"],
    queryFn: async () => {
      const { data } = await salesApi.getOrderAggregates()
      return data
    },
  })
}

export function usePendingSalesOrders(params?: any) {
  return useQuery({
    queryKey: ["sales", "pending-orders", params || {}],
    queryFn: async () => {
      const { data } = await salesApi.getPendingOrders(params)
      return data
    },
  })
}

export function useHoldSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => salesApi.holdOrder(orderId, reason),
    onSuccess: (_response, variables) => invalidateSalesQueries(queryClient, variables.orderId),
  })
}

export function useResumeSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId }: { orderId: string }) => salesApi.resumeOrder(orderId),
    onSuccess: (_response, variables) => invalidateSalesQueries(queryClient, variables.orderId),
  })
}

export function useOrderDeliverySchedules(orderId?: string) {
  return useQuery({
    queryKey: ["sales", "delivery-schedules", orderId],
    queryFn: async () => {
      const { data } = await salesApi.getOrderDeliverySchedules(String(orderId))
      return data
    },
    enabled: Boolean(orderId),
  })
}

export function usePreviewDeliverySchedules() {
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => salesApi.previewOrderDeliverySchedules(orderId, data),
  })
}

export function useCommitDeliverySchedules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => salesApi.commitOrderDeliverySchedules(orderId, data),
    onSuccess: (_response, variables) => {
      invalidateSalesQueries(queryClient, variables.orderId)
      queryClient.invalidateQueries({ queryKey: ["sales", "delivery-schedules", variables.orderId] })
      queryClient.invalidateQueries({ queryKey: ["sales", "pending-orders"] })
    },
  })
}

export function usePreviewScheduleEntirePo() {
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => salesApi.previewScheduleEntirePo(orderId, data),
  })
}

export function useCommitScheduleEntirePo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => salesApi.commitScheduleEntirePo(orderId, data),
    onSuccess: (_response, variables) => {
      invalidateSalesQueries(queryClient, variables.orderId)
      queryClient.invalidateQueries({ queryKey: ["sales", "delivery-schedules", variables.orderId] })
      queryClient.invalidateQueries({ queryKey: ["sales", "pending-orders"] })
    },
  })
}

export function usePatchDeliverySchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, scheduleId, data }: { orderId: string; scheduleId: string; data: any }) =>
      salesApi.patchOrderDeliverySchedule(orderId, scheduleId, data),
    onSuccess: (_response, variables) => {
      invalidateSalesQueries(queryClient, variables.orderId)
      queryClient.invalidateQueries({ queryKey: ["sales", "delivery-schedules", variables.orderId] })
    },
  })
}

export function useMoveDeliverySchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => salesApi.moveDeliverySchedule(orderId, data),
    onSuccess: (_response, variables) => {
      if (!variables.data.preview_only) {
        invalidateSalesQueries(queryClient, variables.orderId)
        queryClient.invalidateQueries({ queryKey: ["sales", "delivery-schedules", variables.orderId] })
        queryClient.invalidateQueries({ queryKey: ["sales", "pending-orders"] })
      }
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

export function useUpdateSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => salesApi.updateOrder(orderId, data),
    onSuccess: (_response, variables) => {
      invalidateSalesQueries(queryClient, variables.orderId)
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
