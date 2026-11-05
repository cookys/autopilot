# autopilot — project conventions (Claude Code)

## Goal

- End goal: 3.0.0 這條線（開發中版號 3.0.0-alpha.N 遞增；3.0.0 正式版即操作員說的「3.0.0.0 大版」）：開發 repo 照 10/31 定稿完整重排，再用白名單匯出成新的 public repo 發佈，開發 repo 轉為私有。同一條線上加入「角色套件」，讓弱模型也能做出好結果；評測證明有效之後，才改成預設。
- Current milestone: 完成重排 P2–P5 和匯出工具；角色套件先做小規模試驗（pilot），由 PM 判定是否過門檻。backlog 從 146 條整理到約 82 條。
- Not goals now: 升版到 3.1；hosted CI；改名、轉私有、建 public repo（這三件要 operator 本人動手）。
- Source: 出處：10/31 定稿 addendum C；operator 11/5 說的「盤點完，全部 refactor」、角色套件的方向，d-c76529c3「做，撥額度」，以及 11/5 版號規則（3.0.0.0 大版、開發中 alpha 遞增）。；操作員 d-fb9989dc 定案（2026-11-05）

For Claude Code sessions working **on** the autopilot plugin itself. Skill-runtime conventions live in each skill's `SKILL.md`. Other agents (Codex, OpenCode, Antigravity): [`AGENTS.md`](AGENTS.md); portability: [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

Original wording of the rules shortened here: [`docs/dev/_archive/entry-docs/claude-md-detail.md`](docs/dev/_archive/entry-docs/claude-md-detail.md). Directory rules load when a session reads or edits a file there: `scripts/CLAUDE.md`, `skills/CLAUDE.md`, `references/CLAUDE.md`, `platforms/CLAUDE.md`, `mods/CLAUDE.md`. A path assembled inside a script does not trigger the load, so every rule that causes damage when missed is also kept below, in one line.

## What this repo is

Standalone lifecycle orchestration plugin: 30 skills, 3 methodology agents, 40 hooks (26 default-on,
14 opt-in). Optional integrations and coexistence rules: [`docs/guide/coexistence.md`](docs/guide/coexistence.md).

## Scripts (prefer over LLM judgment)

`scripts/` ships deterministic tooling the skills use instead of LLM judgment. **Before hand-coding any mechanical step, check whether a script already covers it**: group index below, full name list in `scripts/CLAUDE.md`, descriptions in [`docs/scripts-inventory.md`](docs/scripts-inventory.md).

- A script existing is not evidence it is running: when one is meant to protect something, check that it actually fires; read [`references/evidence-discipline.md`](references/evidence-discipline.md) before recording anything as verified.
- Every new or modified check (gate, hook, scan) ships a negative control: a deliberately broken case shown red before green ([evidence-discipline §58](references/evidence-discipline.md)).
- Some scripts do not parse argv at all, and a few of those are installers that act immediately, so `--help` runs them: read the header comment of an unfamiliar script first.
- A new script is dead code until wired into the reference doc, the SKILL.md table, `docs/scripts-inventory.md` and the name list in `scripts/CLAUDE.md`.
- A script that parses JSON or could run under agy is Node built-ins only; bash only for pure git glue (table in `scripts/CLAUDE.md`).

**Group index** (names are examples; the whole list is in `scripts/CLAUDE.md`):

- **Dispatch rails**: `dispatch-hetero.sh` `dispatch-review.sh` `dispatch-author.sh` `dispatch-foreman.sh` `dispatch-consult.sh`
- **Routing & config resolution**: `resolve-dispatch.sh` `resolve-endpoint.sh` `resolve-qc-gate.sh` `resolve-execution-profile.js`
- **Worktree, mission & session state**: `reap-dispatch-worktrees.sh` `scaffold-mission.js` `next-pick.js` `stage-advance.js`
- **Engine capability & qualification**: `engine-scorecard.js` `engine-qualify.sh` `probe-engine-capability.sh`
- **Diff scanning, verification & review**: `completeness-scan.sh` `secret-scan-diff.js` `check-test-integrity.sh` `verify-red-green.sh` `adjudicate-findings.js`
- **Sync, drift & release gates**: `sync-all.sh` `sync-version.js` `validate.sh` `preflight-release.sh` `check-hook-inventory.js`
- **Setup & install**: `dev-setup.sh` `install-hooks.sh` `project-detect.js` `scaffold-config.js`
- **Skills tooling & shared primitives**: `cost-digest.js` `lib/json-emit.sh` `lib/jsonl-store.js` `lib/config-path.js`

## Skill evolution rules (full text: `skills/CLAUDE.md`)

- Boy-scout: any touch of a skill trims it toward contract-card shape ([`references/skill-contract-card.md`](references/skill-contract-card.md)).
- Scorecard-first: rewriting or deleting a skill needs prior eval ON/OFF evidence.
- Mechanism vs guidance: making an already-stated gate genuinely block needs no eval; changing what it demands does. A mechanism change must not also edit the requirement text; ship them as two commits.

## Severity vocabulary

Unified across all skills and agents:

```
🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
```

