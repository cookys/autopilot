# Blind review redesign, cut 1a-A — the content-addressed review packet and its runner wiring

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `blind-review-packet-2026-09-16`) — the first cut of BACKLOG row "Blind review redesign: blind the
> packet and the process boundary, not the runner" (open, L). Two consults converged on the shape
> (`docs/plans/evidence/2026-09-16-blind-review-redesign/consult-{claude-fable-5-1,gpt-6-astra}.md`);
> a third (codex gpt-5.6-sol, `consult-plan-cut1a-codex-answer.md`) reviewed the first draft of this
> plan and split it: this deliverable is the packet builder plus the `dispatchReview` wiring and the
> adversarial packet tests; the engine threading (receipt `packet_hash`, schema, panel identity rule)
> is cut 1a-B, a separate plan on top of this one. Cut 1b (cleanroom launcher, `bwrap`; probe
> evidence `bwrap-probe.md`) admits tool-capable seats; cut 2 is the speed work (§7).

## 0. What is actually true today (verified 2026-09-16, base `004cb2da`)

- Blind mode is a runner allow-list plus a scratch copy. `src/runners/review.js:210-240`
  (`dispatchReview`): with `blindDiscovery: true` it `mkdtemp`s a `0700` dir, copies the `--diff-file`
  and `--spec-file` arguments into it as `diff.file.input` / `spec.file.input`, launches
  `scripts/dispatch-review.sh` with cwd = that dir and `AUTOPILOT_BLIND_DISCOVERY=1`, and removes the
  dir afterwards. `dispatch-review.sh:288-295` refuses every runner outside
  `qoderclicn|cc-shim|claude-native|anthropic-compatible` under that env; intake refuses those seats
  first (`final_panel_seat_blind_incompatible`, v2.36.58).
- The diff a seat sees is `git diff --no-ext-diff --no-textconv <base>..<commit>` over the whole tree
  (`defaultDiffProvider`, `autopilot-engine.js:1778`), so a tracked verdict carrier rides into every
  seat's prompt if the candidate touched it. This repo tracks such carriers today: five
  `.qc/<sha>.verdict.json`, two `docs/plans/*.review.md`, 810 files under `docs/plans/evidence/`.
  Nothing filters them.
- The spec a seat sees is the dispatcher's brief (`promptFile`); implementer narrative is already
  kept out (`prior_findings_included: false`, blind-evidence gate in `dispatch-review.sh`). Commit
  messages never enter (git diff, not format-patch). `prepareReview` (`:4665-4735`) computes a
  transient `diff_digest` + `spec_digest` and re-checks them before invocation; nothing durable
  records what a seat was handed.
- A tool-capable seat has nothing to work on even if it were admitted: the scratch dir holds two
  files, no source tree. Cut 1b needs a tree to mount; today there is none.
- The tree holds a symlink (`.agents/skills -> ../skills`, mode 120000) and no gitlinks. The base
  `git archive` is ~51 MB — larger than `spawnSync`'s default 1 MiB stdout buffer.

## 1. Ruling and shape

