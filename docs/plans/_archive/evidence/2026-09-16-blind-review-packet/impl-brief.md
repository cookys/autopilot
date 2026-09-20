# Implementation brief — blind-review-packet-2026-09-16

You implement ONE managed deliverable. The harness commits; you never push, never `git stash`,
never touch files outside the sealed `output_paths`, never run a real reviewer binary — tests use
fixture git repos and stub `scriptPath`/`--bin` binaries only. Rubric base for RED evidence and
byte-identity: `004cb2da` (product files identical to the grant base; cite `004cb2da`).

## Read first (in this order)
1. `docs/plans/_archive/2026-09-16-blind-review-packet.md` — §1 is NORMATIVE and complete (packet layout,
   isolated temp `GIT_DIR` checkout, integrity pass, canonical-diff check + splitter, manifest and
   `packet_hash` preimage, deny-list grammar/defaults, `dispatchReview` wiring, env scrub); §2 test
   list — every lettered item (a)–(j), (h2)–(h4) is a required assertion; §2.5 sealed paths; §2.6
   constraints; §4 acceptance. Do not re-derive the design from this brief — the plan wins.
2. `docs/plans/_archive/2026-09-16-blind-review-packet.rubric.md` — R1–R10.
3. `src/runners/review.js` (324 lines): `dispatchReview` ~205-245 (blind branch you extend);
   `dispatchReviewJson` ~247-320 (four return branches, all must carry `packet`).
4. `hooks/tests/dispatch-review.test.sh` ~1120-1160: the existing blind adapter case
   (`dispatchReviewJson(..., { scriptPath: process.env.BLIND_SCRIPT, blindDiscovery: true })`) —
   copy its stub idiom. `hooks/tests/lib.sh` for `TEST_TMP`/asserts; `hooks/tests/review-runner.test.sh`
   for the fixture-repo + stub-script style.
5. `references/blind-dispatch.md` § "Verifier isolation" (~256) — new section goes after it.

## Product (plan §1 is normative; this is only the order of operations)
1. NEW `src/runners/review-packet.js` (Node ≥ 20.10 built-ins; the ONLY external process is `git`
   via `spawnSync`, every call checking `error`/`signal`/`status` and quoting stderr in the thrown
   `Error`). Exports `buildReviewPacket`, `packetPathDenied`, `normalizeDenyList`,
   `DEFAULT_PACKET_DENY_LIST`, `verifyTreeIntegrity(treeDir, listing)` (also used by test (h2)). Order inside
   `buildReviewPacket`: full OIDs via `rev-parse --verify` (verbatim, any object format) →
   `ls-tree -r -z` as Buffers (gitlink → `unsupported submodule: <path>`; non-UTF-8 →
   `unsupported path encoding: <hex>`; both before any write) → isolated `<outDir>/.gitdir`
   (alternates to the real objects dir; no config/info/hooks) + `.empty` work-tree; every tree
   command under the §1.1 env (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`,
   `GIT_ATTR_NOSYSTEM=1`): `read-tree` → drop every `.gitattributes` from the index →
   `checkout-index -a --prefix=<outDir>/tree/` with the §1.1 `-c` flags → write the dropped
   `.gitattributes` blobs raw (`cat-file blob`) → remove `.gitdir`/`.empty` → integrity pass
   (`lstat` type ↔ mode, `hash-object --stdin --no-filters` ↔ listed id, no extra paths; else
   `tree integrity: <path>`) → prune deny-list matches and hazardous symlinks → `diff.patch`:
   regenerate the canonical diff and require `diffFile` bytes equal (else `diff not canonical`),
   Buffer-split aligned to `--name-status -z` (count mismatch → throw; drop when old OR new path is
   denied; rename out of a denied dir also prunes the new tree path) → `spec.md` (byte copy;
   zero bytes when `specFile` null/undefined) → `MANIFEST.json` + `packet_hash` per §1.1. Return
   `{ dir, packet_hash, manifest_path, entries_count, denied_paths }`.
2. `src/runners/review.js`: in `dispatchReview` always clone the env and `delete` both
   `AUTOPILOT_REVIEW_PACKET_{DIR,HASH}` before launch. With `options.blindDiscovery === true` and
   `options.packet = { repo, baseSha, candidateSha }`: build into `<blindCwd>/packet` from the
   `--diff-file` / `--spec-file` args (no `--spec-file` arg → zero-byte spec, do not add the arg),
   rewrite args to `packet/diff.patch` / `packet/spec.md`, set the two env vars, cwd = blind dir
   root, attach the result as `child.autopilotPacket`. Build failure → `{ error, status: null,
   signal: null }` without launching. `dispatchReviewJson`: `packet: { packet_hash, entries_count,
   denied_paths }` on success, `packet: null` on child-error / parse-error / missing-script
   branches. Without `options.packet` the legacy `diff.file.input` / `spec.file.input` copy is
   unchanged.
Mirrors: `bash scripts/sync-codex-plugin-skills.sh` then `--check` (src/runners and references mirror).

## Tests (plan §2 normative; header `# RED at base 004cb2da: <observed message>` per RED block)
- NEW `hooks/tests/review-packet.test.sh` (`chmod +x`): exactly plan §2's fixture repo (tokens,
  `.gitattributes` export-subst/export-ignore/filter=sentinel, `filter.sentinel.smudge` +
  `core.symlinks=false`, `git init --object-format=sha1`, binary, CRLF, three symlinks, rename out
  of `docs/plans/evidence/`, untracked file) and assertions (a)–(j) incl. (h2) ident literal +
  integrity helper on an ident-expanded `id.txt` → `tree integrity: id.txt`, (h2b) sentinel via
  `.git/info/attributes` never runs (real-git-dir control does), (h2c) swapped-section diff →
  `diff not canonical`, (h3) sha256 fixture, (h4) invalid-UTF-8 filename; `git archive` control;
  `packetPathDenied` / `normalizeDenyList` tables; >1 MiB; gitlink via `git update-index --add
  --cacheinfo 160000,<sha>,sub`; OIDs asserted equal to `git rev-parse --verify` output.
