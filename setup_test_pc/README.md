# Hari Om ERP - Tester PC Setup

This folder is for moving the project to another Mac/PC and starting it with minimum manual steps.

## What Copies With The Project

The source code, migrations, setup scripts, UI, backend services, and local reports are normal files. They copy with the project folder.

The live PostgreSQL data does not copy automatically. If the tester needs the exact same local demo data, export the DB dump from this machine first and import it on the other machine.

## Prerequisites

- Python 3.11
- Node.js 18
- PostgreSQL 14+
- npm
- curl
- pg_dump and pg_restore

On macOS with Homebrew:

```bash
brew install python@3.11 node@18 postgresql@14
brew services start postgresql@14
```

If Node 18 is not installed in `/opt/homebrew/opt/node@18/bin`, set `NODE18_BIN` before setup/start:

```bash
export NODE18_BIN="/path/to/node18/bin"
```

## On This Mac: Export Data Before Copying

Run from the project root:

```bash
bash setup_test_pc/export_db_dump.sh
```

This creates `setup_test_pc/db_dumps/hariom_erp_latest.dump`.

Then copy the whole project folder to the other PC, including `setup_test_pc/db_dumps` if you want the same demo data.

## On Other PC: First-Time Setup

Run from the copied project root:

```bash
bash setup_test_pc/setup_once.sh
```

If you copied a DB dump and want the same data:

```bash
bash setup_test_pc/import_db_dump.sh
```

Then start:

```bash
bash setup_test_pc/start_for_tester.sh
```

Open:

```text
http://127.0.0.1:13000/login
```

Default login:

```text
admin@hariom.com
admin123
```

## Daily Start/Stop

Start:

```bash
bash setup_test_pc/start_for_tester.sh
```

Status:

```bash
bash setup_test_pc/status_for_tester.sh
```

Stop:

```bash
bash setup_test_pc/stop_for_tester.sh
```

## Notes

- `start_for_tester.sh` builds the web app and starts all services in direct runtime mode.
- Runtime logs are under `hariom-erp/runtime/logs`.
- If ports are busy, the root `start_all.sh` auto-selects nearby free ports and prints the final URL.
- If the tester imports a dump, it will replace the target local ERP databases listed in `db_names.txt`.
