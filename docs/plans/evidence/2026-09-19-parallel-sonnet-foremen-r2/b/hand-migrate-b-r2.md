## Plan
# Plan B — table migration stops inventing and dropping
1. RED case (p): unmapped status → open; unmapped column cells vanish; preserved:true; bytes do not reconcile.
2. Unmapped status → sidecar verbatim + manifest error; --apply refuses unless --allow-unmapped-to-sidecar. Unmapped column → plan-time error naming the ## Columns line.
3. preserved computed from byte accounting (output + sidecars + dropped==∅); bytes_before === bytes_after + moved_bytes.
4. --apply gates on runCheck (exported) and restores the file on a red gate; doc sentence; mirrors; ONE commit.
Acceptance: revival.3d's shape (unmapped statuses + a foreign column) yields errors and sidecars, never `open` rows or silent loss; a fully mapped table migrates byte-identically to base.

## Product
1. RED first, one new case (p) in `hooks/tests/migrate-backlog-entries.test.sh` modelled on cases (n) `:280-340` and (o) `:343-395`:
   a table fixture with (a) one row whose status word is in neither `## Status map` nor the defaults, (b) one header column absent
   from `## Columns` with non-empty cells, (c) a `--apply` run. At base assert the observed wrong outputs (`Status: open` for (a);
   the (b) cells absent from output AND from every sidecar; manifest `preserved:true`; `bytes_before − bytes_after ≠ moved_bytes`).
2. Fix, aligned to the doc: (a) an unmapped status word → the row goes VERBATIM to a sidecar and the run records an error entry
   (`unmapped_status`, word, line) in the manifest; `open` is never synthesised; the default dry-run lists them; `--apply` exits non-zero
   when any exist unless `--allow-unmapped-to-sidecar` (name it exactly so) is passed — then it moves them and still records the errors.
   (b) a header column outside `## Columns` and outside `TABLE_FIELDS` is an error at plan time (`unmapped_column`, header, cell
   count); nothing is written; the fix message names the `## Columns` line to add. (c) `preserved` is computed, never assumed: after
   the write, every byte of every input row is accounted as either present in the output, present in a sidecar, or explicitly
   listed as `dropped` (which must be empty on success); `bytes_before === bytes_after + moved_bytes` must reconcile exactly
   (whitespace normalisation counted separately as `normalized_bytes` if the script normalises anything — measure, do not guess).
   (d) `--apply` runs the gate on the output (export `runCheck` from `check-backlog-entries.js`, import it the way the other helpers
   are at `:32-41`) and fails the apply (restoring the original file from its in-memory copy) when the gate exit is non-zero;
   the gate report is embedded in the manifest.
3. `references/backlog-entry.md` table-style paragraph (`:29`): one sentence each for unmapped status and unmapped column.
4. Codex mirrors of both scripts and the reference via `bash scripts/sync-codex-plugin-skills.sh` (same commit). Heading-style
   migration (this repo's own config) must be byte-identical in behaviour: `node scripts/migrate-backlog-entries.js --backlog docs/BACKLOG.md --json`
   (dry-run is the default) before and after produces the same manifest except timestamp/run-id fields.

## Tests (RED-first, `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- case (p) above → GREEN: sidecar holds the unmapped-status row verbatim, manifest lists `unmapped_status` + `unmapped_column`
  errors, `--apply` refuses without the flag and succeeds with it, `preserved` reflects reality, bytes reconcile, gate embedded.
- a negative control: a fully mapped table (case (n)'s fixture) still migrates with zero errors and identical output to base.

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/migrate-backlog-entries.test.sh
bash hooks/tests/check-backlog-entries.test.sh
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
node scripts/migrate-backlog-entries.js --backlog docs/BACKLOG.md --json   # dry-run is the default; --apply is the only writer
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(if a suite name above does not exist, `ls hooks/tests | grep backlog` and run every match.)

## Allowed files
`scripts/migrate-backlog-entries.js`, `scripts/check-backlog-entries.js` (export only), `references/backlog-entry.md`, their codex
twins under `platforms/codex/plugin/` via the sync script, `hooks/tests/migrate-backlog-entries.test.sh`. Nothing else; do not edit
`docs/BACKLOG.md` or `.claude/backlog-config.md`.

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it changed; run every verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh` you create must be `chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.

## Repair round — fix these review findings
🟠 [preserved-not-computed] MUST-FIX Spec (c) says `preserved` is computed from byte accounting, but in the non-abort path it is structurally constant true: `normalized_bytes` is defined as `bytes_before − bytes_after − moved_bytes`, so the reconciliation clause is `x === x`, and the `dropped` scan only inspects unmapped headers with non-empty cells, which already trigger `abortRewrite` before that scan runs. Net effect: any loss inside a mapped column's rewrite (title trailing-period strip, Source/Context truncation the lossy check does not catch, bold/padding removal) is absorbed into `normalized_bytes` and reported as `preserved:true`. Smallest remediation: (1) extend the post-loop `dropped` scan to every column of every row not moved verbatim, requiring each non-empty `stripBold(cell).trim()` to appear in `hay`, exempting only the Status cell under the same rule the lossy check uses; (2) measure `normalized_bytes` by applying the script's own normalisers to the original cells (`byteLen(cell) − byteLen(stripBold(cell).trim())` plus the period strip) and count schema fills (`see pointer`, `none`, `unknown`, mapped status kind) as a separate `synthesized_bytes`; set `preserved=false` when `bytes_before ≠ bytes_after + moved_bytes + normalized_bytes − synthesized_bytes` or `dropped` is non-empty.
🟠 [reconcile-assertion-vacuous] MUST-FIX The (p) assertion `bb===ba+mb+nb` reads `nb` from the same manifest that defines it as the residual, so it can never fail after the fix and does not evidence item 3 of the plan. Smallest remediation: compute the expected normalized value independently in the test (sum over `entries[].bytes_before − bytes_after − moved_bytes` from the manifest, or from the fixture) and add one lossy-row assertion (e.g., a Source cell over 160 bytes with no sidecar move) showing `preserved` flips to false.
