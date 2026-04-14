import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { salesApi } from "@/lib/api"

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
        status: line.status || order.status,
        qty: Number(line.qty ?? line.quantity ?? line.remaining_qty ?? 0),
        released_qty: Number(line.released_qty || line.qty_released || 0),
        remaining_qty: Number(line.remaining_qty ?? line.remainingQty ?? line.qty ?? 0),
        parchment_color: line.parchment_color || line.parchment_pattern || line.parchment || null,
      })),
  )
}

export function useReleasedSalesLines() {
  return useQuery({
    queryKey: ["sales", "released-lines"],
    queryFn: async () => {
      const { data } = await salesApi.getOrders()
      return normalizeReleasedLines(Array.isArray(data) ? data : data?.items || data?.rows || [])
    },
  })
}

export function useSalesOrders() {
  return useQuery({
    queryKey: ["sales", "orders"],
    queryFn: async () => {
      const { data } = await salesApi.getOrders()
      if (Array.isArray(data)) return data
      if (Array.isArray(data?.items)) return data.items
      if (Array.isArray(data?.rows)) return data.rows
      return []
    },
  })
}

export function useCreateSalesOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => salesApi.createOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales", "orders"] })
      queryClient.invalidateQueries({ queryKey: ["sales", "released-lines"] })
    },
  })
}
