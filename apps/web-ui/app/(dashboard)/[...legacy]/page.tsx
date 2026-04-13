import { notFound, redirect } from "next/navigation"

import AnalyticsDashboardPage from "../analytics/dashboard/page"
import AnalyticsDispatchPage from "../analytics/dispatch/page"
import AnalyticsInventoryPage from "../analytics/inventory/page"
import AnalyticsLossPage from "../analytics/loss/page"
import AnalyticsProductionPage from "../analytics/production/page"
import AnalyticsQualityPage from "../analytics/quality/page"
import InventoryProductionIssuePage from "../inventory/production-issue/page"
import InventoryRawMaterialInwardPage from "../inventory/raw-material-inward/page"
import InventoryItemsPage from "../inventory/items/page"
import InventoryPage from "../inventory/page"
import LogisticsDispatchPage from "../logistics/dispatch/page"
import MasterAdhesivesPage from "../master/adhesives/page"
import MasterItemsPage from "../master/items/page"
import MasterMandrelsPage from "../master/mandrels/page"
import MasterPage from "../master/page"
import MasterPapersPage from "../master/papers/page"
import MasterParchmentsPage from "../master/parchments/page"
import MasterTubeSizesPage from "../master/tube-sizes/page"
import CustomersPage from "../masters/customers/page"
import PlanningTrackerPage from "../planning/tracker/page"
import EODProductionEntryPage from "../production/eod-entry/page"
import ProductionJobCardsPage from "../production/job-cards/page"
import ProductionPlannerPage from "../production/planner/page"
import ProductionReconciliationPage from "../production/reconciliation/page"
import ReportsInventoryPage from "../reports/inventory/page"
import ReportsPage from "../reports/page"
import ReportsPlantsPage from "../reports/plants/page"
import ReportsSalesPage from "../reports/sales/page"

type LegacyPageProps = {
  params: {
    legacy: string[]
  }
}

const componentMap: Record<string, any> = {
  dashboard: AnalyticsDashboardPage,
  "control-tower": AnalyticsDashboardPage,
  "analytics-loss": AnalyticsLossPage,
  "analytics-overview": AnalyticsDashboardPage,
  "analytics-supplier-reels": AnalyticsInventoryPage,
  "analytics-winder-variance": AnalyticsProductionPage,
  "inventory-items": InventoryItemsPage,
  "inventory-ledger": InventoryPage,
  "inventory-reel-trace": InventoryPage,
  "inventory-reels-inward": InventoryRawMaterialInwardPage,
  "inventory-reels-issue": InventoryPage,
  "inventory-rm-inward": InventoryRawMaterialInwardPage,
  "inventory-valuation": ReportsInventoryPage,
  "job-cards": ProductionJobCardsPage,
  masters: MasterPage,
  "supervisor-entry": EODProductionEntryPage,
  "analytics/exceptions": ReportsPage,
  "analytics/operations": AnalyticsProductionPage,
  "analytics/plants": ReportsPlantsPage,
  "analytics/sales": ReportsSalesPage,
  "inventory/ledger": InventoryPage,
  "inventory/production-issue": InventoryProductionIssuePage,
  "inventory/reels/inward": InventoryRawMaterialInwardPage,
  "inventory/reels/issue": InventoryPage,
  "inventory/reservations": InventoryPage,
  "inventory/valuation": ReportsInventoryPage,
  "master/customers": CustomersPage,
  "master/packaging": MasterItemsPage,
  "masters/adhesives": MasterAdhesivesPage,
  "masters/machines": MasterItemsPage,
  "masters/mandrels": MasterMandrelsPage,
  "masters/packaging": MasterItemsPage,
  "masters/parchments": MasterParchmentsPage,
  "masters/tools": MasterItemsPage,
  "masters/tube-sizes": MasterTubeSizesPage,
  "planning": ProductionPlannerPage,
  "planning/board": ProductionPlannerPage,
  "planning/print": ProductionPlannerPage,
  "production/eod-entry": EODProductionEntryPage,
  "production/job-cards/print": ProductionJobCardsPage,
  "production/planner/print": ProductionPlannerPage,
  "production/supervisor-entry": EODProductionEntryPage,
  "production/reconciliation": ProductionReconciliationPage,
  "reports/dispatch": AnalyticsDispatchPage,
  "reports/exceptions": ReportsPage,
  "reports/loss": AnalyticsLossPage,
  "reports/quality": AnalyticsQualityPage,
}

function resolveLegacyTarget(segments: string[]) {
  const joined = segments.join("/")

  if (segments[0] === "dispatch" && segments.length === 2) {
    return LogisticsDispatchPage
  }

  if (segments[0] === "dispatch" && segments[2] === "print") {
    return LogisticsDispatchPage
  }

  if (segments[0] === "job-cards" && segments.length >= 2) {
    return ProductionJobCardsPage
  }

  if (segments[0] === "planning" && segments[1] === "board") {
    return ProductionPlannerPage
  }

  if (segments[0] === "production" && segments[1] === "entry" && segments.length === 3) {
    return EODProductionEntryPage
  }

  if (segments[0] === "production" && segments[1] === "job-cards" && segments.length >= 3) {
    return ProductionJobCardsPage
  }

  if (segments[0] === "sales-orders" && segments[2] === "audit") {
    redirect(`/sales-orders/${segments[1]}`)
  }

  if (segments[0] === "sales-orders" && segments[2] === "tracking") {
    redirect(`/sales-orders/${segments[1]}`)
  }

  if (segments[0] === "specs" && segments.length === 2) {
    redirect(`/specifications/${segments[1]}`)
  }

  if (segments[0] === "specs" && segments[2] === "edit") {
    redirect(`/specifications/${segments[1]}/edit`)
  }

  if (segments[0] === "specs" && segments[2] === "print") {
    redirect(`/specifications/${segments[1]}/print`)
  }

  return null
}

export default function LegacyRoutePage({ params }: LegacyPageProps) {
  const joined = params.legacy.join("/")
  const Component = componentMap[joined] || resolveLegacyTarget(params.legacy)

  if (!Component) {
    notFound()
  }

  if (joined === "specs") {
    redirect("/specifications")
  }

  return <Component />
}
