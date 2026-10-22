# Plan — review ledger retention

> Status: draft, awaiting owner decisions and plan review. Owner: the person who answered decision card d-1eb50117. Branch: not chosen. Frame: docs plan only; nothing here is implemented. No version bump decided here; ship timing is the owner's.

## 0. Context / thesis

On 2026-10-22 the owner chose "keep a copy in the home directory" on decision card d-1eb50117 and added "also design a rotate / archive mechanism" (owner brief, this plan). Hetero review already writes a ledger the seat report can read. That ledger lives in session scratch and disappears with the session. This plan specifies an opt-in home-directory copy, a stable layout, a rotate path that does not delete by default, and a report that can read the copy without double-counting.

Facts below are `read-code` (file and line, this worktree, 2026-10-22), `ran-command` (the register row only), or the foreman's measured copy cited as given. Anything else is UNVERIFIED. `.claude-plugin/plugin.json` line 3 reads `3.0.0-alpha.6` (read-code). This plan does not bump that version.

## 1. Problem

A reviewer wants last week's seat totals after the session scratchpad is gone. `scripts/hetero-review-loop.js` requires `--ledger` and has no default location (read-code, usage line 182 and the required-flag errors at 665, 1221). Finalize writes `chain.json` with `writeFileSyncAtomic` (line 1690), then `receipt-<phase>.json` (const `receiptPath` at 1713, write at 1714), prints a JSON summary (1716-1722), and calls `process.exit(0)` (1723). The seat report is read-only, takes repeated `--ledger`, and keys findings with `path.resolve` of that directory (read-code, `scripts/review-seat-report.js` lines 21 and 114). Exit 2 on a missing ledger dir (line 35). It reads only `chain.json`, `findings.json`, `dispositions.json`, and `seat-*.json` (header lines 4-12 and 20-27). A ledger that exists only under a deleted scratch path cannot be passed.

Today's manual copy at `~/.autopilot/review-ledger-archive/2026-10-22-autopilot-a6cb3442/` is 43 MB, 184 review phase directories, 3485 json files, 361 `diff.txt` files (foreman measurement, cited as given). Size by kind: `diff.txt` 24.5 MB (57 percent), `seat-*.json` 2.76 MB, `findings.json` 1.22 MB, `dispositions.json` 0.61 MB, `chain.json` 0.59 MB. The four report-needed kinds sum to about 5.2 MB (12 percent). Active span by `chain.json` mtime: 2026-10-16 to 2026-10-22, 7 calendar days, counts per day 54, 30, 20, 30, 20, 14, 15 (same measurement).

Ledger layout the copy must follow (foreman, confirmed in spirit by the report reader): `review-<phase>/chain.json`; `review-<phase>/g<n>/` holding `findings.json`, `dispositions.json`, `seat-s<k>.json`, `range.json`, `diff.txt`; `receipt-<phase>.json`; `phase-<phase>.base`; plus depth-0 `map-*.json` and `disp-*.json` at the ledger root. The report does not need `diff.txt`, `range.json`, the phase base, or the depth-0 map and disp files (read-code, report header).

## 2. OKR / KRs

- KR1. With the archive key unset, finalize writes nothing outside the source ledger. Stdout and exit code match a run with the hook absent (byte-identical summary).
- KR2. With the key set, one finalize produces layout A for that ledger-id, including `archive.json`, and a second finalize of a later generation of the same phase refreshes `chain.json` and adds `g<n>` in the same directory.
- KR3. Two different source ledgers never share a ledger-id. A chain reset that changes the generation-1 collected timestamp gets a new id.
- KR4. `review-seat-report.js` with the same bytes under two archive paths reports the same totals as one copy. Giving both `--ledger` and `--archive` for that data counts once.
- KR5. `prune` with no `--execute` deletes nothing and prints the targets. `--execute` whose realpath is outside the archive root refuses. A tar whose listing count mismatches keeps the uncompressed month.
- KR6. Tests use a temp `HOME`. They never read or write the operator's real `~/.autopilot`.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Global files outside the repo are opt-in.
- Durable data is not live state, so it is not tmpfs.
- TTL or thresholds only warn, never block.
- Evidence deletion is careful (`references/evidence-discipline.md`).
- No trust machinery (`docs/adr/0001-verification-over-attestation.md`): no hash chain, signature, attestation.
- Version is frozen at 3.0.0. No version bump decided here; ship timing is the owner's.
- Node built-ins only for anything that could run in a sandbox.
- New scripts need the four-place wiring from `CLAUDE.md` (lines 51-57: reference doc, skill row, `docs/scripts-inventory.md`, grouped name in `CLAUDE.md`).
- A new check or gate needs a negative control (`references/evidence-discipline.md` section 58).

