from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import RecipeHeader, SpecificationSheet


class ApprovalService:
    def __init__(self, db: Session):
        self.db = db

    def approve_recipe(self, recipe_id: str, approved_by: str | None = None) -> dict:
        recipe_uuid = uuid.UUID(str(recipe_id))
        recipe = self.db.query(RecipeHeader).filter(RecipeHeader.id == recipe_uuid).first()
        if not recipe:
            raise HTTPException(status_code=404, detail="Recipe not found")
        if recipe.status == "approved":
            return {
                "recipe_id": str(recipe.id),
                "spec_id": str(recipe.spec_id),
                "status": "approved",
                "message": "Recipe already approved",
            }

        spec = recipe.specification
        if not spec:
            raise HTTPException(status_code=404, detail="Specification not found")

        existing_approved = (
            self.db.query(SpecificationSheet)
            .filter(
                SpecificationSheet.id != spec.id,
                SpecificationSheet.plant_id == spec.plant_id,
                SpecificationSheet.customer_id == spec.customer_id,
                SpecificationSheet.tube_size_id == spec.tube_size_id,
                SpecificationSheet.target_tube_weight == spec.target_tube_weight,
                SpecificationSheet.required_cs == spec.required_cs,
                SpecificationSheet.status == "approved",
            )
            .first()
        )
        if existing_approved:
            raise HTTPException(
                status_code=409,
                detail="An approved specification already exists for this customer, tube size, weight, and CS key",
            )

        recipe.status = "approved"
        recipe.approved_by = approved_by

        spec.status = "approved"
        spec.active = True
        spec.approved_by = approved_by

        approved_trial = next(
            (
                trial
                for trial in sorted(recipe.trials, key=lambda row: row.tested_at, reverse=True)
                if trial.approved and trial.actual_cs is not None
            ),
            None,
        )
        spec.approved_cs = float(approved_trial.actual_cs) if approved_trial else float(spec.required_cs or 0)

        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise HTTPException(
                status_code=409,
                detail="An approved specification already exists for this customer, tube size, weight, and CS key",
            ) from exc
        self.db.refresh(recipe)
        self.db.refresh(spec)

        return {
            "recipe_id": str(recipe.id),
            "spec_id": str(spec.id),
            "status": "approved",
            "approved_by": approved_by,
        }

    def obsolete_spec(self, spec_id: str) -> dict:
        spec_uuid = uuid.UUID(str(spec_id))
        spec = self.db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_uuid).first()
        if not spec:
            raise HTTPException(status_code=404, detail="Specification not found")

        spec.status = "obsolete"
        spec.active = False
        for recipe in spec.recipes:
            if recipe.status == "approved":
                recipe.status = "obsolete"

        self.db.commit()
        self.db.refresh(spec)

        return {
            "spec_id": str(spec.id),
            "status": "obsolete",
            "message": "Specification marked obsolete",
        }