1. **One packet per review dispatch, built by the dispatcher, content-addressed.** New module
   `src/runners/review-packet.js` (Node built-ins + `git` only) exports
   `buildReviewPacket({ repo, baseSha, candidateSha, diffFile, specFile, outDir, denyList })`,
   `packetPathDenied(path, denyList)`, `normalizeDenyList(denyList)` and
   `DEFAULT_PACKET_DENY_LIST`. It writes, under `outDir`:
   - `tree/` — NOT `git archive` (it honours candidate-controlled `export-subst`, which expands
     `$Format:%B$` to the commit message, and `export-ignore`, which drops an allowed file). Instead:
     a private index (`GIT_INDEX_FILE=<outDir>/.index`, `git read-tree <candidateOid>`) checked out
     with `git -c core.autocrlf=false -c core.eol=lf checkout-index -a --prefix=<outDir>/tree/`,
     the index removed; then an INTEGRITY pass: every `git ls-tree -r -z <candidateOid>` entry must
     exist in `tree/` with `git hash-object --stdin --no-filters` of its bytes (a symlink: of its target bytes)
     equal to the listed object id, and `tree/` must hold nothing the listing lacks — any
     mismatch (an `ident`/`filter`/`eol` attribute rewriting bytes, a missing or extra path) fails
     the build closed with `tree integrity: <path>`. Only then is every path matched by the
     deny-list deleted (a denied directory is removed whole). No `.git`, so no history, no
     `.git/autopilot`, no commit text; untracked files never enter by construction. Symlinks are
     kept as symlinks (never dereferenced); a link whose target is absolute, escapes `tree/`
     (`..` past the root), or resolves to a denied path is removed and listed in `denied_paths`. A
     gitlink (submodule, mode 160000 in `git ls-tree -r`) fails the build closed with
     `unsupported submodule: <path>` before checkout.
   - `diff.patch` — the dispatcher's diff file split into top-level `diff --git` sections as
     `Buffer`s (bytes are never re-encoded; CRLF and binary sections stay exact). The section list is
     aligned one-for-one, in order, with the records of `git diff --no-ext-diff --no-textconv
     --name-status -z <baseOid> <candidateOid>` run in `repo`; a count mismatch fails the build
     closed. A section is dropped when EITHER its old or its new path is denied; when the old path
     was denied and the new path is not (a rename out of a denied dir), the new path is also pruned
     from `tree/` and listed. Kept sections are copied byte-for-byte; with no denied path the file
     is byte-identical (`cmp`) to the input. A line inside file content that starts with
     `diff --git` never starts a section because sections come from the aligned record count, not
     from a regex over content.
   - `spec.md` — the spec file byte-for-byte; when `specFile` is absent (`undefined`/`null`) a
     zero-byte `spec.md` (the terminal review site runs with `noReviewSpec`).
   - `MANIFEST.json` — `{ schema_version: 1, artifact_type: 'review_packet_manifest', base_sha,
     candidate_sha, deny_list, entries, packet_hash }`: `base_sha`/`candidate_sha` are the FULL
     object ids (`git rev-parse --verify <x>^{commit}`); `deny_list` is the normalized list
     (validated, deduplicated, sorted); `entries` is `[{ path, type: 'file'|'symlink', sha256,
     bytes }…]` sorted by `path` (relative to `outDir`: `tree/…`, `diff.patch`, `spec.md`; the
     manifest is not an entry), walked with `lstat`, a symlink's `sha256`/`bytes` taken over its
     target string; `packet_hash = sha256(JSON.stringify({ schema_version, base_sha, candidate_sha,
     deny_list, entries }))` (that key order, UTF-8, no whitespace). No timestamp, absolute path,
     hostname or PID anywhere — two builds of the same inputs produce the same hash.
   - Deny-list grammar: paths are repository-relative POSIX byte strings; a pattern is a `/`-joined
     sequence of segments where `**` matches zero or more whole segments and `*` matches within one
     segment (so `**/*.raw.log` matches root `x.raw.log`); a pattern ending in `/**` matches the
     directory itself and everything under it. `normalizeDenyList` rejects absolute patterns, `..`,
     empty patterns and any other glob syntax. `DEFAULT_PACKET_DENY_LIST = Object.freeze([
     '.autopilot/**', '.qc/**', 'docs/plans/evidence/**', 'docs/plans/**/*.review.md',
     'docs/plans/**/*.review.json', 'docs/plans/**/*disposition*.json', '**/*.receipt.json',
     '**/*.raw.log' ])` — every entry names a verdict carrier this repo tracks or writes.
   - Returns `{ dir, packet_hash, manifest_path, entries_count, denied_paths }` (`denied_paths`
     sorted, tree/diff/symlink hits unioned). Every failure is a thrown `Error` naming the step
     (`git read-tree`, `checkout-index`, `tree integrity`, `git diff --name-status`, alignment,
     symlink, submodule).
