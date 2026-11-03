# Plan — backlog entry migration (Phase 4 of the backlog entry schema)

> Status: execution plan derived from the G1-reviewed parent `2026-09-14-backlog-entry-schema.md` §4 Phase 4 ·
> Owner: cookys · Branch: develop · Frame: /l5 managed campaign for the tool; depth-0 applies it.

## 0. Context

Phases 1–3 shipped in v2.36.38: the schema (`references/backlog-entry.md`), the gate
(`scripts/check-backlog-entries.js`, warn mode), the DI template, and the writer links. The gate on this
repo's own `docs/BACKLOG.md` reports 153 entries, 235,390 B, 747 violations. Phase 4 is the tool that
moves the over-cap bodies out without losing a byte, and the flip of this repo to `block`.

## 1. Split

- **4a (this campaign, hetero hand)**: `scripts/migrate-backlog-entries.js` + `hooks/tests/migrate-backlog-entries.test.sh`
  + inventory wiring. The hand does NOT run the migration on the real backlog: the sidecar file names are
  not known before the script runs, and a sealed campaign enumerates every output path.
- **4b (depth-0, after merge)**: run the script on `docs/BACKLOG.md` with `--apply`, commit the sidecars,
  write `.claude/backlog-debt.json` with `--update-allowlist`-compatible shape from the gate's residual
  report, flip `.claude/backlog-config.md` to `mode: block`, record the four numbers in the CHANGELOG
  (pre-migration bytes, post-migration bytes, sidecars created, residual allowlist entries).

## 2. `scripts/migrate-backlog-entries.js` contract (Node ≥ 20.10, built-ins only)

```
migrate-backlog-entries.js --backlog <file> [--config <file>] [--out-dir docs/backlog] [--apply] [--json]
```

- Parses the backlog with the SAME grammar as the gate (require `./check-backlog-entries.js` exports or
  duplicate nothing: the gate must export its parser — add `module.exports` there if absent; the gate's
  CLI behaviour is unchanged and its suite stays green).
- For every heading-style entry that violates any cap or carries extra content:
  1. keep the schema fields; synthesise `Status` from the entry text when absent: a Trigger beginning
     `**FIRED` / `FIRED` → `fired <date found in the entry or today>`; `SHIPPED v<x>` / `~~…~~ — **SHIPPED` →
     `shipped <version> <date found or today>`; otherwise `open`. `Effort` normalised to the first
     `S|Fix|M|L|H` token, else `M`. `Source` truncated to its first 160 B on a word boundary with `…`.
  2. move EVERYTHING else (the original `Context`, extra bullets, sub-lists, fences, the untruncated
     Trigger/Source text) verbatim into `<out-dir>/<slug>.md` with the header
     `# <title>\n\nSource: docs/BACKLOG.md@<HEAD sha>, migrated <date>\n\n`; `<slug>` = title lowercased,
     non-alphanumerics → `-`, collapsed, trimmed to 80 chars, de-duplicated with `-2`, `-3`.
  3. set `Pointer` to the sidecar path; set `Context` to the first sentence of the original Context
     truncated to 240 B, or omit it.
  4. rewrite the entry in canonical heading style: `### Title` then `- **Status**`, `- **Trigger**`,
     `- **Effort**`, `- **Source**`, `- **Pointer**`, `- **Context**` (optional), blank line.
- Entries already within schema are rewritten byte-identically (idempotent: a second run is a no-op).
- The file header (everything before the first `###`) is kept verbatim.
- Manifest (stdout JSON, and `<out-dir>/MIGRATION-<date>.json` on `--apply`): per entry `{title, slug,
  bytes_before, bytes_after, moved_bytes, moved_sha256, sidecar}`; totals; `preserved: true` only when
  every `moved_sha256` is found verbatim inside its sidecar after writing (re-read from disk).
- `--apply` writes the backlog + sidecars + manifest atomically (tmp + rename per file); default prints
  the manifest and a unified diff of the backlog and writes nothing.
- Exit 0 (dry-run or preserved:true) · 1 (`--apply` and any entry not preserved — nothing written) · 2 usage.

## 3. Tests (`hooks/tests/migrate-backlog-entries.test.sh`)

Red-first: a fixture with (a) a within-schema entry (byte-identical after), (b) a fat entry with fences
and sub-bullets (moved text sha256 present in the sidecar; row ≤ 900 B; gate reports zero violations on
the rewritten row), (c) FIRED/SHIPPED trigger markers → Status synthesis, (d) duplicate titles → `-2`
slug, (e) CJK title → slug still valid, (f) dry-run writes nothing, (g) idempotence (apply twice, second
manifest has zero moved bytes), (h) a simulated sidecar write failure (unwritable out-dir) → exit 1 and the
backlog untouched, (i) the real `docs/BACKLOG.md` dry-run completes and reports ≥ 100 entries to migrate
(no crash on the real file).

## 4. Acceptance

`bash hooks/tests/migrate-backlog-entries.test.sh`; `bash hooks/tests/check-backlog-entries.test.sh`;
`node scripts/check-backlog-entries.js --self-test`; `node scripts/check-js-syntax.js`;
`node scripts/check-claude-md-inventory.js`; `bash scripts/sync-codex-plugin-skills.sh --check`.
Dry-run on the real backlog prints a manifest with `preserved: null` (nothing written) and a diff.

## 5. Global Constraints (copied verbatim into the dispatch)

- Node ≥ 20.10 built-ins only. No markdown library. No trust machinery.
- Byte preservation is verified by re-reading the sidecar from disk and finding the moved text verbatim.
- `--apply` is opt-in; the default writes nothing. The gate's CLI is unchanged.
- Nothing under `docs/backlog/` is created by the campaign; the real migration is depth-0's step 4b.
