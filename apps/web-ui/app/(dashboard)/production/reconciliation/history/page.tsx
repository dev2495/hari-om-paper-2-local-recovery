import { ReconciliationWorkspace } from "@/components/workspace/reconciliation-workspace"
import { RoleGate } from "@/components/workspace/role-gate"

export default function Page() {
  return <RoleGate allow={["Owner", "Admin", "PlantManager"]}><ReconciliationWorkspace view="history" /></RoleGate>
}
