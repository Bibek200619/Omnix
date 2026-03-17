#!/bin/bash
set -e

API_URL=${1:-"http://localhost:8000"}

echo "Checking Liveness..."
curl -f "$API_URL/health/live"

echo -e "\n\nChecking Readiness..."
curl -f "$API_URL/health/ready"

echo -e "\n\nBackend is healthy!"
