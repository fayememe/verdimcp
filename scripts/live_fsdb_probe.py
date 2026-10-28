#!/usr/bin/env python3
"""Probe an FSDB while a simulation is still writing it.

One-shot NPI worker per sample (fresh open, ~3 s init) so every sample sees the
file as it is on disk. Writes one JSON line per sample to stdout.
"""

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORKER = os.path.join(ROOT, "mcp", "npi", "npi_worker.py")


def query(payload, timeout=120):
    started = time.time()
    proc = subprocess.run(
        [sys.executable, WORKER],
        input=json.dumps(payload) + "\n",
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    elapsed = time.time() - started
    result = None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "ok" in candidate:
                result = candidate
    return result, round(elapsed, 3), proc.returncode


def pid_alive(pid):
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fsdb", required=True)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--interval", type=float, default=3.0)
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--signal", default="tb_grow.sig0")
    parser.add_argument("--stats-every", type=int, default=3)
    args = parser.parse_args()

    for index in range(args.samples):
        while pid_alive(args.pid) and not os.path.exists(args.fsdb):
            time.sleep(0.2)
        if not os.path.exists(args.fsdb):
            print(json.dumps({"sample": index, "error": "fsdb missing"}), flush=True)
            break

        size = os.path.getsize(args.fsdb)
        info, info_sec, _ = query({"action": "info", "fsdb": args.fsdb})
        if args.stats_every and index % args.stats_every == 0:
            stats, stats_sec, _ = query(
                {
                    "action": "change_stats",
                    "fsdb": args.fsdb,
                    "signals": [args.signal],
                    "format": "Hex",
                }
            )
        else:
            stats, stats_sec = None, 0.0
        row = {
            "sample": index,
            "sim_alive": pid_alive(args.pid),
            "fsdb_bytes": size,
            "info_ok": bool(info and info.get("ok")),
            "info": (info or {}).get("data"),
            "info_error": (info or {}).get("error"),
            "info_seconds": info_sec,
            "stats_ok": bool(stats and stats.get("ok")),
            "stats": (stats or {}).get("data"),
            "stats_error": (stats or {}).get("error"),
            "stats_seconds": stats_sec,
        }
        print(json.dumps(row), flush=True)
        if not pid_alive(args.pid):
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
