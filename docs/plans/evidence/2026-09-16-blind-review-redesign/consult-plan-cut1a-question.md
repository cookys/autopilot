Design consult on an EXECUTION PLAN (autopilot managed campaign rail; Node engine + bash dispatch).
You are reviewing the plan below for a hetero implementer (cursor grok-4.6, low effort, ~40 min,
worktree-isolated, no host access) and three prompt-only review seats. Recommend concrete
corrections; do not emit ship/no-ship. Answer under ~1200 words, as a numbered list of findings,
each: severity (blocker|major|minor), the plan section, what is wrong, the exact fix.

Focus on:
1. Facts the plan asserts about the code (file:line, function names, return shapes). Flag any that
   look wrong or under-specified enough that a reviewer rubric would demand a MUST-FIX.
2. The packet spec (§1.1): determinism of the hash, the diff splitter, the glob subset, tar/git
   dependencies, failure modes (binary diffs, renames, submodules, symlinks in git archive,
   `diff --git` lines inside file content, CRLF).
3. The engine threading (§1.3/§1.4): whether `packet_hash` as an OPTIONAL closed-set key is sound,
   what else consumes `FINAL_PANEL_SEAT_KEYS` / receipt digests that the plan does not name, and
   whether the panel mismatch rule interacts with resume/replay of durable review digests.
4. Scope: is 18 output_paths + a 9.9k-line engine edit achievable for that implementer in one
   round; what to cut or split if not.
5. Anything the red-first tests miss.

=== PLAN ===
# Blind review redesign, cut 1a — every blind seat reviews one content-addressed packet

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `blind-review-packet-2026-09-16`) — the first cut of BACKLOG row "Blind review redesign: blind the
> packet and the process boundary, not the runner" (open, L). Two consults converged on the shape
> (`docs/plans/evidence/2026-09-16-blind-review-redesign/consult-{claude-fable-5-1,gpt-6-astra}.md`);
> the whole redesign is three cuts (§7). This cut is the input half: what a blind seat is handed.
> Cut 1b (cleanroom launcher, `bwrap`; probe evidence in the same directory, `bwrap-probe.md`) is what
> lets a tool-capable seat sit on the panel; cut 2 is the speed work.

## 0. What is actually true today (verified 2026-09-16, base `004cb2da`)

- Blind mode is a runner allow-list plus a scratch copy. `src/runners/review.js:210-240`
  (`dispatchReview`): with `blindDiscovery: true` it `mkdtemp`s a `0700` dir, copies the `--diff-file`
  and `--spec-file` arguments into it as `diff.file.input` / `spec.file.input`, launches
  `scripts/dispatch-review.sh` with cwd = that dir and `AUTOPILOT_BLIND_DISCOVERY=1`, and removes the
  dir afterwards. `dispatch-review.sh:288-295` refuses every runner outside
  `qoderclicn|cc-shim|claude-native|anthropic-compatible` under that env; intake refuses those seats
  first (`final_panel_seat_blind_incompatible`, v2.36.58, `src/engine/campaign-intake.js:1417-1450`,
  predicate `BLIND_DISCOVERY_CAPABLE_RUNNERS` in `src/engine/final-panel-qualification.js`).
- The diff a seat sees is `git diff --no-ext-diff --no-textconv <base>..<commit>` over the whole tree
  (`defaultDiffProvider`, `autopilot-engine.js:1778`), so a tracked file that carries a prior verdict
  (a reviewer JSON under `docs/plans/evidence/…`, a `*.receipt.json`, anything under `.autopilot/`)
  rides into every seat's prompt if the candidate touched it. Nothing filters it.
- The spec a seat sees is the dispatcher's brief (`promptFile`); implementer narrative is already
  kept out (`prior_findings_included: false`, blind-evidence gate in `dispatch-review.sh`). Commit
  messages never enter (git diff, not format-patch).
