#!/usr/bin/env python3
"""NPI query worker for verdi-mcp.

Two modes:
  npi_worker.py            one-shot: read one JSON request on stdin, print one JSON result
  npi_worker.py --serve    resident: one JSON request per stdin line, one JSON result per
                           stdout line; the FSDB handle stays open (npisys.init ~3 s once)

All diagnostics go to stderr; stdout stays machine-readable.
"""

import contextlib
import json
import os
import sys

VERDI_HOME = os.environ.get("VERDI_HOME", "/opt/synopsys/verdi/W-2024.09-SP1")
NPI_PYTHON = os.path.join(VERDI_HOME, "share", "NPI", "python")
if NPI_PYTHON not in sys.path:
    sys.path.insert(0, NPI_PYTHON)

UNITS = ("ps", "ns", "us", "ms", "s")


class QueryError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def parse_unit(raw):
    text = (raw or "").strip().lower()
    for unit in UNITS:
        if text.endswith(unit):
            return unit
    return "ps"


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def fail(code, message, details=None):
    emit({"ok": False, "error": {"code": code, "message": message, "details": details}})


class Reader:
    """Holds npisys + one FSDB handle at a time."""

    def __init__(self):
        self._waveform = None
        self._handle = None
        self._path = None
        self._initialised = False

    def _ensure_module(self):
        if self._waveform is None:
            from pynpi import npisys, waveform  # imported after PYTHONPATH setup

            with contextlib.redirect_stdout(sys.stderr):
                npisys.init(["pynpi"])
            self._initialised = True
            self._waveform = waveform
        return self._waveform

    def open(self, fsdb):
        waveform = self._ensure_module()
        if self._handle is not None and self._path == fsdb:
            return self._handle
        if self._handle is not None:
            with contextlib.redirect_stdout(sys.stderr):
                waveform.close(self._handle)
            self._handle = None
            self._path = None
        with contextlib.redirect_stdout(sys.stderr):
            handle = waveform.open(fsdb)
        if handle is None:
            raise QueryError("not_supported", "NPI could not open FSDB: %s" % fsdb)
        self._handle = handle
        self._path = fsdb
        return handle

    def close(self):
        if self._handle is not None and self._waveform is not None:
            with contextlib.redirect_stdout(sys.stderr):
                try:
                    self._waveform.close(self._handle)
                except Exception:
                    pass
        self._handle = None
        self._path = None

    def shutdown(self):
        self.close()
        if self._initialised:
            from pynpi import npisys

            with contextlib.redirect_stdout(sys.stderr):
                try:
                    npisys.end()
                except Exception:
                    pass
            self._initialised = False


