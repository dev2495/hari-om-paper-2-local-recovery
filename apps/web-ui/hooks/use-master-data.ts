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

