# P3 orchestration-eval harness — design spec (R0)

Measures whether the quality-floor assets lift a MID-TIER orchestrator's outcome quality,
per plan §5. Everything below is designed against the §5 invalidators.

## Layout
```
evals/orchestration/
  tasks/<task-id>/
    repo/           # frozen synthetic micro-repo (hermetic; committed as plain files)
    task.md         # the orchestrator's assignment (goal + constraints)
    oracle.sh       # deterministic end-state gate — THE outcome measure, arm-independent
  packs/
    on/ASSETS.md    # the quality-floor pack injected in the ON arm (playbook+patterns+
                    #   adjudication protocol excerpts, self-contained)
    off/PADDING.md  # neutral real prose, token-length-matched to ASSETS.md (±10%)
  run-orchestration-eval.sh   # arm runner
  score.js                    # scoring + adherence report
  README.md                   # method + honesty notes
```

## Tasks (pilot = 2; target ≥5)
Synthetic micro-repos, POST-HOC authored (contamination-safe: never published, planted
defects are novel combinations). Each ≈ 10-20 files, bash/node only (no deps). Pilot tasks:
- **T1 fix-with-decoy**: a real bug + a plausible-but-wrong reviewer finding planted in
  `REVIEW-NOTES.md` (claims a correct function is broken). Oracle: real bug fixed (behavior
  test), decoy function UNCHANGED (hash), tests pass, no test deleted/weakened
  (`check-test-integrity`-style additions-only diff check).
- **T2 extract-verbatim**: move an embedded block (heredoc-style) to a lib file
  behavior-identically. Oracle: byte-fidelity check (A3 pattern), runtime behavior identical
  (output diff), suite green.
Both oracles are pure bash + git artifacts; identical for ON/OFF arms; independent of the
assets (they never reference playbook/pattern/adjudication vocabulary).

## Arms
- **ON**: orchestrator prompt = task.md + `packs/on/ASSETS.md` + the REQUIRED-ARTIFACTS
  contract (below).
- **OFF**: task.md + `packs/off/PADDING.md` (length-matched neutral text: a generic
  software-engineering essay with no actionable procedures) + the SAME required-artifacts
  contract (so artifact-production itself isn't the differentiator — the CONTENT guidance is).
- Runner seam: `--runner cc --model <m>` (`claude -p`, `--setting-sources project`,
  `--strict-mcp-config`, scratch HOME — NO plugins, per P3-pre isolation) or `--runner agy`.
  Pilot: one cheap family per arm-pair, same model both arms (haiku-class or flash-class).
- Each run executes in a disposable copy of `repo/` (fresh temp dir, git-init'd), pgroup
  timeout, transcript + workdir preserved as run artifacts.

## Required-artifacts contract (both arms)
The orchestrator is instructed to leave: `PLAN.md` (with acceptance criteria), `DECISIONS.md`
(judgment calls), and if it evaluates any claim from REVIEW-NOTES.md, a
`adjudication.jsonl` via a provided helper (ON arm has the real protocol text; OFF arm just
has the file-name requirement). This keeps artifact PRESENCE symmetric; only guidance differs.

## Scoring (`score.js`, per run → JSONL row)
- `oracle_pass` (bool) — the headline.
- `decoy_respected` (T1: decoy function untouched) — the false-fix signal.
- `fidelity_ok` (T2) — the acceptance-pattern signal.
- Adherence (ON-arm diagnostics, reported for both): adjudication file present/valid
  (feed through `adjudicate-findings.js status`), acceptance pattern ids named in PLAN.md,
  probe evidence present before edits to decoy-adjacent files.
- `rounds`/`duration`/`tokens` (if runner reports) — cost axis.
- Aggregation: per-task ON vs OFF oracle-pass + decoy/fidelity rates. NO preference scores.

## Honesty rails (from §5 invalidators)
- Same oracle both arms; oracle never mentions asset vocabulary.
- OFF-arm padding length-matched (context confound).
- Arms run as separate processes, separate scratch HOMEs (P3-pre isolation); `--selftest`
  asserts no plugin load in either arm.
- Pilot n is TINY → report says "pipeline validation, NOT evidence of lift"; the statistical
  campaign is a separate operator decision (cost gate).
- Runner/model versions recorded per run (moving-tools invalidator).

## Out of scope (P3)
- Multi-turn interactive orchestration (single `-p` session per run for the pilot).
- Task-tree/ledger integration inside the eval repos (the micro-repos are not autopilot).
- Any claim about specific vendor models (routing-axis bar).
