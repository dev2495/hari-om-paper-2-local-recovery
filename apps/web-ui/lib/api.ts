import axios from "axios"

const isBrowser = typeof window !== "undefined"
const browserBaseUrl = "/"
const serverBaseUrl =
  process.env.BFF_INTERNAL_URL || process.env.NEXT_PUBLIC_BFF_URL || "http://127.0.0.1:14000"
const TOKEN_STORAGE_KEY = "hariom_access_token"
const PLANT_STORAGE_KEY = "hariom_active_plant"

function getStoredToken() {
  if (!isBrowser) return null
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null) {
  if (!isBrowser) return
  try {
    if (!token) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // Ignore storage errors
  }
}

export function getStoredPlant() {
  if (!isBrowser) return null
  return window.localStorage.getItem(PLANT_STORAGE_KEY)
}

export function setStoredPlant(plantId: string | null) {
  if (!isBrowser) return
  if (!plantId) {
    window.localStorage.removeItem(PLANT_STORAGE_KEY)
  } else {
    window.localStorage.setItem(PLANT_STORAGE_KEY, plantId)
  }
}

function withPlantHeader(plantId?: string) {
  if (!plantId) return undefined
  return {
    headers: {
      "X-Plant-ID": plantId,
    },
  }
}

export const api = axios.create({
  baseURL: isBrowser ? browserBaseUrl : serverBaseUrl,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
})

api.interceptors.request.use((config) => {
  const headers = (config.headers || {}) as any
  const token = getStoredToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const plantId = getStoredPlant()
  if (plantId && !headers["X-Plant-ID"]) {
    headers["X-Plant-ID"] = plantId
  }

  config.headers = headers
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const requestUrl = String(error?.config?.url || "")
    const isAuthRoute = requestUrl.includes("/api/auth/login") || requestUrl.includes("/api/auth/me")

    if (status === 401 && !isAuthRoute) {
      setStoredToken(null)
      if (isBrowser && window.location.pathname !== "/login") {
        window.location.assign("/login")
      }
    }

    return Promise.reject(error)
  },
)

export const authApi = {
  login: async (email: string, password: string) => {
    const response = await api.post("/api/auth/login", { email, password })
    setStoredToken(response?.data?.access_token || null)
    return response
  },
  logout: async () => {
    const response = await api.post("/api/auth/logout")
    setStoredToken(null)
    return response
  },
  me: () => api.get("/api/auth/me"),
  users: () => api.get("/api/auth/users"),
  createUser: (data: any) => api.post("/api/auth/users", data),
  updateUser: (id: string, data: any) => api.put(`/api/auth/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/api/auth/users/${id}`),
  getRoles: () => api.get("/api/auth/roles"),
  getNotifications: (params?: any) => api.get("/api/auth/notifications", { params }),
  getNotificationUnreadCount: () => api.get("/api/auth/notifications/unread-count"),
  markAllNotificationsRead: () => api.post("/api/auth/notifications/mark-all-read"),
  markNotificationRead: (id: string) => api.post(`/api/auth/notifications/${id}/read`),
  getPlants: () => api.get("/api/auth/plants"),
  createPlant: (data: any) => api.post("/api/auth/plants", data),
  updatePlant: (id: string, data: any) => api.patch(`/api/auth/plants/${id}`, data),
  deletePlant: (id: string) => api.delete(`/api/auth/plants/${id}`),
}

export const dashboardApi = {
  getOverview: () => api.get("/api/analytics/dashboard/overview"),
}

function analyticsParams(
  startOrParams?: string | Record<string, any>,
  endDate?: string,
  plant?: string,
) {
  if (typeof startOrParams === "object" && startOrParams !== null) {
    return startOrParams
  }
  if (typeof startOrParams === "string" || typeof endDate === "string" || typeof plant === "string") {
    return {
      ...(startOrParams ? { start_date: startOrParams } : {}),
      ...(endDate ? { end_date: endDate } : {}),
      ...(plant ? { plant } : {}),
    }
  }
  return undefined
}

