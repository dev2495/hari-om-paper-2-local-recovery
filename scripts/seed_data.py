import requests
import json

BASE_URL = "http://localhost:4000/api" # BFF URL

def seed_master_data():
    print("Seeding Master Data...")
    
    # Paper
    paper_230 = {"name": "Kraft 230", "gsm": 230, "type": "Kraft"}
    paper_301 = {"name": "Kraft 301", "gsm": 301, "type": "Kraft"}
    paper_351 = {"name": "Kraft 351", "gsm": 351, "type": "Kraft"}
    
    p230_id = None
    
    try:
        # Create or Get Papers
        # NOTE: This is naive, assumes empty or allows duplicates. 
        # Ideally we check existence first or the backend handles idempotency.
        r = requests.post(f"{BASE_URL}/master/papers", json=paper_230)
        p230_id = r.json().get('id')
        requests.post(f"{BASE_URL}/master/papers", json=paper_301)
        requests.post(f"{BASE_URL}/master/papers", json=paper_351)
        print("Papers seeded.")
    except Exception as e:
        print(f"Error seeding papers: {e}")

    # Tube Size
    size = {"inner_dia": 110, "outer_dia": 122, "length": 150}
    try:
        requests.post(f"{BASE_URL}/master/tube-sizes", json=size)
        print("Tube Size seeded.")
    except Exception as e:
        print(f"Error seeding tube size: {e}")

    return p230_id

def seed_inventory(p230_id):
    print("Seeding Inventory...")
    # Add Reel Batches
    batches = [
        {"item_id": p230_id, "batch_number": "REEL-230-001", "quantity": 500, "type": "INWARD"},
        {"item_id": p230_id, "batch_number": "REEL-301-001", "quantity": 500, "type": "INWARD"},
        {"item_id": p230_id, "batch_number": "REEL-351-001", "quantity": 500, "type": "INWARD"}
    ]
    
    for b in batches:
        try:
            requests.post(f"{BASE_URL}/inventory/transactions", json=b)
        except Exception as e:
            print(f"Error seeding inventory batch {b['batch_number']}: {e}")
    print("Inventory seeded.")

if __name__ == "__main__":
    # Note: Requires BFF and Services to be running.
    # This is a template script.
    # p230_id = seed_master_data()
    # if p230_id:
    #     seed_inventory(p230_id)
    print("Please run this script when servers are active.")
