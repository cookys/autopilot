# autopilot — project conventions

For Claude Code sessions working **on** the autopilot plugin itself. Skill-runtime conventions live in each skill's `SKILL.md`; this file covers cross-cutting things a session needs at entry.

## What this repo is

Standalone-capable lifecycle orchestration plugin for Claude Code. 16 skills, 3 methodology agents, 14 hooks. Works alone; delegates to `superpowers` when installed via `.claude/dispatch-config.md` chains. See [`README.md`](README.md) for the full coexistence model.

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
| [`scripts/validate.sh`](scripts/validate.sh) | Validate every skill's SKILL.md structure (YAML frontmatter, required fields). |
| [`scripts/dev-setup.sh`](scripts/dev-setup.sh) | One-time local-dev setup. |
| [`scripts/sync-version.js`](scripts/sync-version.js) | Sync version across `package.json`/skills metadata. |
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