- Nothing records what a seat was handed. `finalPanelSeatReceipt` (`autopilot-engine.js:4994-5025`)
  carries runner/model/effort/endpoint/family/status/verdict/review_digest/reason; the full-diff
  authority (`prepareReview`, `:4665-4735`) records `diff_digest` + `spec_digest` per review but that
  object is not on the seat receipt, so "all three seats saw identical input" is assumed, never
  asserted. `FINAL_PANEL_SEAT_KEYS` in `src/engine/campaign-composition.js:318-332` is a closed set.
- A tool-capable seat has nothing to work on even if it were admitted: the scratch dir holds two
  files, no source tree. Cut 1b needs a tree to mount; today there is none.

## 1. Ruling and shape

1. **One packet per review dispatch, built by the dispatcher, content-addressed.** New module
   `src/runners/review-packet.js` (Node built-ins + `git` + `tar` only) exports
   `buildReviewPacket({ repo, baseSha, candidateSha, diffFile, specFile, outDir, denyList })` and
   `DEFAULT_PACKET_DENY_LIST`. It writes, under `outDir`:
   - `tree/` — `git archive --format=tar <candidateSha>` extracted (`tar -xf -`), then every path
     matched by the deny-list deleted. No `.git`, so no history, no `.git/autopilot`, no commit text;
     untracked files never enter by construction.
   - `diff.patch` — the dispatcher's diff file with every per-file section (`diff --git a/<p> b/<p>`
     … up to the next `diff --git`) whose path matches the deny-list removed; sections for other
     paths are copied byte-for-byte, in order. With no denied path the file is byte-identical to the
     input.
   - `spec.md` — the spec file, byte-for-byte.
   - `MANIFEST.json` — `{ schema_version: 1, artifact_type: 'review_packet_manifest', base_sha,
     candidate_sha, deny_list, entries: [{ path, sha256, bytes }…], packet_hash }` with `entries`
     sorted by `path` (paths relative to `outDir`, `tree/…`, `diff.patch`, `spec.md`; the manifest
     itself is not an entry) and `packet_hash = sha256(JSON.stringify(entries))`. No timestamps, no
     absolute paths, no hostnames — two builds of the same inputs produce the same hash.
   - Deny-list semantics: minimatch-free glob subset — `**` matches any number of path segments,
     `*` matches within a segment; a pattern ending in `/**` matches the directory itself and
     everything under it. `DEFAULT_PACKET_DENY_LIST = Object.freeze(['.autopilot/**',
     'docs/plans/evidence/**', '**/*.receipt.json', '**/*.raw.log'])`. The matcher is exported
     (`packetPathDenied(path, denyList)`) and is the only matcher for both the tree prune and the diff
     split.
   - Returns `{ dir, packet_hash, manifest_path, entries_count, denied_paths }` (`denied_paths`
     sorted, tree and diff hits unioned).
2. **`dispatchReview` builds the packet in blind mode when it can.** `src/runners/review.js`: when
   `options.blindDiscovery === true` AND `options.packet` is an object `{ repo, baseSha, candidateSha
   }`, the blind dir gets `packet/` built by §1.1, the launch args point `--diff-file` at
   `packet/diff.patch` and `--spec-file` at `packet/spec.md`, cwd stays the blind dir root, and the
   env gains `AUTOPILOT_REVIEW_PACKET_DIR=<blindDir>/packet` and `AUTOPILOT_REVIEW_PACKET_HASH`.
   `dispatchReviewJson` returns `packet: { packet_hash, entries_count, denied_paths }` (null when no
   packet was built). Without `options.packet` the legacy copy path (`diff.file.input`,
   `spec.file.input`, no packet env) is byte-identical to today — external callers and every existing
   test keep their behaviour. A packet build failure returns the `{ error, status: null, signal: null
   }` shape the function already uses for a missing script (fail closed, no launch).
3. **The engine always passes the packet identity.** `performReview` (`autopilot-engine.js` ~4812,
   `reviewOptions`) adds `packet: { repo: loopCwd, baseSha: authority.base_sha, candidateSha:
   candidate.commit }`; the terminal-review call site (~9692) does the same from its candidate.
   `reviewDiff` copies `reviewResult.packet` onto its return value as `packet` (null when absent);
   `performReview`'s reviewed object gains `packet_hash` (string or null). Not a new CLI flag; not a
   new resolver field.
