#!/bin/bash

# Ensure we are in the project root
echo "Starting Backend Services (Docker)..."
cd hariom-erp || exit
docker compose up -d --build

echo "Waiting for Backend (30s)..."
sleep 30

echo "Navigate to BFF..."
cd ../apps/bff-api || exit

echo "Installing BFF dependencies..."
pip install -r requirements.txt

echo "Starting BFF API (Background)..."
# Check if uvicorn is installed, if not try pip module
if ! command -v uvicorn &> /dev/null; then
    python3 -m uvicorn src.main:app --port 4000 &
else
    uvicorn src.main:app --port 4000 &
fi
BFF_PID=$!

echo "Waiting for BFF (5s)..."
sleep 5

echo "Running Verification Script..."
cd ../../scripts || exit
python3 verify_phase_6_1_fixed.py

echo "Stopping BFF..."
kill $BFF_PID
echo "Done."