2. **`dispatchReview` builds the packet in blind mode when it can.** `src/runners/review.js`: when
   `options.blindDiscovery === true` AND `options.packet` is an object `{ repo, baseSha, candidateSha
   }`, the blind dir gets `packet/` built by §1.1 (`diffFile`/`specFile` taken from the `--diff-file`
   / `--spec-file` args; a missing `--spec-file` arg means the zero-byte spec and NO `--spec-file`
   arg is added), the launch args point `--diff-file` at `packet/diff.patch` and, when present,
   `--spec-file` at `packet/spec.md`, cwd stays the blind dir root, and the env gains
   `AUTOPILOT_REVIEW_PACKET_DIR=<blindDir>/packet` and `AUTOPILOT_REVIEW_PACKET_HASH`. The launch env
   is always a clone of `options.env || process.env` with BOTH packet variables deleted first and set
   only after a successful build — an ambient value never leaks into a legacy or non-blind launch.
   `dispatchReviewJson` returns `packet: { packet_hash, entries_count, denied_paths }` on the
   success branch and `packet: null` on EVERY other return branch (child error, parse error, missing
   script). Without `options.packet` the legacy copy path (`diff.file.input`, `spec.file.input`) is
   byte-identical to today apart from the env scrub. A packet build failure returns the
   `{ error, status: null, signal: null }` shape the function already uses for a missing script and
   the script is never launched (fail closed, no unfiltered input reaches a seat).
3. **Nothing else moves.** The engine does not yet pass `options.packet` (cut 1a-B: the two
   `reviewOptions` sites, `reviewDiff` return, `finalPanelSeatReceipt.packet_hash`, the
   `FINAL_PANEL_SEAT_OPTIONAL_KEYS` rule, `schemas/implementation-campaign-receipt.schema.json`, the
   panel identity rule). `dispatch-review.sh`'s blind `case`, the intake predicate and the resolver ⚠
   stay exactly as v2.36.58 shipped them (cut 1b). A cleanroom seat is still refused at intake; what
   changes is that the packet it will be handed now exists and is proven clean.

## 2. Changes by file

- `src/runners/review-packet.js` (NEW, + mirror): §1.1. `git` via `spawnSync` with `cwd: repo`,
  `error`/`signal`/`status`/stderr checked on every call; no `tar`.
- `src/runners/review.js` (+ mirror): §1.2. `require('./review-packet')`; the packet is built
  before the arg rewrite; `child.autopilotPacket` carries the build result to `dispatchReviewJson`.