export const analyticsApi = {
  getDashboardOverview: (params?: any) =>
    api.get("/api/analytics/dashboard/overview", { params: analyticsParams(params) }),
  getDashboardOwner: (params?: any) =>
    api.get("/api/analytics/dashboard/owner", { params: analyticsParams(params) }),
  getOwnerPack: (params?: any) =>
    api.get("/api/analytics/reports/owner-pack", { params: analyticsParams(params) }),
  getProductionReport: (params?: any) =>
    api.get("/api/analytics/reports/production", { params: analyticsParams(params) }),
  getSalesReport: (params?: any) =>
    api.get("/api/analytics/reports/sales", { params: analyticsParams(params) }),
  getQualityReport: (params?: any) =>
    api.get("/api/analytics/reports/quality", { params: analyticsParams(params) }),
  getDispatchReport: (params?: any) =>
    api.get("/api/analytics/reports/dispatch", { params: analyticsParams(params) }),
  getInventoryHealthReport: (params?: any) =>
    api.get("/api/analytics/reports/inventory-health", { params: analyticsParams(params) }),
  getPlantCompareReport: (params?: any) =>
    api.get("/api/analytics/reports/plant-compare", { params: analyticsParams(params) }),
  getExceptionReport: (params?: any) =>
    api.get("/api/analytics/reports/exceptions", { params: analyticsParams(params) }),
  getProductionTrends: (startOrParams?: any, endDate?: string, plant?: string) =>
    api.get("/api/analytics/production/trends", { params: analyticsParams(startOrParams, endDate, plant) }),
  getShrinkAnalysis: (startOrParams?: any, endDate?: string, plant?: string) =>
    api.get("/api/analytics/production/shrink", { params: analyticsParams(startOrParams, endDate, plant) }),
  getScrapAnalysis: (startOrParams?: any, endDate?: string, plant?: string) =>
    api.get("/api/analytics/production/scrap", { params: analyticsParams(startOrParams, endDate, plant) }),
  getInventoryValuation: (params?: any) =>
    api.get("/api/analytics/inventory/valuation", { params: analyticsParams(params) }),
  getSalesTrends: (startOrParams?: any, endDate?: string, plant?: string) =>
    api.get("/api/analytics/dispatch/sales-trends", { params: analyticsParams(startOrParams, endDate, plant) }),
  getSupplierLoss: (startOrParams?: any, endDate?: string, plant?: string) =>
    api.get("/api/analytics/loss/supplier-loss", { params: analyticsParams(startOrParams, endDate, plant) }),
  getWinderEfficiency: (startOrParams?: any, endDate?: string, plant?: string) =>
    api.get("/api/analytics/production/winder", { params: analyticsParams(startOrParams, endDate, plant) }),
}

