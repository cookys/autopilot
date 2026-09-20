Implement Phases 1, 2 and 3 of docs/plans/_archive/2026/09/2026-09-14-backlog-entry-schema.md (read it first: §2.5 Global Constraints, §3 file map, §4 Phases 1–3). Phase 4 (migration, block flip) is OUT of scope. You edit files only; the harness commits. Do not bump the version, do not edit CHANGELOG.md, do not run `git stash`, never push.

Every path you create or modify MUST be one of these (the contract's output_paths; anything else rejects the round):
.claude/backlog-config.md
CLAUDE.md
docs/scripts-inventory.md
hooks/tests/check-backlog-entries.test.sh
hooks/tests/resolve-project-paths.test.sh
platforms/codex/plugin/project-config-template/backlog-config.md
platforms/codex/plugin/references/backlog-entry.md
platforms/codex/plugin/scripts/check-backlog-entries.js
platforms/codex/plugin/scripts/resolve-project-paths.sh
platforms/codex/plugin/scripts/scaffold-config.js
platforms/codex/plugin/skills/dev-flow/SKILL.md
platforms/codex/plugin/skills/finish-flow/SKILL.md
platforms/codex/plugin/skills/handoff/SKILL.md
platforms/codex/plugin/skills/onboard/SKILL.md
platforms/codex/plugin/skills/project-lifecycle/references/templates.md
platforms/codex/plugin/skills/quality-pipeline/SKILL.md
platforms/codex/plugin/skills/quality-pipeline/references/code-review.md
project-config-template/backlog-config.md
references/backlog-entry.md
scripts/check-backlog-entries.js
scripts/resolve-project-paths.sh
scripts/scaffold-config.js
skills/dev-flow/SKILL.md
skills/finish-flow/SKILL.md
skills/handoff/SKILL.md
skills/onboard/SKILL.md
skills/project-lifecycle/references/templates.md
skills/quality-pipeline/SKILL.md
skills/quality-pipeline/references/code-review.md

## Phase 1 — references/backlog-entry.md (the ONLY place the field list lives)
Fields with UTF-8 BYTE caps: Title 120 (one line, unique per file case-insensitively, no trailing period); Status 64 (`open` | `fired <YYYY-MM-DD>` | `shipped <version-or-sha>` | `dropped <YYYY-MM-DD>`); Trigger 240; Effort ∈ {S, Fix, M, L, H}; Source 160; Pointer 200 (a path under a configured pointer_roots that EXISTS, or an id matching id_pattern; `none` allowed only when the whole entry ≤ 600 B); Context 240, optional. Entry cap 900 B; nothing but these fields (an extra bullet, sub-list or code fence is `extra_content`). State the pointer rule: numbers, logs, stacks, narratives, more than one sentence of context live at the pointer; preferred targets in order: existing docs/plans/…, existing docs/projects/…, ticket id, sidecar docs/backlog/<slug>.md. Describe the three styles: `heading` (`### Title` + `- **Field**: value` bullets), `table` (`| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |`), `checklist` (`- [ ] [Severity] Title` + indented `- Field: value`; Severity is a tag, not a field). Done handling: shipped/dropped rows older than done_retention_days (default 30) are `done_not_moved`; the fix is deleting the row. Keep it under 6 KB; it must pass `node scripts/check-reference-sizes.js`.

## Phase 2 — scripts/check-backlog-entries.js (Node ≥ 20.10, built-ins only, no markdown library)
CLI: `--backlog <file>` (required) `[--config <file>] [--allowlist <file>] [--mode warn|block] [--json] [--self-test] [--update-allowlist]`. Config resolution: `--config`, else `bash scripts/resolve-project-paths.sh --target <repo> --field backlog_config` when it prints a path (not `none`), else built-in defaults (style heading, pointer_roots docs/plans/ docs/projects/ docs/backlog/, mode warn, done_retention_days 30). The repo root is `git rev-parse --show-toplevel` of the backlog's directory; pointers resolve against it, never against cwd. A consumer config may only LOWER a cap (`config_raises_cap` otherwise).
Violation codes (stable strings): missing_field, cap_exceeded, bad_status, bad_effort, pointer_missing, pointer_unresolved, pointer_required, duplicate_title, duplicate_id, extra_content, done_not_moved, unparseable_entry, config_raises_cap. An unparseable block is a violation, never skipped.
Allowlist JSON `{"schema":1,"entries":[{"fingerprint":"<sha256 of style + ':' + lowercased trimmed title>","codes":["..."]}]}`. A violation whose (fingerprint, code) is listed is `allowed`, otherwise `new`. `block` mode exits 1 when any `new` exists; `warn` exits 0 with the full report. `--update-allowlist` rewrites the file keeping ONLY pairs still violating — it can never add a pair; if it would need to, print the pairs and exit 1.
Output JSON on stdout: `{mode, backlog, style, entries, bytes, violations:[{code,title,field,detail,allowed}], new_count, allowed_count, exit}`. Exit 0 clean-or-warn, 1 block with new violations, 2 usage/unreadable/self-test failure. `--self-test` runs the parser and every code against embedded fixtures (one per style; one fixture per code) and exits 0 only when each code fires exactly where expected.
Test hooks/tests/check-backlog-entries.test.sh (use `. "$(dirname "$0")/lib.sh"`, `assert_eq <actual> <expected> <msg>`, `assert_contains <haystack> <needle> <msg>`, end with `finalize_test`): red-first — every code on a fixture; three styles; ratchet (a run that would add fails; --update-allowlist removes a fixed pair and refuses to add); pointer resolves against repo root not cwd; UTF-8 caps (a 3-byte CJK char counts 3); fenced code block ⇒ extra_content; `--self-test` exits 0; a mutated self-test fixture would exit 2 (prove it can fail).

## Phase 3 — DI + writers
- project-config-template/backlog-config.md: markdown config in the same shape as the other templates there, with keys `style`, `pointer_roots` (list), `id_pattern`, `mode`, `allowlist_path`, `done_retention_days`, and optional `caps.<field>` overrides (lower only). Copy it to .claude/backlog-config.md for this repo with `style: heading`, `mode: warn`, `allowlist_path: .claude/backlog-debt.json`.
- scripts/resolve-project-paths.sh: add field `backlog_config` = the target's `.claude/backlog-config.md` when it exists, else `none`; `--field backlog_config` works; extend hooks/tests/resolve-project-paths.test.sh (declared / absent ⇒ none).
- scripts/scaffold-config.js: emit backlog-config.md alongside the other templates (style `table` when an existing backlog file's first non-blank line starts with `|`, else `heading`).
- skills/onboard/SKILL.md: one sentence naming backlog-config.md among the scaffolded configs.
- Replace every "add to BACKLOG with context + trigger" style line (skills/dev-flow/SKILL.md ≈ lines 281, 476, 555, 584; skills/finish-flow/SKILL.md S.2, L-5.6, H-9.6; skills/quality-pipeline/SKILL.md line ≈173–178; skills/handoff/SKILL.md step 3.5 table row; skills/quality-pipeline/references/code-review.md §Backlog Entry Format ≈321–332; skills/project-lifecycle/references/templates.md) with ONE sentence linking `references/backlog-entry.md` (relative link from that file's location) — no field list anywhere but the reference. Keep code-review.md's "No trigger → rejected" sentence. finish-flow S.2 and quality-pipeline additionally say: run `node scripts/check-backlog-entries.js --backlog <resolved backlog>` (warn mode).
- After Phase 3: `grep -rn 'context + trigger' skills/` returns nothing.

## Wiring
docs/scripts-inventory.md: one row for check-backlog-entries.js (purpose, when, pointer to the reference). CLAUDE.md: add `check-backlog-entries.js` to the "Diff scanning & anti-gaming" group list. Mirror: run `bash scripts/sync-codex-plugin-skills.sh` so platforms/codex/plugin/... copies match; never hand-edit mirrors.

## Verification you must leave green
bash hooks/tests/check-backlog-entries.test.sh; node scripts/check-backlog-entries.js --self-test; bash hooks/tests/resolve-project-paths.test.sh; node scripts/check-js-syntax.js; node scripts/check-claude-md-inventory.js; bash scripts/sync-codex-plugin-skills.sh --check; node scripts/check-reference-sizes.js. Also run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (warn) once and make sure it exits 0 and reports violations rather than crashing on the real 233 KB file.