- Tests (each change-pinning block starts with `# RED at base 004cb2da: <observed message>` quoting
  the base run verbatim; preservation guards labelled `(preservation, green at base)`; fixture
  repos and stub `--bin`/`scriptPath` binaries only — no real reviewer runs):
  - `hooks/tests/review-packet.test.sh` (NEW): fixture repo with base commit B and candidate C.
    C's commit message holds token `T-MSG`; C changes `src/app.js` (benign, content includes a line
    starting with `diff --git a/x b/x`), adds `.autopilot/prior-verdict.json` (`T-AUTOPILOT`),
    `.qc/deadbeef.verdict.json` (`T-QC`), `docs/plans/evidence/x/review.json` (`T-EVIDENCE`),
    `docs/plans/p.review.md` (`T-REVIEWMD`), `docs/plans/g1-disposition.json` (`T-DISP`),
    `lib/run.receipt.json` (`T-RECEIPT`), `logs/x.raw.log` (`T-RAWLOG`, at a nested path AND a
    root-level `y.raw.log`), renames `docs/plans/evidence/old.md` (present at B, `T-RENAME`) to
    `docs/notes/moved.md`, adds a binary file `img.bin` (allowed) and a CRLF file `win.txt`
    (allowed), a safe relative symlink `link -> src`, an escaping symlink `esc -> ../../etc`, and a
    symlink to a denied path `qc -> .qc`; an untracked `notes/verdict.txt` (`T-UNTRACKED`) sits in
    the worktree; C also commits a `.gitattributes` with `msg.txt export-subst` (`msg.txt` holds
    `$Format:%B$`, so `git archive` would expand `T-MSG` into it) and `keep.txt export-ignore`
    (`keep.txt` is an allowed product file); the diff file is `git diff --no-ext-diff --no-textconv
    B..C`; the spec holds no token. Assertions: (a) `grep -r` for each of the eleven tokens over
    the packet dir → zero hits, `tree/msg.txt` holds the literal `$Format:%B$` and `tree/keep.txt`
    is present with C's bytes (RED at base: module absent; a `git archive` control in the test
    shows the expansion and the omission); (b) `tree/src/app.js`, `tree/img.bin`, `tree/win.txt` byte-equal
    to C's blobs; `tree/link` is a symlink to `src`; `tree/esc`, `tree/qc`, `tree/.autopilot`,
    `tree/.qc`, `tree/docs/plans/evidence`, `tree/docs/notes/moved.md` (rename out of a denied
    dir) absent; `denied_paths` lists each pruned path once, sorted; (c) `diff.patch` holds the
    `src/app.js`, `img.bin`, `win.txt`, `link` sections byte-equal (`cmp` on the extracted section
    bytes) to the input's, and no section for any denied old/new path; (d) `MANIFEST.json` entries
    == the sorted `lstat` walk minus the manifest, each `sha256`/`bytes` re-verified by a Node
    helper (`fs.readFileSync` for files, `fs.readlinkSync(p, { encoding: 'buffer' })` for symlinks —
    never a line-oriented shell pipeline, which would append a newline), `type` correct, `base_sha`/`candidate_sha` are 40-hex,
    `deny_list` sorted+deduped, `packet_hash` == `sha256` of the pinned preimage string
    (re-computed in the test from the manifest fields in the stated key order); (e) building twice
    → equal `packet_hash`; one spec byte changed → different; deny-list reordered/duplicated →
    equal; (f) with `denyList: []` and a candidate touching no symlink/rename hazards,
    `diff.patch` is byte-identical (`cmp`) to the input; (g) `packetPathDenied` table: `.autopilot/x`,
    `.autopilot/a/b`, `.qc/a.verdict.json`, `docs/plans/evidence/r.md`, `docs/plans/a/b.review.md`,
    `docs/plans/g2-disposition.json`, `a/b/c.receipt.json`, `x.raw.log`, `a/x.raw.log` → denied;
    `docs/plans/evidence.md`, `src/receipt.json`, `autopilot/x`, `docs/review.md` → allowed;
    `normalizeDenyList` rejects `/abs/**`, `a/../b`, `` and `{a,b}`; (h) a fixture whose tree
    exceeds 1 MiB builds; (h2) a fixture with `id.txt ident` (`$Id$` is rewritten on checkout)
    fails closed with `tree integrity: id.txt` and writes no `MANIFEST.json`; (i) a gitlink fixture (a submodule entry added with
    `git update-index --add --cacheinfo 160000,<sha>,sub`) fails with `unsupported submodule: sub`
    and writes nothing under `outDir`; (j) a candidate with `specFile` absent yields a zero-byte
    `spec.md` and the manifest lists it with `bytes: 0`.
  - `hooks/tests/dispatch-review.test.sh` (next to the existing blind adapter case ~1138, which
    already drives `dispatchReviewJson` with `blindDiscovery: true` and a stub `scriptPath`): with
    `options.packet` the stub script receives `--diff-file` ending in `/packet/diff.patch`,
    `--spec-file` ending in `/packet/spec.md`, env `AUTOPILOT_REVIEW_PACKET_DIR` = the dir of those
    files, `AUTOPILOT_REVIEW_PACKET_HASH` = 64 hex, `AUTOPILOT_BLIND_DISCOVERY=1`, and the JSON
    result carries `packet.packet_hash` equal to the env value (RED at base: `diff.file.input`, no
    packet key); without `--spec-file` in the args the stub receives no `--spec-file` and
    `packet/spec.md` is zero bytes; without `options.packet` the args end in `diff.file.input` /
    `spec.file.input` and `packet` is `null` (preservation); with poisoned ambient
    `AUTOPILOT_REVIEW_PACKET_DIR=/poison` and `AUTOPILOT_REVIEW_PACKET_HASH=poison` in
    `options.env`, the legacy blind launch and the non-blind launch see neither variable (RED at
    base: inherited); a packet build failure (candidateSha that does not exist) returns `error`
    set, `status: null`, `packet: null`, and the stub was never invoked (RED at base); the
    child-error, parse-error and missing-script branches all carry `packet: null`.
- Docs: `references/blind-dispatch.md` (+ mirror) — new section "Packet blinding (v2.36.59)" after
  "Verifier isolation": what the packet is, the deny-list default and grammar, the hash preimage,
  the symlink/submodule rules, and the pointer to cuts 1a-B/1b; `docs/BACKLOG.md` — the redesign
  row's Context gains "cut 1a-A (packet builder) shipped v2.36.59" (≤ 240 bytes; Status stays
  `open`). `CHANGELOG.md` and version manifests are NOT sealed (depth-0 release commit after the
  merge; the v2.36.59 number in text is a pin as in v2.36.53–58).

### 2.5 Sealed `output_paths` (exact)

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

