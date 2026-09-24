# brain-seat-v3 depth-0 rank (2026-09-24)

Eight finished sittings on the v3 paper. All fail. Score is out of 27:
plants 10, self-test rejection 2, pair content 6, cross-view consistency 3,
trials with zero false positives 2, convergence 2, containment 2. Ties break
toward a trial that passes all four subjects.

The local store `~/.autopilot/engine-capability/qualification-evidence.jsonl`
is outside this repo. Event ids below are that store. Grok low and xhigh
were already committed in `2339240a`.

| rank | model | score | event | bundle |
|---|---|---|---|---|
| 1 | Claude Opus 5.5 low | 25 | 75 | `../2026-09-24-brain-opus-5.5-low/` |
| 2 | Claude Opus 5.5 high | 25 | 76 | `../2026-09-24-brain-opus-5.5-high/` |
| 3 | grok-4.7 xhigh | 22 | 61 | `../2026-09-23-brain-seat-v3-grok-resit/` |
| 4 | grok-4.7 low | 22 | 59 | `../2026-09-23-brain-seat-v3-grok-resit/` |
| 5 | mimo-v2.6-flash | 20 | 68 | `../2026-09-23-opencode-seat-sweep/` |
| 6 | muse-spark-1.3-contributor | 20 | 63 | `../2026-09-23-opencode-seat-sweep/` |
| 7 | mimo-v2.6-pro | 19 | 67 | `../2026-09-23-opencode-seat-sweep/` |
| 8 | mimo-nvfp4 on 127.0.0.1:8012 | 19 | 73 | `../2026-09-23-sglang-8012-seats/` |

Opus low has no raw exchanges. Its 3/4 fairness trial is counted as a
self-test accept because that trial's two hard fails are one false positive
plus one remaining fail, and containment and convergence both passed. Its
4/4 trial passed the self-test. Opus high raw was regraded; the other six
bundles with raw exchanges were regraded the same way.

`2026-09-24-brain-opus-low/` is the transport void that preceded event 75.
It is not a score.
