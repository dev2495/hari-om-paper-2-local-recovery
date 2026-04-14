import { SpecSheetDocument } from "@/components/specs/SpecSheetDocument"

export default function EditSpecPage({ params }: { params: { id: string } }) {
  return <SpecSheetDocument mode="edit" specId={params.id} />
}
