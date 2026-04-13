import requests
import json
import time

BASE_URL = "http://localhost:4000/api"
INVENTORY_SERVICE_URL = "http://localhost:8005/api/v1" # Direct access for verify if needed, but BFF should suffice

def print_section(title):
    print(f"\n{'='*50}")
    print(f" {title}")
    print(f"{'='*50}\n")

def register_admin():
    print("Attempting to bootstrap Admin role and user...")
    
    # 1. Create Admin Role (Direct access to Auth Service, bypassing BFF limitation)
    try:
        r = requests.post("http://localhost:8001/roles/create", json={"name": "Admin"})
        print(f"Role creation: {r.status_code} {r.text}")
    except Exception as e:
        print(f"Role creation connection error (ignore if exists): {e}")

    # 2. Register User (Via BFF)
    try:
        payload = {
            "email": "admin@hariom.com",
            "password": "admin123",
            "name": "Admin User",
            "role_names": ["Admin"] 
        }
        r = requests.post(f"{BASE_URL}/auth/register", json=payload)
        if r.status_code in [200, 201]:
            print("Registration Successful.")
            return True
        else:
            print(f"Registration failed: {r.status_code} {r.text}")
            return False
    except Exception as e:
        print(f"Registration error: {e}")
        return False

def login():
    print("Logging in...")
    # Try logging in
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json={"email": "admin@hariom.com", "password": "admin123"})
        if r.status_code == 200:
            print("Login Successful.")
            return r.json().get("access_token")
    except Exception as e:
        print(f"Login connection error: {e}")
        return None
    
    # If failed, try registering then logging in
    print("Login failed. Trying to register admin...")
    if register_admin():
        try:
            r = requests.post(f"{BASE_URL}/auth/login", json={"email": "admin@hariom.com", "password": "admin123"})
            if r.status_code == 200:
                print("Login Successful after registration.")
                return r.json().get("access_token")
        except Exception:
            pass
            
    print("FATAL: Could not login. Exiting.")
    exit(1)

