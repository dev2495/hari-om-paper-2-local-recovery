#!/usr/bin/env python3
"""Spawn a long-running child process and print its PID.

The shell launcher redirects this script's stdout into a pidfile. Keep this
small and dependency-free so runtime startup does not depend on any hydrated
application modules.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: spawn_detached.py <logfile> <command...>", file=sys.stderr)
        return 2

    logfile = Path(sys.argv[1])
    command = sys.argv[2:]
    logfile.parent.mkdir(parents=True, exist_ok=True)

    with logfile.open("ab", buffering=0) as log:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=os.getcwd(),
            start_new_session=True,
            close_fds=True,
        )

    print(process.pid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
