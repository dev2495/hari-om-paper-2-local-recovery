"use client"

import { useMemo, useState } from "react"

import { CrudTable } from "@/components/common/crud-table"
import { MastersNav } from "@/components/master/masters-nav"
import { FaddaForm, PackagingBoxForm, PlasticSheetForm } from "@/components/forms/master-forms"
import {
  useCreatePackagingBox,
  useCreatePackagingFadda,
  useCreatePackagingPlasticSheet,
  useDeletePackagingBox,
  useDeletePackagingFadda,
  useDeletePackagingPlasticSheet,
  usePackagingBoxes,
  usePackagingFadda,
  usePackagingPlasticSheets,
  useUpdatePackagingBox,
  useUpdatePackagingFadda,
  useUpdatePackagingPlasticSheet,
} from "@/hooks/use-master-data"

const PACKING_SECTIONS = [
  {
    key: "boxes",
    label: "Boxes",
    title: "Box masters",
    subtitle: "Outer cartons and box dimensions that feed the packing handoff.",
  },
  {
    key: "plastics",
    label: "Plastic Sheets",
    title: "Plastic sheet masters",
    subtitle: "Plastic sleeves used by the spec and dispatch flows. Inward captures batch pricing.",
  },
  {
    key: "fadda",
    label: "Fadda",
    title: "Fadda masters",
    subtitle: "Fadda SKUs used during final packing and dispatch. Inward captures batch pricing.",
  },
] as const

type PackingSectionKey = (typeof PACKING_SECTIONS)[number]["key"]

export default function PackagingMasterPage() {
  const [activeSection, setActiveSection] = useState<PackingSectionKey>("boxes")

  const boxesQuery = usePackagingBoxes({ include_inactive: true })
  const plasticsQuery = usePackagingPlasticSheets({ include_inactive: true })
  const faddaQuery = usePackagingFadda({ include_inactive: true })

  const createBox = useCreatePackagingBox()
  const updateBox = useUpdatePackagingBox()
  const deleteBox = useDeletePackagingBox()

  const createPlastic = useCreatePackagingPlasticSheet()
  const updatePlastic = useUpdatePackagingPlasticSheet()
  const deletePlastic = useDeletePackagingPlasticSheet()

  const createFadda = useCreatePackagingFadda()
  const updateFadda = useUpdatePackagingFadda()
  const deleteFadda = useDeletePackagingFadda()

  const section = useMemo(
    () => PACKING_SECTIONS.find((item) => item.key === activeSection) || PACKING_SECTIONS[0],
    [activeSection],
  )

  const sectionConfig = useMemo(() => {
    if (activeSection === "plastics") {
      return {
        title: section.title,
        columns: [
          { header: "SKU", accessorKey: "sku" },
          { header: "Size Label", accessorKey: "size_label" },
          { header: "Weight (kg)", accessorKey: "weight_kg" },
        ],
        data: plasticsQuery.data || [],
        isLoading: plasticsQuery.isLoading,
        onAdd: (data: any) => createPlastic.mutateAsync(data),
        onEdit: (id: string, data: any) => updatePlastic.mutateAsync({ id, data }),
        onDelete: (id: string) => deletePlastic.mutate(id),
        FormComponent: PlasticSheetForm,
      }
    }

    if (activeSection === "fadda") {
      return {
        title: section.title,
        columns: [
          { header: "SKU", accessorKey: "sku" },
          { header: "Weight (kg)", accessorKey: "weight_kg" },
        ],
        data: faddaQuery.data || [],
        isLoading: faddaQuery.isLoading,
        onAdd: (data: any) => createFadda.mutateAsync(data),
        onEdit: (id: string, data: any) => updateFadda.mutateAsync({ id, data }),
        onDelete: (id: string) => deleteFadda.mutate(id),
        FormComponent: FaddaForm,
      }
    }

    return {
      title: section.title,
      columns: [
        { header: "Code", accessorKey: "code" },
        { header: "Color", accessorKey: "size_label" },
        {
          header: "Dimensions",
          accessorKey: "length_mm",
          render: (_value: any, row: any) => `${row.length_mm} x ${row.width_mm} x ${row.height_mm} mm`,
        },
        { header: "Weight (kg)", accessorKey: "weight_kg" },
      ],
      data: boxesQuery.data || [],
      isLoading: boxesQuery.isLoading,
      onAdd: (data: any) => createBox.mutateAsync(data),
      onEdit: (id: string, data: any) => updateBox.mutateAsync({ id, data }),
      onDelete: (id: string) => deleteBox.mutate(id),
      FormComponent: PackagingBoxForm,
    }
  }, [
    activeSection,
    boxesQuery.data,
    boxesQuery.isLoading,
    createBox,
    createFadda,
    createPlastic,
    deleteBox,
    deleteFadda,
    deletePlastic,
    faddaQuery.data,
    faddaQuery.isLoading,
    plasticsQuery.data,
    plasticsQuery.isLoading,
    section.title,
    updateBox,
    updateFadda,
    updatePlastic,
  ])

  const counts = {
    boxes: (boxesQuery.data || []).length,
    plastics: (plasticsQuery.data || []).length,
    fadda: (faddaQuery.data || []).length,
  }

  const kindLabel = activeSection === "boxes" ? "Box" : activeSection === "plastics" ? "Plastic sheet" : "Fadda"

  return (
    <div className="min-w-0 space-y-4">
      <MastersNav />
      <section className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Packaging</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">Boxes, plastic sheets and fadda used by the spec sheet, packing handoff and dispatch. Pick a kind to work on.</p>
          </div>
          <div role="tablist" aria-label="Packing master" className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
            {PACKING_SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={activeSection === item.key}
                onClick={() => setActiveSection(item.key)}
                className={`min-h-9 rounded-md px-3.5 text-[13px] font-semibold transition-colors ${
                  activeSection === item.key ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label} <span className="ml-1 text-muted-foreground">{counts[item.key]}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <CrudTable
        embedded
        title={sectionConfig.title}
        columns={sectionConfig.columns}
        data={sectionConfig.data}
        isLoading={sectionConfig.isLoading}
        onAdd={sectionConfig.onAdd}
        onEdit={sectionConfig.onEdit}
        onDelete={sectionConfig.onDelete}
        FormComponent={sectionConfig.FormComponent}
        qcBand={(row) => {
          const code = row?.code || row?.sku
          return code ? { materialType: "PACKAGING", scope: "ITEM", scopeKey: String(code), title: `${code}${row.size_label ? ` · ${row.size_label}` : ""}`, subtitle: kindLabel, group: kindLabel } : null
        }}
      />
    </div>
  )
}
