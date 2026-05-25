import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { authApi } from "@/lib/api"
import { canonicalPlantScopeValue } from "@/lib/plant-scope"

function isRealPlant(row: any) {
    return (
        row &&
        row.is_active !== false &&
        String(row.code || "").trim().toUpperCase() !== "ALL" &&
        canonicalPlantScopeValue(row.id).toUpperCase() !== "ALL"
    )
}

// Plants
export function usePlants() {
    return useQuery({
        queryKey: ["plants"],
        queryFn: async () => {
            const { data } = await authApi.getPlants()
            return Array.isArray(data) ? data.filter(isRealPlant) : []
        },
    })
}

export function useCreatePlant() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => authApi.createPlant(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["plants"] })
        },
    })
}

export function useUpdatePlant() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => authApi.updatePlant(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["plants"] })
        },
    })
}

export function useDeletePlant() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => authApi.deletePlant(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["plants"] })
        },
    })
}

// Users
export function useUsers() {
    return useQuery({
        queryKey: ["users"],
        queryFn: async () => {
            const { data } = await authApi.users()
            return data
        },
    })
}

export function useCreateUser() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => authApi.createUser(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] })
        },
    })
}

export function useUpdateUser() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => authApi.updateUser(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] })
        },
    })
}

export function useDeleteUser() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => authApi.deleteUser(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] })
        },
    })
}

// Roles
export function useRoles() {
    return useQuery({
        queryKey: ["roles"],
        queryFn: async () => {
            const { data } = await authApi.getRoles()
            return data
        },
    })
}