export const masterApi = {
  getPapers: () => api.get("/api/master/papers"),
  createPaper: (data: any) => api.post("/api/master/papers", data),
  updatePaper: (id: string, data: any) => api.put(`/api/master/papers/${id}`, data),
  deletePaper: (id: string) => api.delete(`/api/master/papers/${id}`),

  getAdhesives: () => api.get("/api/master/adhesives"),
  createAdhesive: (data: any) => api.post("/api/master/adhesives", data),
  updateAdhesive: (id: string, data: any) => api.put(`/api/master/adhesives/${id}`, data),
  deleteAdhesive: (id: string) => api.delete(`/api/master/adhesives/${id}`),

  getParchments: () => api.get("/api/master/parchments"),
  createParchment: (data: any) => api.post("/api/master/parchments", data),
  updateParchment: (id: string, data: any) => api.put(`/api/master/parchments/${id}`, data),
  deleteParchment: (id: string) => api.delete(`/api/master/parchments/${id}`),
  getParchmentVendors: () => api.get("/api/master/parchment/vendors"),
  createParchmentVendor: (data: any) => api.post("/api/master/parchment/vendors", data),
  updateParchmentVendor: (id: string, data: any) => api.put(`/api/master/parchment/vendors/${id}`, data),
  deleteParchmentVendor: (id: string) => api.delete(`/api/master/parchment/vendors/${id}`),

  getTubeSizes: () => api.get("/api/master/tube-sizes"),
  createTubeSize: (data: any) => api.post("/api/master/tube-sizes", data),
  updateTubeSize: (id: string, data: any) => api.put(`/api/master/tube-sizes/${id}`, data),
  deleteTubeSize: (id: string) => api.delete(`/api/master/tube-sizes/${id}`),

  getMandrels: () => api.get("/api/master/mandrels"),
  createMandrel: (data: any) => api.post("/api/master/mandrels", data),
  updateMandrel: (id: string, data: any) => api.put(`/api/master/mandrels/${id}`, data),
  deleteMandrel: (id: string) => api.delete(`/api/master/mandrels/${id}`),

  getMachines: () => api.get("/api/production/machines"),
  createMachine: (data: any) => api.post("/api/production/machines", data),
  updateMachine: (id: string, data: any) => api.put(`/api/production/machines/${id}`, data),
  deleteMachine: (id: string) => api.delete(`/api/production/machines/${id}`),

  getCustomers: () => api.get("/api/master/customers"),
  createCustomer: (data: any) => api.post("/api/master/customers", data),
  updateCustomer: (id: string, data: any) => api.put(`/api/master/customers/${id}`, data),
  deleteCustomer: (id: string) => api.delete(`/api/master/customers/${id}`),
  getCustomerContacts: (customerId: string) => api.get(`/api/master/customers/${customerId}/contacts`),
  createCustomerContact: (customerId: string, data: any) => api.post(`/api/master/customers/${customerId}/contacts`, data),
  updateCustomerContact: (customerId: string, contactId: string, data: any) =>
    api.put(`/api/master/customers/${customerId}/contacts/${contactId}`, data),
  deleteCustomerContact: (customerId: string, contactId: string) =>
    api.delete(`/api/master/customers/${customerId}/contacts/${contactId}`),
  getContactDirectory: () => api.get("/api/master/contact-directory"),

  getSuppliers: () => api.get("/api/master/suppliers"),
  createSupplier: (data: any) => api.post("/api/master/suppliers", data),
  updateSupplier: (id: string, data: any) => api.put(`/api/master/suppliers/${id}`, data),
  deleteSupplier: (id: string) => api.delete(`/api/master/suppliers/${id}`),
  getVendors: () => api.get("/api/master/vendors"),
  createVendor: (data: any) => api.post("/api/master/vendors", data),
  updateVendor: (id: string, data: any) => api.put(`/api/master/vendors/${id}`, data),
  deleteVendor: (id: string) => api.delete(`/api/master/vendors/${id}`),
  getVendorContacts: (vendorId: string) => api.get(`/api/master/vendors/${vendorId}/contacts`),
  createVendorContact: (vendorId: string, data: any) => api.post(`/api/master/vendors/${vendorId}/contacts`, data),
  updateVendorContact: (vendorId: string, contactId: string, data: any) =>
    api.put(`/api/master/vendors/${vendorId}/contacts/${contactId}`, data),
  deleteVendorContact: (vendorId: string, contactId: string) =>
    api.delete(`/api/master/vendors/${vendorId}/contacts/${contactId}`),

  getPackagingBoxes: () => api.get("/api/master/packaging/boxes"),
  createPackagingBox: (data: any) => api.post("/api/master/packaging/boxes", data),
  updatePackagingBox: (id: string, data: any) => api.put(`/api/master/packaging/boxes/${id}`, data),
  deletePackagingBox: (id: string) => api.delete(`/api/master/packaging/boxes/${id}`),

  getPackagingPlasticSheets: () => api.get("/api/master/packaging/plastic-sheets"),
  createPackagingPlasticSheet: (data: any) => api.post("/api/master/packaging/plastic-sheets", data),
  updatePackagingPlasticSheet: (id: string, data: any) => api.put(`/api/master/packaging/plastic-sheets/${id}`, data),
  deletePackagingPlasticSheet: (id: string) => api.delete(`/api/master/packaging/plastic-sheets/${id}`),

  getPackagingFadda: () => api.get("/api/master/packaging/fadda"),
  createPackagingFadda: (data: any) => api.post("/api/master/packaging/fadda", data),
  updatePackagingFadda: (id: string, data: any) => api.put(`/api/master/packaging/fadda/${id}`, data),
  deletePackagingFadda: (id: string) => api.delete(`/api/master/packaging/fadda/${id}`),

  getTools: (params?: any) => api.get("/api/master/tools", { params }),
  createTool: (data: any) => api.post("/api/master/tools", data),
  updateTool: (id: string, data: any) => api.put(`/api/master/tools/${id}`, data),
  deleteTool: (id: string) => api.delete(`/api/master/tools/${id}`),
}

