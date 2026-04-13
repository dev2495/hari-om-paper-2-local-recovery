import httpx
from typing import Dict, Optional
from ..config import get_settings

settings = get_settings()

class InventoryClient:
    """HTTP client to communicate with Inventory Service"""
    
    def __init__(self):
        self.base_url = settings.INVENTORY_SERVICE_URL
    
    async def get_item_details(self, item_id: str, token: str) -> Optional[Dict]:
        """Get item details from inventory service"""
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                response = await client.get(
                    f"{self.base_url}/items/{item_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5.0
                )
                if response.status_code == 200:
                    return response.json()
                return None
        except Exception as e:
            print(f"Error fetching item details: {e}")
            return None
    
    async def get_item_balance(self, item_id: str, token: str) -> Optional[float]:
        """Get current balance for an item"""
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                response = await client.get(
                    f"{self.base_url}/balance/{item_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5.0
                )
                if response.status_code == 200:
                    data = response.json()
                    return data.get("current_balance", 0.0)
                return None
        except Exception as e:
            print(f"Error fetching balance: {e}")
            return None
    
    async def deduct_stock(
        self, 
        item_id: str, 
        batch_id: Optional[str], 
        qty: float, 
        dispatch_ref: str,
        token: str
    ) -> Dict:
        """
        Deduct stock from inventory.
        
        Returns:
            {
                "success": bool,
                "message": str,
                "data": dict (response from inventory service)
            }
        """
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                payload = {
                    "item_id": item_id,
                    "batch_id": batch_id,
                    "qty": qty,
                    "dispatch_ref": dispatch_ref
                }
                
                response = await client.post(
                    f"{self.base_url}/dispatch/",
                    json=payload,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    return {
                        "success": True,
                        "message": "Stock deducted successfully",
                        "data": response.json()
                    }
                elif response.status_code == 400:
                    error_data = response.json()
                    return {
                        "success": False,
                        "message": error_data.get("detail", "Insufficient stock"),
                        "data": None
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Inventory service error: {response.status_code}",
                        "data": None
                    }
        except httpx.ConnectError:
            return {
                "success": False,
                "message": "Cannot connect to inventory service",
                "data": None
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"Error: {str(e)}",
                "data": None
            }
