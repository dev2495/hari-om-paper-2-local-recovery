import requests
from fastapi import HTTPException
from typing import Optional, Dict, Any, List

def service_get(
    url: str,
    token: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 10.0,
    plant_id: Optional[str] = None,
):
    headers = {"Authorization": f"Bearer {token}"}
    if plant_id:
        headers["X-Plant-ID"] = plant_id
    response = requests.get(
        url,
        params=params,
        headers=headers,
        timeout=timeout,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Downstream service failed: {url}")
    return response.json()

def scope_plant_ids(scope: dict) -> List[str]:
    if scope.get("scope_all"):
        return list(scope.get("allowed_plants") or [])
    selected = scope.get("selected_plant_id")
    return [selected] if selected else []
