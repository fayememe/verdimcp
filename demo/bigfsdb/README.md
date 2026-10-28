# bigfsdb — synthetic large FSDB for NPI P1

Generator for the headless-rendering measurement in `poc/evidence/diff-levers/npi-p1/`.

- 128 × 32-bit signals + clk, clock period 1 ns.
- `CYCLES=5000000` produces ~903 MB (`1ps` time unit, 5 ms simulated time).
- Outputs `big.fsdb`, `simv*`, `tb_big.v`, `csrc/`, logs; all ignored by git.

```bash
cd demo/bigfsdb
make CYCLES=5000000
```

`make` re-runs the simulation on every invocation so a changed `CYCLES` takes effect.

Measurement results and the conclusion (headless full render is **not** faster than GUI)
are in `poc/evidence/diff-levers/README.md` and `md/10-visual-evidence.md` §8.