`review-packet.js`, its mirror and `review-packet.test.sh` are created (`authorized_creates`); every
other path exists at base.

### 2.6 Global constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only; the only external process is `git`; never `git archive` (attribute
  leakage); the tree is verified against `git ls-tree -r` object ids before use.
- `MANIFEST.json` and `packet_hash` contain no timestamp, absolute path, hostname or PID; the hash
  preimage is `JSON.stringify({ schema_version, base_sha, candidate_sha, deny_list, entries })`.
- Symlinks are never followed; a gitlink fails the build closed.
- The legacy blind path (no `options.packet`) and the non-blind path are byte-identical to base
  `004cb2da` except that both packet env variables are always scrubbed from the launch env.
- `src/engine/**`, `scripts/**`, `bin/autopilot.js`, `schemas/**` are byte-identical to base.
- No new CLI flag; no new resolver field; no new config knob.

## 3. Out of scope

- Cut 1a-B: `options.packet` from the engine (`performReview` ~4812, terminal site ~9692 with
  `baseSha: immutableBase`), `reviewDiff` return, `finalPanelSeatReceipt.packet_hash`,
  `FINAL_PANEL_SEAT_OPTIONAL_KEYS` (mixed presence among reviewed seats rejected, all-missing
  allowed only for legacy receipts, forbidden on failed seats), the receipt JSON schema + mirror,
  the panel identity rule. Its plan is written on top of this deliverable's merged base.
- Binding `packet_hash` into `review_digest` / durable replay (consult finding 5): refuted for now —
  the packet is a pure function of `(base_sha, candidate tree, spec bytes, deny_list)`; the first
  three are already re-checked by the transient full-diff authority before invocation and the
  deny-list is a frozen constant in this cut. Revisit when the deny-list becomes configurable (1b).
- The cleanroom tier (1b) and the speed cuts (2). A configurable deny-list (1b).
- Redacting code comments / test names: they are the code under review (both consults).

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `packet-canary` | eleven planted tokens (commit message, untracked file, eight deny-listed tracked carriers, a rename out of a denied dir) yield zero hits over the built packet; allowed product, binary and CRLF files and their diff sections are present byte-for-byte | review-packet suite |
| `packet-hazards` | safe relative symlink kept as a symlink; escaping and deny-targeting symlinks pruned and listed; gitlink fails closed with nothing written; `export-subst`/`export-ignore` attributes neither leak nor omit; an `ident` rewrite fails closed as `tree integrity`; >1 MiB tree builds; absent spec → zero-byte `spec.md` | review-packet suite |
| `packet-identity` | same inputs → same `packet_hash`; one spec byte → different; deny-list order/duplicates irrelevant; manifest entries == `lstat` walk with verified sha256 and `type`; full OIDs; pinned preimage; no denied path → `diff.patch` byte-identical | review-packet suite |
| `runner-wiring` | blind dispatch with `options.packet` launches on `packet/diff.patch` (+ `packet/spec.md` only when a spec arg was given) with the packet env and returns `packet.packet_hash`; legacy path unchanged with `packet: null`; ambient packet env never inherited; a build failure never launches; every non-success branch carries `packet: null` | dispatch-review suite |
| `no-regression` | `review-packet`, `dispatch-review`, `review-runner` green; `node scripts/check-js-syntax.js`; `bash scripts/sync-codex-plugin-skills.sh --check`; `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` | suite output |
| `scope-integrity` | `git diff --name-only 004cb2da HEAD` ⊆ §2.5 plus committed plan/mission docs; `src/engine/**`, `scripts/**`, `bin/autopilot.js`, `schemas/**` byte-identical to `004cb2da`; every new test file is `test -x` | command output |

## 5. Dogfood proof (depth-0, after merge)

A manual `dispatchReviewJson` run with `options.packet` against this repo's HEAD (candidate = a
commit touching `docs/plans/evidence/**` and `.qc/**`) lists those paths in `denied_paths`, the
stub sees `packet/diff.patch` without them, and `tree/.agents/skills` is a symlink.

## 6. Risks + inversion

- **Deny-list too broad / too narrow.** Too broad hides product files (silent under-review); too
  narrow leaks. The default names only verdict carriers this repo tracks or writes; `denied_paths`
  is returned so a caller can log it; the canary pins both directions (§2 (a)–(c), (g)).
