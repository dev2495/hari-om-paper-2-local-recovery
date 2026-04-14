import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["workspace-notifications"],
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/auth/notifications", { params: { limit: 12 } })
        if (Array.isArray(data)) return { items: data }
        if (Array.isArray(data?.items)) return data
      } catch {
        // The notification proxy route can be absent in some recovered snapshots.
      }
      return { items: [] as any[] }
    },
    enabled,
  })
}

export function useWorkspaceCommandPalette(query = "", enabled = true) {
  return useQuery({
    queryKey: ["workspace-command-palette", query],
    queryFn: async () => {
      const { data } = await api.get("/api/workspace/command-palette", { params: { q: query } })
      return data
    },
    enabled,
  })
}

export function useNotificationUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ["workspace-notifications-unread"],
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/auth/notifications/unread-count")
        return data
      } catch {
        return { unread: 0, count: 0 }
      }
    },
    enabled,
  })
}