export const specApi = {
  getSpecs: (params?: any, plantId?: string) =>
    api.get("/api/spec/specifications", { ...(withPlantHeader(plantId) || {}), params }),
  createSpec: (data: any, plantId?: string) => api.post("/api/spec/specifications", data, withPlantHeader(plantId)),
  getSpec: (id: string) => api.get(`/api/spec/specifications/${id}`),
  updateSpec: (id: string, data: any, plantId?: string) =>
    api.put(`/api/spec/specifications/${id}`, data, withPlantHeader(plantId)),
  approveSpec: (id: string, data: any, plantId?: string) =>
    api.post(`/api/spec/specifications/${id}/approve`, data, withPlantHeader(plantId)),
  obsoleteSpec: (id: string, data?: any, plantId?: string) =>
    api.post(`/api/spec/specifications/${id}/obsolete`, data ?? {}, withPlantHeader(plantId)),
  getConstants: () => api.get("/api/spec/constants"),
  getSpecFields: () => api.get("/api/spec/spec-fields"),
  createSpecField: (data: any, plantId?: string) => api.post("/api/spec/spec-fields", data, withPlantHeader(plantId)),
  createRecipe: (specId: string, data: any, plantId?: string) =>
    api.post(`/api/spec/recipes/${specId}`, data, withPlantHeader(plantId)),
  getRecipesForSpec: (specId: string) => api.get(`/api/spec/recipes/spec/${specId}`),
  getRecipe: (recipeId: string) => api.get(`/api/spec/recipes/${recipeId}`),
  addRecipeLayer: (recipeId: string, data: any, plantId?: string) =>
    api.post(`/api/spec/recipes/${recipeId}/layers`, data, withPlantHeader(plantId)),
  createTrial: (recipeId: string, data: any, plantId?: string) =>
    api.post(`/api/spec/trials/${recipeId}`, data, withPlantHeader(plantId)),
  getTrials: (recipeId: string) => api.get(`/api/spec/trials/${recipeId}`),
  calculateYield: (specId: string, tubeLengthMm: number) =>
    api.get(`/api/spec/calculate/yield/${specId}`, { params: { tube_length_mm: tubeLengthMm } }),
  calculateWeight: (recipeId: string) => api.get(`/api/spec/calculate/weight/${recipeId}`),
  calculateBom: (recipeId: string, tubeLengthMm: number, tubeOdMm: number) =>
    api.get(`/api/spec/calculate/bom/${recipeId}`, { params: { tube_length_mm: tubeLengthMm, tube_od_mm: tubeOdMm } }),
  calculatePreview: (data: any, plantId?: string) =>
    api.post("/api/spec/calculate/preview", data, withPlantHeader(plantId)),
  calculateSuggestions: (data: any, plantId?: string) =>
    api.post("/api/spec/calculate/suggestions", data, withPlantHeader(plantId)),
}

export const salesApi = {
  getOrders: (params?: any) => api.get("/api/sales/orders", { params }),
  createOrder: (data: any) => api.post("/api/sales/orders", data),
  getOrder: (id: string) => api.get(`/api/sales/orders/${id}`),
  getOrderTimeline: (id: string) => api.get(`/api/sales/orders/${id}/timeline`),
  updateOrder: (id: string, data: any) => api.put(`/api/sales/orders/${id}`, data),
  approveOrder: (id: string, plantId?: string) => api.post(`/api/sales/orders/${id}/approve`, {}, withPlantHeader(plantId)),
  releaseOrder: (id: string, plantId?: string) => api.post(`/api/sales/orders/${id}/release`, {}, withPlantHeader(plantId)),
  releaseOrderLine: (lineId: string, data: any, plantId?: string) => api.post(`/api/sales/orders/lines/${lineId}/release`, data, withPlantHeader(plantId)),
}

