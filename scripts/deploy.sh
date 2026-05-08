#!/bin/bash
set -e

echo "Deploying Omnix AI Platform to Production..."

# Pull latest code
echo "Pulling latest code..."
git pull origin main

# Build and start services
echo "Building and starting Docker containers..."
docker-compose -f docker-compose.prod.yml up --build -d

# Verify health
echo "Waiting for backend to be healthy..."
sleep 15
./scripts/healthcheck.sh

echo "Deployment complete."
