import requests
from fastapi import HTTPException
from typing import Optional, Dict, Any, List

def service_get(
    url: str,
    token: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
    plant_id: Optional[str] = None,
    required: bool = False,
):
    headers = {"Authorization": f"Bearer {token}"}
    if plant_id:
        headers["X-Plant-ID"] = plant_id
    try:
        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        if required:
            raise HTTPException(status_code=502, detail=f"Upstream service unavailable: {exc}") from exc
        return None
    if response.status_code != 200:
        if required:
            detail = (response.text or "").strip()
            raise HTTPException(
                status_code=502,
                detail=f"Upstream service returned {response.status_code}: {detail[:240]}",
            )
        return None
    try:
        return response.json()
    except ValueError as exc:
        if required:
            raise HTTPException(status_code=502, detail="Upstream service returned malformed JSON") from exc
        return None

def scope_plant_ids(scope: dict) -> List[str]:
    if scope.get("scope_all"):
        return list(scope.get("allowed_plants") or [])
    selected = scope.get("selected_plant_id")
    return [selected] if selected else []
