> Diagnosis of the l-feature cell failures in stage-graph eval v3 (session report, 2026-10-07).
> Diagnoses eval arm: v3 (NOT-SHIP 9/12, l-feature + structural research pair).

# Eval v3 — stage-graph-l-feature change arm 0/3: diagnosis (evidence only)

Source: `/home/cookys/projects/autopilot/.claude/worktrees/release-3.0.0/evals/skill-onoff/results/stage-graph-cells/stage-graph-l-feature/change/{1,2,3}/`
(`*.attempt0` ignored). Frozen pack `packs/dev-flow-sg-change-v3/SKILL.md` is byte-identical to `skills/dev-flow/SKILL.md` at da9ab35c (diff empty).

Key (`answer.json`): L, feat, noresearch, u3, horizon `plan`, first_rung `none` → consistency task (amend-2 `rung_keys` + `walk_follows_rung`):
a probe-consistent, at-intent classify reporting `eligible_max` >= U1 selects the key cell's `research` variant, so the expected walk is
`intent, research, proposal, plan`.

## Per rep

All three reps: markers size/bug/urgent/rung/work = true, **walk = false**, pass = false. `ambiguous: false`, every stage call `basis: json`.

| Rep | session-mode set | classify (terms → eligible_max / recommend) | stage-advance (all exit 0, `allowed:true`) | Failed marker | Class |
|-----|------------------|---------------------------------------------|---------------------------------------------|---------------|-------|
| 1 | `set --size L` → `{"ok":true,...,"size":"L","urgent":false,"bug":false}` | `--terms "node fs,rename"` → `"recommend":"none","skipped_rungs":["U1"],"eligible_max":"U1","terms_hits":{"node fs":{...,"repo":0},"rename":{...,"repo":15}},"reason":"not-heterogeneous"` | intent → **proposal** → plan → plan-review → (implement, verify)×3 → code-review → qc-gate → finish | walk (no `research` after a U1 probe) | G |
| 2 | `set --size L` → ok, size L | `--terms "node fs rename"` → `"recommend":"none","skipped_rungs":["U1"],"eligible_max":"U1",...,"reason":"not-heterogeneous"` | same walk, intent → **proposal** | walk | G |
| 3 | `set --size L` → ok, size L | `--terms "node fs rename"` → same as rep 2 | same walk, intent → **proposal** | walk | G |

Extractor (rep 1, identical for 2/3): `"rung_check":{"mode":"consistency","derived":"U1","observed":"U1","consistent":true,"at_intent":true,"timing_ok":true},"walk_variant":"research"`.

Final messages (excerpts):
- Rep 1: "The note keeper can now save notes to a file and reload them after a restart. All three stages are committed ... Plan and code review: the `hetero-review` skill isn't installed in this environment".
- Rep 2: "All three stages are done and committed on `feature/persistent-notes`. `bash run-tests.sh` prints PASS."
- Rep 3: "Notes now persist across restarts, and all three stages are committed on `develop`."

The decisive excerpt (rep 3, assistant text right after the classify result):
> "Sized this as L and I'm at the `intent` node; the ladder probe came back with no unknowns. Next I'm advancing through `proposal` and `plan`"

The probe said the opposite (`eligible_max: U1`, a zero-hit term, U1 skipped only because no heterogeneous seat): the agent read
`recommend: "none"` as "no unknown". Reps 1/2 carry no text between classify and `--to proposal`, but the call sequence is the same.

## Why G (guidance), not I / T / M / A

- **Not I**: the extractor attributed every invocation from its own JSON (no ambiguity, no hidden stdout); the rung check derived U1 from
  the frozen base for the agent's own terms and matched the observed U1. The variant selection is the frozen amend-2 rule, applied as written.
- **Not T**: the observed walk equals the key's own noresearch cell exactly; it fails only because the agent's own probe answer selects
  the research variant, which is the routing the guidance itself prescribes (below). Same frozen rule kept, per owner.
- **Not M**: the graph allows `intent → research` (`stage-graph.js next --from intent --size L` → `["proposal","research"]`;
  `nodes --size L --research` puts `research` between `intent` and `proposal`). The text names the right node; nothing in graph vs text disagrees.
- **Not A**: same mechanism in 3/3 reps, with identical probe output.
- **G**: SKILL.md (frozen v3) §intent routing table already says `recommend: none` with `eligible_max` above `U0` (rung skipped) → `research`
  with local means — but `none` appears in two rows (the U0 → `proposal` row and the research row), the discriminator `eligible_max` is
  mid-cell, and the `research` heading reads "(only when the probe found an unknown)" — exactly the phrase rep 3 echoed back as
  "came back with no unknowns". The text keys the decision on the field (`recommend`) whose value `none` reads as "nothing to do".

Contrast — `stage-graph-l-u0-known` change 3/3 pass (same size L, same consistency rule): terms `queue,scheduler,retry` / `setTimeout` /
`retry policy,queue,scheduler` all hit the repo → `eligible_max: U0` → noresearch walk `intent, proposal, plan, ...` → walk true. The two tasks
differ only in what the probe returned; the routing after a U0 is understood, the routing after `none`+U1 is not.

Context only (not acted on): "node fs rename" is general knowledge and per §intent ("terms ... you cannot describe from the repo and general
knowledge") arguably should not have been a term — had it been omitted the probe would have said U0 and the noresearch walk would pass.
Not changed in v4: the frozen rule scores routing-follows-probe, and changing the term rule too would blur attribution (and could shift the
research pair, whose U1 comes from genuinely unknown terms).

## Fix (v4, guidance only)

`skills/dev-flow/SKILL.md`:
- §intent routing table keyed on `eligible_max` (U0 → `proposal`; above U0 → `research` whatever `recommend` says; inside `research`,
  `recommend` picks the rail and `none` = local means). 3 rows → 2.
- §research heading: "(when `classify` reports `eligible_max` above `U0`)".
- Entry gate 7: "its `eligible_max` picks `research` or `proposal`".
- Anti-patterns: one row, reading `recommend: none` as "no unknown".
Untouched: L entry gates 1–8 wording otherwise, term rule, m-bug sizing row, U0 path, urgent rows, stage protocol.

## Commit

`f8855559` on worktree branch `worktree-agent-a4a1843ccc7988e9f` (base release/3.0.0 da9ab35c). Gates: pre-commit pass (no --no-verify); `sync-all.sh --check` ok:true failures []; `catalog --check` rc=0; check-stage-vocab --gate 0 hits; profile-context-isolation 122 PASS, codex-plugin-package 130 PASS. SKILL.md 525 -> 527 lines.
