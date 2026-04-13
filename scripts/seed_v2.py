import requests
import jwt
import datetime
import uuid

# Configuration
BFF_URL = "http://localhost:24000/api"
JWT_SECRET = "hariom-secret-key-123"

def generate_token(plant_id, role="Owner"):
    payload = {
        "sub": "admin@hariom.com",
        "name": "Admin User",
        "role": role,
        "roles": [role, "Admin"],
        "plant_id": plant_id,
        "permissions": ["*"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def seed_plant(plant_id):
    print(f"\n--- Seeding Data for {plant_id} ---")
    token = generate_token(plant_id)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Plant-ID": plant_id,
        "Content-Type": "application/json"
    }

    # 1. Papers
    papers = [
        {"gsm": 180, "strength_type": "BF", "strength_value": 18},
        {"gsm": 230, "strength_type": "BF", "strength_value": 20},
    ] if plant_id == "PLANT-1" else [
        {"gsm": 250, "strength_type": "BF", "strength_value": 22},
        {"gsm": 300, "strength_type": "BF", "strength_value": 24},
    ]

    for p in papers:
        try:
            resp = requests.post(f"{BFF_URL}/master/papers", json=p, headers=headers)
            if resp.status_code in [200, 201]:
                print(f"  [OK] Seeded Paper: {p['gsm']} GSM")
            else:
                print(f"  [FAIL] Paper {p['gsm']}: {resp.status_code} - {resp.text}")
        except Exception as e:
            print(f"  [ERROR] Paper {p['gsm']}: {e}")

    # 2. Adhesives
    adhesives = [
        {"name": f"Adhesive A - {plant_id}", "internal_code": f"ADH-A-{plant_id}"},
        {"name": f"Adhesive B - {plant_id}", "internal_code": f"ADH-B-{plant_id}"},
    ]
    for a in adhesives:
        try:
            resp = requests.post(f"{BFF_URL}/master/adhesives", json=a, headers=headers)
            if resp.status_code in [200, 201]:
                print(f"  [OK] Seeded Adhesive: {a['name']}")
        except Exception as e:
            print(f"  [ERROR] Adhesive {a['name']}: {e}")

    # 3. Tube Sizes
    sizes = [
        {"inner_diameter_mm": 50, "outer_diameter_mm": 55, "length_mm": 500, "description": "Small Tube"},
        {"inner_diameter_mm": 100, "outer_diameter_mm": 110, "length_mm": 1000, "description": "Large Tube"},
    ]
    for s in sizes:
        try:
            resp = requests.post(f"{BFF_URL}/master/tube-sizes", json=s, headers=headers)
            if resp.status_code in [200, 201]:
                print(f"  [OK] Seeded Tube Size: {s['inner_diameter_mm']}x{s['outer_diameter_mm']}")
        except Exception as e:
            print(f"  [ERROR] Tube Size: {e}")

if __name__ == "__main__":
    print("Starting Multi-Plant Seeding...")
    seed_plant("PLANT-1")
    seed_plant("PLANT-2")
    print("\nSeeding Complete!")
