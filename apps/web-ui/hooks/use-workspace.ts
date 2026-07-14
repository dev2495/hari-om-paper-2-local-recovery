import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

export function useNotifications(
  enabledOrParams: boolean | { enabled?: boolean; limit?: number; offset?: number; role?: string; event_type?: string; search?: string; unread_only?: boolean } = true,
) {
  const params = typeof enabledOrParams === "boolean" ? { enabled: enabledOrParams } : enabledOrParams
  const { enabled = true, limit = 30, offset = 0, role, event_type, search, unread_only } = params
  return useQuery({
    queryKey: ["workspace-notifications", { limit, offset, role, event_type, search, unread_only }],
    queryFn: async () => {
      try {
        const { data } = await api.get("/api/auth/notifications", {
          params: { limit, offset, role, event_type, search, unread_only },
        })
        if (Array.isArray(data)) return { items: data, total_count: data.length, has_more: false, limit, offset }
        if (data && Array.isArray(data.items)) return data
      } catch {
        // The notification proxy route can be absent in some recovered snapshots.
      }
      return { items: [] as any[], total_count: 0, has_more: false, limit, offset }
    },
    enabled,
  })
}

export function useAuditEvents(params?: {
  since_hours?: number
  event_type?: string
  entity_type?: string
  entity_id?: string
  actor_email?: string
  plant_id?: string
  limit?: number
  offset?: number
  enabled?: boolean
}) {
  const { enabled = true, ...rest } = params || {}
  return useQuery({
    queryKey: ["audit-events", rest],
    queryFn: async () => {
      const { data } = await api.get("/api/auth/audit-events", { params: rest })
      return data
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

export function useSystemHealth(enabled = true) {
  return useQuery({
    queryKey: ["workspace-system-health"],
    queryFn: async () => {
      const { data } = await api.get("/api/workspace/system-health")
      return data
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