4. **Seat receipts carry it; the panel asserts it.** `finalPanelSeatReceipt` body gains
   `packet_hash` (64-hex) whenever the seat reviewed and a packet was built — placed after
   `review_digest`, inside the digested body; the key is OMITTED otherwise (never `null`). In
   `src/engine/campaign-composition.js` it is an OPTIONAL key of the closed set exactly like
   `raw_log` (`hasFinalPanelSeatKeys` allows it; when present it must match `^[0-9a-f]{64}$`), so the
   eight suites that hand-build seat receipts without it stay green untouched. `performFinalPanel`:
   after the findings merge, if the reviewed seats carry two or more distinct `packet_hash` values the
   panel is NOT reviewed (`reviewed: false`, `verdict: null`) exactly as a findings inconsistency is
   today, and the seat receipts show the hashes. Identical inputs build identical packets (§1.1), so
   a mismatch is a dispatcher defect, never a seat's.
5. **The runner gate is untouched.** `dispatch-review.sh`'s blind `case`, the intake predicate and
   the resolver ⚠ stay exactly as v2.36.58 shipped them; cut 1b replaces them. A cleanroom seat is
   still refused at intake; what changes is that the packet it will be handed now exists and is
   proven clean.

## 2. Changes by file

- `src/runners/review-packet.js` (NEW, + mirror): §1.1. ~150 lines; `git` via `spawnSync` with
  `cwd: repo`, `tar` via `spawnSync` with the archive on stdin; every failure is an `Error` naming
  the step.
- `src/runners/review.js` (+ mirror): §1.2. `require('./review-packet')`; the packet is built
  before the arg rewrite; `child.autopilotPacket` carries the build result to `dispatchReviewJson`.
- `src/engine/autopilot-engine.js` (+ mirror): §1.3 (two `reviewOptions` sites + `reviewDiff`
  return + `performReview` return) and §1.4 (`finalPanelSeatReceipt`, `performFinalPanel`).
