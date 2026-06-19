from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PRIORITIES = {"LOW", "NORMAL", "HIGH"}
SALES_ORDER_STATUSES = {"OPEN", "PLANNED", "COMPLETED", "CANCELLED"}
JOB_CARD_STATUSES = {"CREATED", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
STAGES = {"SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"}
STAGES_WITH_DONE = {"SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH", "DONE"}
STAGE_STATUSES = {"PLANNED", "QUEUED", "ASSIGNED", "RUNNING", "COMPLETED"}
SEGMENT_STATUSES = {"PLANNED", "QUEUED", "ASSIGNED", "RUNNING", "COMPLETED", "CANCELLED"}
SPLIT_SOURCES = {"NONE", "AUTO", "MANUAL"}
SAVE_MODES = {"DRAFT", "COMPLETE"}
SHIFT_CODES = {"SHIFT_A", "SHIFT_B"}


def _normalize_upper(value: str) -> str:
    return value.strip().upper()


class SalesOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: UUID
    spec_id: UUID
    order_qty: float = Field(gt=0)
    due_date: date
    priority: str = "NORMAL"

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, value: str) -> str:
        normalized = _normalize_upper(value)
        if normalized not in PRIORITIES:
            raise ValueError("priority must be one of LOW, NORMAL, HIGH")
        return normalized


class SalesOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    plant_id: UUID
    customer_id: UUID
    spec_id: UUID
    order_qty: float
    due_date: date
    priority: str
    status: str
    created_at: datetime


class JobCardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sales_order_id: UUID
    sales_order_line_id: UUID
    planned_qty: float = Field(gt=0)
    priority: Optional[str] = None

    @field_validator("priority")
    @classmethod
    def validate_optional_priority(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_upper(value)
        if normalized not in PRIORITIES:
            raise ValueError("priority must be one of LOW, NORMAL, HIGH")
        return normalized


class JobCardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    plant_id: UUID
    sales_order_id: UUID
    sales_order_line_id: Optional[UUID] = None
    release_lot_id: Optional[UUID] = None
    spec_id: UUID
    spec_snapshot: dict[str, Any]
    routing_snapshot: dict[str, Any] = Field(default_factory=dict)
    material_plan_snapshot: dict[str, Any] = Field(default_factory=dict)
    released_qty: float = 0.0
    assigned_winder_machine_id: Optional[UUID] = None
    product_code: Optional[str] = None
    planned_qty: float
    status: str
    current_stage: str
    requires_slitting: bool = False
    created_at: datetime
    # Operator-friendly derived lifecycle label.
    # Maps status + stage + released_qty into one human-readable token:
    # DRAFT · RELEASED · SCHEDULED · IN_PROGRESS · COMPLETED · CLOSED · CANCELLED
    lifecycle_label: Optional[str] = None


class JobCardStageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_card_id: UUID
    stage_type: str
    machine_id: Optional[UUID]
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    planned_start: Optional[datetime]
    planned_end: Optional[datetime]
    actual_start: Optional[datetime]
    actual_end: Optional[datetime]
    input_qty: Optional[float]
    output_qty: Optional[float]
    scrap_qty: Optional[float]
    status: str
    reel_issue_ids: list[str] = Field(default_factory=list)
    entry_snapshot: dict[str, Any] = Field(default_factory=dict)
    actuals_snapshot: dict[str, Any] = Field(default_factory=dict)
    quality_checks: dict[str, Any] = Field(default_factory=dict)
    material_allocations: list[dict[str, Any]] = Field(default_factory=list)
    location_id: Optional[UUID] = None
    required_capacity: Optional[float] = None
    remarks: Optional[str]
    entered_by: Optional[str]
    entered_at: Optional[datetime]
    created_at: datetime


class QueueJobCardItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queue_id: UUID
    segment_id: UUID
    job_card_id: UUID
    sales_order_id: UUID
    sales_order_line_id: Optional[UUID] = None
    release_lot_id: Optional[UUID] = None
    job_card_ref: Optional[str] = None
    stage_id: UUID
    stage_type: str
    status: str
    segment_status: str
    segment_no: int = 1
    split_source: str = "NONE"
    split_parent_segment_id: Optional[UUID] = None
    sequence_no: int
    slot_order: int
    machine_id: Optional[str]
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    required_capacity: Optional[float] = None
    segment_planned_qty: float
    remaining_segments: int = 1
    planned_qty: float
    priority: Optional[str]
    current_stage: str
    product_code: Optional[str] = None
    product_size_label: Optional[str] = None
    parchment_color: Optional[str] = None
    released_qty: Optional[float] = None
    assigned_winder_machine_id: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    tube_size_id: Optional[str] = None
    spec_id: Optional[str] = None
    spec_reference: Optional[str] = None
    spec_version: Optional[int] = None
    required_cs: Optional[float] = None
    target_tube_weight: Optional[float] = None
    tube_weight_g: Optional[float] = None
    planned_weight_kg: Optional[float] = None
    bamboo_weight_kg: Optional[float] = None
    pcs_per_bamboo: Optional[int] = None
    target_bamboo_count: Optional[int] = None
    selected_bamboo_length_mm: Optional[float] = None
    usable_length_mm: Optional[float] = None
    due_date: Optional[date] = None
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    created_at: datetime
    is_carry_forward: bool = False
    carry_forward_source_job_card_id: Optional[UUID] = None
    carry_forward_reason_code: Optional[str] = None


class QueueMachineBucket(BaseModel):
    model_config = ConfigDict(extra="forbid")

    machine_id: Optional[str]
    jobs: list[QueueJobCardItem]


class PlanningQueueResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    scope_all: bool
    buckets: list[QueueMachineBucket]


class PlanningBoardMachineConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_min_mm: Optional[float] = None
    id_max_mm: Optional[float] = None
    od_min_mm: Optional[float] = None
    od_max_mm: Optional[float] = None
    length_min_mm: Optional[float] = None
    length_max_mm: Optional[float] = None
    supported_mandrel_ids: list[str] = Field(default_factory=list)
    supported_mandrels: list[dict[str, Any]] = Field(default_factory=list)


class PlanningBoardLane(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lane_id: str
    stage: str
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    shift_label: Optional[str] = None
    machine_id: Optional[str] = None
    machine_code: Optional[str] = None
    machine_name: str
    machine_department: Optional[str] = None
    capacity_value: Optional[float] = None
    capacity_unit: Optional[str] = None
    batch_bamboo_capacity: Optional[float] = None
    cycle_time_hours: Optional[float] = None
    current_load: float = 0.0
    warning: Optional[str] = None
    constraints: PlanningBoardMachineConstraint = Field(default_factory=PlanningBoardMachineConstraint)
    jobs: list[QueueJobCardItem] = Field(default_factory=list)


class PlanningBoardStageSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobs: int
    planned_qty: float
    capacity_load: float
    capacity_unit: str


class PlanningShift(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    label: str
    capacity_share: float


class PlanningBoardStageView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    summary: PlanningBoardStageSummary
    lanes: list[PlanningBoardLane]


class PlanningSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    job_card_id: UUID
    lane_id: str
    machine_id: Optional[str] = None
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    sequence_no: int
    required_capacity: Optional[float] = None
    reason: Optional[str] = None


class PlanningBoardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_date: Optional[date] = None
    include_unscheduled: bool
    scope_all: bool
    requires_explicit_plant: bool = False
    allowed_plants: list[str] = Field(default_factory=list)
    shifts: list[PlanningShift] = Field(default_factory=list)
    summary: PlanningBoardStageSummary
    stages: list[PlanningBoardStageView] = Field(default_factory=list)
    suggestions: list[PlanningSuggestion] = Field(default_factory=list)


class ReorderQueuePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_card_id: Optional[UUID] = None
    segment_id: Optional[UUID] = None
    stage: str
    machine_id: Optional[UUID] = None
    sequence_no: int = Field(gt=0)
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, value: str) -> str:
        normalized = _normalize_upper(value)
        if normalized not in STAGES:
            raise ValueError("stage must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC, DISPATCH")
        return normalized

    @field_validator("shift_code")
    @classmethod
    def validate_shift_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_upper(value)
        if normalized not in SHIFT_CODES:
            raise ValueError("shift_code must be one of SHIFT_A, SHIFT_B")
        return normalized

    @model_validator(mode="after")
    def validate_reorder_target(self):
        if self.job_card_id is None and self.segment_id is None:
            raise ValueError("job_card_id or segment_id is required")
        return self


class BoardMovePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_card_id: Optional[UUID] = None
    segment_id: Optional[UUID] = None
    stage: str
    machine_id: Optional[UUID] = None
    sequence_no: int = Field(gt=0)
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, value: str) -> str:
        normalized = _normalize_upper(value)
        if normalized not in STAGES:
            raise ValueError("stage must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC, DISPATCH")
        return normalized

    @field_validator("shift_code")
    @classmethod
    def validate_board_shift_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_upper(value)
        if normalized not in SHIFT_CODES:
            raise ValueError("shift_code must be one of SHIFT_A, SHIFT_B")
        return normalized

    @model_validator(mode="after")
    def validate_move_target(self):
        if self.job_card_id is None and self.segment_id is None:
            raise ValueError("job_card_id or segment_id is required")
        return self


class StageSegmentSplitPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    segment_id: UUID
    stage: str
    primary_qty: float = Field(gt=0)

    @field_validator("stage")
    @classmethod
    def validate_split_stage(cls, value: str) -> str:
        normalized = _normalize_upper(value)
        if normalized not in STAGES:
            raise ValueError("stage must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC, DISPATCH")
        return normalized


class JobCardPlannerSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    plant_id: UUID
    sales_order_id: UUID
    sales_order_line_id: Optional[UUID] = None
    release_lot_id: Optional[UUID] = None
    job_card_ref: Optional[str] = None
    spec_id: UUID
    released_qty: float = 0.0
    assigned_winder_machine_id: Optional[str] = None
    product_code: Optional[str] = None
    product_size_label: Optional[str] = None
    parchment_color: Optional[str] = None
    active_segment_id: Optional[str] = None
    active_segment_status: Optional[str] = None
    active_segment_machine_id: Optional[str] = None
    active_segment_plan_date: Optional[date] = None
    open_segment_count: int = 0
    blocked_reason: Optional[str] = None
    planner_gate_ready: bool = False
    planner_gate_reason: Optional[str] = None
    current_machine_id: Optional[str] = None
    current_plan_date: Optional[date] = None
    current_shift_code: Optional[str] = None
    planned_qty: float
    status: str
    current_stage: str
    priority: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    tube_size_id: Optional[str] = None
    spec_reference: Optional[str] = None
    spec_version: Optional[int] = None
    required_cs: Optional[float] = None
    target_tube_weight: Optional[float] = None
    tube_weight_g: Optional[float] = None
    planned_weight_kg: Optional[float] = None
    bamboo_weight_kg: Optional[float] = None
    pcs_per_bamboo: Optional[int] = None
    target_bamboo_count: Optional[int] = None
    selected_bamboo_length_mm: Optional[float] = None
    usable_length_mm: Optional[float] = None
    due_date: Optional[date] = None
    created_at: datetime


class JobCardPlanningStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_type: str
    status: str
    machine_id: Optional[str] = None
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    input_qty: Optional[float] = None
    output_qty: Optional[float] = None
    scrap_qty: Optional[float] = None
    remarks: Optional[str] = None
    reel_issue_ids: list[str] = Field(default_factory=list)
    entry_snapshot: dict[str, Any] = Field(default_factory=dict)
    actuals_snapshot: dict[str, Any] = Field(default_factory=dict)
    quality_checks: dict[str, Any] = Field(default_factory=dict)
    material_allocations: list[dict[str, Any]] = Field(default_factory=list)
    location_id: Optional[str] = None
    required_capacity: Optional[float] = None


class JobCardStageSegmentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    stage_type: str
    segment_no: int
    machine_id: Optional[str] = None
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    planned_qty: float
    input_qty: Optional[float] = None
    output_qty: Optional[float] = None
    scrap_qty: Optional[float] = None
    required_capacity: float = 0.0
    status: str
    split_source: str = "NONE"
    split_parent_segment_id: Optional[str] = None
    sequence_no: int
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class CarryForwardSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggested: bool
    source_stage: Optional[str] = None
    remaining_qty: float = 0.0
    reason: Optional[str] = None
    sales_order_line_id: Optional[UUID] = None
    parchment_color: Optional[str] = None


class JobCardPlanningDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    plant_id: UUID
    sales_order_id: UUID
    sales_order_line_id: Optional[UUID] = None
    release_lot_id: Optional[UUID] = None
    spec_id: UUID
    requires_slitting: bool = False
    released_qty: float = 0.0
    assigned_winder_machine_id: Optional[str] = None
    product_code: Optional[str] = None
    planned_qty: float
    status: str
    current_stage: str
    job_card_ref: str
    sales_order_ref: str
    spec_snapshot: dict[str, Any]
    routing_snapshot: dict[str, Any] = Field(default_factory=dict)
    material_plan_snapshot: dict[str, Any] = Field(default_factory=dict)
    snapshot_mode: str
    document_snapshot: dict[str, Any]
    sales_order: dict[str, Any]
    active_segment_id: Optional[str] = None
    active_segment_status: Optional[str] = None
    active_segment_machine_id: Optional[str] = None
    active_segment_plan_date: Optional[date] = None
    open_segment_count: int = 0
    blocked_reason: Optional[str] = None
    planner_gate_ready: bool = False
    planner_gate_reason: Optional[str] = None
    carry_forward_suggestion: CarryForwardSuggestion = Field(default_factory=CarryForwardSuggestion)
    stages: list[JobCardPlanningStage]
    stage_segments: list[JobCardStageSegmentResponse] = Field(default_factory=list)
    packing_record: Optional[dict[str, Any]] = None
    quality_inspections: list[dict[str, Any]] = Field(default_factory=list)
    quality_holds: list[dict[str, Any]] = Field(default_factory=list)
    audit_events: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime


class ReleaseSyncLineResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sales_order_line_id: UUID
    release_lot_id: UUID
    job_card_id: UUID
    first_stage: str
    queue_created: bool


class ReleaseSyncRowPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    release_lot_id: UUID
    sales_order_line_id: UUID
    release_qty: float = Field(gt=0)
    winder_machine_id: UUID
    product_code: Optional[str] = None


class ReleaseSyncPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line_ids: list[UUID] = Field(default_factory=list)
    release_rows: list[ReleaseSyncRowPayload] = Field(default_factory=list)
    order_snapshot: Optional[dict[str, Any]] = None


class ReleaseSyncResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: UUID
    order_status: str
    line_results: list[ReleaseSyncLineResult]


class AssignMachinePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: Optional[str] = None
    machine_id: Optional[UUID] = None
    sequence_no: int = Field(gt=0)
    plan_date: Optional[date] = None
    shift_code: Optional[str] = None
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_upper(value)
        if normalized not in STAGES:
            raise ValueError("stage must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC, DISPATCH")
        return normalized

    @field_validator("shift_code")
    @classmethod
    def validate_assign_shift_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_upper(value)
        if normalized not in SHIFT_CODES:
            raise ValueError("shift_code must be one of SHIFT_A, SHIFT_B")
        return normalized

    @model_validator(mode="after")
    def validate_planned_window(self):
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            raise ValueError("planned_end must be greater than or equal to planned_start")
        return self


class StageOutputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: Optional[str] = None
    segment_id: Optional[UUID] = None
    save_mode: str = "complete"
    machine_id: Optional[UUID] = None
    output_qty: Optional[float] = Field(default=None, ge=0)
    scrap_qty: Optional[float] = Field(default=None, ge=0)
    input_qty: Optional[float] = Field(default=None, ge=0)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    reel_issue_ids: list[UUID] = Field(default_factory=list)
    actuals: dict[str, Any] = Field(default_factory=dict)
    quality_checks: dict[str, Any] = Field(default_factory=dict)
    material_allocations: list[dict[str, Any]] = Field(default_factory=list)
    location_id: Optional[UUID] = None
    entry_snapshot: dict[str, Any] = Field(default_factory=dict)
    remarks: Optional[str] = None
    override_reason: Optional[str] = None

    @field_validator("stage")
    @classmethod
    def validate_output_stage(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_upper(value)
        if normalized not in STAGES:
            raise ValueError("stage must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC, DISPATCH")
        return normalized

    @field_validator("save_mode")
    @classmethod
    def validate_save_mode(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in SAVE_MODES:
            raise ValueError("save_mode must be one of draft, complete")
        return normalized.lower()


class StageActionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    job_card_id: UUID
    stage: str
    segment_id: Optional[UUID] = None
    job_card_status: str
    current_stage: str
    save_mode: str = "complete"
    stage_status: str
    remaining_open_segments: int = 0
    entry_saved: bool = True
    override_used: bool = False
    override_reason: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)
    reel_issue_ids: list[str] = Field(default_factory=list)
    quality_hold_ids: list[str] = Field(default_factory=list)
