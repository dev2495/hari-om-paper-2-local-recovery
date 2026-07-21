import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { masterApi } from "@/lib/api"

// Papers
export function usePapers(params?: any) {
    return useQuery({
        queryKey: ["papers", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getPapers(params)
            return data
        },
    })
}

export function useCreatePaper() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createPaper(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["papers"] })
        },
    })
}

export function useUpdatePaper() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updatePaper(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["papers"] })
        },
    })
}

export function useDeletePaper() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deletePaper(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["papers"] })
        },
    })
}

// Adhesives
export function useAdhesives(params?: any) {
    return useQuery({
        queryKey: ["adhesives", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getAdhesives(params)
            return data
        },
    })
}

export function useCreateAdhesive() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createAdhesive(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["adhesives"] })
        },
    })
}

export function useUpdateAdhesive() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateAdhesive(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["adhesives"] })
        },
    })
}

export function useDeleteAdhesive() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteAdhesive(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["adhesives"] })
        },
    })
}

// Parchments
export function useParchments(params?: any) {
    return useQuery({
        queryKey: ["parchments", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getParchments(params)
            return data
        },
    })
}

export function useCreateParchment() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createParchment(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["parchments"] })
        },
    })
}

export function useUpdateParchment() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateParchment(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["parchments"] })
        },
    })
}

export function useDeleteParchment() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteParchment(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["parchments"] })
        },
    })
}

export function useParchmentVendors(params?: any) {
    return useQuery({
        queryKey: ["parchment-vendors", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getParchmentVendors(params)
            return data
        },
    })
}

export function useCreateParchmentVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createParchmentVendor(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["parchment-vendors"] })
            queryClient.invalidateQueries({ queryKey: ["parchments"] })
        },
    })
}

export function useUpdateParchmentVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateParchmentVendor(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["parchment-vendors"] })
            queryClient.invalidateQueries({ queryKey: ["parchments"] })
        },
    })
}

export function useDeleteParchmentVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteParchmentVendor(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["parchment-vendors"] })
            queryClient.invalidateQueries({ queryKey: ["parchments"] })
        },
    })
}

// Tube Sizes
export function useTubeSizes(params?: any) {
    return useQuery({
        queryKey: ["tube-sizes", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getTubeSizes(params)
            return data
        },
    })
}

export function useCreateTubeSize() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createTubeSize(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tube-sizes"] })
        },
    })
}

export function useUpdateTubeSize() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateTubeSize(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tube-sizes"] })
        },
    })
}

export function useDeleteTubeSize() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteTubeSize(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tube-sizes"] })
        },
    })
}

// Mandrels
export function useMandrels(params?: any) {
    return useQuery({
        queryKey: ["mandrels", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getMandrels(params)
            return data
        },
    })
}

export function useCreateMandrel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createMandrel(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["mandrels"] })
        },
    })
}

export function useUpdateMandrel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateMandrel(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["mandrels"] })
        },
    })
}

export function useDeleteMandrel() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteMandrel(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["mandrels"] })
        },
    })
}

// Customers
export function useCustomers(params?: any) {
    return useQuery({
        queryKey: ["customers", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getCustomers(params)
            return data
        },
    })
}

export function useCreateCustomer() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createCustomer(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useUpdateCustomer() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateCustomer(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useDeleteCustomer() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteCustomer(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useContactDirectory() {
    return useQuery({
        queryKey: ["contact-directory"],
        queryFn: async () => {
            const { data } = await masterApi.getContactDirectory()
            return Array.isArray(data) ? data : []
        },
    })
}

export function useCustomerContacts(customerId?: string | null) {
    return useQuery({
        queryKey: ["customer-contacts", customerId || ""],
        queryFn: async () => {
            if (!customerId) return []
            const { data } = await masterApi.getCustomerContacts(customerId)
            return data
        },
        enabled: Boolean(customerId),
    })
}

export function useCreateCustomerContact() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ customerId, data }: { customerId: string; data: any }) => masterApi.createCustomerContact(customerId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["customer-contacts", variables.customerId] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useUpdateCustomerContact() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ customerId, contactId, data }: { customerId: string; contactId: string; data: any }) =>
            masterApi.updateCustomerContact(customerId, contactId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["customer-contacts", variables.customerId] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useDeleteCustomerContact() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ customerId, contactId }: { customerId: string; contactId: string }) =>
            masterApi.deleteCustomerContact(customerId, contactId),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["customer-contacts", variables.customerId] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

