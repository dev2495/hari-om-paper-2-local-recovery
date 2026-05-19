import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { masterApi } from "@/lib/api"

// Papers
export function usePapers() {
    return useQuery({
        queryKey: ["papers"],
        queryFn: async () => {
            const { data } = await masterApi.getPapers()
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
export function useAdhesives() {
    return useQuery({
        queryKey: ["adhesives"],
        queryFn: async () => {
            const { data } = await masterApi.getAdhesives()
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
export function useParchments() {
    return useQuery({
        queryKey: ["parchments"],
        queryFn: async () => {
            const { data } = await masterApi.getParchments()
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

export function useParchmentVendors() {
    return useQuery({
        queryKey: ["parchment-vendors"],
        queryFn: async () => {
            const { data } = await masterApi.getParchmentVendors()
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
export function useTubeSizes() {
    return useQuery({
        queryKey: ["tube-sizes"],
        queryFn: async () => {
            const { data } = await masterApi.getTubeSizes()
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
export function useMandrels() {
    return useQuery({
        queryKey: ["mandrels"],
        queryFn: async () => {
            const { data } = await masterApi.getMandrels()
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
export function useCustomers() {
    return useQuery({
        queryKey: ["customers"],
        queryFn: async () => {
            const { data } = await masterApi.getCustomers()
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
export function useSuppliers() {
    return useQuery({
        queryKey: ["suppliers"],
        queryFn: async () => {
            const { data } = await masterApi.getSuppliers()
            return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
        },
    })
}

export function useVendors() {
    return useQuery({
        queryKey: ["vendors"],
        queryFn: async () => {
            const { data } = await masterApi.getVendors()
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
export function usePackagingBoxes() {
    return useQuery({
        queryKey: ["packaging-boxes"],
        queryFn: async () => {
            const { data } = await masterApi.getPackagingBoxes()
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
export function usePackagingPlasticSheets() {
    return useQuery({
        queryKey: ["packaging-plastic-sheets"],
        queryFn: async () => {
            const { data } = await masterApi.getPackagingPlasticSheets()
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
export function usePackagingFadda() {
    return useQuery({
        queryKey: ["packaging-fadda"],
        queryFn: async () => {
            const { data } = await masterApi.getPackagingFadda()
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

export function useCreateTool() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createTool(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
        },
    })
}

export function useUpdateTool() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateTool(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
        },
    })
}

export function useDeleteTool() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteTool(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["tools"] })
        },
    })
}

// Machines
export function useMachines() {
    return useQuery({
        queryKey: ["machines"],
        queryFn: async () => {
            const { data } = await masterApi.getMachines()
            return data
        },
    })
}

export function useCreateMachine() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => masterApi.createMachine(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["machines"] })
        },
    })
}

export function useUpdateMachine() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => masterApi.updateMachine(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["machines"] })
        },
    })
}

export function useDeleteMachine() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => masterApi.deleteMachine(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["machines"] })
        },
    })
}