export const productionApi = {
  getJobs: () => api.get("/api/production/jobs"),
  createJob: (data: any) => api.post("/api/production/jobs", data),
  getJobPrintCard: (id: string) => api.get(`/api/production/jobs/${id}/print-card`),
  getJobLoss: (id: string) => api.get(`/api/production/jobs/${id}/loss`),
  getJobSummary: (id: string) => api.get(`/api/production/jobs/${id}/summary`),
  updateJob: (id: string, data: any) => api.put(`/api/production/jobs/${id}`, data),
  validateJob: (id: string, data: any) => api.post(`/api/production/jobs/${id}/validate`, data),
  closeJob: (id: string, data: any) => api.post(`/api/production/jobs/${id}/close`, data),
  addReel: (jobId: string, data: any) => api.post(`/api/production/jobs/${jobId}/reels`, data),
  getReels: (jobId: string) => api.get(`/api/production/jobs/${jobId}/reels`),
  getMachines: () => api.get("/api/production/machines"),
  createPlanningSalesOrder: (data: any) => api.post("/api/production/sales-orders", data),
  releaseSyncSalesOrder: (salesOrderId: string, data: any, plantId?: string) =>
    api.post(`/api/production/sales-orders/${salesOrderId}/release-sync`, data, withPlantHeader(plantId)),
  createPlanningJobCard: (data: any) => api.post("/api/production/job-cards", data),
  getPlanningJobCards: (params?: any) => api.get("/api/production/job-cards", { params }),
  getPlanningJobCard: (id: string) => api.get(`/api/production/job-cards/${id}`),
  getJobCardGenealogy: (id: string) => api.get(`/api/production/genealogy/job-cards/${id}`),
  getPlanningQueue: (params: {
    stage: string
    plan_date?: string
    include_unscheduled?: boolean
    plant_id?: string
  }) => api.get("/api/production/planning/queues", { params }),
  getPlanningBoard: (params: {
    stage?: string
    plan_date?: string
    include_unscheduled?: boolean
    plant_id?: string
  }) => api.get("/api/production/planning/board", { params }),
  movePlanningBoard: (data: any) => api.post("/api/production/planning/board/move", data),
  splitPlanningSegment: (data: any) => api.post("/api/production/planning/board/split", data),
  reorderPlanningQueue: (data: any) => api.patch("/api/production/planning/queues/reorder", data),
  assignMachine: (jobCardId: string, data: any) => api.post(`/api/production/job-cards/${jobCardId}/assign-machine`, data),
  postStageOutput: (jobCardId: string, data: any) => api.post(`/api/production/job-cards/${jobCardId}/stage-output`, data),
  getQualityInspections: (params?: any) => api.get("/api/production/quality/inspections", { params }),
  createQualityInspection: (data: any, plantId?: string) =>
    api.post("/api/production/quality/inspections", data, withPlantHeader(plantId)),
  getQualityHolds: (params?: any) => api.get("/api/production/quality/holds", { params }),
  createQualityHold: (data: any, plantId?: string) =>
    api.post("/api/production/quality/holds", data, withPlantHeader(plantId)),
  releaseQualityHold: (holdId: string, plantId?: string) =>
    api.post(`/api/production/quality/holds/${holdId}/release`, {}, withPlantHeader(plantId)),

  getJobCards: (params?: any) => api.get("/api/production/jobs", { params }),
  createJobCard: (data: any) => api.post("/api/production/job-cards", data),
  updateJobCard: (id: string, data: any) => api.put(`/api/production/jobs/${id}`, data),
  validateJobCard: (id: string, data: any) => api.post(`/api/production/jobs/${id}/validate`, data),
  closeJobCard: (id: string, data: any) => api.post(`/api/production/jobs/${id}/close`, data),
  addReelIssue: (jobId: string, data: any) => api.post(`/api/production/jobs/${jobId}/reels`, data),
  getShiftMaterialLedger: (params?: any) => api.get("/api/production/shift-material-ledger", { params }),
  getShiftMaterialRetally: (params?: any) => api.get("/api/production/shift-material-retally", { params }),
  getPlantRetallySummary: (params?: any) => api.get("/api/production/plant-retally-summary", { params }),
  getMonthlyMaterialSummary: (params?: any) => api.get("/api/production/monthly-material-summary", { params }),
  getMonthlyCloseState: (params?: any) => api.get("/api/production/monthly-close-state", { params }),
  getMonthlyCloseHistory: (params?: any) => api.get("/api/production/monthly-close-history", { params }),
  createShiftMaterialLedger: (data: any) => api.post("/api/production/shift-material-ledger", data),
  importMonthlyActuals: (payload: any, plantId?: string) =>
    api.post("/api/production/import-monthly-actuals", payload, withPlantHeader(plantId)),
  approveMonthlyClose: (payload: any, plantId?: string) =>
    api.post("/api/production/approve-monthly-close", payload, withPlantHeader(plantId)),
}

