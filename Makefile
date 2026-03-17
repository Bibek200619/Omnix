.PHONY: dev build test lint clean docker-up docker-down migrate

dev:
	cd backend && venv/bin/uvicorn app.main:app --reload

backend:
	cd backend && venv/bin/uvicorn app.main:app

worker:
	cd backend && venv/bin/python -m app.automation.scheduler

docker-up:
	docker-compose up --build

docker-down:
	docker-compose down

test:
	cd backend && venv/bin/pytest

lint:
	cd backend && venv/bin/ruff check .
	cd frontend && npm run lint

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +

migrate:
	@echo "Running migrations..."
	# Add migration command here
