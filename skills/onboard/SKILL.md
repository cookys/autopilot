---
name: onboard
description: >
  Scaffold a consuming project's autopilot config (`.claude/*-config.md` DI) from its detected reality —
  the bridge from "fresh repo" to "autopilot-calibrated repo". Use when: "onboard this repo to autopilot",
  "set up the .claude config", "scaffold autopilot for this project", "calibrate autopilot to this codebase",
  "把這個專案接上 autopilot", "建立 .claude 設定", "幫這個 repo 接 autopilot". Detects package manager /
  commands / coverage thresholds / doc convention / workspace layout, scaffolds the config set with
  autopilot-only (ecosystem-standalone) chains, then enriches the judgment-heavy configs (skill-routing,
  doc-drift domains, security surfaces) by reading the repo. Not for: bootstrapping project-tracking docs
  from a plan (→ project-lifecycle), authoring a plan (→ references/plan-template.md), or running quality
  gates (→ quality-pipeline).
---

# Onboard — calibrate autopilot to a consuming project

Turns a repo with no autopilot config into one that speaks its own build commands, coverage thresholds,
doc layout, and ecosystem-standalone dispatch chains. The **deterministic half is scripted** (detect +
scaffold); the **judgment half is yours** (map this project's domain to skills, derive doc⇄code drift
domains, name security surfaces). The golden reference output is the hand-built `~/projects/hangar-bridge/.claude/`.

> **Premise: ecosystem-standalone.** The scaffolded chains default to **autopilot-only** (the assumed
> baseline is autopilot + `codeforge` + `mnemos`, no third-party plugins). `superpowers` is added only as an
> explicit, commented fallback when the project actually has it installed. Never scaffold a superpowers-first
> default.

## Available Scripts (prefer over LLM judgment for the mechanical half)

| Script | Role |
|--------|------|
| [`scripts/project-detect.js`](../../scripts/project-detect.js) | **Detect** (pure read → JSON): package manager, commands (+`lint_is_noop`), per-package coverage thresholds, doc convention (`doc/` vs `docs/`), workspace/packages, `default_branch`, protected-path candidates, project paths, installed plugins. Run it FIRST; it owns every mechanical fact. |
| [`scripts/scaffold-config.js`](../../scripts/scaffold-config.js) | **Scaffold** (mechanical write): copies+fills the 9-file config set into `<target>/.claude/`, fills detected values, writes autopilot-only chains when `superpowers=false`, and updates `.gitignore` to exclude runtime state while KEEPING `*-config.md` tracked. Idempotent; `--force` to clobber a hand-edit; `--dry-run` to preview. |

## Workflow

### 1. Detect (mechanical — run the script, read the JSON)
```bash
node <autopilot>/scripts/project-detect.js <target-repo> | tee /tmp/onboard-detect.json
```
Read the JSON. Sanity-check it against the repo: does `package_manager`, `doc_dir`, the coverage table, and
`default_branch` match reality? `default_branch` is only emitted when the target IS the git top-level; if it
is `null` or wrong (e.g. the repo's `origin/HEAD` isn't set), note the canonical branch for step 4. **Do not
re-derive these facts by hand — the detector owns them.**

### 2. Scaffold (mechanical — run the script)
```bash
node <autopilot>/scripts/scaffold-config.js <target-repo> --detect /tmp/onboard-detect.json
```
Preview first with `--dry-run` (writes nothing, prints what it WOULD do); pass `--force` to overwrite a
hand-edited config. This writes the 9 configs + the `.gitignore` runtime-state block. Inspect the JSON summary
(`{written, skipped, gitignore_updated}`). On a re-run it is idempotent (writes nothing unchanged) and skips
hand-edited files unless you pass `--force`. The 7 **mechanical** configs (next, project-lifecycle, dispatch,
quality-gate, dev-flow, test-strategy, qc-gate) are now correctly filled. The 2 **judgment** configs
(skill-routing, doc-drift) are SKELETONS with `TODO(onboard)` markers — step 3 fills them.

