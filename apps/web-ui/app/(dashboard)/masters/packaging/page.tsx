"use client"

import { useMemo, useState } from "react"

import { CrudTable } from "@/components/common/crud-table"
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

  const boxesQuery = usePackagingBoxes()
  const plasticsQuery = usePackagingPlasticSheets()
  const faddaQuery = usePackagingFadda()

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

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-premium">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Packaging Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">One packing workspace, not three long pages</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Keep boxes, plastic sheets, and fadda in one compact flow. Switch the active packing master from here instead of scrolling through stacked sections that waste page height.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {PACKING_SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={`rounded-[1.4rem] border px-4 py-4 text-left transition ${
                  activeSection === item.key
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold">{counts[item.key]}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white/90 p-5 shadow-premium">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active section</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">{section.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{section.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PACKING_SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  activeSection === item.key
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <CrudTable
        title={sectionConfig.title}
        columns={sectionConfig.columns}
        data={sectionConfig.data}
        isLoading={sectionConfig.isLoading}
        onAdd={sectionConfig.onAdd}
        onEdit={sectionConfig.onEdit}
        onDelete={sectionConfig.onDelete}
        FormComponent={sectionConfig.FormComponent}
      />
    </div>
  )
}
