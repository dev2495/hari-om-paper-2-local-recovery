"use client"

import { CrudTable } from "@/components/common/crud-table"
import { PaperForm } from "@/components/forms/master-forms"
import { usePapers, useCreatePaper, useUpdatePaper, useDeletePaper } from "@/hooks/use-master-data"

export default function PapersPage() {
  const { data, isLoading } = usePapers({ include_inactive: true })
  const createMutation = useCreatePaper()
  const updateMutation = useUpdatePaper()
  const deleteMutation = useDeletePaper()

  const columns = [
    { header: "Code", accessorKey: "code" },
    { header: "Variety", accessorKey: "variety" },
    { header: "GSM", accessorKey: "gsm" },
    { header: "BF", accessorKey: "bf" },
    { header: "Ply Bond", accessorKey: "ply_bond" },
    { header: "Bulk Factor", accessorKey: "bulk_factor" },
    { header: "Thickness (mm)", accessorKey: "thickness_mm" },
  ]

  return (
    <CrudTable
      title="Papers"
      columns={columns}
      data={data}
      isLoading={isLoading}
      onAdd={(data) => createMutation.mutateAsync(data)}
      onEdit={(id, data) => updateMutation.mutateAsync({ id, data })}
      onDelete={(id) => deleteMutation.mutate(id)}
      FormComponent={PaperForm}
      qcBand={(row) => row?.code ? {
        materialType: "RAW_PAPER", scope: "ITEM", scopeKey: String(row.code), title: `${row.code}${row.variety ? ` · ${row.variety}` : ""}`,
        subtitle: `GSM ${row.gsm ?? "—"} · BF ${row.bf ?? "—"}`, group: row.variety || null,
        nominals: { gsm: row.gsm, bf: row.bf, caliper_mm: row.thickness_mm, ply_bond: row.ply_bond, bulk: row.bulk_factor },
      } : null}
    />
  )
}
