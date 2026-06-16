#!/bin/bash
set -e

echo "Starting/Scaling Omnix Workers..."

WORKERS=${1:-1}

# Scale ingestion workers using docker-compose
docker-compose -f docker-compose.prod.yml up --scale ingestion-worker=$WORKERS -d ingestion-worker

echo "Workers scaled to $WORKERS. Check status with ./scripts/runtime_status.py"
