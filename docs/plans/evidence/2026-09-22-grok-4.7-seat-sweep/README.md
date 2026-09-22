# grok-4.7 depth-0 (brain) seat sweep — 2026-09-22, cuda

Rail: grok CLI (`QRP_CLI_KIND=grok`) → case broker → `engine-qualify.sh brain`.
Subscription rail, not the API — the operator's constraint is that grok is billed by
subscription **only while it is reached through the grok build CLI**, so no
`XAI_API_KEY` / `GROK_API_KEY` is ever set on this path.

Narrowed to the two ENDS of the effort scale (operator, 2026-09-22): low and xhigh.
Effort is part of the exam identity here because the grok CLI really forwards
`--effort` — live enum re-probed this day (`grok --effort bogus -p hi` lists exactly
`xhigh, high, medium, low`) and `grokEffortClamp` passes it through. That is the
opposite of the cc-shim / HTTP-broker path, where the request body carries only
model/max_tokens/temperature and a tier label would be fiction.

## Result

| effort | outcome | event | notes |
|---|---|---|---|
| low | **FAIL** (capability) | 55 | diligence ✗ fairness ✗ convergence ✗ containment ✓ |
| xhigh | not yet obtained | — | three transport aborts, zero rows; see below |

### low — event 55

| | trial-1 | trial-2 |
|---|---|---|
| plants caught | 4 / 5 | 4 / 5 |
| clean false positives | **2** | **1** |
| fairness correctness failures | 2 / 4 | 2 / 4 |
| hard fails | 5 | 1 |
| findings closed | 2 | 1 |
| verification actions | 4 | 5 |
| convergence_terminal | false | false |
| pair_delta | 2 | 2 |
| spend | 10,169 | 9,957 |

Read against the other three engines on the byte-identical prompt v4 (`5feb7076`):
grok is the only one that raises **false alarms on clean material** (2+1 against 0+0 for
flash-next and muse-spark, 0+1 for claude-fable-5), and it carries the most hard fails.
Its fairness is the best of the four (2/4 wrong vs 3/4 for the two local engines). It
decides more readily, and pays for it in precision.

## The xhigh cell: three aborts, three different timeout layers

No verdict was ever recorded and **no row was ever appended** — the transport abort
added in v2.36.82/84 held every time.

| attempt | died | error | the layer that killed it |
|---|---|---|---|
| 1, 03:40 | trial 1 round 6 | `provider_process_failed` | adapter `QRP_TIMEOUT_MS`, default 180 s |
| 2, 11:10 | trial 1 round 6 | `provider_timeout` | broker `--remote-timeout-ms`, default 300 s |
| 3, 12:08 | in flight | — | both set: broker 600 s (the cap), adapter 570 s |

All three died on round 6 at a ~3 KB bundle after five clean rounds.

**There are three nested budgets and raising only the inner one changes nothing.** Each
layer reports a *transport* fault, never "your budget was too small", so the failure
reads as an engine or rail problem. Attempt 3 deliberately sets the inner budget BELOW
the outer one: if the outer expires first it kills the child and the inner diagnosis is
never written — which is exactly why attempt 1 took a bisect to explain.

This failure mode is effort-correlated and therefore systematic: a higher effort thinks
longer per round while the round bundle grows monotonically, so a high-effort cell dies
in the LATER rounds while its early rounds pass cleanly.

## Identity

`identity-brain-{low,xhigh}.json`. `prompt_config_hash 5feb7076` is byte-identical to
the incumbent's pinned prompt v4, so these rows sit directly beside claude-fable-5,
qwen3.8-flash-next and muse-spark-1.3 on the same paper.

`runner_version 1.0.40`; `harness_version engine-qualify-5c498e99`;
containment surface records the honest posture — `grok --prompt-file … --deny "*"` with
**host-ambient credentials**, since `QRP_CLI_HOME` is seeded credential-only rather than
from a dedicated exam account.

### The credential seed, and a trap worth recording

The broker replaces `HOME` with its own empty temp dir, so grok cannot find its
credentials and every round fails. The supported way through is the adapter's generic
`QRP_CLI_HOME` clone. Three attempts were needed:

1. not set at all → `provider_process_failed` on round 1;
2. set, but **the seed directory was used to run a verification** — grok initialised
   sessions/logs/bundled/grove inside it and 3 files / 20 KB became 491 files / 14 MB,
   over the adapter's 8 MB clone cap;
3. rebuilt, but nested as `<seed>/.grok/auth.json` — wrong, because the adapter sets
   **`GROK_HOME`**, which IS the credential root, not its parent. grok answered
   `Not signed in`.

Correct seed is flat: `<seed>/{auth.json, agent_id, .metadata_version}`, 1769 bytes.
**Never run grok against the seed itself** — copy it first.
