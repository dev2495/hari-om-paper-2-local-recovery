/** Doc Vault API (6 Nov 2026). Uploads go through lib/doc-upload.ts (outbox); everything else is here. */
import { api, downloadUrl } from "@/lib/api"
import type { DocEntityType, DocKind } from "@/lib/doc-upload"

export type DocLink = { entity_type: DocEntityType; entity_id: string; label: string | null; href: string | null; linked_by: string; linked_at: string | null }
export type DocPage = { page_no: number; mime: string; bytes: number; width: number | null; height: number | null; pdf_pages: number | null; file_url: string; thumb_url: string | null; uploaded_by: string; uploaded_at: string | null }
export type DocEvent = { action: "UPLOAD" | "ADD_PAGE" | "LINK" | "UNLINK" | "EDIT" | "VOID" | string; actor: string; at: string | null; detail: Record<string, any> }

export type VaultDocument = {
  id: string
  plant_id: string
  doc_no: string
  kind: DocKind
  kind_label: string
  category: string | null
  party_type: string | null
  party_id: string | null
  party_name: string | null
  ref_no: string | null
  ref_date: string | null
  amount: number | null
  note: string | null
  pages: number
  mime: string
  bytes: number
  source: "GATE" | "STORE" | "QC" | "DISPATCH" | "SYSTEM"
  uploaded_by: string
  uploaded_at: string | null
  status: "ACTIVE" | "VOID"
  void_reason: string | null
  void_reason_code: string | null
  voided_by: string | null
  voided_at: string | null
  version: number
  file_url: string
  thumb_url: string | null
  links: DocLink[]
  can?: { void: boolean; unlink: boolean; edit: boolean; add_page: boolean }
  page_list?: DocPage[]
  history?: DocEvent[]
}

export type VaultTab = "ALL" | "VENDOR" | "EXPENSE" | "OUTWARD" | "UNLINKED"

export type VaultFilters = {
  q?: string
  tab?: VaultTab
  kind?: string
  category?: string
  party?: string
  date_from?: string
  date_to?: string
  linked?: boolean
  uploaded_by?: string
  source?: string
  status?: "ACTIVE" | "VOID" | "ALL"
  limit?: number
  offset?: number
}

export type VaultList = { items: VaultDocument[]; total: number; counts: Record<VaultTab, number>; limit: number; offset: number; can_upload: DocKind[] | null }

function clean(params: Record<string, any>) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""))
}

/** File and thumbnail links for <img>/<iframe>: they cannot send the plant header, so the plant goes in the query. */
export const fileUrl = (path: string, download = false) => downloadUrl(download ? `${path}&download=true` : path)

export const documentsApi = {
  list: (filters: VaultFilters) => api.get<VaultList>("/api/documents", { params: clean(filters) }),
  forEntity: (entityType: DocEntityType, entityId: string, includeVoid = false) =>
    api.get<{ items: VaultDocument[]; can_upload: DocKind[] | null }>(`/api/documents/for/${entityType}/${encodeURIComponent(entityId)}`, { params: includeVoid ? { include_void: true } : {} }),
  get: (id: string) => api.get<VaultDocument>(`/api/documents/${id}`),
  link: (id: string, entityType: DocEntityType, entityId: string) =>
    api.post<{ created: boolean; document: VaultDocument }>(`/api/documents/${id}/links`, { entity_type: entityType, entity_id: entityId }),
  unlink: (id: string, entityType: DocEntityType, entityId: string) =>
    api.delete<{ removed: boolean; document: VaultDocument }>(`/api/documents/${id}/links/${entityType}/${encodeURIComponent(entityId)}`),
  update: (id: string, data: Partial<Pick<VaultDocument, "kind" | "category" | "party_type" | "party_id" | "party_name" | "ref_no" | "ref_date" | "amount" | "note">> & { expected_version: number }) =>
    api.patch<VaultDocument>(`/api/documents/${id}`, data),
  void: (id: string, data: { expected_version?: number; reason_code: string; reason_note?: string | null }) =>
    api.post<VaultDocument>(`/api/documents/${id}/void`, data),
}
