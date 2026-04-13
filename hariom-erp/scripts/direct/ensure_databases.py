#!/usr/bin/env python3
"""Create required ERP databases when running services directly (non-Docker mode)."""

from __future__ import annotations

import argparse
import getpass
import sys

import psycopg2
from psycopg2 import sql


DEFAULT_DATABASES = [
    "authdb",
    "masterdb",
    "specdb",
    "salesdb",
    "productiondb",
    "inventorydb",
    "analyticsdb",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ensure required ERP databases exist.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=5432, type=int)
    parser.add_argument("--user", default=getpass.getuser())
    parser.add_argument("--password", default="")
    parser.add_argument("--admin-db", default="postgres")
    parser.add_argument("--databases", nargs="+", default=DEFAULT_DATABASES)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        conn = psycopg2.connect(
            host=args.host,
            port=args.port,
            user=args.user,
            password=args.password,
            dbname=args.admin_db,
        )
    except Exception as exc:  # pragma: no cover - script error path
        print(f"[db] failed to connect to PostgreSQL ({args.host}:{args.port}/{args.admin_db}): {exc}")
        return 1

    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for db_name in args.databases:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
                exists = cur.fetchone() is not None
                if exists:
                    print(f"[db] exists: {db_name}")
                    continue
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))
                print(f"[db] created: {db_name}")
    except Exception as exc:  # pragma: no cover - script error path
        print(f"[db] failed while checking/creating databases: {exc}")
        return 1
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