## 2.6 Change-policy decisions

- **Compatibility impact**: additive and opt-in. Unset key: no write, no read, no change to finalize rc or stdout. Existing `--ledger` reports stay valid. The legacy flat copy stays readable.
- **Dependency decision**: none for P1 and P2 (Node built-ins plus the already-exported `repoIdentity` in `src/status/task-runtime.js` line 36, exported at line 181). P3 uses the system `tar` binary only, because Node has no built-in tar. If `tar` is missing or fails the probe, leave the month uncompressed and warn.

## 3. File-structure map

| Path | Responsibility |
|---|---|
| `scripts/hetero-review-loop.js` | After the receipt write at line 1714 and before `process.exit(0)` at 1723, call the copy inside try/catch. |
| new file `review-ledger-archive.js` (new), placed under scripts/ | Subcommands `import`, `status`, `rotate`, `prune`. Node built-ins only. |
| new file `review-ledger-copy.js` (new), placed under scripts/lib/ | Shared copy, ledger-id, mkdir lock, atomic write, layout walk. The loop and the CLI both require it. |
| `scripts/review-seat-report.js` | New repeatable `--archive`. Canonical key and footer counts. |
| `scripts/lib/config-keys.json` | Register the new keys. |
| `docs/settings-reference.md` | One row per key, env twin `AUTOPILOT_<NAME>`, same shape as `context_budget.t1` (line 63). |
| `CHANGELOG.md` | A "Settings changes" entry when the keys ship. Not in this docs-only plan commit. |
| `scripts/lib/config-path.js` | Unchanged. User file stays `~/.autopilot/config.json` (lines 2-5, 28). |
| `src/status/task-runtime.js` | Unchanged. Call `repoIdentity`. |
| `scripts/lib/repo-identity.sh` | Unchanged. Documents the shell twin `repo_identity_of` (lines 6-9, 37). |
| `CLAUDE.md`, `docs/scripts-inventory.md`, `skills/quality-pipeline/SKILL.md`, `skills/quality-pipeline/references/code-review.md` | Four-place wiring for the new script. |
| new file `review-ledger-archive.test.sh` (new), placed under hooks/tests/ | Temp `HOME`. Negative controls named in P1-P3. |
| `scripts/probe-harness-capabilities.sh` | Existing probe to extend or invoke for `tar` on Windows and the agy sandbox. |

Dependency map: P1 (copy, import, status, config, wiring, lock) blocks P2 and P3. P2 (report) and P3 (rotate, prune) do not block each other. P3's "report over a tar equals report over the directory" acceptance needs P2, so that one check lands after both, in P3's test file, and is skipped with a named reason if P2 has not merged.

## 4. Design decisions

### 4.1 Auto-save

Trigger: after finalize writes the receipt, before `process.exit(0)`, inside try/catch.

Options: copy only report files (`chain.json`, `findings.json`, `dispositions.json`, `seat-*.json`, `range.json` per `g<n>`, plus `receipt-<phase>.json`) versus copy the whole `g<n>` including `diff.txt`.

Recommendation: report files only by default. `diff.txt` is a separate opt-in key `review_ledger_archive.include_diff`, default false. `diff.txt` is 57 percent of the measured copy and is reconstructible from `range.json` plus git while those commits exist. Trade-off: after the branch is deleted, the archive cannot rebuild the diff. `range.json` is copied even though the seat report ignores it, so a later rebuild still has the range.

Switch: config key `review_ledger_archive.dir` plus env `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR`. Env wins. Empty string means off. Unset means nothing is written and nothing is read. Default off. Suggest, and do not default, `~/.autopilot/review-ledger-archive`.

Failure: fail-open. Any error is one stderr line prefixed `review-ledger-archive`. Finalize exit code and stdout summary stay byte-identical to the unset case. Negative control: a read-only archive dir must not change rc or stdout. Remove the try/catch and that test goes red.

