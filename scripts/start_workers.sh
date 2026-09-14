#!/bin/bash
set -e

echo "Starting/Scaling Omnix Workers..."

WORKERS=${1:-1}

# Scale ordinary ingestion capacity and ensure one bounded OCR worker is running.
docker-compose -f docker-compose.prod.yml up --scale ingestion-worker=$WORKERS --scale ocr-worker=1 -d ingestion-worker ocr-worker

echo "Ingestion workers scaled to $WORKERS; OCR worker pinned to 1. Check status with ./scripts/runtime_status.py"