- `src/engine/campaign-composition.js` (+ mirror): `FINAL_PANEL_SEAT_KEYS` + validator (§1.4).
- Tests (each change-pinning block starts with `# RED at base 004cb2da: <observed message>` quoting
  the base run verbatim; preservation guards labelled `(preservation, green at base)`; fixture
  repos, stub `--bin` binaries, stub dispatchers and sandbox ledgers only — no real reviewer runs):
  - `hooks/tests/review-packet.test.sh` (NEW): a fixture repo with base commit B and candidate C;
    C's commit message holds token `T-MSG`; C changes `src/app.js` (benign) and adds
    `.autopilot/prior-verdict.json` (token `T-AUTOPILOT`), `docs/plans/evidence/x/review.json`
    (`T-EVIDENCE`), `lib/run.receipt.json` (`T-RECEIPT`); an untracked `notes/verdict.txt`
    (`T-UNTRACKED`) sits in the worktree; the diff file is `git diff B..C`; the spec holds no token.
    Assertions: (a) `grep -r` for each of the five tokens over the packet dir → zero hits (RED at
    base: no module); (b) `tree/src/app.js` exists with C's content; `tree/.autopilot`,
    `tree/docs/plans/evidence`, `tree/lib/run.receipt.json` absent; (c) `diff.patch` contains the
    `src/app.js` section byte-equal to the input's and no `diff --git` line for a denied path; (d)
    `MANIFEST.json` entries == the sorted file walk of the dir minus the manifest, each `sha256`
    verified with `sha256sum`, `packet_hash` == `sha256` of `JSON.stringify(entries)`; (e) building
    twice → equal `packet_hash`; changing one spec byte → different; (f) with an empty deny-list and
    a candidate touching no denied path, `diff.patch` is byte-identical to the input (`cmp`); (g)
    `packetPathDenied` table: `.autopilot/x`, `.autopilot/a/b`, `docs/plans/evidence/r.md`,
    `a/b/c.receipt.json`, `x.raw.log` → denied; `docs/plans/evidence.md`, `src/receipt.json`,
    `autopilot/x` → allowed.
  - `hooks/tests/review-runner.test.sh` (or `dispatch-review.test.sh` next to its existing blind case
    ~1138 — whichever already drives `dispatchReviewJson` with `blindDiscovery: true`): with
    `options.packet` the stub script receives `--diff-file` ending in `/packet/diff.patch`,
    `--spec-file` ending in `/packet/spec.md`, env `AUTOPILOT_REVIEW_PACKET_DIR` = the dir of those
    files, `AUTOPILOT_REVIEW_PACKET_HASH` = 64 hex, `AUTOPILOT_BLIND_DISCOVERY=1`, and the JSON result
    carries `packet.packet_hash` equal to the env value (RED at base: `diff.file.input`, no packet
    key); without `options.packet` the args end in `diff.file.input` / `spec.file.input` and
    `packet` is `null` (preservation); a packet build failure (candidateSha that does not exist)
    returns `error` set, `status: null`, and the stub was never invoked (RED at base).
  - `hooks/tests/implementation-campaign-state.test.sh` + `hooks/tests/implementation-campaign-routing.test.sh`
    (the engine-level run with a sealed contract, the REAL `appendCampaignEvent`, a REAL sandbox
    ledger and stub dispatchers, as the v2.36.58 block does): the stub `reviewDispatcher` records
    `options.packet` for every managed review call — each equals `{ repo: <loop cwd>, baseSha:
    <base>, candidateSha: <candidate commit> }` (RED at base: undefined); the stub returns
    `packet: { packet_hash: <H> … }` and every reviewed final-panel seat receipt carries
    `packet_hash === H` (RED at base: key absent) and its `receipt_digest` re-derives over the body
    including the key; a stub returning `packet: null` → no `packet_hash` key and the panel is still
    reviewed (preservation); seats returning two different hashes → `reviewed: false`, `verdict:
    null`, `final_panel_count` still counts the reviewed seats, receipts carry both hashes (RED at
    base: reviewed true).
  - `hooks/tests/implementation-campaign-receipt.test.sh` (or wherever `validateFinalPanelReceipt`
    is exercised): a seat receipt carrying a 64-hex `packet_hash` inside its digested body validates
    (RED at base: unknown key → `final_panel_metadata_incomplete`); a receipt without the key still
    validates (preservation); `packet_hash: null` and a non-hex string fail.
- Docs: `references/blind-dispatch.md` — new section "Packet blinding (v2.36.59)" after "Verifier
  isolation": what the packet is, the deny-list default, the hash on the receipt, and the pointer to
  cut 1b for the cleanroom tier (+ mirror); `docs/BACKLOG.md` — the redesign row's Context gains "cut 1a
  (packet) shipped v2.36.59" (≤ 240 bytes; keep Status `open` — cuts 1b and 2 remain);
  `skills/l5/references/hetero-impl-loop.md` step 11 fixed list gains "review packet + receipt
  packet_hash v2.36.59" (+ mirror). `CHANGELOG.md` and version manifests are NOT sealed (depth-0
  release commit after the merge; the v2.36.59 number in text is a pin as in v2.36.53–58).

### 2.5 Sealed `output_paths` (exact)

```
src/runners/review-packet.js
platforms/codex/plugin/src/runners/review-packet.js
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
hooks/tests/review-packet.test.sh
hooks/tests/review-runner.test.sh
hooks/tests/dispatch-review.test.sh
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```

`review-packet.js`, its mirror and `review-packet.test.sh` are created (`authorized_creates`); every
other path exists at base.

### 2.6 Global constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only; external processes limited to `git` and `tar`.
- `MANIFEST.json` and `packet_hash` contain no timestamp, absolute path, hostname or PID.
- The legacy blind path (no `options.packet`) is byte-identical to base `004cb2da`.
- `dispatch-review.sh`, `campaign-intake.js`, `final-panel-qualification.js`,
  `resolve-review-loop.sh` are byte-identical to base — the runner gate is cut 1b's.
- No new CLI flag on `bin/autopilot.js`; no new resolver field; no new config knob.
- Seat receipts: `packet_hash` is inside the digested body, optional like `raw_log`, never `null`.

