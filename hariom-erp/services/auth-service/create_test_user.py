import httpx
import asyncio

async def create_user():
    url = "http://localhost:8001"
    
    # First, login as admin to get token (you'll need to create admin first via direct SQL)
    # For now, let's show you the available endpoints
    
    async with httpx.AsyncClient() as client:
        # Check health
        print("\n=== Auth Service Health ===")
        response = await client.get(f"{url}/")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        # Check roles endpoint
        print("\n=== Available Roles ===")
        response = await client.get(f"{url}/roles/")
        print(f"Status: {response.status_code}")
        print(f"Roles: {response.json()}")
        
        # Check master data service health
        master_url = "http://localhost:8002"
        print("\n=== Master Data Service Health ===")
        response = await client.get(f"{master_url}/")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")

if __name__ == "__main__":
    asyncio.run(create_user())
