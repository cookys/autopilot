# Original wording of rules summarised in the root AGENTS.md

BL-0383 shortened the root `AGENTS.md` to under 10 KB. Each line below is the original, unshortened text of a rule the root file now states in fewer words; it is kept here word for word so nothing is lost. Shown in a code block because the relative links in the original lines were written for the repo root.

```text
This file follows the [agents.md](https://agents.md/) convention: a single agent-facing readme that any coding agent (Claude Code, OpenCode, Codex, Antigravity, Cursor, Aider, …) can read on entry to this repository. Sections below follow the spec's recommended four-section structure (Project Structure / Coding Conventions / Testing / PR Guidelines) plus two autopilot-added sections (Build / Contribution).

For Claude Code-specific conventions, see [`CLAUDE.md`](../../CLAUDE.md). For cross-agent portability detail (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](../../references/multi-agent-portability.md).

Skill body is in `skills/<name>/SKILL.md`. Methodology agent prompt body is in `agents/<role>.md`. Hooks live in `hooks/` and are registered via `hooks/hooks.json`.

- **Severity vocabulary** (unified across skills + agents): `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`. The dialectic skills (`think-tank*`) use a separate lowercase `critical / important / minor` tag for risk-not-severity — intentionally distinct.

- **Prefer scripts over LLM judgment** for mechanical work (regex scans, JSON parsing, diff filtering). When you write a new script, wire it into both `CLAUDE.md` scripts inventory and the relevant skill's "Available Scripts" table.

- **Compatibility**: preserve published and user-facing contracts by default. Remove internal compatibility shims after every in-repository consumer is migrated; do not retain them speculatively.

- **Authorized breaking changes**: a deliberate public break requires explicit authorization, a versioning decision, migration notes, CHANGELOG coverage, rollback guidance, and contract validation.

- **Simplicity**: choose the least lifecycle-complex implementation that fully satisfies the current requirements; do not optimize only for line count or initial implementation speed.

- **Reuse order**: prefer, in order, the platform or standard library, an existing dependency, an established well-maintained library, then a custom implementation.

- **New dependency bar**: justify maintenance health, license compatibility, transitive footprint, and supported-platform fit before adding a dependency.

- **Skill structure**: `scripts/validate.sh` validates every `SKILL.md` has the required YAML frontmatter (`name`, `description`) and structure.

- **Version manifest sync**: `node scripts/sync-version.js --check` (read-only) verifies the version mirrors (root `plugin.json`, `marketplace.json`, `README.md` version badge) + the description's skill/hook fragments match the canonical `.claude-plugin/plugin.json`. Run before any commit that touches version metadata.

- **Hook inventory drift**: `node scripts/check-hook-inventory.js --check` (read-only) is the single source of truth for the hook tally — it derives default-on/opt-in/disabled from real wiring (`hooks/hooks.json` + `hooks/opt-in-manifest.json`) and asserts every doc agrees on counts AND tier membership. Run it (no flag) to print the canonical lists when editing the hook docs.

- **Pre-commit gate**: After running `scripts/install-hooks.sh` once per clone, `git commit` runs a fail-fast gate (`.githooks/pre-commit`): always `sync-version.js --check`, `sync-agent-bodies.sh --check`, the `blind-dispatch.md` issue-ref grep, and `check-canonical-invariants.sh`; plus change-scoped `check-readme-parity.js` (when a README is staged) and `check-hook-inventory.js --check` (when hooks or a count-bearing mirror is staged). Any drift blocks the commit.

- **Branch naming**: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`. For multi-phase work, use `<type>/v<version>-<short-name>` (e.g. `fix/v2.7.3-multi-agent-portability-correction`).

- **Commit messages**: Conventional Commits style (`type(scope): summary`). Co-authored-by lines are welcome for AI-assisted commits.

- **Severity in PR descriptions**: when listing reviewer findings, use the unified `🔴 / 🟠 / 🟡 / 🔵` vocabulary.

- **Plans go in `docs/plans/`** with date prefix (`YYYY-MM-DD-<name>.md`). Plans capture: background, design decisions, implementation steps, acceptance criteria, risks, out-of-scope items, open questions.

- **Spike before assert**. Any cross-platform claim (env var, CLI subcommand, directory path) MUST be verified — by official-doc URL or by running the real tool — before being written into reference material. The lesson cuts both ways: three multi-platform commits were reverted for LLM-fabricated env vars and CLI subcommands; then the correction *over-corrected* (labelled `agy plugin validate` and the root-`plugin.json` requirement as fabricated), and only installing real `agy` 1.0.1 settled it — both are genuine. Second-hand survey/WebFetch can be stale; prefer running the tool when it's installable.

**Owner decision cards.** Open with `node scripts/open-decision.js open --question <q> --option <label>::<description> --option <label>::<description> --recommendation <label> --why <reason> --not-authorized <boundary>[:<why>]` (at least two `--option`, or `--free-text` for a question the owner answers by typing; `--not-authorized` is required: boundary is `read_only|reversible|external|irreversible|goal-change|scope-expansion|resources-2x|red-line`, and in an `/l3`–`/l6` session a class the DOA lets you decide alone is refused with exit 3; optional `--background`, `--recommendation`, `--why`, `--blocks`, `--source`, `--root-run-id`). Close with `node scripts/open-decision.js close --id <id>`. List with `node scripts/open-decision.js show`. Write the card id in the reply; when the owner answers with a message whose first line is `[待決回覆]`, act on the answer.

**Dispatch rails.** Selection table: [references/hetero-dispatch.md](../../references/hetero-dispatch.md).

- `scripts/dispatch-consult.sh` — advice-only consult

- `scripts/dispatch-discuss.js` — discuss seat

- `scripts/dispatch-explore.sh` — read-the-repo question

- `scripts/dispatch-plan-review.js` — plan-review session

- `scripts/dispatch-review.sh` — read-only review verdict

- `scripts/dispatch-batch.sh` — batch fan-out

- `scripts/dispatch-foreman.sh` — non-Claude foreman seat

- `scripts/dispatch-author.sh` — raw-prompt authoring

- `scripts/dispatch-hetero.sh` — worktree-isolated implementer
```
