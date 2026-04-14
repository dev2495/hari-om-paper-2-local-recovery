from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


class MachineDepartment(str, Enum):
    SLITTING = "SLITTING"
    WINDER = "WINDER"
    OVEN = "OVEN"
    PROCESS = "PROCESS"
    PACKING = "PACKING"


class MachineCapacityType(str, Enum):
    REELS_PER_DAY = "REELS_PER_DAY"
    BAMBOOS_PER_DAY = "BAMBOOS_PER_DAY"
    BATCHES_PER_DAY = "BATCHES_PER_DAY"
    TUBES_PER_DAY = "TUBES_PER_DAY"


LEGACY_CAPACITY_TYPE_ALIASES = {
    "REELS_PER_SHIFT": MachineCapacityType.REELS_PER_DAY.value,
    "BAMBOOS_PER_SHIFT": MachineCapacityType.BAMBOOS_PER_DAY.value,
    "BATCHES_PER_SHIFT": MachineCapacityType.BATCHES_PER_DAY.value,
    "TUBES_PER_SHIFT": MachineCapacityType.TUBES_PER_DAY.value,
}


class MachineSupportedMandrelBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supported_mandrel_ids: list[UUID] = Field(default_factory=list)

    @field_validator("supported_mandrel_ids", mode="before")
    @classmethod
    def normalize_supported_mandrel_ids(cls, value):
        if value in (None, ""):
            return []
        if isinstance(value, str):
            parts = [part.strip() for part in value.split(",") if part.strip()]
            return parts
        return value


class MachineSupportedMandrelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mandrel_code: str
    outer_diameter_mm: float


class MachineBase(MachineSupportedMandrelBase):
    model_config = ConfigDict(extra="forbid")

    code: str
    name: str
    department: MachineDepartment
    capacity_type: MachineCapacityType
    capacity_value: float = Field(gt=0)
    id_min_mm: float = Field(gt=0)
    id_max_mm: float = Field(gt=0)
    od_min_mm: float = Field(gt=0)
    od_max_mm: float = Field(gt=0)
    length_min_mm: float = Field(gt=0)
    length_max_mm: float = Field(gt=0)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper().replace(" ", "_")
        if not normalized:
            raise ValueError("code is required")
        return normalized

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("department", mode="before")
    @classmethod
    def normalize_department(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @field_validator("capacity_type", mode="before")
    @classmethod
    def normalize_capacity_type(cls, value):
        if isinstance(value, str):
            normalized = value.strip().upper()
            return LEGACY_CAPACITY_TYPE_ALIASES.get(normalized, normalized)
        return value

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.id_min_mm > self.id_max_mm:
            raise ValueError("id_min_mm must be less than or equal to id_max_mm")
        if self.od_min_mm > self.od_max_mm:
            raise ValueError("od_min_mm must be less than or equal to od_max_mm")
        if self.length_min_mm > self.length_max_mm:
            raise ValueError("length_min_mm must be less than or equal to length_max_mm")
        return self


class MachineCreate(MachineBase):
    pass


class MachineUpdate(MachineSupportedMandrelBase):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    code: Optional[str] = None
    name: Optional[str] = None
    department: Optional[MachineDepartment] = None
    capacity_type: Optional[MachineCapacityType] = None
    capacity_value: Optional[float] = Field(default=None, gt=0)
    id_min_mm: Optional[float] = Field(default=None, gt=0)
    id_max_mm: Optional[float] = Field(default=None, gt=0)
    od_min_mm: Optional[float] = Field(default=None, gt=0)
    od_max_mm: Optional[float] = Field(default=None, gt=0)
    length_min_mm: Optional[float] = Field(default=None, gt=0)
    length_max_mm: Optional[float] = Field(default=None, gt=0)
    is_active: Optional[bool] = Field(default=None, validation_alias=AliasChoices("is_active", "active"))

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip().upper().replace(" ", "_")
        if not normalized:
            raise ValueError("code cannot be empty")
        return normalized

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be empty")
        return normalized

    @field_validator("department", mode="before")
    @classmethod
    def normalize_department(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @field_validator("capacity_type", mode="before")
    @classmethod
    def normalize_capacity_type(cls, value):
        if isinstance(value, str):
            normalized = value.strip().upper()
            return LEGACY_CAPACITY_TYPE_ALIASES.get(normalized, normalized)
        return value

    @model_validator(mode="after")
    def validate_partial_ranges(self):
        if self.id_min_mm is not None and self.id_max_mm is not None and self.id_min_mm > self.id_max_mm:
            raise ValueError("id_min_mm must be less than or equal to id_max_mm")
        if self.od_min_mm is not None and self.od_max_mm is not None and self.od_min_mm > self.od_max_mm:
            raise ValueError("od_min_mm must be less than or equal to od_max_mm")
        if self.length_min_mm is not None and self.length_max_mm is not None and self.length_min_mm > self.length_max_mm:
            raise ValueError("length_min_mm must be less than or equal to length_max_mm")
        return self


class MachineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    code: str
    name: str
    department: MachineDepartment
    capacity_type: MachineCapacityType
    capacity_value: float
    id_min_mm: float
    id_max_mm: float
    od_min_mm: float
    od_max_mm: float
    length_min_mm: float
    length_max_mm: float
    plant_id: str
    is_active: bool
    active: bool
    supported_mandrel_ids: list[UUID] = Field(default_factory=list)
    supported_mandrels: list[MachineSupportedMandrelResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None