Naming: lookup before create, inside a short mkdir lock with a fixed name in the repo bucket (owner file, stale tombstone, bounded wait). The date is `YYYY-MM-DD` from the generation-1 `collected_at`, then `at`, when that entry has one. When neither exists, the date is the local calendar date of the first time this ledger is archived, stored on `archive.json` as `first_collect_at` and never recomputed, because a later copy finds the directory by lookup. The phase content key is the sha1 hex of the bytes of `review-<phase>/g1/range.json` (base and head). If `range.json` is missing, the key is the sha1 of `g1/findings.json`. If both are missing, the copy throws. The key does not depend on mtime, path, or copy method, and it does not change across later generations of the phase. Scan every ledger-id directory in the repo bucket and read `archive.json`. Reuse a directory when `phase_keys` (an object mapping phase name to content key; metadata only, not a claim) lists this phase's key, or when `source_realpath` equals the source ledger realpath. Otherwise create `date`, repo slug, then the first 8 hex of the content key of the first phase being archived. Update `archive.json` inside the lock: `phase_keys` gains this phase, `source_realpath` stays the first source, and `imported_from` is set when importing. The per-ledger-id lock still covers the file copy. No hash chain, signature, or attestation. Re-running finalize for a later generation lands in the same ledger-id and refreshes `chain.json` plus adds the new `g<n>`. Two phases of one live ledger share one ledger-id, successively or concurrently. An original and a plain `cp -r` copy resolve to the same ledger-id. Two unrelated ledgers with the same phase name and different `range.json` bytes get different ledger-ids. A chain reset (new `range.json` bytes) is a new phase key and a new ledger-id when the source realpath also differs; the same realpath reuses the existing id.

Repo slug: call `repoIdentity` from `src/status/task-runtime.js` (the Node twin of `repo_identity_of`, which prints `git-common-dir:` plus the realpath; read-code, `scripts/lib/repo-identity.sh` lines 6-9). Directory name for the repo bucket is the repo basename, a hyphen, and the first 8 hex of a sha1 of the identity string. That is the shape of the existing manual label `a6cb3442`. UNVERIFIED that `a6cb3442` equals that prefix. Verify by computing sha1 of `repoIdentity` for this repo. If it does not match, the plan's slug is the one defined here and the legacy name is only a label. The hash is a short directory name, not a trust claim (`docs/adr/0001-verification-over-attestation.md`).

Also write `archive.json` in the ledger-id directory: `source_realpath`, `repo_identity`, `first_collect_at`, `imported_from` (null for auto), tool version string. It is metadata so a later reader can name the ledger and de-duplicate. It is not attestation: no signature, no hash chain, no claim that the bytes were not edited after the write.

### 4.2 Layout

Options: A) archive, then repo slug, then `YYYY-MM`, then ledger-id, then `review-<phase>/...`. B) flat archive then ledger-id, which is what the manual copy looks like today. C) archive, then `YYYY-MM`, then repo slug.

Recommendation: A. Reports are per repo, so the repo comes first. Rotate works on whole months, so the month comes second. The ledger-id comes third. Month is the month of the first collect, so a ledger never moves between months. The legacy flat copy stays readable (4.4 and 4.5).

### 4.3 Rotate / archive

Trigger options: by month only, by total size only, or both.

Recommendation: both, as two independent checks, run by `rotate` / `status` and by P1's `status` for the size warning.

(a) Month rotation compresses any complete month older than N months (default 2) into `repo-slug/YYYY-MM.tar.gz`. Only after `tar` lists the archive back and the file count matches, the uncompressed month directory may be removed. The owner brief says never delete by default. Removal after a successful compress does not destroy content, but it is still a deletion of a directory the owner can open without `tar`. Default is compress-and-keep-both until the owner opts into keeping only the tar, via `review_ledger_archive.rotate_remove_source`, default false.

(b) Size threshold `review_ledger_archive.warn_mb`, default 500. Over it, print a warning. Never block.

Reading compressed months: auto-extract into a `mkdtemp` directory, read-only use, remove in `finally`, versus require a manual extract. Recommendation: auto-extract. The reader owns the temp dir. Manual extract is not required for the report.

`tar` is the system binary. UNVERIFIED on Windows and under the agy sandbox. Verify with `scripts/probe-harness-capabilities.sh` or by running the real command there. Fallback: leave the month uncompressed and warn.

Deletion: a separate `prune` subcommand. Flags `--older-than` and `--execute`. Dry-run is the default and prints exactly what would go. Refuses to touch anything whose realpath is not under the configured archive dir. Never runs from a hook.