- `hooks/tests/dispatch-review.test.sh` next to the existing blind case: `options.packet` → stub
  sees `/packet/diff.patch`, `/packet/spec.md`, both env vars, `AUTOPILOT_BLIND_DISCOVERY=1`,
  result `packet.packet_hash` == env; no `--spec-file` arg → no arg + zero-byte `packet/spec.md`;
  legacy → `diff.file.input`, `packet: null` (preservation); poisoned ambient env vars absent in
  legacy-blind and non-blind launches (RED); bad candidate → `error`, `status: null`, `packet:
  null`, stub never invoked (RED); child-error / parse-error / missing-script → `packet: null`.
Run each suite at base BEFORE product edits and quote the observed messages. Never weaken or
delete an existing assertion.

## Docs
- `references/blind-dispatch.md`: `## Packet blinding (v2.36.59)` after "Verifier isolation":
  packet contents, deny-list default + grammar, hash preimage, isolation/integrity/symlink/submodule
  rules, pointers to cuts 1a-B and 1b. Regenerate the mirror.
- `docs/BACKLOG.md`: row "Blind review redesign: blind the packet and the process boundary, not the
  runner" — replace the Context line's value with EXACTLY: `packet (tree + git diff + spec,
  deny-list); packet/cleanroom tiers; intake canary; verify-once; parallel seats. Cut 1a-A (packet
  builder) shipped v2.36.59; 1a-B/1b/2 open. Detail in the pointer.` (Status stays `open`);
  `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exits 0. Do NOT touch
  CHANGELOG.md or version manifests.

## Verify (all, one at a time, foreground; all green)
```
bash hooks/tests/review-packet.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/review-runner.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat 004cb2da -- src/engine scripts bin/autopilot.js schemas   # must print nothing
test -x hooks/tests/review-packet.test.sh
```

## Sealed output_paths (the ONLY files you may change)
```
src/runners/review-packet.js
platforms/codex/plugin/src/runners/review-packet.js
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
hooks/tests/review-packet.test.sh
hooks/tests/dispatch-review.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
docs/BACKLOG.md
```
Finish with a clean tree, committed as the harness instructs; report RED-at-base messages and each
suite's pass/fail count.
