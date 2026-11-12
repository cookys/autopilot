# autopilot — Agent Instructions

Follows the [agents.md](https://agents.md/) convention. Claude Code conventions: [`CLAUDE.md`](CLAUDE.md). Portability: [`references/multi-agent-portability.md`](references/multi-agent-portability.md). Original wording of the rules shortened here: [`docs/dev/_archive/entry-docs/agents-md-detail.md`](docs/dev/_archive/entry-docs/agents-md-detail.md).

Codex, agy and OpenCode do not descend into subdirectories: before working in `scripts/`, `skills/`, `references/`, `platforms/` or `mods/`, read that directory's `AGENTS.md` and the `CLAUDE.md` it names, in full.

---

## Project Structure (spec)

```
skills/              31 lifecycle/methodology skills (SKILL.md format)
agents/              3 methodology agents (reviewer, debugger, planner) — markdown body + YAML frontmatter
hooks/               Claude Code hooks (bash + JS) and hooks.json manifest
platforms/codex/     Codex skills + production PostCompact package + repo-local marketplace
.opencode/           OpenCode wrapper (opencode.json; plugin entry .opencode/plugin-package/server.ts)
.claude-plugin/      Claude Code plugin manifest (canonical for version + description)
plugin.json          Root mirror of .claude-plugin/plugin.json (for non-Claude tools)
references/          Cross-skill reference docs (blind-dispatch, model-routing, portability)
scripts/             Deterministic tooling — prefer these over LLM judgment for mechanical work
docs/                projects/ (active + archive), plans/, BACKLOG.md, CHANGELOG.md
.githooks/           Repo-tracked pre-commit hooks (activated via scripts/install-hooks.sh)
```


## Coding Conventions (spec)

- **Severity vocabulary**: `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion` (`think-tank*` skills use lowercase `critical / important / minor` risk tags).
- **No hardcoded dispatch metadata** in skill files. Use `scripts/resolve-dispatch.sh` to map role → `{model, mode, agent}` JSON.
- **Prefer scripts over LLM judgment** for mechanical work (regex scans, JSON parsing, diff filtering). When you write a new script, wire it into the name list in `scripts/CLAUDE.md` and the relevant skill's "Available Scripts" table.

## Change Policy (autopilot-added)

- Preserve published and user-facing contracts by default; remove internal compatibility shims once every in-repository consumer is migrated.
- A deliberate public break requires explicit authorization, a versioning decision, migration notes, CHANGELOG coverage, rollback guidance, and contract validation.
- Choose the least lifecycle-complex implementation; reuse order: standard library, existing dependency, well-maintained library, then custom; justify any new dependency.

## Testing (spec)

- **Skill structure**: `scripts/validate.sh` checks every `SKILL.md` has YAML frontmatter (`name`, `description`) and the required structure.
- **Version manifest sync**: `node scripts/sync-version.js --check` (read-only); run it before any commit that touches version metadata.
- **Hook inventory drift**: `node scripts/check-hook-inventory.js --check` (read-only) is the single source of truth for the hook tally.
- **Pre-commit gate**: after `scripts/install-hooks.sh` once per clone, `git commit` runs `.githooks/pre-commit` (version, agent-body, canonical-invariants and change-scoped readme/hook-inventory checks). Any drift blocks the commit.

## Build (autopilot-added)

- **No build step for production**: skills, agents and hooks ship as source.
- **Generated, never hand-edited**: `platforms/codex/plugin` is produced by `scripts/sync-codex-plugin-skills.sh`; never hand-edit it or add a Codex hook without a probed adapter phase. Read `platforms/AGENTS.md` first.

## PR Guidelines (spec)

- **Branch naming**: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`. Multi-phase work: `<type>/v<version>-<short-name>`.
- **Commit messages**: Conventional Commits style (`type(scope): summary`).
- **One logical change per commit**. For phased work, each phase = independent commit (bisect-friendly).
- **Severity in PR descriptions**: use the unified `🔴 / 🟠 / 🟡 / 🔵` vocabulary for reviewer findings.

## Contribution (autopilot-added)

- **Plans go in `docs/plans/`** with date prefix (`YYYY-MM-DD-<name>.md`).
- **Spike before assert**. Any cross-platform claim (env var, CLI subcommand, directory path) MUST be verified, by official-doc URL or by running the real tool, before it is written into reference material; the two-way lesson is in the `CLAUDE.md` Don't list.

---

## What autopilot gives you (any agent)

Codex and OpenCode do not receive the SessionStart injection, so they must read this table themselves and open `skills/<name>/SKILL.md`.

| Trigger | Skill |
|---------|-------|
| Starting code work, "I'm working on X", quick fix, hotfix, continuing from yesterday | `autopilot:dev-flow` |
| Research options, "what do others use", compare X vs Y, 業界怎麼做 | `autopilot:survey` |
| Strategic decision, need perspectives, tradeoff analysis, 要辯論一下 | `autopilot:think-tank` |
| Irreversible decision, genuine stalemate, Hegelian dialectic, 不可逆決策, 兩邊都有道理, 辯證一下 | `autopilot:think-tank-dialectic` |
| Full delegation, "get it done", CEO mode, 搞定, 全權處理 | `autopilot:ceo-agent` |
| Pre-commit/merge quality checks, "is this ready?" | `autopilot:quality-pipeline` |
| Archive project, bootstrap from plan, set up tracking | `autopilot:project-lifecycle` |
| Onboard a repo to autopilot, scaffold .claude config | `autopilot:onboard` |
| Save a lesson, "record this", knowledge audit | `autopilot:learn` |
| Retrospective, commit history analysis, 回顧 | `autopilot:retro` |
| What to work on next, /next, highest priority | `autopilot:next` |
| Compare two implementations, feature parity check | `autopilot:audit` |

**Owner decision cards.** `node scripts/open-decision.js open --executor <address> --question <q> --option <label>::<description> --option <label>::<description> --recommendation <label> --why <reason> --not-authorized <boundary>[:<why>]` (at least two `--option`, or `--free-text`). `--executor` (who carries out the answer; the PM address for a card the PM handles itself) and `--not-authorized` are required; boundary is `read_only|reversible|external|irreversible|goal-change|scope-expansion|resources-2x|red-line`, and in an `/l3`–`/l6` session a class the DOA lets you decide alone is refused (exit 3). Close with `close --id <id>`. `open` also takes `--due <ISO time|+4h|+1d>` (the card stays at the bottom, out of the pending count, until then) and `--kind remind` (a reminder: no options, ended with `done --id <id>`); `due-sweep` prints `DUE <id> <title>` once per card that fell due. Write the card id in the reply; when the owner's answer starts with `[待決回覆]`, act on it.

**Dispatch rails.** Selection table: [references/hetero-dispatch.md](references/hetero-dispatch.md). Scripts: `scripts/dispatch-consult.sh`, `dispatch-discuss.js`, `dispatch-explore.sh`, `dispatch-plan-review.js`, `dispatch-review.sh`, `dispatch-batch.sh`, `dispatch-foreman.sh`, `dispatch-author.sh`, `dispatch-hetero.sh`.

**Hetero review.** Follow `skills/hetero-review/SKILL.md`. Poll with `node scripts/dispatch-status.js` (`--run <run-id>`, or `--log <path>`, or `--list`). Wait with `node scripts/wait-dispatch-results.js --ledger <path> --expect <run_id>.<stage>` (optional `--timeout`, `--poll`, `--json`).

**Claude Code hooks only.** `Lane:`, `Budget-Ack:`, `Bash-Cap:`, and an `Engine:` header on subagent dispatch prompts are enforced by Claude Code hooks. On other platforms they are text conventions to follow by hand.

---

## Orchestration Discipline (learned, cross-controller; full text with evidence: `references/CLAUDE.md`)

These bind ANY depth-0 controller driving this repo.

- Depth-0 never hand-authors substance, even when the output is good; "the engine isn't up to it" is an ESCALATION, never a license.
- Read the raw child log BEFORE classifying a failure (a quota death was once misread as a model question).
- Env vars and the command consuming them go in the SAME shell invocation; exports do not survive across tool calls.
- Prefer one blocking wait over polling loops; polling burns context and forces compaction.
- A background agent parked on its own child is NOT auto-woken: on the child's completion, cross-check via the dispatcher's status query (never the agent's self-report), then wake it explicitly to harvest, advance, and not park again; budget a wake at every phase boundary.
- Never dispatch background work you cannot be woken for: use the harness's background notification or an armed self-polling wake, never a bare detached process.
- Before ANY git state operation (not only merge or `worktree remove`), pin an absolute path or start with `cd <repo-root> &&`; verify a worktree still exists (`git worktree list`) before resuming an agent into it.
- Source-plan phases are not execution phases: normalise into a bounded deliverable DAG (default max 8); tests, review seats, repair generations and doc sync are gates INSIDE a deliverable. Each deliverable binds source plan/rubric, dependencies, acceptance command, resource reservation and gate-attempt budget; total reservations stay under the Mission ceiling.
- Repair a failure inside its original deliverable; never add a phase to hide a retry; a new branch/session/ticket/model must NOT reopen an unresolved Mission's lineage, graph or budget without a reconciled terminal receipt. If the tracker row count equals the sum of all source-plan phase counts, stop: document segmentation has been mistaken for execution segmentation.
- Judge failed test files only from the runner's Summary section (the `❌ N / M test files FAILED:` list) or a file's own `PASS` line, never `grep FAIL` over a log; cross-check suspect output against the same log section in a known-green run.
- GitHub Actions `run:` steps default to `bash -e {0}` with NO pipefail: steps that pipe a test command need explicit `shell: bash` or `set -o pipefail`; verify by intentionally breaking one test and confirming CI goes red.

---

## Cross-Platform Notes (factual)

Platform config files and skill discovery differ; see [`references/multi-agent-portability.md`](references/multi-agent-portability.md) for the verified table with source URLs, and `platforms/CLAUDE.md` for skill-sharing paths and the Codex/OpenCode packages.
