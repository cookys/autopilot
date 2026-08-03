# autopilot — Agent Instructions

This file follows the [agents.md](https://agents.md/) convention: a single agent-facing readme that any coding agent (Claude Code, OpenCode, Codex, Antigravity, Cursor, Aider, …) can read on entry to this repository. Sections below follow the spec's recommended four-section structure (Project Structure / Coding Conventions / Testing / PR Guidelines) plus two autopilot-added sections (Build / Contribution).

For Claude Code-specific conventions, see [`CLAUDE.md`](CLAUDE.md). For cross-agent portability detail (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

---

## Project Structure (spec)

```
skills/              28 lifecycle/methodology skills (SKILL.md format)
agents/              3 methodology agents (reviewer, debugger, planner) — markdown body + YAML frontmatter
hooks/               Claude Code hooks (bash + JS) and hooks.json manifest
platforms/codex/     Codex skills-only plugin package + repo-local marketplace
.opencode/           OpenCode wrapper (opencode.json, in-process TS plugin)
.claude-plugin/      Claude Code plugin manifest (canonical for version + description)
plugin.json          Root mirror of .claude-plugin/plugin.json (for non-Claude tools)
references/          Cross-skill reference docs (blind-dispatch, model-routing, portability)
scripts/             Deterministic tooling — prefer these over LLM judgment for mechanical work
docs/                projects/ (active + archive), plans/, BACKLOG.md, CHANGELOG.md
.githooks/           Repo-tracked pre-commit hooks (activated via scripts/install-hooks.sh)
```

Skill body is in `skills/<name>/SKILL.md`. Methodology agent prompt body is in `agents/<role>.md`. Hooks live in `hooks/` and are registered via `hooks/hooks.json`.

## Coding Conventions (spec)

- **Severity vocabulary** (unified across skills + agents): `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`. The dialectic skills (`think-tank*`) use a separate lowercase `critical / important / minor` tag for risk-not-severity — intentionally distinct.
- **No hardcoded dispatch metadata** in skill files. Use `scripts/resolve-dispatch.sh` to map role → `{model, mode, agent}` JSON.
- **Prefer scripts over LLM judgment** for mechanical work (regex scans, JSON parsing, diff filtering). When you write a new script, wire it into both `CLAUDE.md` scripts inventory and the relevant skill's "Available Scripts" table.

## Change Policy (autopilot-added)

- **Compatibility**: preserve published and user-facing contracts by default. Remove internal compatibility shims after every in-repository consumer is migrated; do not retain them speculatively.
- **Authorized breaking changes**: a deliberate public break requires explicit authorization, a versioning decision, migration notes, CHANGELOG coverage, rollback guidance, and contract validation.
- **Simplicity**: choose the least lifecycle-complex implementation that fully satisfies the current requirements; do not optimize only for line count or initial implementation speed.
- **Reuse order**: prefer, in order, the platform or standard library, an existing dependency, an established well-maintained library, then a custom implementation.
- **New dependency bar**: justify maintenance health, license compatibility, transitive footprint, and supported-platform fit before adding a dependency.

## Testing (spec)

- **Skill structure**: `scripts/validate.sh` validates every `SKILL.md` has the required YAML frontmatter (`name`, `description`) and structure.
- **Version manifest sync**: `node scripts/sync-version.js --check` (read-only) verifies the version mirrors (root `plugin.json`, `marketplace.json`, `README.md` version badge) + the description's skill/hook fragments match the canonical `.claude-plugin/plugin.json`. Run before any commit that touches version metadata.
- **Hook inventory drift**: `node scripts/check-hook-inventory.js --check` (read-only) is the single source of truth for the hook tally — it derives default-on/opt-in/disabled from real wiring (`hooks/hooks.json` + `hooks/opt-in-manifest.json`) and asserts every doc agrees on counts AND tier membership. Run it (no flag) to print the canonical lists when editing the hook docs.
- **Hooks runtime smoke test**: `CLAUDE_PLUGIN_ROOT=$(pwd) node hooks/intent-capture.js < /dev/null` should write to `~/.autopilot/intent/` without throwing.
- **Pre-commit gate**: After running `scripts/install-hooks.sh` once per clone, `git commit` runs a fail-fast gate (`.githooks/pre-commit`): always `sync-version.js --check`, `sync-agent-bodies.sh --check`, the `blind-dispatch.md` issue-ref grep, and `check-canonical-invariants.sh`; plus change-scoped `check-readme-parity.js` (when a README is staged) and `check-hook-inventory.js --check` (when hooks or a count-bearing mirror is staged). Any drift blocks the commit.

## Build (autopilot-added)

- **No build step for production**. Skills, agents, hooks ship as source. Claude Code loads them at plugin install time.
- **Codex package** (`platforms/codex/plugin`) is skills-only at the manifest level. Its marketplace entry lives at `platforms/codex/.agents/plugins/marketplace.json`; `platforms/codex/plugin/skills` plus linked support files are generated by `scripts/sync-codex-plugin-skills.sh`. Never add Claude hooks to this package without a probed Codex hook adapter phase.
- **OpenCode plugin** (`.opencode/plugins/autopilot.ts`) is loaded by Bun in-process — no compilation, but `@opencode-ai/plugin` types are needed at edit time (see `.opencode/package.json`).
- **Version bump**: `node scripts/sync-version.js --version X.Y.Z --hook-count N --skill-count M --opt-in-count K --disabled-count X` propagates the new version + description fragments to all mirrors atomically, including the Codex package manifest version (two-pass; fail-loud on regex drift). `--opt-in-count`/`--disabled-count` are **preserved from the canonical manifest when omitted** (NOT defaulted to 0 — omitting them while passing `--hook-count` would otherwise corrupt the 3-tier description); default-on = hook-count − opt-in − disabled. Hook-count correctness itself is gated separately by `check-hook-inventory.js --check`.
- **Dev mode for Claude Code**: `scripts/dev-setup.sh` replaces the installed plugin cache with a symlink to your local clone. Edits take effect immediately.

## PR Guidelines (spec)

- **Branch naming**: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`. For multi-phase work, use `<type>/v<version>-<short-name>` (e.g. `fix/v2.7.3-multi-agent-portability-correction`).
- **Commit messages**: Conventional Commits style (`type(scope): summary`). Co-authored-by lines are welcome for AI-assisted commits.
- **One logical change per commit**. For phased work, each phase = independent commit (bisect-friendly).
- **Severity in PR descriptions**: when listing reviewer findings, use the unified `🔴 / 🟠 / 🟡 / 🔵` vocabulary.

## Contribution (autopilot-added)

- **Plans go in `docs/plans/`** with date prefix (`YYYY-MM-DD-<name>.md`). Plans capture: background, design decisions, implementation steps, acceptance criteria, risks, out-of-scope items, open questions.
- **Reviews are dialectic**. For non-trivial changes, prefer 3-perspective review (Architect / Ops / Skeptic) — each spawned in parallel with disjoint focus. Findings get tagged with the unified severity vocabulary and consolidated in a review summary table within the plan.
- **Spike before assert**. Any cross-platform claim (env var, CLI subcommand, directory path) MUST be verified — by official-doc URL or by running the real tool — before being written into reference material. The lesson cuts both ways: three multi-platform commits were reverted for LLM-fabricated env vars and CLI subcommands; then the correction *over-corrected* (labelled `agy plugin validate` and the root-`plugin.json` requirement as fabricated), and only installing real `agy` 1.0.1 settled it — both are genuine. Second-hand survey/WebFetch can be stale; prefer running the tool when it's installable.

---

## Orchestration Discipline (learned, cross-controller)

Rules distilled from real long-run transcripts of this repo's 2026-07 Mission/L6 campaigns. They bind ANY depth-0 controller driving this repo (Claude Code, Codex, OpenCode, Antigravity, …) — the failures they encode were produced by more than one controller. Machine-enforced versions are landing via `docs/BACKLOG.md` § "P0 — Controller execution discipline"; until every gate ships, treat these as binding methodology, not suggestions.

### Orchestration granularity (phase-explosion prevention)

- Source-plan phase headings (`P0..PN`) are the author's *document* structure, NOT execution phases. Multi-plan intake first normalizes into a bounded deliverable DAG — default max 8 deliverables. Tests, review seats, repair generations, and doc sync are gates INSIDE a deliverable, never new deliverables or phases.
- Every deliverable binds its source plan/rubric, dependencies, acceptance command, resource reservation, and gate-attempt budget; the totals stay under the Mission ceiling.
- A review or test failure is repaired inside its original deliverable. Adding a phase to hide a retry is forbidden. A new branch/session/ticket/model must NOT reopen an unresolved Mission's lineage, graph, or budget without a reconciled terminal receipt.
- Self-check: if the tracker row count equals the sum of all source-plan phase counts, stop — document segmentation has been mistaken for execution segmentation. (Origin: a 2026-07-28 portfolio run expanded 7 plans into 34 rows ≈ 238 workflow nodes; compaction amplified the damage, but granularity without a ceiling was the root cause.)

### Dispatch / foreman clauses (each missing clause has burned a full round)

- Hand-authoring substance at the orchestrator level = protocol violation, even when the output is good. "The engine isn't up to this" is an ESCALATION, never a license to implement at depth-0 — decorrelation-by-generation is the point, quality does not exempt it.
- Read the raw child log BEFORE classifying a failure. A quota death ("You've hit your usage limit") has been misclassified as a model question, wasting two dispatch rounds before a human read the log.
- Env vars and the command consuming them must be in the SAME shell invocation — exports do not survive across separate tool calls.
- Prefer one blocking wait (long-timeout foreground command, or the harness's background-task notification) over polling loops when babysitting a child process. Polling burns context, which forces compaction, which loses controller state — the compounding is worse than the wait.
- Shell working directory may persist across tool calls. Before any git state operation (merge, `worktree remove`), pin an absolute path or start with an explicit `cd <repo-root> &&`. Before resuming an agent into a worktree, verify the tree still exists (`git worktree list`) — auto-cleaned worktrees make a resumed agent silently operate on the main checkout.

### CI / test-log reading

- The only authority for which test files failed is the runner's Summary section (the `❌ N / M test files FAILED:` list) or a file's own `PASS [name] N assertions` line. `grep FAIL` over a CI log also matches fixtures' intentional negative-path output — identical lines exist in green runs — and has doubled a repair scope before. Cross-check the same log section in a known-green run to unmask fixture output.
- GitHub Actions `run:` steps without an explicit `shell:` default to `bash -e {0}` — NO pipefail. Any `cmd | tee` pipeline silently swallows the command's failure → false-green CI. Steps that pipe a test command must set explicit `shell: bash` (or lead with `set -o pipefail`). Verify by intentionally breaking one test and confirming CI goes red.

---

## Cross-Platform Notes (factual)

Each platform reads different config files and uses different skill discovery paths. See [`references/multi-agent-portability.md`](references/multi-agent-portability.md) for the verified facts table with source URLs.

Skill-sharing paths by platform: **OpenCode** scans `.agents/skills/` natively (verified empirically, OpenCode 1.15.10). **Codex** can use `.agents/skills/` from the repo and can also install the skills-only package under `platforms/codex/plugin` through the repo-local marketplace (verified empirically, codex-cli 0.142.5). **Antigravity** does NOT scan a loose skills dir — it imports the whole repo as a plugin via `agy plugin install <repo>` (verified empirically, `agy` 1.0.1), registering skills + agents + hooks. SKILL.md format (YAML frontmatter + Markdown body) is the de facto standard across all four platforms.
