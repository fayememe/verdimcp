#!/usr/bin/env python3
import json, os, sys, time

V = os.environ.get("VERDI_HOME", "/opt/synopsys/verdi/W-2024.09-SP1")
sys.path.insert(0, os.path.join(V, "share", "NPI", "python"))
from pynpi import npisys, waveform

OUT = os.path.dirname(os.path.abspath(__file__))
FSDB = "/home/faye/mydrv/aiwork/verdimcp/demo/bigfsdb/big.fsdb"
BINS = int(os.environ.get("BINS", "2000"))
MAX_SIGNALS = int(os.environ.get("MAX_SIGNALS", "128"))

t0 = time.perf_counter()
npisys.init(["pynpi"])
t1 = time.perf_counter()
fh = waveform.open(FSDB)
t2 = time.perf_counter()
scope = fh.top_scope_list()[0]
names = [s.full_name() for s in scope.sig_list() if s.full_name().startswith("tb_big.s")][:MAX_SIGNALS]
lo, hi = fh.min_time(), fh.max_time()
step = max(1, (hi - lo) // BINS)

samples = []
t3 = time.perf_counter()
for name in names:
    row = []
    for k in range(BINS):
        row.append(str(waveform.sig_value_at(fh, name, lo + k * step, waveform.VctFormat_e.HexStrVal)))
    samples.append((name, row))
t4 = time.perf_counter()

# Render a simple digital waveform: 0/1/X/Z on the LSB, bus rows labeled with the value at t=lo.
row_h = 12
label_w = 250
plot_w = BINS * 2
width = label_w + plot_w + 20
height = 60 + row_h * len(samples)
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">',
         '<rect width="100%" height="100%" fill="white"/>',
         f'<text x="8" y="24" font-size="14" font-family="monospace">big.fsdb — {len(samples)} signals × {BINS} bins — {lo}..{hi} ({fh.scale_unit()})</text>']
for r, (name, row) in enumerate(samples):
    y0 = 40 + r * row_h
    parts.append(f'<text x="8" y="{y0 + 9}" font-size="9" font-family="monospace">{name} = {row[0]}</text>')
    points = []
    for k, value in enumerate(row):
        x = label_w + k * 2
        text = value.lower()
        if "x" in text or "z" in text:
            y = y0 + row_h // 2
        else:
            y = y0 + (2 if text[-1] == "0" else row_h - 2)
        points.append(f"{x},{y}")
    color = "#cc0000" if any(("x" in v.lower() or "z" in v.lower()) for v in row) else "#0066cc"
    parts.append(f'<polyline points="{" ".join(points)}" fill="none" stroke="{color}" stroke-width="1"/>')
parts.append("</svg>")
svg = "\n".join(parts)
svg_path = os.path.join(OUT, "big_npi.svg")
png_path = os.path.join(OUT, "big_npi.png")
with open(svg_path, "w", encoding="utf-8") as handle:
    handle.write(svg)
t5 = time.perf_counter()

import subprocess
rc = subprocess.run(["convert", svg_path, png_path]).returncode
t6 = time.perf_counter()

waveform.close(fh)
npisys.end()

report = {
    "fsdb": FSDB,
    "signals": len(samples),
    "bins": BINS,
    "scale_unit": fh.scale_unit(),
    "time_range": [lo, hi],
    "timings": {
        "init": round(t1 - t0, 3),
        "open": round(t2 - t1, 3),
        "read": round(t4 - t3, 3),
        "render_svg": round(t5 - t4, 3),
        "convert_png": round(t6 - t5, 3),
        "total": round(t6 - t0, 3),
    },
    "svg_bytes": os.path.getsize(svg_path),
    "png_bytes": os.path.getsize(png_path) if os.path.exists(png_path) else 0,
    "convert_rc": rc,
}
with open(os.path.join(OUT, "npi_render.json"), "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
print(json.dumps(report, indent=2))
