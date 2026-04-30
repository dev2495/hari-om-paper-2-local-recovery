import { SpecSheetDocument } from "@/components/specs/SpecSheetDocument"

export default async function EditSpecPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <SpecSheetDocument mode="edit" specId={id} />
}