Warnings location options: SessionStart hook, report footer, status subcommand only. Recommendation: report footer plus the status subcommand. A SessionStart hook would add a per-session cost and a new default behaviour for a feature that is off by default. SessionStart stays an option the owner may add later.

### 4.4 Report integration (P2)

`scripts/review-seat-report.js` gains `--archive <root>`, repeatable, alongside `--ledger`.

Discovery: every directory under the root that contains at least one `review-*/chain.json`, at layout depth A or at legacy flat depth B. Compressed months are extracted to a temp dir first (4.3).

De-dup: the report keys on the absolute ledger path (read-code, line 114), so two copies of one ledger would count twice. Archive ledgers use a canonical key equal to the ledger-id from `archive.json`. Ledgers without `archive.json` (legacy copy, or a raw `--ledger` dir) use the realpath. Content fallback: two ledgers whose set of (phase, generation, `findings.json` bytes) is identical count once. Compare with plain byte equality, or a sha256 used only as a comparison key, not as a trust claim. When the same data is given via both `--ledger` and `--archive`, count once. The footer scope line adds the number of archive ledgers read and the number of duplicates skipped.

Negative control: copy a fixture ledger twice under two archive paths and expect the same totals as one copy. Delete the dedupe and the test must go red.

### 4.5 Manual import

New script named in 4.1's file row. `import --ledger <dir> [--repo <dir>]` copies the same report files into the same layout as auto-save. Running it twice changes nothing. `archive.json` has `imported_from` set to the source realpath.

Migration of today's manual copy at `~/.autopilot/review-ledger-archive/2026-10-22-autopilot-a6cb3442/`. Options: A) leave it where it is; P2 reads the legacy flat layout (zero risk, keeps `diff.txt`). B) import it into layout A and then the owner removes the old directory by hand. C) import with `--move`.

Recommendation: A now. B only if the owner wants one layout. Never C. The original source (`/tmp` ledger) being gone or still present is UNVERIFIED. The home copy is the only record this plan relies on.

### 4.6 Not doing

- Signing: ADR-0001 forbids attestation of a claim.
- Hash chain: same ADR; a chain would be trust machinery.
- Attestation: same ADR; verification is re-derivation.
- Remote upload or sync: the owner asked for a home-directory copy, not a network store.
- Any default-on write: global files outside the repo are opt-in.
- SessionStart hook in the first version: per-session cost for a feature that is off by default (4.3).
- Automatic deletion: evidence deletion is careful; prune is explicit and dry-run by default.
- Compressing `diff.txt` separately: default copy omits it; a second compress path is extra machinery.
- Encrypting: no key management in this plan; mode 0700/0600 is the privacy control (section 6).

### 4.7 P1 — auto-save, import, status (dev-flow size M)

Size M, not S: the work crosses the loop, a new CLI, config registration, four-place wiring, and a concurrency lock. One phase can still ship alone.

Files: the map rows for the loop, the new CLI, the new lib, config keys, settings reference, CHANGELOG Settings changes, inventory wiring, and the test file.

Steps:

1. Add the lib: resolve the archive dir (env, then config, then off); build ledger-id from the chain; copy the report-file set; write `archive.json`; mkdir lock per ledger-id with an owner file and a stale-lock tombstone, copying the pattern in `acquireChainLock` (`scripts/hetero-review-loop.js` lines 44-99, lock path at line 53). Atomic write is temp file plus rename, same idea as `writeFileSyncAtomic`.
2. Call it from finalize only, after line 1714, inside try/catch, then fall through to the existing summary and `process.exit(0)`.
3. CLI subcommands `import` and `status`. `status` prints ledger count, byte size, and the warn line when over `warn_mb`.
4. Register keys. Document them. Add the Settings changes CHANGELOG entry in the same implementation commit that adds the keys, not before.
5. Wire the script in the four places in section 2.5.
6. Tests under a temp `HOME`.

Acceptance: unset key writes nothing (directory listing of the archive root stays empty). Set key produces layout A with `archive.json`. Archive dir made read-only does not change finalize rc or stdout. Two ledgers with the same phase name do not collide. Concurrent finalize of two phases into one ledger-id leaves a valid `chain.json` (the lock).

Negative controls: remove the try/catch and the read-only test must go red. Remove the lock and the concurrency test must go red.

### 4.8 P2 — report reads the archive (dev-flow size S)

Files: `scripts/review-seat-report.js` and the same test file (new cases).