def verify_e2e():
    token = login()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    
    # 1. Seed Master Data
    print_section("STEP 1: Checking/Seeding Master Data")
    papers = [
        {"name": "Kraft 230", "gsm": 230, "type": "Kraft", "id_ref": "230"},
        {"name": "Kraft 301", "gsm": 301, "type": "Kraft", "id_ref": "301"},
        {"name": "Kraft 351", "gsm": 351, "type": "Kraft", "id_ref": "351"}
    ]
    
    paper_ids = {}
    for p in papers:
        # Check if exists or create
        # Naive create for now
        r = requests.post(f"{BASE_URL}/master/papers", json=p, headers=headers)
        if r.status_code in [200, 201]:
            pid = r.json()['id']
            paper_ids[p['gsm']] = pid
            print(f"Paper {p['name']} ID: {pid}")
        else:
            print(f"Failed to create paper {p['name']}: {r.status_code}")

    # Tube Size
    tube_size_id = None
    r = requests.post(f"{BASE_URL}/master/tube-sizes", json={"inner_dia": 110, "outer_dia": 122, "length": 150}, headers=headers)
    if r.status_code in [200, 201]:
        tube_size_id = r.json()['id']
        print(f"Tube Size ID: {tube_size_id}")

    # 2. Inward Stock
    print_section("STEP 2: Inward Stock (Raw Material)")
    batches = []
    # Inward 5000kg of each
    for gsm, pid in paper_ids.items():
        if not pid: continue
        batch_no = f"REEL-{gsm}-INIT"
        payload = {
            "item_id": pid,
            "batch_number": batch_no,
            "quantity": 5000,
            "type": "INWARD"
        }
        r = requests.post(f"{BASE_URL}/inventory/transactions", json=payload, headers=headers)
        if r.status_code in [200, 201]:
            print(f"Inwarded {batch_no}: 5000kg")
            batches.append({"batch": batch_no, "id": pid, "gsm": gsm})
        else:
            print(f"Failed Inward {batch_no}: {r.text}")

    # 3. Create Spec
    print_section("STEP 3: Create Specification")
    spec_id = None
    if tube_size_id and paper_ids.get(230) and paper_ids.get(301):
        spec_payload = {
            "customer_name": "Test Customer",
            "tube_size_id": tube_size_id,
            "target_cs": 450,
            "parchment_color_id": None, # Optional
            "adhesive_ratio": "20/80",
            "plies": [
                {"paper_id": paper_ids[230], "layers": 2},
                {"paper_id": paper_ids[301], "layers": 5},
                {"paper_id": paper_ids[351], "layers": 5}
            ]
        }
        r = requests.post(f"{BASE_URL}/spec/specifications", json=spec_payload, headers=headers)
        if r.status_code in [200, 201]:
            spec_id = r.json()['id']
            print(f"Created Spec ID: {spec_id}")
        else:
            print(f"Failed to create Spec: {r.text}")

    # 4. Run 5 Job Cards (Orders)
    if spec_id:
        print_section("STEP 4: Executing 5 Production Orders")
        for i in range(1, 6):
            print(f"\n--- Processing Order #{i} ---")
            
            # Setup Job Card Data
            # Assume 1000kg input, 900kg output
            job_payload = {
                "date": "2024-02-04",
                "shift": "Day",
                "machine_id": "M001", # Assume exists or ignored placeholder
                "spec_id": spec_id,
                "reels": [
                    {"batch_number": f"REEL-230-INIT", "weight": 200},
                    {"batch_number": f"REEL-301-INIT", "weight": 500},
                    {"batch_number": f"REEL-351-INIT", "weight": 500}
                ],
                "bamboo_qty": 0,
                "oven_in_weight": 1200,
                "oven_out_weight": 1150, # 50kg shrink
                "tubes_produced": 800 + (i * 10),
                "scrap_weight": 40,
                "cs_value": 455
            }
            
            r = requests.post(f"{BASE_URL}/production/job-cards", json=job_payload, headers=headers)
            if r.status_code in [200, 201]:
                print(f"Job Card #{i} Created. Produced: {job_payload['tubes_produced']} Tubes.")
            else:
                print(f"Job Card #{i} Failed: {r.text}")

    # 5. Dispatch
    print_section("STEP 5: Dispatching Goods")
    # Identify FG Items (Production Service likely creates FG items in Inventory)
    # List Inventory Items of type FG
    r = requests.get(f"{BASE_URL}/inventory/items", headers=headers)
    r = requests.get(f"{BASE_URL}/inventory/items", headers=headers)
    if r.status_code == 200:
        fg_items = [x for x in r.json() if x.get('type') == 'FG']
    else:
        print(f"Failed to fetch inventory items: {r.status_code}")
        fg_items = []
    
    if fg_items:
        fg_id = fg_items[0]['id']
        print(f"Found FG Item: {fg_items[0]['name']} (Qty: {fg_items[0]['quantity']})")
        
        dispatch_payload = {
            "customer_id": "CUST-001", # Mock
            "item_id": fg_id,
            "quantity": 200,
            "status": "SHIPPED"
        }
        r = requests.post(f"{BASE_URL}/dispatch/dispatches", json=dispatch_payload, headers=headers)
        if r.status_code in [200, 201]:
            print("Dispatch Created Successfully (200 Qty).")
        else:
            print(f"Dispatch Failed: {r.text}")
    else:
        print("No Finished Goods found in Inventory to dispatch.")

    # 6. Report Inward Stock
    print_section("STEP 6: Validating Final Stock Balance")
    r = requests.get(f"{BASE_URL}/inventory/items", headers=headers)
    items = r.json()
    
    print(f"{'Item Name':<30} | {'Type':<10} | {'Stock':>10}")
    print("-" * 60)
    for i in items:
        print(f"{i.get('name', 'Unknown'):<30} | {i.get('type', 'N/A'):<10} | {i.get('quantity', 0):>10}")
    
    print("\nVerification Complete.")

if __name__ == "__main__":
    verify_e2e()
