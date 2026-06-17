#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  set -- uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
fi

if [ "${OMNIX_SKIP_ALEMBIC:-0}" != "1" ]; then
  alembic upgrade head
fi

exec "$@"
