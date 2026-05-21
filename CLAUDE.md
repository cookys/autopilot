# autopilot — Claude Code Conventions

This file provides tool-specific configurations for Claude Code (claude.ai/code) when working **on** the autopilot plugin itself.

---

## ⚠️ Canonical Guidelines (READ FIRST)
BEFORE WRITING ANY CODE or modifying any rules, read and adhere to the project conventions, manifest synchronization, and multi-agent compatibility rules in **[AGENTS.md](file:///home/codepower/projects/autopilot/AGENTS.md)**. 

Do not duplicate those rules here. `AGENTS.md` is the single source of truth for all agents in this workspace.

---

## 💻 Scripts Inventory (Prefer over LLM judgment)

`scripts/` ships deterministic tooling that the skills reference instead of asking the LLM to do mechanical work each run.

| Script | Purpose |
|--------|---------|
| [`scripts/completeness-scan.sh`](scripts/completeness-scan.sh) | Anti-stub regex (TODO/FIXME/empty-impl/DISABLED_) on staged diff; JSON output; exit 1 ⇒ quality-pipeline completeness gate. |
| [`scripts/check-redispatch-prompt.sh`](scripts/check-redispatch-prompt.sh) | Leaky-phrase linter for round-2+ re-dispatch prompts. Exit 1 ⇒ strip and retry. |
| [`scripts/diff-file-list.sh`](scripts/diff-file-list.sh) | Changed-file list as a Verified Clean markdown checklist. |
| [`scripts/diff-scope-report.sh`](scripts/diff-scope-report.sh) | v2 scope-creep candidate filter: whitespace-only, comment-only hunks, quote-style swaps. |
| [`scripts/resolve-dispatch.sh`](scripts/resolve-dispatch.sh) | Role → `{model, mode, agent}` JSON. Consults `.claude/model-routing-config.md`. |
| [`scripts/verify-preexisting.sh`](scripts/verify-preexisting.sh) | Test failure classification: PRE_EXISTING / INTRODUCED / NO_FAILURE / INCONCLUSIVE. |
| [`scripts/risk-counter.sh`](scripts/risk-counter.sh) | Persistent WTF-Likelihood Cap counter. Subcommands: `status`, `increment`, `threshold-hit`, `reset`. |
| [`scripts/diff-since-last-round.sh`](scripts/diff-since-last-round.sh) | Round-N checkpoint + delta-since-checkpoint. |
| [`scripts/validate.sh`](scripts/validate.sh) | Validate every skill's SKILL.md structure. |
| [`scripts/dev-setup.sh`](scripts/dev-setup.sh) | One-time local-dev setup. |
| [`scripts/sync-version.js`](scripts/sync-version.js) | Sync version across `package.json`/skills metadata. |

---

## 🚦 Multi-Agent Considerations
- Consult **[references/multi-agent-portability.md](file:///home/codepower/projects/autopilot/references/multi-agent-portability.md)** for detailed environment comparisons (Claude Code vs. Codex vs. `agy`) and compatibility guidelines.
- Never write hardcoded, platform-exclusive hook path variables in JS/Bash. Refer to the portability document for the fallback chains.

---

## 🔴 Severity Vocabulary

Unified across all skills and agents:
```
🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
```

---

## 🔕 Reply Preference
Inherit from `~/.claude/CLAUDE.md` (Traditional Chinese, terse decisions like `go`/`A`/`1` accepted). For docs and code, English unless content is user-facing localization.

---

## ❌ Don'ts
- Don't hardcode dispatch model/mode in skill files — use `scripts/resolve-dispatch.sh`.
- Don't write "manually check for TODO/FIXME" in a reference doc — call `scripts/completeness-scan.sh`.
- Don't enumerate forbidden phrases inline in code-review logic — call `scripts/check-redispatch-prompt.sh`.
- Don't introduce new severity vocabulary — use the unified 4-tier above.
- Don't add a second canonical statement of "what the reviewer reads" — code-review.md Invocation § is canonical; reviewer.md Workflow §1 references it.
- Don't add Claude Code-only hook logic or OpenCode-only plugin logic without a portability assessment — check `references/multi-agent-portability.md` first.