## 3. Out of scope (cuts 1b and 2)

- The cleanroom tier: runner `tools` declaration, the `bwrap` launcher, the intake preflight canary,
  replacing `BLIND_DISCOVERY_CAPABLE_RUNNERS` with a tier lookup, codex back on the panel. Cut 1b.
- Verify-once-per-tree, `review.in_rail` off when a panel exists, concurrent seats, standby seat,
  panel snapshot into campaign state. Cut 2.
- A configurable deny-list (`review.packet_deny_list`): the default constant plus the function
  parameter ship now; the resolver knob rides with cut 1b's other resolver changes.
- Redacting code comments / test names: they are the code under review (both consults).

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `packet-canary` | five planted tokens (commit message, untracked file, three deny-listed tracked files) yield zero hits over the built packet; the product file and its diff section are present byte-for-byte | review-packet suite |
| `packet-identity` | same inputs → same `packet_hash`; one spec byte → different; manifest entries == file walk with verified sha256; no denied path → `diff.patch` byte-identical to the input | review-packet suite |
| `runner-wiring` | blind dispatch with `options.packet` launches the script on `packet/diff.patch` + `packet/spec.md` with the packet env and returns `packet.packet_hash`; without it the legacy names and `packet: null`; a build failure never launches | review-runner / dispatch-review suite |
| `receipt-hash` | every managed review call receives `options.packet` with the loop repo, base and candidate commit; reviewed seat receipts carry `packet_hash` inside the digested body; mismatched hashes make the panel unreviewed; a receipt without the key still validates | state + routing + receipt suites |
| `no-regression` | `review-packet`, `review-runner`, `dispatch-review`, `implementation-campaign-state`, `implementation-campaign-routing`, `implementation-campaign-receipt`, `qc-panel-honesty`, `controller-execution-independent` green; `node scripts/check-js-syntax.js`; `bash scripts/sync-codex-plugin-skills.sh --check`; `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` | suite output |
| `scope-integrity` | `git diff --name-only 004cb2da HEAD` ⊆ §2.5 plus committed plan/mission docs; `scripts/dispatch-review.sh`, `src/engine/campaign-intake.js`, `src/engine/final-panel-qualification.js`, `scripts/resolve-review-loop.sh`, `bin/autopilot.js` byte-identical to `004cb2da`; every new test file is `test -x` | command output |

## 5. Dogfood proof (depth-0, after merge)

The next managed campaign's final-panel seat receipts (three packet-tier seats) show one identical
`packet_hash`; a manual `dispatchReviewJson` run with `options.packet` against this repo's HEAD lists
`docs/plans/evidence/**` paths in `denied_paths` when the candidate touched them.

## 6. Risks + inversion

- **Deny-list too broad / too narrow.** Too broad hides product files from the reviewer (silent
  under-review); too narrow leaks. Mitigation: the default is four patterns naming only verdict
  carriers; `denied_paths` is returned so a caller can log it; the canary test pins both directions
  (§2 (a)–(c), (g)).
- **`tar` absent on a host.** The build fails closed before launch (§1.2) — the seat is not run on
  an unfiltered input. `tar` is on every target platform; recorded here, not probed.
- **Determinism.** The hash is over content only; extraction mtimes/modes are not hashed. Pinned by
  §2 (e).
- **The closed key set.** Eight suites hand-build seat receipts; making the key required would drag
  them all into scope. Optional-like-`raw_log` keeps them green; the receipt suite pins the new
  shape; missing the mirror is caught by `sync-codex-plugin-skills.sh --check`.
- **Hand touches the engine.** `autopilot-engine.js` is 9.9k lines; the edits are four bounded sites
  named by line in §0/§1; `scope-integrity` pins the untouched neighbours.

## 7. The three cuts

1. **1a (this plan)** — packet + hash on receipt. Any seat, any tier, reviews the same proven-clean
   input; the tree exists for 1b to mount.
