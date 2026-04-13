import requests
import json
import time
from datetime import date

BASE_URL = "http://localhost:4000/api"
TS = int(time.time())

def print_section(title):
    print(f"\n{'='*50}")
    print(f" {title}")
    print(f"{'='*50}\n")

def bootstrap_admin():
    print("Bootstrapping Admin...")
    # 1. Create Role
    try:
        requests.post("http://localhost:8001/roles/create", json={"name": "Admin"})
        requests.post("http://localhost:8001/roles/create", json={"name": "Production"})
        requests.post("http://localhost:8001/roles/create", json={"name": "Store"})
        requests.post("http://localhost:8001/roles/create", json={"name": "Dispatch"})
    except: pass

    # 2. Register
    payload = {
        "email": f"admin_{TS}@hariom.com",
        "password": "admin123",
        "name": f"Admin User {TS}",
        "role_names": ["Admin", "Production", "Store", "Dispatch"]
    }
    requests.post(f"{BASE_URL}/auth/register", json=payload)

def login():
    print("Logging in...")
    bootstrap_admin()
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json={"email": f"admin_{TS}@hariom.com", "password": "admin123"})
        if r.status_code == 200:
            return r.json().get("access_token")
    except Exception as e:
        print(f"Login failed: {e}")
    return None

def verify():
    token = login()
    if not token:
        print("Auth failed.")
        return
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Master Data
    print_section("1. Master Data Seeding")
    
    # Machine
    r = requests.post(f"{BASE_URL}/master/machines", json={"name": f"Machine {TS}", "department": "Winding"}, headers=headers)
    if r.status_code not in [200, 201]:
        print(f"Machine creation failed: {r.status_code} {r.text}")
        return
    m_id = r.json()['id']
    print(f"Machine: {r.status_code}")
    
    # Mandrel
    r = requests.post(f"{BASE_URL}/master/mandrels", json={
        "mandrel_code": f"M-{TS}",
        "outer_diameter_mm": 110,
        "length_mm": 3000
    }, headers=headers)
    if r.status_code not in [200, 201]:
        print(f"Mandrel creation failed: {r.status_code} {r.text}")
        return
    mandrel_id = r.json()['id']
    print(f"Mandrel: {r.status_code}")
    
    # Tube Size
    r = requests.post(f"{BASE_URL}/master/tube-sizes", json={
        "inner_diameter_mm": 110,
        "outer_diameter_mm": 120,
        "length_mm": 1000
    }, headers=headers)
    if r.status_code not in [200, 201]:
        # If tube size exists, just get it
        r_list = requests.get(f"{BASE_URL}/master/tube-sizes", headers=headers)
        tube_id = r_list.json()[0]['id']
    else:
        tube_id = r.json()['id']
    print(f"Tube Size: {tube_id}")
    
    # Papers (3 types)
    papers = []
    for gsm in [230, 301, 351]:
        r = requests.post(f"{BASE_URL}/master/papers", json={"gsm": gsm, "strength_type": "BF", "strength_value": 18}, headers=headers)
        if r.status_code not in [200, 201]:
            # If exists, fetch all and filter
            r_all = requests.get(f"{BASE_URL}/master/papers", headers=headers)
            match = [p for p in r_all.json() if p['gsm'] == gsm]
            if match:
                papers.append(match[0])
                continue
            else:
                print(f"Paper {gsm} creation failed and not found: {r.status_code} {r.text}")
                return
        papers.append(r.json())
        print(f"Paper {gsm}: {r.status_code}")

    # 2. Inventory Inward
    print_section("2. Inventory Inward")
    for p in papers:
        payload = {
            "item_id": p['id'],
            "batch_no": f"BATCH-{p['gsm']}-{TS}",
            "qty": 5000.0,
            "location": "MAIN_WH"
        }
        r = requests.post(f"{BASE_URL}/inventory/inward", json=payload, headers=headers)
        print(f"Inward {p['gsm']} GSM: {r.status_code}")

    # 3. Specification & Recipe
    print_section("3. Specification & Recipe")
    spec_payload = {
        "customer_name": f"Antigravity_{TS}",
        "tube_size_id": tube_id,
        "mandrel_id": mandrel_id,
        "required_cs": 450.0
    }
    r = requests.post(f"{BASE_URL}/spec/specifications", json=spec_payload, headers=headers)
    print(f"Spec Creation: {r.status_code}")
    spec_id = r.json()['id']
    
    # Create Recipe (Trial)
    recipe_payload = {
        "notes": f"Trial {TS}"
    }
    r = requests.post(f"{BASE_URL}/spec/recipes/{spec_id}", json=recipe_payload, headers=headers)
    print(f"Recipe Creation: {r.status_code}")
    recipe_id = r.json()['id']
    
    # 4. Production Job
    print_section("4. Production Job")
    job_payload = {
        "date": str(date.today()),
        "shift": "Day",
        "spec_id": spec_id,
        "recipe_id": recipe_id,
        "operator_name": "John Doe",
        "mandrel_id": mandrel_id,
        "total_reel_weight_issued": 1000.0,
        "bamboo_produced_qty": 100,
        "tubes_produced_qty": 800,
        "oven_input_weight": 950.0,
        "oven_output_weight": 900.0,
        "finished_weight": 850.0
    }
    r = requests.post(f"{BASE_URL}/production/jobs", json=job_payload, headers=headers)
    print(f"Job Creation: {r.status_code} {r.text if r.status_code != 200 else 'SUCCESS'}")
    job_id = r.json()['id'] if r.status_code == 200 else None
    
    # 5. Inventory FG Inward
    print_section("5. FG Inward")
    # Create an FG item first in Inventory (as ItemMaster)
    r = requests.post(f"{BASE_URL}/inventory/items", json={
        "item_code": f"FG-{TS}",
        "name": f"Tube {TS}",
        "type": "FINISHED_GOOD",
        "uom": "PCS"
    }, headers=headers)
    fg_id = r.json()['id']
    
    payload = {
        "item_id": fg_id,
        "batch_no": f"LOT-{TS}",
        "qty": 800.0,
        "production_job_id": job_id if job_id else fg_id
    }
    r = requests.post(f"{BASE_URL}/inventory/fg-inward", json=payload, headers=headers)
    print(f"FG Inward: {r.status_code}")

    # 6. Dispatch
    print_section("6. Dispatch")
    dispatch_payload = {
        "dispatch_date": str(date.today()),
        "customer_name": f"Cust_{TS}",
        "items": [
            {
                "item_id": fg_id,
                "qty": 200.0
            }
        ]
    }
    r = requests.post(f"{BASE_URL}/dispatch/dispatches", json=dispatch_payload, headers=headers)
    print(f"Dispatch: {r.status_code} {r.text if r.status_code != 200 else 'SUCCESS'}")

    # 7. Final Balance
    print_section("7. Final Stock Balance")
    r = requests.get(f"{BASE_URL}/inventory/balance", headers=headers)
    if r.status_code == 200:
        items = r.json().get('items', [])
        print(f"{'Item':<25} | {'Stock':<10}")
        print("-" * 40)
        for item in items:
            bal = item.get('balance', item.get('current_balance', 0))
            print(f"{item['name']:<25} | {bal:<10}")


if __name__ == "__main__":
    verify()
