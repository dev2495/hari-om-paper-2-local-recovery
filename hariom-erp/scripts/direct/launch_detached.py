#!/usr/bin/env python3
"""Launch a service outside the caller's process group and write its PID.

The desktop command runner can clean up children that remain in its process
group after a shell command exits. Popen(start_new_session=True) creates the
same practical behavior we need from setsid/daemon without requiring those
platform tools to exist on macOS.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch a detached runtime process")
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--pidfile", required=True)
    parser.add_argument("--logfile", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("command is required after --")
    return args


def main() -> int:
    args = parse_args()
    cwd = Path(args.cwd).resolve()
    pidfile = Path(args.pidfile)
    logfile = Path(args.logfile)
    pidfile.parent.mkdir(parents=True, exist_ok=True)
    logfile.parent.mkdir(parents=True, exist_ok=True)

    with logfile.open("wb") as log:
        process = subprocess.Popen(
            args.command,
            cwd=str(cwd),
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            close_fds=True,
            start_new_session=True,
        )

    pidfile.write_text(f"{process.pid}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
