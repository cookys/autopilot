# autopilot — project conventions (Claude Code)

For Claude Code sessions working **on** the autopilot plugin itself. Skill-runtime conventions live in each skill's `SKILL.md`; this file covers cross-cutting things a session needs at entry.

For **non-Claude-Code** agents (OpenCode, Codex, Antigravity, …), see [`AGENTS.md`](AGENTS.md) for the agents.md-spec readme that applies to any agent. For cross-platform portability details (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

## What this repo is

Standalone-capable lifecycle orchestration plugin for Claude Code. 19 skills, 3 methodology agents, 19 hooks (12 default-on, 7 opt-in). Works alone; delegates to `superpowers` when installed via `.claude/dispatch-config.md` chains. See [`README.md`](README.md) for the full coexistence model.

## Scripts inventory (prefer over LLM judgment)

`scripts/` ships deterministic tooling that the skills reference instead of asking the LLM to do mechanical work each run. If you're touching anything in `skills/quality-pipeline/` or `agents/reviewer.md`, check whether a script already covers it.

| Script | Purpose |
|--------|---------|
| [`scripts/completeness-scan.sh`](scripts/completeness-scan.sh) | Anti-stub regex (TODO/FIXME/empty-impl/DISABLED_) on staged diff; JSON output; exit 1 ⇒ new findings (quality-pipeline completeness gate). |
| [`scripts/check-redispatch-prompt.sh`](scripts/check-redispatch-prompt.sh) | Leaky-phrase linter for round-2+ re-dispatch prompts; encodes `references/blind-dispatch.md` checklist. Exit 1 ⇒ strip and retry. |
| [`scripts/diff-file-list.sh`](scripts/diff-file-list.sh) | Changed-file list as a Verified Clean markdown checklist. Removes LLM-from-memory file enumeration in reviewer output. |
| [`scripts/diff-scope-report.sh`](scripts/diff-scope-report.sh) | v2 scope-creep candidate filter: whitespace-only files, files not in commit message, comment-only hunks (per-language regex), quote-style swaps. JSON `findings`; reviewer judges, doesn't auto-flag. |
| [`scripts/resolve-dispatch.sh`](scripts/resolve-dispatch.sh) | Role → `{model, mode, agent}` JSON. Consults `.claude/model-routing-config.md` or `references/model-routing.md` defaults. Use instead of hardcoding dispatch metadata. |
| [`scripts/verify-preexisting.sh`](scripts/verify-preexisting.sh) | Test failure classification: PRE_EXISTING / INTRODUCED / NO_FAILURE / INCONCLUSIVE. Replaces manual `git stash + checkout develop` recipe. |
| [`scripts/risk-counter.sh`](scripts/risk-counter.sh) | Persistent WTF-Likelihood Cap counter (per repo+branch). Subcommands: `status`, `increment --event <kind>`, `threshold-hit`, `reset`. |
| [`scripts/diff-since-last-round.sh`](scripts/diff-since-last-round.sh) | Round-N checkpoint + delta-since-checkpoint. **Delta output is dispatcher-only — never pass to reviewer** (leaks round-cycle meta-signal). |
| [`scripts/dispatch-hetero.sh`](scripts/dispatch-hetero.sh) | Heterogeneous implementer dispatch (CC → `agy` headless) with **hard-coded worktree isolation** + artifact-based verification (commit/diff/cleanliness from git, never agent self-report). JSON output; exit 0 committed / 1 no-commit-or-dirty (worktree kept) / 2 precondition. Ritual + invariants: [`references/hetero-dispatch.md`](references/hetero-dispatch.md). |
| [`scripts/distill-scan.js`](scripts/distill-scan.js) | Deterministic history scanner for `skills/distill`: reads `~/.claude/projects/*/*.jsonl` → frequency atoms in two buckets (ritual + correction candidates). `--real-only`, `--json`, `--top N`. **`--incremental`/`--new-only`** add a per-session cursor (`~/.autopilot/distill/scan-state.json`) so re-runs only re-read new/changed sessions — cumulative totals stay identical to a full scan; `--new-only` reports just candidates risen since last run. No LLM in the count path. |
| [`scripts/distill-sync-setup.sh`](scripts/distill-sync-setup.sh) | `skills/distill` pack-sync onboarding: `status` / `init-remote <url>` / `enroll <url>` / `fix-gitignore [repo]`. Idempotent; emits the **correct** `.claude/*` + `!.claude/skills/` negation (the obvious `.claude/` + `!.claude/skills/` form is silently broken — git can't re-include under a fully-excluded parent). |
| [`scripts/distill-consolidate.sh`](scripts/distill-consolidate.sh) | `skills/distill` cross-machine consolidation plumbing (deterministic, no LLM): `normalize-slug <raw>` (machine-stable slug: lowercase + drop tiny stopword set + **preserve order**, so independent namings of one procedure converge while antonyms stay distinct), `migrate [pack]` (one-time: rename existing dirs → normalized slugs **and rewrite each frontmatter `name:` to match** — identity convergence needs both; STOPs on collision), `compare <slug> [pack]` (**proactive** divergence check vs `@{u}` → JSON, no merge-conflict state). Human-gated LLM merge lives in SKILL.md Step 5, not the script. Design: [`docs/plans/2026-06-04-distill-consolidate.md`](docs/plans/2026-06-04-distill-consolidate.md). |
| [`scripts/validate.sh`](scripts/validate.sh) | Validate every skill's SKILL.md structure (YAML frontmatter, required fields). |
| [`scripts/dev-setup.sh`](scripts/dev-setup.sh) | One-time local-dev setup. |
| [`scripts/sync-version.js`](scripts/sync-version.js) | Sync version across canonical `.claude-plugin/plugin.json` + mirrors (root `plugin.json`, README badges). `--check` mode (read-only drift gate, used by `.githooks/pre-commit`). |
| [`scripts/sync-agent-bodies.sh`](scripts/sync-agent-bodies.sh) | Strip YAML frontmatter from `agents/<role>.md` → `.opencode/agent-bodies/<role>.body.md` (OpenCode `{file:..}` reference target). `--check` mode in pre-commit. |
| [`scripts/preflight-portability.sh`](scripts/preflight-portability.sh) | 12-check cross-agent acceptance gate (hooks smoke, symlinks, OpenCode plugin/skill/agent). Self-skips OpenCode checks when binary absent. |
| [`scripts/preflight-release.sh`](scripts/preflight-release.sh) | Release-hygiene gate: CHANGELOG entry + INDEX row + version-mirror parity for canonical version. Run at finish-flow L-5.5 when a ship bumps the version. |
| [`scripts/setup-symlinks.sh`](scripts/setup-symlinks.sh) / [`.ps1`](scripts/setup-symlinks.ps1) | Ensure `.agents/skills/` symlink resolves (Windows-safe). Auto-run by `dev-setup.sh`. |
| [`scripts/install-antigravity.sh`](scripts/install-antigravity.sh) / [`.ps1`](scripts/install-antigravity.ps1) | Register autopilot as an `agy` plugin (validate → install → list). Verified against agy 1.0.1. |
| [`scripts/install-hooks.sh`](scripts/install-hooks.sh) | Set `git config core.hooksPath .githooks` to activate the git hooks: `pre-commit` (version/agent-body drift gate) + `post-merge` (release-ritual advisory — prints merge SHA + `preflight-release.sh` status when a merge lands on develop/main; never blocks, never commits). |
| [`scripts/run-eval-batch.sh`](scripts/run-eval-batch.sh) / [`run-skill-opt.sh`](scripts/run-skill-opt.sh) | Eval harness; see `evals/`. |
| [`scripts/toggle-payload-capture.sh`](scripts/toggle-payload-capture.sh) | Hook payload capture (Tier B diagnostic — see hooks gotchas). |

All scripts respond to `<script> --help`. JSON-emitting scripts have stable schemas; exit codes follow each script's header.

## When adding a new script

If you replace an LLM-judgment step with a script, **wire it in**:
1. The reference doc (`skills/quality-pipeline/references/*.md` or equivalent) — describe what the script does and when to call it.
2. The relevant `SKILL.md` — add a row to its "Available Scripts" table (if it has one) or reference inline.
3. This file's inventory table — keep alphabetical-by-purpose grouping.

Without all three, the script is dead code: future sessions won't discover it.

## Severity vocabulary

Unified across all skills and agents:

```
🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
```

If you see "Important" anywhere in a severity context, that's a leftover from the old vocabulary — fix it. The dialectic skills (`think-tank`, `think-tank-dialectic`) use a separate **risk** tagging vocabulary (`critical / important / minor`, lowercase) which is intentionally distinct.

## Coexistence with superpowers

Autopilot is standalone-capable. When `superpowers` is installed, orchestrators (`ceo-agent`, `finish-flow`, `quality-pipeline`, `think-tank*`, `dev-flow`) consult `.claude/dispatch-config.md` to decide which methodology / reviewer / parallel dispatcher to delegate to. Defaults in [`project-config-template/dispatch-config.md`](project-config-template/dispatch-config.md). Per-scenario UX in [`README.md`](README.md#superpowers-coexistence).

## Where context lives

| Topic | File |
|-------|------|
| Skill execution rules | `skills/<name>/SKILL.md` |
| Methodology agent prompts | `agents/{reviewer,debugger,planner}.md` |
| Cross-skill references | `references/{blind-dispatch,model-routing}.md` |
| Project tracking | `docs/projects/` (active + `_archive/`) |
| Backlog | `docs/BACKLOG.md` |
| Plans | `docs/plans/` |
| Release notes | `CHANGELOG.md` |
| Per-session gotchas | `~/.claude/projects/-home-cookys-projects-autopilot/memory/` |

## Reply preference

Inherit from `~/.claude/CLAUDE.md` (Traditional Chinese, terse decisions like `go`/`A`/`1` accepted). For docs and code, English unless content is user-facing localization.

## Don't

- Don't hardcode dispatch model/mode in skill files — use `scripts/resolve-dispatch.sh`.
- Don't write "manually check for TODO/FIXME" in a reference doc — call `scripts/completeness-scan.sh`.
- Don't enumerate forbidden phrases inline in code-review logic — call `scripts/check-redispatch-prompt.sh`.
- Don't introduce new severity vocabulary — use the unified 4-tier above.
- Don't add a second canonical statement of "what the reviewer reads" — code-review.md Invocation § is canonical; reviewer.md Workflow §1 references it.
- Don't claim cross-platform env vars or CLI subcommands without verifying — by official doc URL OR by running the real tool. Past lesson cuts both ways: `CODEX_PLUGIN_ROOT` / `AGY_PLUGIN_ROOT` / `GEMINI_PLUGIN_ROOT` env vars were fabricated and shipped to main; but the *correction* then over-corrected, labelling `agy plugin validate` + the root-`plugin.json` requirement as fabricated when installing real `agy` 1.0.1 proved both genuine. If you can't cite a URL or show a tool run, it's a Spike candidate, not a fact. See [`references/multi-agent-portability.md`](references/multi-agent-portability.md) "Corrected — previously mislabelled" §.