// Suppliers
export function useSuppliers(params?: any) {
    return useQuery({
        queryKey: ["suppliers", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getSuppliers(params)
            return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
        },
    })
}

export function useVendors(params?: any) {
    return useQuery({
        queryKey: ["vendors", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getVendors(params)
            return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
        },
    })
}

export function useCreateSupplier() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createSupplier(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["suppliers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useCreateVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createVendor(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            queryClient.invalidateQueries({ queryKey: ["suppliers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useUpdateSupplier() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateSupplier(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["suppliers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useUpdateVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateVendor(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            queryClient.invalidateQueries({ queryKey: ["suppliers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useDeleteSupplier() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteSupplier(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["suppliers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useDeleteVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteVendor(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            queryClient.invalidateQueries({ queryKey: ["suppliers"] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useVendorContacts(vendorId?: string | null) {
    return useQuery({
        queryKey: ["vendor-contacts", vendorId || ""],
        queryFn: async () => {
            if (!vendorId) return []
            const { data } = await masterApi.getVendorContacts(vendorId)
            return data
        },
        enabled: Boolean(vendorId),
    })
}

export function useCreateVendorContact() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ vendorId, data }: { vendorId: string; data: any }) => masterApi.createVendorContact(vendorId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["vendor-contacts", variables.vendorId] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useUpdateVendorContact() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ vendorId, contactId, data }: { vendorId: string; contactId: string; data: any }) =>
            masterApi.updateVendorContact(vendorId, contactId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["vendor-contacts", variables.vendorId] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

export function useDeleteVendorContact() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ vendorId, contactId }: { vendorId: string; contactId: string }) =>
            masterApi.deleteVendorContact(vendorId, contactId),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["vendor-contacts", variables.vendorId] })
            queryClient.invalidateQueries({ queryKey: ["contact-directory"] })
        },
    })
}

// Packaging boxes
export function usePackagingBoxes(params?: any) {
    return useQuery({
        queryKey: ["packaging-boxes", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getPackagingBoxes(params)
            return data
        },
    })
}

export function useCreatePackagingBox() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createPackagingBox(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-boxes"] })
        },
    })
}

export function useUpdatePackagingBox() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updatePackagingBox(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-boxes"] })
        },
    })
}

export function useDeletePackagingBox() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deletePackagingBox(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-boxes"] })
        },
    })
}

// Packaging plastic sheets
export function usePackagingPlasticSheets(params?: any) {
    return useQuery({
        queryKey: ["packaging-plastic-sheets", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getPackagingPlasticSheets(params)
            return data
        },
    })
}

export function useCreatePackagingPlasticSheet() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createPackagingPlasticSheet(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-plastic-sheets"] })
        },
    })
}

export function useUpdatePackagingPlasticSheet() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updatePackagingPlasticSheet(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-plastic-sheets"] })
        },
    })
}

export function useDeletePackagingPlasticSheet() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deletePackagingPlasticSheet(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-plastic-sheets"] })
        },
    })
}

// Packaging fadda
export function usePackagingFadda(params?: any) {
    return useQuery({
        queryKey: ["packaging-fadda", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getPackagingFadda(params)
            return data
        },
    })
}

export function useCreatePackagingFadda() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createPackagingFadda(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-fadda"] })
        },
    })
}

export function useUpdatePackagingFadda() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updatePackagingFadda(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-fadda"] })
        },
    })
}

export function useDeletePackagingFadda() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deletePackagingFadda(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["packaging-fadda"] })
        },
    })
}

// Tools
export function useTools(params?: any) {
    return useQuery({
        queryKey: ["tools", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getTools(params)
            return data
        },
    })
}

export function useToolCategories() {
    return useQuery({
        queryKey: ["tool-categories"],
        queryFn: async () => {
            const { data } = await masterApi.getToolCategories()
            return data
        },
    })
}

export function useToolOptions(params?: any) {
    return useQuery({
        queryKey: ["tool-options", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getToolOptions(params)
            return Array.isArray(data) ? data : []
        },
    })
}

export function useCreateToolOption() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createToolOption(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tool-options"] })
        },
    })
}

export function useUpdateToolOption() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateToolOption(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tool-options"] })
        },
    })
}