2. **1b** — cleanroom tier: runner table gains `tools: true|false`; `scripts/lib/cleanroom-launch.sh`
   runs a tool-capable CLI inside `bwrap` with only `packet/tree`, the runtime, TLS/DNS and a
   sanitized credential HOME (policy and probe: `evidence/2026-09-16-blind-review-redesign/bwrap-probe.md`);
   intake runs a no-model stub probe per cleanroom seat and refuses in seconds when the boundary is
   not enforceable; `BLIND_DISCOVERY_CAPABLE_RUNNERS` becomes the packet tier; codex profile first;
   the isolation suite is host-only and refuses (never skips) without `bwrap`.
3. **2** — verify once per tree, in-rail single review off when a panel exists, seats in separate
   processes concurrently, one standby seat, panel snapshot at intake.

## Review log

- Consults 2026-09-16 (claude-fable-5-1 and gpt-6-astra, evidence dir above): converged on packet
  blinding + two tiers + gate at intake and resolver + verify-once + concurrent seats. Divergence:
  UID drop (Fable) vs bwrap (astra) — settled by the host probe (`bwrap-probe.md`): the operator HOME is
  `0750` and holds every CLI, so UID drop needs host surgery; bwrap needs none and codex with tools
  ran inside it against a planted packet. Both consults' packet shape is §1.1 verbatim.

=== RUBRIC ===
# Rubric — 2026-09-16-blind-review-packet.md

> Source plan: docs/plans/_archive/2026-09-16-blind-review-packet.md

R1: `src/runners/review-packet.js` exports `buildReviewPacket`, `packetPathDenied` and `DEFAULT_PACKET_DENY_LIST` (exactly `.autopilot/**`, `docs/plans/evidence/**`, `**/*.receipt.json`, `**/*.raw.log`); the packet holds `tree/` (git archive of the candidate, denied paths pruned), `diff.patch` (input diff with denied per-file sections removed, other sections byte-for-byte), `spec.md` (byte-for-byte) and `MANIFEST.json` with sorted `entries[{path, sha256, bytes}]` and `packet_hash = sha256(JSON.stringify(entries))`; no timestamp, absolute path, hostname or PID appears in the manifest.
R2: Packet canary — a fixture candidate whose commit message, an untracked worktree file and three deny-listed tracked files (`.autopilot/…`, `docs/plans/evidence/…`, `*.receipt.json`) each carry a unique token yields zero grep hits over the built packet, while the product file is present in `tree/` with the candidate's content and its diff section is byte-equal to the input's (RED at base: module absent).
R3: Packet identity — two builds of the same inputs give the same `packet_hash`; one changed spec byte gives a different one; manifest entries equal the sorted file walk (manifest excluded) with every sha256 re-verified; with no denied path `diff.patch` is byte-identical (`cmp`) to the input diff; the `packetPathDenied` table in plan §2 holds.
R4: `dispatchReview` with `blindDiscovery: true` and `options.packet = { repo, baseSha, candidateSha }` launches the script with `--diff-file` ending `/packet/diff.patch`, `--spec-file` ending `/packet/spec.md`, env `AUTOPILOT_REVIEW_PACKET_DIR` (that dir), `AUTOPILOT_REVIEW_PACKET_HASH` (64-hex) and `AUTOPILOT_BLIND_DISCOVERY=1`; `dispatchReviewJson` returns `packet.packet_hash` equal to the env value; a build failure (nonexistent candidate) returns `error` set, `status: null`, and the script is never invoked (RED at base).
R5: Preservation — without `options.packet` the blind launch args end in `diff.file.input` / `spec.file.input`, no packet env is set and `packet` is `null`; the non-blind path is byte-identical to base `004cb2da`.
R6: Every managed review call (`performReview` full-diff and final-panel, and the terminal-review site) passes `reviewOptions.packet` equal to `{ repo: <loop cwd>, baseSha: <base>, candidateSha: <candidate commit> }`, observed by a stub `reviewDispatcher` in an engine-level run with a sealed contract, the real appender and a sandbox ledger (RED at base: undefined).
R7: Reviewed final-panel seat receipts carry `packet_hash` (64-hex) inside the digested body when the stub returned one, `receipt_digest` re-derives over the body including it, and the key is absent (not `null`) when the stub returned `packet: null`; `FINAL_PANEL_SEAT_KEYS` treats it as optional like `raw_log` and `validateFinalPanelReceipt` rejects `null` and non-hex values while accepting receipts without the key (RED at base: unknown key rejected).
R8: `performFinalPanel` with reviewed seats carrying two distinct `packet_hash` values returns `reviewed: false`, `verdict: null`, `final_panel_count` = reviewed seats, receipts showing both hashes (RED at base: reviewed true); identical hashes → reviewed as today.
R9: Scope integrity — `git diff --name-only 004cb2da HEAD` ⊆ plan §2.5 plus committed plan/mission docs; `scripts/dispatch-review.sh`, `src/engine/campaign-intake.js`, `src/engine/final-panel-qualification.js`, `scripts/resolve-review-loop.sh`, `bin/autopilot.js` byte-identical to `004cb2da`; no new CLI flag, resolver field or config knob; every new test file is `test -x`; every change-pinning assertion is recorded RED against base in the test header with the observed message.
R10: Suites green: `review-packet`, `review-runner`, `dispatch-review`, `implementation-campaign-state`, `implementation-campaign-routing`, `implementation-campaign-receipt`, `qc-panel-honesty`, `controller-execution-independent`; `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` pass; docs per plan §2 (blind-dispatch.md section + mirror, BACKLOG Context, l5 reference step 11 + mirror).

