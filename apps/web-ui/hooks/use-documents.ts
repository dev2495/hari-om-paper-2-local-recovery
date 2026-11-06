"use client"

/** Doc Vault hooks (6 Nov 2026): lists, one document, the outbox, and the write actions. */
import { useEffect, useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/context/AuthContext"
import { documentsApi, type VaultDocument, type VaultFilters } from "@/lib/api-documents"
import { onDocumentSaved, startOutbox, subscribeOutbox, type DocEntityType, type OutboxState } from "@/lib/doc-upload"

export const DOCUMENTS_KEY = ["documents"] as const

export function useVaultDocuments(filters: VaultFilters, enabled = true) {
  const { activePlant } = useAuth()
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, "list", activePlant, filters],
    queryFn: () => documentsApi.list(filters).then((response) => response.data),
    enabled: enabled && Boolean(activePlant),
    placeholderData: keepPreviousData,
  })
}

export function useEntityDocuments(entityType: DocEntityType, entityId: string | null | undefined, includeVoid = false) {
  const { activePlant } = useAuth()
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, "for", activePlant, entityType, entityId, includeVoid],
    queryFn: () => documentsApi.forEntity(entityType, String(entityId), includeVoid).then((response) => response.data),
    enabled: Boolean(activePlant && entityId),
  })
}

export function useVaultDocument(id: string | null | undefined) {
  const { activePlant } = useAuth()
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, "one", activePlant, id],
    queryFn: () => documentsApi.get(String(id)).then((response) => response.data),
    enabled: Boolean(activePlant && id),
  })
}

/** The outbox (photos waiting to be sent). Starts background sending and refreshes lists as files land. */
export function useDocumentOutbox(): OutboxState {
  const client = useQueryClient()
  const [state, setState] = useState<OutboxState>({ items: [], pending: 0, uploading: 0, failed: 0 })
  useEffect(() => {
    startOutbox()
    const stop = subscribeOutbox(setState)
    const stopSaved = onDocumentSaved(() => { void client.invalidateQueries({ queryKey: DOCUMENTS_KEY }) })
    return () => { stop(); stopSaved() }
  }, [client])
  return state
}

export function useDocumentActions() {
  const client = useQueryClient()
  const refresh = (document?: VaultDocument) => {
    if (document) client.setQueriesData({ queryKey: [...DOCUMENTS_KEY, "one"] }, (old: any) => (old?.id === document.id ? { ...old, ...document } : old))
    return client.invalidateQueries({ queryKey: DOCUMENTS_KEY })
  }
  const link = useMutation({
    mutationFn: ({ id, entityType, entityId }: { id: string; entityType: DocEntityType; entityId: string }) => documentsApi.link(id, entityType, entityId).then((r) => r.data),
    onSuccess: (data) => refresh(data.document),
  })
  const unlink = useMutation({
    mutationFn: ({ id, entityType, entityId }: { id: string; entityType: DocEntityType; entityId: string }) => documentsApi.unlink(id, entityType, entityId).then((r) => r.data),
    onSuccess: (data) => refresh(data.document),
  })
  const update = useMutation({
    mutationFn: ({ id, ...data }: Parameters<typeof documentsApi.update>[1] & { id: string }) => documentsApi.update(id, data).then((r) => r.data),
    onSuccess: (data) => refresh(data),
  })
  const voidDocument = useMutation({
    mutationFn: ({ id, ...data }: Parameters<typeof documentsApi.void>[1] & { id: string }) => documentsApi.void(id, data).then((r) => r.data),
    onSuccess: (data) => refresh(data),
  })
  return { link, unlink, update, voidDocument }
}