- **Alignment fragility.** Sections aligned to `--name-status -z` records fail closed on any count
  mismatch rather than guessing; the rename/copy/odd-name/CRLF/binary/embedded-`diff --git`
  fixtures pin the alignment.
- **Attribute-driven rewrites.** `export-*` are bypassed by not using `git archive`; every other
  attribute that rewrites bytes on checkout is caught by the object-id integrity pass and fails the
  build closed before launch; no seat runs on an unfiltered or altered input.
- **Symlink escape.** Never dereferenced; escaping/denied targets pruned; pinned by §2 (b).
- **Hand scope.** Two product files, two tests, two docs — sized for one round after the consult's
  split.

## 7. The cuts

1. **1a-A (this plan)** — packet builder + runner wiring.
2. **1a-B** — engine passes the packet; receipts carry `packet_hash`; the panel asserts one hash.
3. **1b** — cleanroom tier: runner table gains `tools: true|false`; `scripts/lib/cleanroom-launch.sh`
   runs a tool-capable CLI inside `bwrap` with only `packet/tree`, the runtime, TLS/DNS and a
   sanitized credential HOME (policy and probe: `evidence/2026-09-16-blind-review-redesign/bwrap-probe.md`);
   intake runs a no-model stub probe per cleanroom seat and refuses in seconds when the boundary is
   not enforceable; `BLIND_DISCOVERY_CAPABLE_RUNNERS` becomes the packet tier; codex profile first;
   the isolation suite is host-only and refuses (never skips) without `bwrap`; configurable deny-list.
4. **2** — verify once per tree, in-rail single review off when a panel exists, seats in separate
   processes concurrently, one standby seat, panel snapshot at intake.

## Review log

- Consults 2026-09-16 (claude-fable-5-1 and gpt-6-astra, evidence dir above): converged on packet
  blinding + two tiers + gate at intake and resolver + verify-once + concurrent seats. Divergence:
  UID drop (Fable) vs bwrap (astra) — settled by the host probe (`bwrap-probe.md`): the operator HOME is
  `0750` and holds every CLI, so UID drop needs host surgery; bwrap needs none and codex with tools
  ran inside it against a planted packet.
- Plan consult 2026-09-16 (codex gpt-5.6-sol on the first draft, `consult-plan-cut1a-codex-answer.md`),
  twelve findings: accepted 1 (`--output` archive, >1 MiB fixture), 2 (lstat walk, symlink rules,
  gitlink fails closed), 3+4 (schema + optional-key semantics → moved whole to cut 1a-B with the
  mixed-presence rule), 6 (hash preimage binds OIDs + deny-list + type), 7 (`--name-status -z`
  alignment, either-path deny, rename prune, Buffer split), 8 (`.qc/**`, review/disposition
  patterns, root globstar, grammar), 9 (zero-byte spec, `immutableBase` — recorded for 1a-B), 10
  (env scrub, `packet` on every branch), 11 (split A/B; `dispatch-review.test.sh` chosen), 12
  (wording). Refuted 5 (durable replay binding) with the rationale in §3.
- Plan hetero loop G1 2026-09-16 (GLM-5.2 READY, gpt-5.6-sol STOP 2 blockers; evidence
  `evidence/2026-09-16-blind-review-packet/g1-*`): both accepted — (R2) `git archive` honours
  candidate-controlled `export-subst`/`export-ignore`, so the tree is now a private-index
  `checkout-index` verified against `ls-tree` object ids, with the attribute fixtures; (R4) the
  symlink oracle `readlink | sha256sum` hashes a trailing newline — replaced by a Node helper over
  `readlinkSync(..., { encoding: 'buffer' })`. The G1 blocker falsified rubric R1's own wording
  ("git archive via `--output`"), so the frozen rubric could not carry the fold; the rubric was
  corrected and the review continues under logical id `blind-review-packet-2026-09-16-v2` (G1 of v2
  reviews the folded plan; the v1 G1 artifact and dispositions stay in the evidence dir). The
  first v2 G1 process was killed by the host memory guard before any seat returned (other operator
  jobs held ~80 GB); the rail then recorded `orphaned_active_claim_transport_exhausted` with zero
  semantic content consumed, so that state dir was moved aside (kept in the session scratchpad) and
  v2 G1 re-run from a clean lineage — the same zero-consumption reset the plan-review contract allows.
