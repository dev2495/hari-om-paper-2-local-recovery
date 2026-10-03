import { api } from "./api"

export type Season = "ROY" | "MONSOON"
export const seasonLabel = (season: string) => season === "MONSOON" ? "Monsoon" : "Rest of year"
export const seasonTimestamp = (value: string) => new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`).toLocaleString("en-IN")
export const qcRangeLabel = (rule: any): string => {
  if (!rule.applicable) return "Not applicable"
  if (rule.mode === "RECORD_ONLY") return "Required observation"
  const term = (value: any) => `${value.ref === "SAMPLE.pre_weight" ? "Same sample pre-weight" : value.ref} × ${value.factor}${value.offset ? ` ${Number(value.offset) < 0 ? "−" : "+"} ${Math.abs(Number(value.offset))}` : ""}`
  const bound = (values: any[], kind: string) => values.length > 1 ? `${kind}(${values.map(term).join(", ")})` : values.map(term).join("")
  const min = rule.dynamic ? bound(rule.lower || [], "max") || null : rule.min
  const max = rule.dynamic ? bound(rule.upper || [], "min") || null : rule.max
  return `${min != null && max != null ? `${min} to ${max}` : min != null ? `≥ ${min}` : max != null ? `≤ ${max}` : "No bound configured"}${rule.unit ? ` ${rule.unit}` : ""}`
}
export const command = (extra: Record<string, unknown> = {}) => ({ request_id: crypto.randomUUID(), ...extra })
export const errorText = (error: any): string => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.blockers) return detail.blockers.map((v: any) => typeof v === "string" ? v : JSON.stringify(v)).join(" · ")
  if (detail?.missing) return detail.missing.map((v: any) => `${v.label || v.parameter}: ${v.have}/${v.need}`).join(" · ")
  return detail?.message || error?.message || "Could not complete this action"
}
function makeSeasonApi(client: Pick<typeof api,"get"|"post"|"put">) { return {
  papers: () => client.get("/api/master/papers"),
  state: () => client.get("/api/spec/season"),
  bootstrap: (body: any) => client.post("/api/spec/season/bootstrap", body),
  history: () => client.get("/api/spec/season/history"),
  previewSwitch: (to: Season) => client.post("/api/spec/season/switch/preview", { to }),
  switch: (body: any) => client.post("/api/spec/season/switch", body),
  rules: (season: Season) => client.get("/api/spec/qc-rules", { params: { season } }),
  saveRules: (season: Season, body: any) => client.put("/api/spec/qc-rules/draft", body, { params: { season } }),
  impact: (season: Season) => client.post("/api/spec/qc-rules/draft/impact", {}, { params: { season } }),
  publishRules: (season: Season, body: any) => client.post("/api/spec/qc-rules/draft/publish", body, { params: { season } }),
  overlays: () => client.get("/api/spec/qc-overlays"),
  saveOverlay: (body: any) => client.put("/api/spec/qc-overlays/draft", body),
  publishOverlay: (id: string, body: any) => client.post(`/api/spec/qc-overlays/${id}/publish`, body),
  document: (id: string) => client.get(`/api/spec/specifications/${id}/season-document`),
  saveDocument: (id: string | undefined, body: any) => id ? client.put(`/api/spec/specifications/${id}/document`, body) : client.post("/api/spec/specifications/document", body),
  confirm: (id: string, season: Season, body: any) => client.post(`/api/spec/specifications/${id}/recipes/${season}/confirm`, body),
  review: (id: string, body: any) => client.post(`/api/spec/specifications/${id}/season-review`, body),
  approve: (id: string, body: any) => client.post(`/api/spec/specifications/${id}/season-approve`, body),
  resolved: (id: string, season: Season) => client.get(`/api/spec/specifications/${id}/qc-resolved`, { params: { season } }),
  recipeHistory: (id: string, season: Season) => client.get(`/api/spec/specifications/${id}/recipes/${season}/history`),
  revision: (id: string, season: Season, body: any) => client.put(`/api/spec/specifications/${id}/recipes/${season}/revision`, body),
  approveRevision: (id: string, season: Season, body: any) => client.post(`/api/spec/specifications/${id}/recipes/${season}/approve`, body),
  summary: (params: any) => client.get("/api/spec/specifications/summary", { params }),
} }
export const seasonApi=makeSeasonApi(api)
export const seasonApiForPlant=(plantId:string)=>makeSeasonApi({
  get:(url:string,config:any={})=>api.get(url,{...config,headers:{...config.headers,"X-Plant-ID":plantId}}),
  post:(url:string,body:any,config:any={})=>api.post(url,body,{...config,headers:{...config.headers,"X-Plant-ID":plantId}}),
  put:(url:string,body:any,config:any={})=>api.put(url,body,{...config,headers:{...config.headers,"X-Plant-ID":plantId}}),
})

function makeEntryApi(client: Pick<typeof api, "get" | "post" | "patch">) { return {
  employees: () => client.get("/api/master/employees"),
  items: () => client.get("/api/inventory/items"),
  locations: () => client.get("/api/inventory/locations"),
  reelIssues: (machineId:string) => client.get("/api/inventory/reel-issues",{params:{machine_id:machineId,status:"CLOSED",limit:500}}),
  finalSamples: (id:string,offset=0) => client.get("/api/production/quality/inspections",{params:{job_card_id:id,offset,limit:100}}),
  batch: (id:string,body:any) => client.post(`/api/production/job-cards/${id}/entries/batch`,body),
  effects: (id:string) => client.get(`/api/production/job-cards/${id}/effects`),
  retryEffect: (id:string,effect:string,body:any) => client.post(`/api/production/job-cards/${id}/effects/${effect}/retry`,body),
  resolveResidual: (id:string,residual:string,body:any) => client.post(`/api/production/job-cards/${id}/residual-wip/${residual}/resolve`,body),
  finalTemplate: (id:string) => client.get(`/api/production/quality/job-cards/${id}/template`, {params:{stage_type:"QC"}}),
  finalInspections: (body:any) => client.post("/api/production/quality/inspections/import",body),
  flow: (id: string) => client.get(`/api/production/job-cards/${id}/flow`),
  list: (id: string, stage?: string, offset=0, limit=50) => client.get(`/api/production/job-cards/${id}/entries`, { params: { stage, offset, limit } }),
  edit: (id:string, entry:string, body:any) => client.patch(`/api/production/job-cards/${id}/entries/${entry}`, body),
  history: (id:string, entry:string) => client.get(`/api/production/job-cards/${id}/entries/${entry}/history`),
  create: (id: string, body: any) => client.post(`/api/production/job-cards/${id}/entries`, body),
  submit: (id: string, entry: string, body: any) => client.post(`/api/production/job-cards/${id}/entries/${entry}/submit`, body),
  void: (id: string, entry: string, body: any) => client.post(`/api/production/job-cards/${id}/entries/${entry}/void`, body),
  observations: (id: string, entry: string, body: any) => client.post(`/api/production/job-cards/${id}/entries/${entry}/observations`, body),
  close: (id: string, stage: string, body: any) => client.post(`/api/production/job-cards/${id}/stages/${stage}/close`, body),
  reopen: (id: string, stage: string, body: any) => client.post(`/api/production/job-cards/${id}/stages/${stage}/reopen`, body),
} }
export const entryApi=makeEntryApi(api)
export const entryApiForPlant=(plantId:string)=>makeEntryApi({
  get:(url:string,config:any={})=>api.get(url,{...config,headers:{...config.headers,"X-Plant-ID":plantId}}),
  post:(url:string,body:any,config:any={})=>api.post(url,body,{...config,headers:{...config.headers,"X-Plant-ID":plantId}}),
  patch:(url:string,body:any,config:any={})=>api.patch(url,body,{...config,headers:{...config.headers,"X-Plant-ID":plantId}}),
})