If you see "Important" anywhere in a severity context, that's a leftover from the old vocabulary — fix it. The dialectic skills (`think-tank`, `think-tank-dialectic`) use a separate **risk** tagging vocabulary (`critical / important / minor`, lowercase) which is intentionally distinct.

## Versioning

Bump with `scripts/sync-version.js` only. 3.0.0 final is the operator's "3.0.0.0 major"; during development a bump uses 3.0.0-alpha.N continuing from alpha.7 (never back to alpha.1). Whoever pushes to `origin` second yields a colliding number. Bump table and collision procedure: [`docs/dev/versioning.md`](docs/dev/versioning.md).

## Process rules

- With `superpowers` installed, orchestrators consult `.claude/dispatch-config.md` (defaults: [`project-config-template/dispatch-config.md`](project-config-template/dispatch-config.md)).
- Mission graphs: node `verification_commands` stay fast and fixed, never `bash hooks/tests/run.sh`; the whole suite runs once, alone, on this host before a campaign merges into `develop`, and red means no merge. Sealed graphs keep their existing chain; editing one breaks its pinned digest.
- The merge gate runs `check-phase-review-receipt.js` against the branch tip being merged, never the last reviewed head; any product-code delta after the reviewed head needs its own review, and at the generation cap only a PM ruling plus a post-head ledger passes ([`skills/dev-flow/references/hetero-loops.md`](skills/dev-flow/references/hetero-loops.md)).
- No hosted CI (operator): suites and the merge gate run locally; never add a hosted workflow. The remaining checks.yml / website.yml are retired by G39.
- Destructive or irreversible ops (force-push, history rewrite, mass delete, `reset --hard`, overwriting live config) need a snapshot, a stated blast radius and explicit operator confirmation; never read, print or copy credentials, and give dispatch children a throwaway config dir seeded with only `.credentials.json`, never the real `~/.claude` ([`references/hetero-dispatch.md`](references/hetero-dispatch.md)).
- A dispatch brief that relies on rules in a subdirectory must say "read <subdir>/AGENTS.md first".

## Where context lives

| Topic | File |
|-------|------|
| Skill execution rules | `skills/<name>/SKILL.md` |
| Methodology agent prompts | `agents/{reviewer,debugger,planner}.md` |
| Engine CLI / orchestration layer | `bin/autopilot.js`, `src/engine/`, `src/runners/` |
| Cross-skill references | `references/{blind-dispatch,model-routing}.md` |
| Project tracking | `docs/projects/` (active + `_archive/`) |
| Backlog | `project/backlog/BACKLOG.md` |
| Plans | `docs/plans/` — registered in `project/projects/INDEX.md` (Version `active`; `scripts/check-plan-graduation.js`'s `plan_unregistered` gate) |
| Architecture decisions | `docs/adr/` (ADR-0001: verification over attestation — binding on governance work) |
| Release notes | `CHANGELOG.md` |
| Per-session gotchas | `~/.claude/projects/-home-cookys-projects-autopilot/memory/` |
| Dogfood / coexistence knowledge | `.claude/knowledge/` — read `INDEX.md` first. Gitignored on purpose: a write there is not saved until `git add -f` + commit (`references/knowledge-routing.md`) |
| Directory rules (loaded on first touch) | `scripts/CLAUDE.md`, `skills/CLAUDE.md`, `references/CLAUDE.md`, `platforms/CLAUDE.md`, `mods/CLAUDE.md`; mod surface colour/emphasis rules in `mods/CLAUDE.md` |

## Reply preference

Inherit from `~/.claude/CLAUDE.md` (Traditional Chinese, terse decisions like `go`/`A`/`1` accepted). For docs and code, English unless content is user-facing localization.

## Don't

- Don't `cat` a file or diff and retype it when the user asks to see it: call the `show` tool (`mcp__autopilot__show`, `path` or `diff`). It displays to the user only and returns one line, so the text never enters context; read the file separately if you need to analyze it.
- Don't hardcode dispatch model/mode in skill files — use `scripts/resolve-dispatch.sh`.
- Don't write "manually check for TODO/FIXME" in a reference doc — call `scripts/completeness-scan.sh`.
- Don't enumerate forbidden phrases inline in code-review logic — call `scripts/check-redispatch-prompt.sh`.
- Don't introduce new severity vocabulary — use the unified 4-tier above.
- Don't add trust machinery (hash chains, event ledgers, witness receipts, attestation, trust roots) — settled by [ADR-0001](docs/dev/adr/0001-verification-over-attestation.md); verification is independent re-derivation, never tamper-evidence of a claim.
- Don't add a second canonical statement of "what the reviewer reads" — code-review.md Invocation § is canonical; reviewer.md Workflow §1 references it.
- Don't append per-release notes to a Scripts-inventory row — `CHANGELOG.md` owns history; the row is an index entry (see Row shape rule).
- Don't claim cross-platform env vars or CLI subcommands without verifying — by official doc URL OR by running the real tool. Both fabrication (`CODEX_PLUGIN_ROOT` etc. shipped to main) and over-correction (`agy plugin validate` wrongly called fabricated) happened; no URL or tool run means a Spike candidate, not a fact. See [`references/multi-agent-portability.md`](references/multi-agent-portability.md) "Corrected — previously mislabelled" §.
