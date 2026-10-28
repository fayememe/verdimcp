#!/usr/bin/env python3
import json, os, subprocess, sys, time

CLI = os.path.expanduser("~/.local/bin/verdi-session")
OUT = os.path.dirname(os.path.abspath(__file__))
FSDB = "/home/faye/mydrv/aiwork/verdimcp/demo/bigfsdb/big.fsdb"
DISPLAY = os.environ.get("DISPLAY", "localhost:10.0")
XAUTH = os.environ.get("XAUTHORITY", os.path.expanduser("~/.Xauthority"))


def sessions():
    out = subprocess.check_output([CLI, "list", "--json"], text=True)
    return json.loads(out)


def run(sid, cmds):
    cmd = [CLI, "exec", "--id", sid, "--json", "--", *cmds]
    p = subprocess.run(cmd, text=True, capture_output=True)
    rows = []
    for line in p.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return p.returncode, rows, p.stderr


def result(rows, idx=-1):
    results = [r for r in rows if r.get("type") == "result"]
    if not results:
        return None
    return results[idx].get("result", "")


def quote(name):
    return "{" + name + "}" if any(c in name for c in "[]{} $\\") else name


def main():
    session = next(s for s in sessions() if s.get("label") == "big" and s.get("state") == "up")
    sid = session["id"]
    timings = {}
    log = []

    def step(name, cmds):
        t0 = time.perf_counter()
        rc, rows, err = run(sid, cmds)
        dt = time.perf_counter() - t0
        timings[name] = round(dt, 3)
        log.append({"step": name, "seconds": round(dt, 3), "rc": rc, "rows": rows, "stderr": err})
        return rows

    rows = step("create_window", ["wvCreateWindow"])
    wid = result(rows, -1)
    if not wid or wid == "0":
        raise SystemExit(f"wvCreateWindow failed: {rows}")
    log.append({"window_id": wid})

    step("open_fsdb", [f"wvOpenFile -win {wid} {FSDB}"])
    step("dump_signal_list", [f"wvDumpSignalListToFile -win {wid} -signal -delim / -file {OUT}/big_signals.txt"])
    with open(f"{OUT}/big_signals.txt", encoding="utf-8") as handle:
        signals = [line.strip() for line in handle if line.strip()]
    data_signals = [s for s in signals if "/tb_big/s" in s][:128]
    if len(data_signals) != 128:
        raise SystemExit(f"expected 128 data signals, got {len(data_signals)}")

    add_cmd = f"wvAddSignal -win {wid} " + " ".join(quote(s) for s in data_signals)
    step("add_128_signals", [add_cmd])
    step("zoom_full", [f"wvZoom -win {wid} 0 5000000000"])
    step("view_range", [f"wvGetViewTimeRange -win {wid}"])
    rows = step("xid", [f"wvGetXWindowId -id {wid}"])
    xid = result(rows, -1)

    t0 = time.perf_counter()
    png = f"{OUT}/big_gui.png"
    rc = subprocess.run(["import", "-window", f"0x{xid}", png],
                        env={**os.environ, "DISPLAY": DISPLAY, "XAUTHORITY": XAUTH}).returncode
    timings["screenshot"] = round(time.perf_counter() - t0, 3)
    log.append({"step": "screenshot", "seconds": timings["screenshot"], "rc": rc, "path": png})

    timings["operation_total"] = round(sum(v for k, v in timings.items() if k != "operation_total"), 3)
    report = {"session_id": sid, "pid": session.get("pid"), "timings": timings,
              "signal_count": len(data_signals), "signals_file": f"{OUT}/big_signals.txt",
              "screenshot": png, "log": log}
    with open(f"{OUT}/gui_proxy.json", "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({k: report[k] for k in ("session_id", "pid", "timings", "signal_count")}, indent=2))


if __name__ == "__main__":
    main()
