# Plan — review packet mode: carry a range over the packet ceiling without slicing it away

> Status: ✅ Merged to develop as 40c6ccdf (feature fd04dc41; guidance text 56a951ce, its stage-graph v11 eval is deferred as BL-0116) — ships with 3.0.0. Was: size S · Owner: depth-0 · Branch: `batch/b-packet` · Source: BACKLOG row "hetero-review-loop cannot carry a range over its packet ceiling: no phase-keyed packet mode" (3.0.0 total QC, 2026-10-08; evidence `docs/plans/evidence/2026-10-06-stage-graph/qc-total-2026-10-08/README.md`).

## 1. Problem

`hetero-review-loop.js collect` sends one `base..head` diff to every seat. Past about 400 KB the diff does not fit a seat's prompt. The only slicing tool is `--exclude`, and its allowlist (`scripts/lib/exclude-allowlist.js`) refuses source paths on purpose: a reviewer must never see less than the range it is signing for. So the 1.07 MB 3.0.0 range was reviewed by hand as eight `dispatch-review.sh` packets with no `chain.json`, and the receipt was a README.

## 2. Design

A **packet set** splits the range by path without hiding any path. Each packet is its own phase (own chain, generations, dispositions, receipt). A new set-level check proves the packets together cover the whole range exactly once and that every packet passed.

### 2.1 Data: `packets.json`

```
{ "schema": "autopilot.review-packets/1",
  "set": "total-qc",
  "packets": { "K1-graph": ["scripts/a.js", "hooks/tests/a.test.sh"], "K2-marker": ["..."] } }
```

- `set` and each packet id match `[A-Za-z0-9][A-Za-z0-9_.-]{0,40}`, no `..`. The packet's phase id is `<set>-<id>` (it becomes `review-<phase>/` and `receipt-<phase>.json`).
- Paths are **exact repo-relative file paths**: no globs, no directories, no leading `/`, no `..`, no duplicates, at least one per packet. Every git call uses `--literal-pathspecs` and `-z`, so a path can never act as a pathspec pattern.
- Deviation from the earlier design sketch: file paths only (not path sets that could hold globs), so "union equals the changed list" is an exact set comparison and a packet cannot smuggle in an exclusion through pattern syntax.

### 2.2 CLI

- `hetero-review-loop.js collect --packets <packets.json> --packet <id> ...` (all other flags as today). `--phase` is derived as `<set>-<id>`; giving a different `--phase` is an error. `finalize` takes the same `--packets/--packet` pair (or the derived `--phase`).
- `check-phase-review-receipt.js --packets <packets.json> --ledger <dir> --branch <b> --phase-base <sha> [--repo-root] [--min-reviewed-seats]` is the set check (Mode C).
- Collect copies `packets.json` to `<ledger>/packets-<set>.json` (a second collect against different bytes is refused) and records `packet: {set, id, packets_sha256, paths}` in each generation's `range.json`. `full_range_sha256` is the sha256 of the unfiltered `git diff base..head`, the same value the exclusion path already uses.

### 2.3 Collect rules

1. `--packets` needs `--packet`, and `--exclude` is refused together with them (exit 2): packets and exclusions are separate mechanisms; the allowlist is untouched.
2. Generation 1: the sorted `git diff --no-renames --name-only base..head` list must equal the union of all packet paths exactly (missing, extra and overlapping paths are each named). Generation N>1: the changed list must be a subset of the union (a fix may only touch covered paths).
3. The diff handed to seats is `git diff --no-renames base..head -- <that packet's paths>`; `diff_sha256` is its hash.
4. A packet diff above 400000 bytes still only warns, and the warning says to split the packet (it does not suggest `--exclude`).

### 2.4 Receipt rules

Mode A on a packet phase **refuses** (a lone packet receipt must not pass as a whole-range receipt) unless called from the set check. Called from it, each generation additionally re-derives `packet.paths` from the packets file, requires `packets_sha256` to match, requires `excluded` empty, recomputes the packet diff against `diff_sha256`, and re-checks `full_range_sha256`.

The set check (Mode C) then requires, in order:

1. The packets file is valid (2.1) and no path appears in two packets (overlap).
2. Every packet's phase passes Mode A, which already means SHIP-AS-IS with the reviewed-seat floor met. A missing receipt is a failure.
3. All packets' first finalized generation has the same head `h1`, and the union of packet paths equals `--name-only base..h1` exactly (a path in the range but in no packet is "missing"; a path in a packet but not in the range is "extra").
4. For the branch tip `H`: every packet's last reviewed head is an ancestor of `H`; `--name-only base..H` is a subset of the union; and no packet path changed between that packet's last reviewed head and `H`. This is what ties a later fix commit to a re-review without forcing every packet to re-run.

### 2.5 Failure cases

Unknown packet id; invalid or overlapping packets file; `--exclude` with a packet; a range that is not exactly covered at generation 1; second collect against changed packets bytes; packet receipt checked alone; one packet not SHIP-AS-IS or without a receipt; packets reviewed at different gen-1 heads; a path changed after its packet's last reviewed head.

### 2.6 Compatibility

Without `--packets` every code path is the current one: same range.json fields, same chain, same checker behavior. Existing suites are the regression proof; `hetero-review-loop.test.sh` also gets an explicit "no packet flag, unchanged output" case.

## 3. Steps

1. `scripts/lib/review-packets.js`: file validation, name list, packet diff, coverage comparison (shared by both scripts).
2. `hetero-review-loop.js`: collect/finalize packet flags and the range.json record.
3. `check-phase-review-receipt.js`: Mode A packet guard and per-generation packet checks, Mode C.
4. Tests in `hooks/tests/hetero-review-loop.test.sh` (normal split, missing path, overlap, failed packet, exclusion attempt, unchanged behavior), each with a removed-check proof.
5. `docs/scripts-inventory.md` rows, script headers, `CLAUDE.md` name list, delete the BACKLOG row.

## 4. Follow-up: guidance text (deliberately not in this change)

This change does not edit `skills/**` or `references/*.md`. The one sentence `skills/hetero-review/references/code-loop.md` (and the `--exclude` paragraph of `skills/dev-flow/references/hetero-loops.md`) needs later:

> A range too large for one packet is split by path with `--packets <packets.json> --packet <id>` (every changed file in exactly one packet) and gated by `check-phase-review-receipt.js --packets`; `--exclude` is never the way to shrink a review.
