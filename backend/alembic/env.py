from __future__ import annotations

from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None
DATABASE_URL_ENV_VARS = ("DATABASE_URL", "OMNIX_DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL")


def database_url() -> str:
    for name in DATABASE_URL_ENV_VARS:
        value = os.getenv(name)
        if value:
            return value

    configured = config.get_main_option("sqlalchemy.url")
    if configured and not configured.startswith("driver://"):
        return configured

    raise RuntimeError(
        "Alembic requires DATABASE_URL, OMNIX_DATABASE_URL, SUPABASE_DB_URL, "
        "or POSTGRES_URL to point at the configured Postgres database."
    )


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = database_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