def handle_query(reader, payload):
    fsdb = payload.get("fsdb")
    if not fsdb:
        raise QueryError("invalid_argument", "fsdb is required")
    if not os.path.isfile(fsdb):
        raise QueryError("not_supported", "FSDB not found: %s" % fsdb)

    handle = reader.open(fsdb)
    waveform = reader._waveform
    scale = parse_unit(handle.scale_unit())
    fmt_name = payload.get("format", "Hex")
    fmt = getattr(
        waveform.VctFormat_e,
        {"Hex": "HexStrVal", "Bin": "BinStrVal"}.get(fmt_name, "HexStrVal"),
        waveform.VctFormat_e.HexStrVal,
    )

    def ticks(spec, default_unit):
        if spec is None:
            return None
        if isinstance(spec, (int, float)):
            return waveform.convert_time_in(handle, spec, default_unit)
        return waveform.convert_time_in(handle, spec["value"], spec.get("unit") or default_unit)

    action = payload.get("action")

    if action == "info":
        with contextlib.redirect_stdout(sys.stderr):
            max_time = int(handle.max_time())
            completed = bool(handle.is_completed())
            max_time_native = waveform.convert_time_out(handle, max_time, scale)
        return {
            "scale_unit": "1" + scale,
            "max_time_ticks": max_time,
            "max_time": max_time_native,
            "is_completed": completed,
        }

    if action == "values":
        signals = payload.get("signals") or []
        times = payload.get("times") or []
        if not signals or not times:
            raise QueryError("invalid_argument", "values requires signals and times")
        rows = []
        with contextlib.redirect_stdout(sys.stderr):
            for name in signals:
                for spec in times:
                    t = ticks(spec, scale)
                    rows.append(
                        {
                            "signal": name,
                            "time_ticks": int(t),
                            "value": str(waveform.sig_value_at(handle, name, int(t), fmt)),
                        }
                    )
        return {"scale_unit": "1" + scale, "values": rows}

    if action == "transitions":
        name = payload.get("signal")
        if not name:
            raise QueryError("invalid_argument", "transitions requires signal")
        start = ticks(payload.get("start"), scale)
        end = ticks(payload.get("end"), scale)
        if start is None:
            start = 0
        if end is None:
            end = int(handle.max_time())
        max_rows = int(payload.get("max") or 1000)
        with contextlib.redirect_stdout(sys.stderr):
            changes = waveform.sig_value_between(handle, name, int(start), int(end), fmt)
        rows = [
            {"time_ticks": int(t), "value": str(v)}
            for (t, v) in changes
            if int(start) <= int(t) <= int(end)
        ]
        truncated = len(rows) > max_rows
        rows = rows[:max_rows]
        return {
            "scale_unit": "1" + scale,
            "transitions": rows,
            "truncated": truncated,
            "resume_from": rows[-1]["time_ticks"] if truncated and rows else None,
        }

    if action == "xz_scan":
        signals = payload.get("signals") or []
        if not signals:
            raise QueryError("invalid_argument", "xz_scan requires signals")
        start = ticks(payload.get("start"), scale)
        end = ticks(payload.get("end"), scale)
        if start is None:
            start = 0
        if end is None:
            end = int(handle.max_time())
        max_rows = int(payload.get("max") or 100)
        candidates = []
        truncated = False
        with contextlib.redirect_stdout(sys.stderr):
            for name in signals:
                changes = waveform.sig_value_between(handle, name, int(start), int(end), fmt)
                for (t, v) in changes:
                    text = str(v).lower()
                    if "x" in text or "z" in text:
                        if len(candidates) >= max_rows:
                            truncated = True
                            break
                        candidates.append({"signal": name, "time_ticks": int(t), "value": str(v)})
                if truncated:
                    break
        return {"scale_unit": "1" + scale, "candidates": candidates, "truncated": truncated}

    if action == "change_stats":
        signals = payload.get("signals") or []
        if not signals:
            raise QueryError("invalid_argument", "change_stats requires signals")
        start = ticks(payload.get("start"), scale)
        end = ticks(payload.get("end"), scale)
        if start is None:
            start = 0
        if end is None:
            end = int(handle.max_time())
        rows = []
        with contextlib.redirect_stdout(sys.stderr):
            for name in signals:
                count = waveform.sig_vc_count(handle, name, int(start), int(end))
                first = waveform.sig_value_at(handle, name, int(start), fmt)
                last = waveform.sig_value_at(handle, name, int(end), fmt)
                rows.append(
                    {
                        "signal": name,
                        "count": int(count),
                        "first_value": str(first),
                        "last_value": str(last),
                    }
                )
        return {"scale_unit": "1" + scale, "stats": rows}

    raise QueryError("invalid_argument", "unknown action: %s" % action)


def run_one_shot():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001 - report as structured error
        fail("invalid_argument", "invalid JSON on stdin: %s" % exc)
        return 0
    reader = Reader()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = handle_query(reader, payload)
        emit({"ok": True, "data": result, "meta": {"source": "npi", "resident": False}})
        return 0
    except QueryError as exc:
        fail(exc.code, exc.message, exc.details)
        return 0
    except Exception as exc:  # noqa: BLE001 - report as structured error
        fail("backend_error", "NPI query failed: %s" % exc)
        return 0
    finally:
        reader.shutdown()


def run_serve():
    reader = Reader()
    for line in sys.stdin:
        text = line.strip()
        if not text:
            continue
        request_id = None
        try:
            payload = json.loads(text)
            request_id = payload.get("_id")
            if payload.get("action") == "close":
                reader.shutdown()
                emit({"ok": True, "_id": request_id, "data": {"closed": True}})
                return 0
            with contextlib.redirect_stdout(sys.stderr):
                result = handle_query(reader, payload)
            emit({"ok": True, "_id": request_id, "data": result,
                  "meta": {"source": "npi", "resident": True}})
        except QueryError as exc:
            emit({"ok": False, "_id": request_id,
                  "error": {"code": exc.code, "message": exc.message, "details": exc.details}})
        except Exception as exc:  # noqa: BLE001 - keep serving after a bad request
            emit({"ok": False, "_id": request_id,
                  "error": {"code": "backend_error", "message": "NPI query failed: %s" % exc}})
    reader.shutdown()
    return 0


if __name__ == "__main__":
    if "--serve" in sys.argv[1:]:
        sys.exit(run_serve())
    sys.exit(run_one_shot())
