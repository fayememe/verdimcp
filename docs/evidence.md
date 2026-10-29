# Evidence

An agent reading a waveform is only useful if it can hand back something a reviewer can check. That is
what a bundle is for.

## The bundle

```
evidence/<id>/
  bundle.json          # id, title, session, items[]
  items/<item-id>.json # one file per item, including query_used
  report-<id>.md       # rendered report (md or html)
```

An item is one of: `value`, `changes`, `source`, `check`, `screenshot`, `cone`, `compare`.

```json
{
  "item_id": "d62d8f20-...",
  "type": "value",
  "created_at": "2026-10-28T19:54:41.321Z",
  "data": {"signal": "/tb_sync_fifo/rst_n", "time": 40, "value": "1"},
  "query_used": {"tool": "verdi_value_get",
                 "arguments": {"signal": "/tb_sync_fifo/rst_n", "time": 40, "unit": "ns"}}
}
```

`query_used` is the whole contract. `evidence_report` turns it into a reproduce section, so a reader can
re-run each claim. An item whose `query_used` does not match what ran is worse than no item.

## Artifacts

| Artifact | Produced by | Proof it carries |
|---|---|---|
| annotated screenshot | `capture_annotate` | path, bytes, `sha256`, window id, annotation list with `applied` flags |
| bounded render | `waveform_render` | path, SVG path, width/height, signal count, bins |
| cone | `cone_capture` | path, width/height, bytes, `sha256`, mode, time, `trace_applied` |
| comparison | `waveform_compare` / `evidence_compare` | path, bytes, and for the latter the two ROIs |

`sha256` is not decoration: it is how you prove two "identical" captures really are the same, and how a
reviewer notices that a report was regenerated with different content.

## What each artifact can and cannot prove

| Artifact | Proves | Does not prove |
|---|---|---|
| `value` | the value at that time and unit | that the design is correct |
| `changes` | edges/counts in a stated range, with engine + fsdb | delta-cycle completeness when `engine: gui` |
| `check` | the predicate held for those params | that the predicate is the right rule |
| annotated screenshot | what the engineer sees in that window | the logic behind it |
| cone image | the traced topology at that time | a pin list (Verdi gives none) |
| comparison image | a visible difference | a cycle count — use `transitions_get` |

## Labels

| Label | Means |
|---|---|
| `VERIFIED` | a tool was called and its result read |
| `INFERRED` | concluded from an image, a cone, or a correlation |
| `DOCUMENTED_ONLY` | a document says it; nothing was run |
| `NOT_TESTED` | nobody ran it |

A generated report is not VERIFIED by existing. The underlying query must have run, and the label belongs
to the claim, not to the file.

## A minimal bundle

```
title:      fifo write stall
value:      /tb_sync_fifo/wr_valid @115.43ns = "1"        VERIFIED
changes:    /tb_sync_fifo/wr_ready 0..240ns count=0       VERIFIED (npi, fsdb.completed=true)
check:      wr_stall (7dcf91b9) hits=17                   VERIFIED
capture:    annotated.png 2560x615 sha256 26f718f8...     VERIFIED image
cone:       cone-x-....png 1711x618 sha256 f8f6e51a...    VERIFIED image, INFERRED logic
verdict:    backpressure from a full FIFO, not a protocol violation   INFERRED
not proven: which upstream block refused the read
```

That last line is the difference between a report someone trusts and a report someone has to redo.

## In CI

`scripts/acceptance.sh` writes a bundle-shaped summary with one entry per check:

```json
{"started":"...","finished":"...","ok":true,
 "checks":[{"name":"cone_capture.x_image","passed":true}, ...]}
```

97 checks, one JSON file, exit code 0 or 1. A nightly job can gate on it before anyone trusts an agent's
report.
