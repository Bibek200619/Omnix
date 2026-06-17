# Backend Migrations

Omnix now uses Alembic to track database migration state.

The existing SQL files in `backend/migrations/` are historical migrations. They
must not be replayed by Alembic. The first Alembic revision,
`0045_existing_sql_baseline`, is an empty baseline used to stamp databases that
already have the historical SQL migrations applied through
`0045_add_file_content_hash.sql`.

## Historical Filename Corrections

The raw SQL migration set originally contained two `0032_*` files:

- `0032_conversation_ambient_identity.sql`
- `0032_workspace_operational_initiatives.sql`

To keep raw migration identifiers unique without renumbering later historical
files, `0032_workspace_operational_initiatives.sql` is now recorded as
`0032b_workspace_operational_initiatives.sql`. The SQL body is unchanged. If an
environment tracks raw SQL filenames outside Alembic, treat the `0032b_*` file
as the same historical migration previously named `0032_workspace_operational_initiatives.sql`.

## Required Database URL

Alembic reads the database URL from one of these environment variables:

- `DATABASE_URL`
- `OMNIX_DATABASE_URL`
- `SUPABASE_DB_URL`
- `POSTGRES_URL`

Use the direct Postgres connection string for the configured Supabase/Postgres
project. The Supabase REST URL is not a SQLAlchemy database URL.

## Existing Databases

For an existing database that already has all raw SQL migrations applied:

```bash
cd backend
DATABASE_URL="postgresql+psycopg://..." alembic stamp head
DATABASE_URL="postgresql+psycopg://..." alembic current
```

`stamp head` records the Alembic baseline without running historical SQL.

## New Migrations

Create future migrations with Alembic:

```bash
cd backend
DATABASE_URL="postgresql+psycopg://..." alembic revision -m "describe change"
```

Edit the generated file in `backend/alembic/versions/`, then apply it:

```bash
cd backend
DATABASE_URL="postgresql+psycopg://..." alembic upgrade head
```

Production API startup runs `alembic upgrade head` before launching `uvicorn`.
Set `OMNIX_SKIP_ALEMBIC=1` only for emergency diagnostics where schema changes
are intentionally managed out of band.