=== CODE EXCERPTS ===
--- src/runners/review.js:205-245
      signal: null,
    };
  }
  let launchArgs = args;
  let launchCwd = options.cwd || REPO_ROOT;
  let blindCwd = null;
  try {
    if (options.blindDiscovery === true) {
      blindCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-review-blind-'));
      fs.chmodSync(blindCwd, 0o700);
      launchArgs = [...args];
      for (const flag of ['--diff-file', '--spec-file']) {
        const index = launchArgs.indexOf(flag);
        if (index < 0 || typeof launchArgs[index + 1] !== 'string') continue;
        const source = launchArgs[index + 1];
        const target = path.join(blindCwd, flag.slice(2, -5).replace(/-/g, '.') + '.input');
        fs.copyFileSync(source, target);
        fs.chmodSync(target, 0o600);
        launchArgs[index + 1] = target;
      }
      launchCwd = blindCwd;
    }
    const child = spawnSync(scriptPath, launchArgs, {
      cwd: launchCwd,
      env: options.blindDiscovery === true
        ? { ...(options.env || process.env), AUTOPILOT_BLIND_DISCOVERY: '1' }
        : (options.env || process.env),
      shell: false,
      stdio: options.stdio || 'inherit',
    });
    child.autopilotLaunchCwd = launchCwd;
    return child;
  } catch (error) {
    return { error, status: null, signal: null };
  } finally {
    if (blindCwd) fs.rmSync(blindCwd, { recursive: true, force: true });
  }
}