export function useToolLogs(params?: any) {
    return useQuery({
        queryKey: ["tool-logs", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getToolLogs(params)
            return data
        },
    })
}

export function useToolReport(params?: any) {
    return useQuery({
        queryKey: ["tool-report", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getToolReport(params)
            return data
        },
    })
}

export function useCreateTool() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createTool(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
            queryClient.invalidateQueries({ queryKey: ["tool-report"] })
            queryClient.invalidateQueries({ queryKey: ["tool-logs"] })
        },
    })
}

export function useUpdateTool() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateTool(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
            queryClient.invalidateQueries({ queryKey: ["tool-report"] })
            queryClient.invalidateQueries({ queryKey: ["tool-logs"] })
        },
    })
}

export function useUpdateToolStatus() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateToolStatus(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
            queryClient.invalidateQueries({ queryKey: ["tool-report"] })
            queryClient.invalidateQueries({ queryKey: ["tool-logs"] })
        },
    })
}

export function useLogToolUsage() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.logToolUsage(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
            queryClient.invalidateQueries({ queryKey: ["tool-report"] })
            queryClient.invalidateQueries({ queryKey: ["tool-logs"] })
        },
    })
}

export function useDeleteTool() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteTool(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
            queryClient.invalidateQueries({ queryKey: ["tool-report"] })
            queryClient.invalidateQueries({ queryKey: ["tool-logs"] })
        },
    })
}

// Machines
export function useMachines(options?: { includeInactive?: boolean }) {
    const includeInactive = Boolean(options?.includeInactive)
    return useQuery({
        queryKey: ["master-machines", { includeInactive }],
        queryFn: async () => {
            const { data } = await masterApi.getMachines(includeInactive ? { include_inactive: true } : undefined)
            return data
        },
    })
}

export function useCreateMachine() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createMachine(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["master-machines"] })
            queryClient.invalidateQueries({ queryKey: ["production-machines"] })
        },
    })
}

export function useUpdateMachine() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateMachine(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["master-machines"] })
            queryClient.invalidateQueries({ queryKey: ["production-machines"] })
        },
    })
}

export function useDeleteMachine() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteMachine(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["master-machines"] })
            queryClient.invalidateQueries({ queryKey: ["production-machines"] })
        },
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Shop-floor masters
// ──────────────────────────────────────────────────────────────────────────

export function useEmployees(params?: any) {
    return useQuery({
        queryKey: ["employees", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getEmployees(params)
            return Array.isArray(data) ? data : []
        },
    })
}

export function useCreateEmployee() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createEmployee(data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
    })
}

export function useUpdateEmployee() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateEmployee(id, data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
    })
}

export function useDeleteEmployee() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteEmployee(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
    })
}

export function useShifts(params?: any) {
    return useQuery({
        queryKey: ["shifts", params || {}],
        queryFn: async () => {
            const { data } = await masterApi.getShifts(params)
            return Array.isArray(data) ? data : []
        },
    })
}

export function useCreateShift() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createShift(data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
    })
}

export function useUpdateShift() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateShift(id, data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
    })
}

export function useDeleteShift() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteShift(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
    })
}

export function useHolidays(year?: number) {
    return useQuery({
        queryKey: ["holidays", year || "all"],
        queryFn: async () => {
            const { data } = await masterApi.getHolidays(year ? { year } : undefined)
            return Array.isArray(data) ? data : []
        },
    })
}

export function useCreateHoliday() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createHoliday(data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
    })
}

export function useUpdateHoliday() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateHoliday(id, data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
    })
}

export function useDeleteHoliday() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteHoliday(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
    })
}

export function useReasonCodes(category?: string, options?: { includeInactive?: boolean }) {
    const params = {
        ...(category ? { category } : {}),
        ...(options?.includeInactive ? { include_inactive: true } : {}),
    }
    return useQuery({
        queryKey: ["reason-codes", params],
        queryFn: async () => {
            const { data } = await masterApi.getReasonCodes(params)
            return Array.isArray(data) ? data : []
        },
    })
}

export function useCreateReasonCode() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createReasonCode(data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reason-codes"] }),
    })
}

export function useUpdateReasonCode() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateReasonCode(id, data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reason-codes"] }),
    })
}

export function useDeleteReasonCode() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteReasonCode(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reason-codes"] }),
    })
}