### 3. Enrich the judgment configs (THIS is the skill's value — scripts can't do it)
Read the target repo's code + docs, then fill:

- **`skill-routing.md`** — map THIS project's domain keywords → the right autopilot methodology skill. Read
  the source/docs for the recurring domain terms (wire format, schema, auth surface, perf-sensitive paths,
  test tooling) and route each to `autopilot:debug` / `autopilot:reviewer` / `autopilot:test-strategy` /
  `autopilot:profiling`. (Golden example: hangar-bridge routes "envelope/zod schema → debug", "channel tag/
  escaping/injection → reviewer", "latency/throughput → profiling".)
- **`doc-drift-config.md`** — one `###` domain block per doc⇄code mapping: which doc file(s) describe which
  code dir(s), and a `focus:` line naming the claims that must stay true (commands, coverage numbers, API
  surface, status claims). Keep the deterministic `gate_command` + `staleness_days` the skeleton already has.
- **`quality-gate-config.md` security surfaces** — if the repo has security-sensitive code (auth, crypto,
  escaping, input validation, idempotency, ordering invariants), add a `## Security-critical surfaces` block
  naming them as always-full-review (never fast-path). Read the code to find them; do not guess.

### 4. Reconcile CLAUDE.md (optional, if one exists and is stale)
If the target has a `CLAUDE.md`, align its commands / coverage thresholds / doc paths / default branch to the
detected reality (step 1). If `default_branch` detection was null/ambiguous, write the canonical branch you
confirmed. Do NOT invent conventions — only correct drift against detected facts. If there's no CLAUDE.md,
skip (creating one is out of this skill's scope).

### 5. Seed memory pointers (optional)
If the target warrants persistent memory, note the project memory dir
(`~/.claude/projects/<path-hash>/memory/`) so `autopilot:learn` writes to one home. Add a one-line pointer to
its `MEMORY.md` if the project has ongoing work worth tracking. (This mirrors what was hand-done for
hangar-bridge.)

### 5.5 Heterogeneous engine credentials (optional)
If the project's `review-loop-config.md` uses a `cc-shim` / `anthropic-compatible` reviewer or
implementer (GLM / MiniMax / any Anthropic-compatible endpoint), point the user to the ONE canonical
credential home instead of scattering shell exports: run `load-endpoints-env.sh --init` to scaffold
a mode-600 `~/.autopilot/endpoints.env` stub, fill in `AUTOPILOT_ENDPOINT_<NAME>_{URL,TOKEN}`, then
set `reviewer_endpoint` / `implementer_endpoint` in `.claude/review-loop-config.md` so `/l5`/`/l6`
pick it up declaratively. Prefer a subscription/coding-plan token over a metered API key; OAuth-login
runners (codex/agy/grok) need no token. Full guide:
[`docs/installation.md` § Heterogeneous engine credentials](../../docs/installation.md#heterogeneous-engine-credentials-optional--unlocks-the-strong-reviewimpl-roster).

### 6. Verify
- `ls <target>/.claude/` shows the 9 configs; `<target>/.gitignore` excludes runtime state but NOT
  `*-config.md` (they must stay tracked — `git -C <target> check-ignore .claude/dispatch-config.md` returns
  nothing).
- Re-run `scaffold-config.js <target> --detect /tmp/onboard-detect.json` (same detect JSON as step 2) →
  summary `written:[]` (idempotent; your step-3/4 hand edits are preserved, reported in `skipped`).
- The dispatch chains are autopilot-only (no superpowers-first default) unless the project genuinely has
  superpowers installed.

## Acceptance (what "done" looks like)
The `<target>/.claude/` set reproduces the **mechanical** values of the golden hangar-bridge output (same
commands, coverage table, doc paths, protected paths, autopilot-only chains) AND carries the project-specific
**judgment** content you added in step 3. The scaffold is re-runnable without churn.

> **Note (first run after install):** a newly-shipped `onboard` skill is not dispatchable until Claude Code
> restarts (the plugin caches skills at session start). The scripts (`project-detect.js` / `scaffold-config.js`)
> work immediately from the CLI regardless.
