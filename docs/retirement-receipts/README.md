# Retirement receipts

One JSON file per removal from a governed path. Enforced by
[`scripts/check-retirement-receipts.js`](../../scripts/check-retirement-receipts.js).

## Why removals need receipts

This project's own Decision Log recorded the root cause of its KR10 failure in one line, on
2026-07-20:

> the plan's deletions are prose, its additions are executed modules, and the deletion gate counts
> executed modules

Additions arrive with tests, gates and receipts. Removals arrived as **intent** — a sentence in a
plan saying something would be retired, with nothing mechanical to check whether it happened or
whether the thing replacing it worked. A project can accumulate 31,000 lines that way while deleting
nothing, and then fail a gate that counts what actually executes.

A receipt makes a removal a claim with evidence behind it, the same as any other change.

This is **not** a ban on deleting things. It asks one question — what replaced this, and what proves
the replacement works — and refuses to let the answer be silence.

## Governed paths

`src/engine/`, `skills/`, `scripts/`.

Generated Codex mirrors under `platforms/codex/plugin/` are exempt: they follow their canonical
source, and receipting both would be noise.

Renames are **not** retirements. The checker resolves them with `git diff -M`, so moving a file does
not demand a receipt explaining its own disappearance.

## Regime start

Receipts are required for removals made after the regime start commit recorded in the checker.
History is deliberately not backfilled — demanding paperwork for deletions made before the rule
existed produces a wall of retroactive filler with no evidentiary value, and the usual response to
that is to switch the check off.

## Format

`docs/retirement-receipts/<short-slug>.json`:

```json
{
  "removed": "src/engine/legacy-widget.js",
  "replaced_by": "src/engine/widget.js",
  "evidence": "hooks/tests/widget.test.sh",
  "commit": "abc1234",
  "reason": "Folded into widget.js; the legacy module had no callers left after the port."
}
```

| Field | Required | Meaning |
|---|---|---|
| `removed` | yes | Repo-relative path that was deleted (the values above are illustrative). Must match the path git reports. |
| `replaced_by` | yes (may be `null`) | What took over its responsibility. `null` is legitimate — some things are deleted because nothing should replace them — but the field must be present and considered. |
| `evidence` | yes, never `null` | A test or gate that proves the removal was safe. Even when `replaced_by` is `null`, something must show nothing broke. The checker verifies the named path exists, and with `--run-evidence` actually executes it. |
| `commit` | yes | The commit that performed the removal. |
| `reason` | yes | Why, in a sentence a reader who was not there can act on. |

## Usage

```bash
# Since the regime start (the normal check)
node scripts/check-retirement-receipts.js --check

# Over a specific range, executing each receipt's evidence rather than only checking it exists
node scripts/check-retirement-receipts.js --base <ref> --head <ref> --check --run-evidence

# Machine-readable
node scripts/check-retirement-receipts.js --json
```

Exit `1` under `--check` when a governed removal has no receipt, or a receipt is malformed, or its
named evidence is missing (or fails, under `--run-evidence`).