Steps: parse repeatable `--archive`; walk depth A and depth B; extract tar months via the P3 helper if present, otherwise skip tarred months with a named skip until P3 lands; apply the canonical key and the byte fallback; extend the footer.

Acceptance: KR4. Footer shows archive ledgers read and duplicates skipped. A missing archive root is exit 2, same as a missing `--ledger` dir.

Negative control: the double-path fixture in 4.4. Delete the dedupe and the test goes red.

### 4.9 P3 — rotate, compress, prune (dev-flow size M)

Files: the CLI's `rotate` and `prune`, the lib's tar and realpath-prefix helpers, tests.

Steps:

1. `rotate` selects complete months older than N (default 2), runs system `tar`, lists it back, compares file count, writes the `.tar.gz` beside the month. Removes the month directory only when `rotate_remove_source` is true and the listing matched. On mismatch, keep the source and warn.
2. `prune` dry-run by default. `--execute` required to delete. Realpath prefix check against the configured archive dir. Refuse otherwise.
3. Report path: when P2 is present, reading a tarred month equals reading the untarred month (temp dir removed in `finally`).
4. Probe `tar` via `scripts/probe-harness-capabilities.sh` or a direct run. Record Windows and agy as pass or as the uncompressed fallback.

Acceptance: dry-run prune deletes nothing and lists targets. Prune without `--execute` never deletes. `--execute` outside the archive root refuses. Tar listing mismatch keeps the source month. Report-over-tar equals report-over-directory when P2 is merged.

Negative control: point `--execute` at a sibling of the archive root and require refusal. If the prefix check is removed, that test goes red.

## 5. Test / validation

Script-gated: the test file in section 3, temp `HOME`, assertions in KR1-KR6. Human-gated: the section 8 choices before implementation starts. This plan commit itself is docs-only. No new test runs in the authoring commit. Implementation commits run the new test file plus `node scripts/check-config-docs.js` and `node scripts/check-claude-md-inventory.js` after the four-place wiring.

Concrete checks the implementer runs, each with `HOME` set to a fresh temp directory:

- Unset: run finalize against a fixture ledger and list the archive root. Expect no new directory.
- Set: export `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR` to a temp directory, finalize once, and require `archive.json` plus one `review-<phase>/chain.json` under repo slug, month, ledger-id.
- Read-only: `chmod` the archive root to `0555` after creating it, finalize again, and diff stdout and the exit code against the unset run. Expect equality. Stderr may contain one `review-ledger-archive` line.
- Collision: two fixture ledgers, same phase string, different generation-1 timestamps. Expect two ledger-id directories.
- Lock: two finalize processes, two phases, one ledger-id. Both exit 0. The archived `chain.json` parses and contains both generations' phase entries.
- Dedupe: two archive roots, identical fixture bytes. `review-seat-report.js` with both `--archive` flags prints the same totals as one root, and the footer says one duplicate skipped.
- Prune: without `--execute`, a file count of the archive root is unchanged and stdout names the targets. With `--execute` and a path outside the root, exit non-zero and the outside path is unchanged.
- Tar mismatch: replace the built tar with a shorter archive before the count check. The month directory must still be present.

Scope coverage: items 1 through 8 of the owner brief map to subsections 4.1 through 4.9. Nothing in the brief is left without a phase or an explicit "not doing" line. Placeholder scan: no load-bearing step says to figure the shape out later. The UNVERIFIED list is the only open measurement, and each row names the command that closes it.

Authoring checks for this document, not for the implementation: `node scripts/check-plan-graduation.js` must exit 0 with the INDEX row at Version `active`, and `node scripts/doc-drift-gate.js` on `docs/plans/` and `docs/projects/` must not add a new broken link. The gate walks directories, so a file argument is not a scan (read-code, `scripts/doc-drift-gate.js` lines 194-198). A link failure already present under `docs/plans/evidence/` is not this plan's defect.

## 6. Risks and inversion

What would guarantee this fails:

- A default-on write. Mitigation: unset means off; tests assert an empty archive root.
- The archive grows unnoticed. Mitigation: `warn_mb` on `status` and on the report footer; yearly arithmetic below is the expectation to re-measure.
- Dedupe missing, so the report double-counts. Mitigation: KR4 negative control.
- Deleting evidence. Mitigation: prune dry-run default, realpath prefix, `rotate_remove_source` default false, never from a hook.
- Finalize rc or stdout changes when the archive errors. Mitigation: fail-open try/catch and the read-only negative control.
- Disk full. Covered by the same fail-open path. The source ledger write has already finished before the copy starts (read-code, chain at 1690, receipt at 1714).

