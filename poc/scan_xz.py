#!/usr/bin/env python3
"""Prototype X/Z scan over a signal list at sampled times, via cmdclient."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIENT = HERE / "cmdclient"
SIGNALS = HERE / "evidence" / "signals.txt"
TIMES = list(range(0, 2001, 25))


def port_for(label):
    reg = Path.home() / ".local/state/verdi-sessions"
    for p in reg.glob("*.json"):
        e = json.loads(p.read_text())
        if e.get("label") == label and e.get("state", "up") == "up":
            return e["port"], e["port"]
    raise SystemExit(f"no session labelled {label}")


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "p3design"
    port, _ = port_for(label)
    win = sys.argv[2] if len(sys.argv) > 2 else None
    if not win:
        raise SystemExit("usage: scan_xz.py <label> <window-id>")
    sigs = [s.strip() for s in SIGNALS.read_text().splitlines() if s.strip()]
    cmds = []
    meta = []
    for s in sigs:
        for t in TIMES:
            cmd = f"wvGetSigValueByTime -win {win} {{{s}}} -time {t} -format Bin -lz"
            cmds.append(cmd)
            meta.append((s, t))
    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = "/opt/synopsys/verdi/W-2024.09-SP1/share/libcmd/linux64" + (
        ":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else ""
    )
    r = subprocess.run([str(CLIENT), str(port)] + cmds, capture_output=True, text=True, env=env)
    hits = []
    total = 0
    for line, (sig, t) in zip(r.stdout.splitlines(), meta):
        if not line.startswith("OK\t"):
            continue
        val = line.split("\t", 2)[2]
        total += 1
        if re.search(r"[xzXZ]", val):
            hits.append((sig, t, val))
    print(f"queried {total} values, {len(hits)} with X/Z")
    for sig, t, val in hits[:60]:
        print(f"{t:>6} ns  {sig:<40} {val}")
    if len(hits) > 60:
        print(f"... {len(hits) - 60} more")


if __name__ == "__main__":
    main()
