import PurchaseOrderEditor from "@/components/procurement/po-editor"
import { RoleGate } from "@/components/workspace/role-gate"

// The server creates POs for Store and the plant head (Owner and Admin pass): the Planner proposes
// arrivals on the RM inward calendar instead, so the form is not shown to them.
export default function NewPurchaseOrderPage() {
  return (
    <RoleGate allow={["Store", "PlantManager"]} fallbackTitle="Purchase orders are made by Store or the plant head"
      fallbackMessage="Propose the arrival on the RM inward calendar; when the Owner approves it, its draft PO is made for you.">
      <PurchaseOrderEditor />
    </RoleGate>
  )
}