Yearly growth, from the one measured week (method: 43 / 7 and 5.2 / 7, then times 365). Full copy: 43 MB / 7 days is about 6.1 MB per day, about 2.2 GB per year. Report files only: 5.2 MB / 7 days is about 0.74 MB per day, about 270 MB per year. Rotate multiplies the kept bytes by an unknown gzip ratio (UNVERIFIED). Verify the ratio in P3 by running `tar czf` on a copy of the report-files subset and comparing sizes. UNVERIFIED that the 7 days are representative: this was one busy campaign week and one ledger; other repos and other sessions add more. Verify by re-measuring after 30 days of P1 running, using the `status` subcommand.

Privacy: `findings.json`, `seat-*.json`, and `diff.txt` contain code excerpts and reviewer text. The archive lives in the owner's home under the default umask. Plan item: create directories mode 0700 and files mode 0600, and test those modes. No secrets scrub in the default path.

Secret scan before copy is an option, using `scripts/secret-scan-diff.js`. Recommendation: do not scan before copy. The scan is a diff gate, not an archive filter; a false positive would drop review evidence, and a false negative would look like a guarantee. Owner decision (section 8).

Multi-session writes: mkdir lock per ledger-id directory, owner file, stale tombstone, same shape as `chain.json`'s lock (read-code, lines 44-99). Atomic write via temp file plus rename.

## 7. Out of scope

Items in 4.6. Also: changing how `scripts/hetero-review-loop.js` chooses the source ledger; editing depth-0 `map-*.json` / `disp-*.json` policy; a version bump; BACKLOG edits in the authoring commit; implementing any of P1-P3 in this commit.

## 8. Open questions

Decided 2026-10-22 (d-3d5e0503): owner accepted all recommendations.

- `include_diff`: no. `diff.txt` is not stored; `include_diff` defaults to false.
- After compress: keep both the tar and the original directory (`rotate_remove_source` stays false until the owner sets it).
- Deletion: never automatic; only the explicit `prune` subcommand with `--execute`.
- Reminder location: report footer and `status` subcommand only; no SessionStart hook.
- Legacy manual copy: left in place (option A); P2 reads the legacy flat layout.
- Secret scan before copy: no. Privacy control is directory mode 0700 and file mode 0600.
- Suggested archive path `~/.autopilot/review-ledger-archive` stays a suggested value the owner sets in their own config; it is not a default.

## Review log

R0 author drafted by a grok hand under foreman lane retplan; no review generation yet.
P1 naming changed: real chain.json has no timestamp, and mtime is not copy-stable, so the ledger-id uses a phase content key and lookup by phase_keys or source_realpath.

## UNVERIFIED

- The 7-day span is representative of a year. Verify: re-measure after 30 days of P1, `status` subcommand.
- Gzip ratio, measured 2026-10-22. A read-only `cp -r` of `~/.autopilot/review-ledger-archive/2026-10-22-autopilot-a6cb3442` into a temp directory, then system `tar czf`. Whole copy: 31654354 bytes uncompressed, 8341311 bytes gzip (ratio 0.264, about 3.79:1). Report-files subset (everything except `diff.txt`): 7116359 bytes uncompressed, 2020290 bytes gzip (ratio 0.284, about 3.52:1).
- `a6cb3442` equals the first 8 hex of sha1 of this repo's `repoIdentity` string. Verify: compute it. On mismatch, the slug rule in 4.1 stands and the legacy directory name is only a label.
- System `tar` on this host, measured 2026-10-22: `tar (GNU tar) 1.35`.
- System `tar` works on Windows and under the agy sandbox. UNVERIFIED. Verify: `scripts/probe-harness-capabilities.sh` or a real run there. Fallback is uncompressed plus a warning. An uncompressed-fallback path exists. It is covered by case au (no tar on PATH) and case av (the tar listing does not match, so the month stays a directory) in `hooks/tests/review-ledger-archive.test.sh`.
- Whether the original `/tmp` source ledger still exists. The home copy is the record this plan uses. Verify: the owner looks; do not delete the home copy to find out.
- Mode 0700/0600 survives the platforms we ship on. Verify: the P1 test asserts `stat` mode after create.

This list is the whole set of measurements this plan does not treat as settled. A later review generation may add rows. It may not delete a row by calling the claim verified without the check named on that row.