function dispatchReviewJson(args, options = {}) {
  const child = dispatchReview(args, {
--- src/engine/autopilot-engine.js:4994-5025 finalPanelSeatReceipt
    const finalPanelSeatReceipt = (seat, seatIndex, outcome) => {
      const isReviewed = outcome && outcome.reviewed === true;
      let status = 'no_verdict';
      if (!isReviewed && outcome && outcome.phase === 'product_review_normalization') {
        status = 'parser_failed';
      } else if (!isReviewed && outcome && outcome.raw && outcome.raw.reviewResult
          && (outcome.raw.reviewResult.error || outcome.raw.reviewResult.signal
            || outcome.raw.reviewResult.status !== 0)) {
        status = 'transport_failed';
      } else if (!isReviewed && outcome && outcome.phase === 'reviewer_qualification') {
        status = 'precondition_failed';
      }
      const body = {
        schema_version: 1,
        artifact_type: 'implementation_campaign_final_panel_seat',
        seat_index: seatIndex + 1,
        runner: seat.runner,
        model: seat.model,
        effort: seat.effort,
        endpoint: seat.endpoint === undefined ? null : seat.endpoint,
        family: seat.family,
        status: isReviewed ? 'reviewed' : status,
        verdict: isReviewed ? outcome.verdict : null,
        review_digest: isReviewed ? outcome.review_digest : null,
        reason: isReviewed ? null : `final_panel_seat_${status}`,
      };
      if (!isReviewed && outcome && typeof outcome.raw_log === 'string'
          && outcome.raw_log.length > 0) {
        body.raw_log = outcome.raw_log;
      }
      return { ...body, receipt_digest: campaignCanonicalDigest(body) };
    };
--- autopilot-engine.js:5049-5118 performFinalPanel body
      const outcomes = seats.map((seat, index) => {
        const reviewRoster = {
          ...roster,
          reviewer_runner: seat.runner,
          reviewer_engine: seat.model,
          reviewer_effort: seat.effort,
          reviewer_endpoint: seat.endpoint || '',
          reviewer_qualified: finalPanelSeatQualified(roster, seat, index),
        };
        const outcome = finalPanelSeatQualified(roster, seat, index)
          ? performReview({
            ...reviewInput,
            scope: 'final',
            reviewRoster,
            reviewStage: `campaign-final-review#seat-${index + 1}`,
            pinReviewerTuple: true,
          })
          : {
            reviewed: false,
            phase: 'reviewer_qualification',
            reason: 'final panel seat is not an exact qualified reviewer tuple',
          };
        return { seat, outcome };
      });
      const seatReceipts = outcomes.map(({ seat, outcome }, index) =>
        finalPanelSeatReceipt(seat, index, outcome));
      const reviewedOutcomes = outcomes.filter(({ outcome }) => outcome.reviewed === true);
      const mergedFindings = [];
      const findingIds = new Map();
      let findingsConsistent = true;
      for (const { outcome } of reviewedOutcomes) {
        let items;
        try {
          items = outcome.findings && outcome.findings.trim().length > 0
            ? JSON.parse(outcome.findings)
            : [];
        } catch (_error) {
          findingsConsistent = false;
          break;
        }
        for (const item of items) {
          const prior = findingIds.get(item.finding_id);
          const digest = campaignCanonicalDigest(item);
          if (prior && prior !== digest) {
            findingsConsistent = false;
            break;
          }
          if (!prior) {
            findingIds.set(item.finding_id, digest);
            mergedFindings.push(item);
          }
        }
        if (!findingsConsistent) break;
      }
      const allReviewed = reviewedOutcomes.length === outcomes.length;
      return {
        reviewed: allReviewed && findingsConsistent,
        verdict: allReviewed && findingsConsistent ? 'SHIP-AS-IS' : null,
        findings: JSON.stringify(mergedFindings),
        review_digest: allReviewed && findingsConsistent
          ? (reviewedOutcomes.length === 1
            ? reviewedOutcomes[0].outcome.review_digest
            : campaignCanonicalDigest(seatReceipts.map((seat) => seat.review_digest)))
          : null,
        sealed_min_panel_size: minPanelSize,
        final_panel_count: reviewedOutcomes.length,
        final_panel_seat_receipts: seatReceipts,
      };
    };

--- campaign-composition.js:318-354
const FINAL_PANEL_SEAT_KEYS = [
  'schema_version',
  'artifact_type',
  'seat_index',
  'runner',
  'model',
  'effort',
  'endpoint',
  'family',
  'status',
  'verdict',
  'review_digest',
  'reason',
  'receipt_digest',
];
const FINAL_PANEL_FAILURE_STATUSES = new Set([
  'no_verdict',
  'transport_failed',
  'parser_failed',
  'precondition_failed',
]);

function hasFinalPanelSeatKeys(seat) {
  if (!seat || typeof seat !== 'object' || Array.isArray(seat)) return false;
  if (!FINAL_PANEL_SEAT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(seat, key))) {
    return false;
  }
  const allowed = new Set([...FINAL_PANEL_SEAT_KEYS, 'raw_log']);
  for (const key of Object.keys(seat)) {
    if (!allowed.has(key)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(seat, 'raw_log')
      && (typeof seat.raw_log !== 'string' || seat.raw_log.length < 1)) {
    return false;
  }
  return true;
}
