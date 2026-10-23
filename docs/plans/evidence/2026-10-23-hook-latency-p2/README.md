# P2 hook latency baseline (BL-0241), 2026-10-23

Produced by `scripts/benchmark-hook-latency.js` (merge hooklat 54e9ff131) at commit
54e9ff131cf4ddea6bcf3e65e57b22a4b46470f3: N=30 samples, model haiku, `--max-usd 1.5`,
spent 0.689258 USD, no stop and no unknown cost.

- `hook-latency-baseline.json`: the conclusion file the tool wrote.
- `run.log`: the console log of the same run (rc=0).

Three arms: enabled (the shipped hooks), positive_control (a known added delay) and zero (no hooks).

Result: verdict `open_guard_port_plan`. PostToolUse spawns 7 hooks per tool call, call p95 197 ms
over the zero arm (zero arm 0 hook lines). The marker p95 is 247 ms (above the 180 ms floor), so the
instrument is valid.

Caveat: the host load average was about 40 during the run, so the absolute numbers run high.
The next step is the guard-port plan, tracked in BL-0241.