export const inventoryApi = {
  getItems: () => api.get("/api/inventory/items"),
  createItem: (data: any) => api.post("/api/inventory/items", data),
  updateItem: (id: string, data: any) => api.put(`/api/inventory/items/${id}`, data),
  getBalances: () => api.get("/api/inventory/balance"),
  getItemBalance: (itemId: string) => api.get(`/api/inventory/balance/${itemId}`),
  getTransactions: (params?: any) => api.get("/api/inventory/ledger", { params }),
  getStockStatement: (params?: any) => api.get("/api/inventory/stock-control/statement", { params }),
  getOpeningLoads: () => api.get("/api/inventory/stock-control/opening-loads"),
  createOpeningLoad: (data: any) => api.post("/api/inventory/stock-control/opening-loads", data),
  getStockCertifications: () => api.get("/api/inventory/stock-control/certifications"),
  createStockCertification: (data: any) => api.post("/api/inventory/stock-control/certifications", data),
  getStockCertification: (id: string) => api.get(`/api/inventory/stock-control/certifications/${id}`),
  updateStockCertification: (id: string, data: any) => api.patch(`/api/inventory/stock-control/certifications/${id}`, data),
  certifyStockCertification: (id: string, data?: any) => api.post(`/api/inventory/stock-control/certifications/${id}/certify`, data || {}),
  getCarryForwards: () => api.get("/api/inventory/stock-control/carry-forwards"),
  createCarryForward: (id: string, data?: any) => api.post(`/api/inventory/stock-control/certifications/${id}/carry-forward`, data || {}),
  getLocations: () => api.get("/api/inventory/locations"),
  createLocation: (data: any) => api.post("/api/inventory/locations", data),
  getInventoryHealthSummary: () => api.get("/api/inventory/health/summary"),
  notifyMrpShortage: (data: any) => api.post("/api/inventory/mrp/notify-shortage", data),
  getInventoryStatusSummary: () => api.get("/api/inventory/health/status-summary"),
  getInventoryLocationOccupancy: () => api.get("/api/inventory/health/location-occupancy"),
  getInventoryAging: () => api.get("/api/inventory/health/aging"),
  getInventoryGenealogyExceptions: () => api.get("/api/inventory/health/genealogy-exceptions"),
  getValuationSummary: () => api.get("/api/inventory/valuation/summary"),
  getValuationReels: () => api.get("/api/inventory/valuation/reels"),
  createTransaction: (data: any) => api.post("/api/inventory/issue", data),
  createInward: (data: any) => api.post("/api/inventory/inward", data),
  createIssue: (data: any) => api.post("/api/inventory/issue", data),
  createFgInward: (data: any) => api.post("/api/inventory/fg-inward", data),
  createDispatch: (data: any) => api.post("/api/inventory/dispatch", data),
  getReservations: (params?: any) => api.get("/api/inventory/reservations", { params }),
  createReservation: (data: any) => api.post("/api/inventory/reservations", data),
  releaseReservation: (id: string) => api.post(`/api/inventory/reservations/${id}/release`, {}),
  getLotAvailability: (itemId: string, specId?: string) =>
    api.get("/api/inventory/lots/availability", { params: { item_id: itemId, spec_id: specId } }),
  createReelInward: (data: any) => api.post("/api/inventory/reels/inward", data),
  getReels: (params?: any) => api.get("/api/inventory/reels", { params }),
  getReel: (id: string) => api.get(`/api/inventory/reels/${id}`),
  createReelScan: (id: string, data: any) => api.post(`/api/inventory/reels/${id}/scan`, data),
  getReelScans: (id: string, params?: any) => api.get(`/api/inventory/reels/${id}/scans`, { params }),
  createReelIssue: (data: any) => api.post("/api/inventory/reel-issues", data),
  getReelIssues: (params?: any) => api.get("/api/inventory/reel-issues", { params }),
  closeReelIssue: (id: string, data: any) => api.post(`/api/inventory/reel-issues/${id}/close`, data),
}

export const dispatchApi = {
  getReadyJobs: () => api.get("/api/dispatch/ready-jobs"),
  getDispatch: (id: string) => api.get(`/api/dispatch/${id}`),
  getDispatchByJob: (jobCardId: string) => api.get(`/api/dispatch/by-job/${jobCardId}`),
  createOrUpdateDispatch: (data: any) => api.post("/api/dispatch", data),
}
