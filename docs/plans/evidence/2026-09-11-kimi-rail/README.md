# kimi implementer rail — P3 evidence (2026-09-11, this host)

## Real dispatch (KR1)

Scratch repo, one-file task (`greeting.txt` with exactly `kimi-rail-real-8842`):

```
$ scripts/dispatch-hetero.sh --branch feat/kimi-real --prompt-file task.md --runner kimi --model kimi-code/k3 --base main --context-window warn
dispatch-hetero: run_id=hetero-1789127250-2580269-b3e6 …
{ "status": "committed", "runner": "kimi", "model": "kimi-code/k3", "containment": "cgroup", "contained": true,
  "branch": "feat/kimi-real", "base": "main", "commit": "b5892c1379e34a3610c26fcc520d042a0bf0ab85",
  "files_changed": 1, "insertions": 1, "deletions": 0, "model_calls": 1, "mutation_attempts": 1,
  "usage": null, "wall_secs": 27, … }

$ git show --stat feat/kimi-real
b5892c1 dispatch-hetero(kimi): edits on feat/kimi-real
 greeting.txt | 1 +
$ git show feat/kimi-real:greeting.txt
kimi-rail-real-8842
```

Verdict from git artifacts (wrapper commit, exact content), not from the model's report.

## Seat resolution in the consuming repo (KR3)

fleet-comms `.claude/review-loop-config.md` flipped to the operator's 2026-09-08 choice; from that repo:

```
$ resolve-review-loop.sh --field implementer_engine   → kimi-code/k3
$ resolve-review-loop.sh --field implementer_runner   → kimi
$ resolve-review-loop.sh --field implementer_effort   → high
$ resolve-dispatch.sh --tree --role sub-orchestrator  → {"model":"kimi-code/k3","mode":"default",…,"source":"project"}
```

(The `| tree:sub-orchestrator | kimi-code/k3 | default |` row that model-routing-config.md
recorded as unexpressible on 2026-09-08 now resolves — KR2.)

Not run end-to-end here: `bin/autopilot.js engine implement-review --campaign-contract …` — it
reaches `dispatch-hetero.sh` through the same resolver fields and the same runner arm exercised
above; the first real `/l5` on fleet-comms is where that path gets its transcript.

## Mirror parity (R6)

`diff scripts/dispatch-hetero.sh platforms/codex/plugin/scripts/dispatch-hetero.sh` → empty at
each commit (pre-commit ritual `sync-codex-plugin-skills --check` passed).
