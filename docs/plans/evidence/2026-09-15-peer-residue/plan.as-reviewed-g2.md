# Peer-reported residue: config-ladder tier-3 leak, qc-panel output namespace, wrapper commit-subject contract

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node `peer-residue-2026-09-15`).
> Source rows: `docs/BACKLOG.md` "The shared config ladder's tier 3 reads the PLUGIN's `.claude/`…" (fired 2026-09-12)
> and "PEER-REPORTED (chatgpt-tunnel-host via cuda)…" items (A) and (D) (fired 2026-09-12). Items (B)/(C)/(E)
> of the latter shipped v2.36.34/v2.36.37 and are out of scope. Audit evidence for §1 is in the
> 2026-09-15 read-only spike recorded under "Review log" below.

## 0. Why these three together

All three are the same failure class: a mechanism whose answer is right by coincidence — a config
tier that happens to find no file, an output directory that happens not to be shared, a commit
subject that happens to match a grep. Each is S-size, each touches a different surface, none has
a design question left open. One campaign, one branch, one review.

## 1. Config ladder tier 3 — `scripts/lib/resolve-config.sh`

**Defect.** `resolve_config_ladder` tier 3 (`resolve-config.sh:45-47`) reads
`$REPO_ROOT/.claude/<basename>` where `REPO_ROOT` is computed by every consumer from its own script
path — i.e. the autopilot plugin root, never the consuming project. The installed plugin ships a
`.claude/` directory, so a foreign repo with no config of its own resolves autopilot's dogfood file
and labels it `source: project-repo`. Measured consequences (spike 2026-09-15):

- `resolve-review-loop.sh`: ~15 roster fields differ between `.claude/review-loop-config.md` and
  `project-config-template/review-loop-config.md` (implementer cursor-grok, reviewer MiniMax via
  `minimax` endpoint, GLM fallback, Qwen verification author…) — a foreign repo silently inherits
  credentials it does not have. The authors already patched ONE field of this class
  (`brain_seat_identity_file`, `resolve-review-loop.sh:1940-1948`).
- `resolve-worktree-teardown.sh`: `stale_reaper_age_days` is `14` in `.claude/` vs `0` (reaper OFF)
  in the template — a foreign repo's `dispatch-hetero.sh --gc` goes from no-op to deleting
  marker-bearing worktrees older than 14 days. Destructive.
- `resolve-qc-gate.sh`: tier-3 file does not exist today (latent, same wiring).
- `resolve-doa.sh`: own hand-rolled 3-tier ladder (`:148-155`), same `$REPO_ROOT/.claude` third
  tier, same class; its file does not exist today either.

**Ruling (depth-0, within DOA).** Tier 3 is intent ONLY when the caller is working inside the
autopilot repo itself (dogfood). For every other caller it is an accident. `resolve-knowledge-routing.sh:93`
already implements exactly this gate; the helper adopts it.

**Change.**
- `resolve_config_ladder`: tier 3 fires only when the git toplevel of `$PWD` (realpath) equals
  `REPO_ROOT` (realpath). Outside a git checkout, or when they differ, tier 3 is skipped and tier 4
  (template) / the consumer's built-in default answers. Label stays `project-repo` (it now IS the
  project's repo). Add the gate once, in the helper; the three consumers
  (`resolve-qc-gate.sh`, `resolve-worktree-teardown.sh`, `resolve-review-loop.sh`) need no edit.
- `resolve-doa.sh`: apply the same gate to its third tier (two-line change; keep its own ladder,
  do not migrate it).
- `resolve-review-loop.sh:1940-1948` brain-seat guard: leave in place (defence in depth), but its
  comment must say the helper now refuses cross-repo tier 3 so the guard is no longer the only wall.
- Tests: `hooks/tests/resolve-config.test.sh` gains (a) a foreign git repo with no `.claude/` →
  `source: template`, and the review-loop `stale_reaper_age_days`/`implementer_engine` answers equal
  the template's; (b) cwd = a SUBDIRECTORY of the autopilot repo → tier 3 still fires
  (`source: project-repo`); (c) cwd outside any git repo → template. `resolve-doa.test.sh` gains the
  foreign-repo negative. Each new assertion must fail on the pre-change helper (record the red).

## 2. qc-panel output namespace — `scripts/qc-panel.js`, `scripts/dispatch-foreman.sh`

**Defect (tunnel-host A).** `qc-panel.js:193-199` derives the default `--out` as
`docs/projects/<proj>/tree/panel` from `--proj` alone; `--node` is validated but not used in the
path. Two panels on one project (depth-0 and a foreman, or two nodes) overwrite each other's json.

**Change.**
- Default `--out` becomes `docs/projects/<proj>/tree/panel/<node>`; when `--run-id <id>` is given
  (new optional flag, validated as a path component) it becomes `…/panel/<node>/<run-id>`. An
  explicit `--out` still wins. The chosen directory is printed on stderr and included in the
  panel's summary json (`out_dir`) so a caller can prove where it wrote.
- `dispatch-foreman.sh`: the brief it writes tells the foreman that any qc-panel it runs MUST pass
  `--out "$RUN_DIR/panel/<node>"` — `--out` rooted at `RUN_DIR` is the ONLY accepted form in the
  brief; `--run-id` is an optional extra path component, never an alternative to `--out` (a
  `--run-id`-only call still lands under the project-level default and can collide). Grep-able
  instruction, pinned by a test that asserts the literal `--out "$RUN_DIR/panel/` prefix.
- Tests: `hooks/tests/qc-panel.test.sh` — two nodes on one project produce two directories, neither
  clobbers the other; `--run-id` containing `..`, `/` or `\\` (the same `validatePathComponent` rule
  `--proj`/`--node` already use) is refused with exit 2 and a message naming the flag; explicit
  `--out` unchanged.
  `hooks/tests/dispatch-foreman.test.sh` — the brief contains the `--out`/`--run-id` instruction
  (string assertion only; the foreman suite's case-3 TEST_TMP defect is a separate BACKLOG row).

## 3. Wrapper commit-subject contract — `references/hetero-dispatch.md`, `scripts/check-hands-commit.js`

**Defect (tunnel-host D).** The wrapper commit subject `dispatch-hetero(<engine>): edits on <branch>`
exists only at `dispatch-hetero.sh:3487`. Nothing documents it; nothing consumes it; peers re-derive
"landed / not landed" from grepping subjects and get it wrong (308, 2026-09-12).

**Change.**
- `references/hetero-dispatch.md` § Outcome states: a "Wrapper commit subject" paragraph freezing
  the exact format, stating that the subject is an IDENTIFIER of the wrapper commit and never
  evidence of integration — containment is `check-containment.js` / `check-inputs-landed.js`, not
  grep.
- `check-hands-commit.js`: a new `--expect-wrapper-subject` opt-in check that the range's tip
  commit subject matches `^dispatch-hetero\([^)]+\): edits on \S+$`; off by default (the rail's own
  commit is not the only legitimate producer). `dispatch-hetero.sh` passes it when it invokes the
  gate on its own commit.
- Tests: `hooks/tests/check-hands-commit.test.sh` — matching subject passes, a `feat(...)` subject
  fails ONLY with the flag, default unchanged.

## 4. Out of scope (do not touch)

`resolve-dispatch.sh` and `resolve-endpoint.sh` (no file ladder); the codex-mirror `.claude/`
question (ruled "worse defect than the one it closes" in the BACKLOG row); tunnel-host B/C/E; the
foreman suite's TEST_TMP defect; any change to what tier 1/2/4 read.

## 5. Acceptance

- `bash hooks/tests/resolve-config.test.sh`, `resolve-doa.test.sh`, `resolve-review-loop.test.sh`,
  `resolve-worktree-teardown.test.sh`, `qc-gate.test.sh` (the `resolve-qc-gate.sh` consumer suite),
  `qc-panel.test.sh`, `check-hands-commit.test.sh` all PASS;
  `dispatch-foreman.test.sh` assertion count for the brief string is green (suite total may stay
  red on the known TEST_TMP defect — that is not this deliverable's).
- `node scripts/check-js-syntax.js` (covers only the two JS files touched, `qc-panel.js` and
  `check-hands-commit.js` — it says nothing about the shell edits in §1), `bash scripts/sync-codex-plugin-skills.sh --check`,
  `node scripts/check-reference-sizes.js` clean. Note `check-reference-sizes.js` caps only
  `skills/*/references/*.md`; `references/hetero-dispatch.md` is a top-level reference already at
  78,649 B (2026-09-15) and is NOT under that cap — the §3 paragraph must stay ≤ 700 B and the hand
  records `wc -c` before/after in its commit message so the growth is visible.
- Every new assertion has a recorded red against the base commit.
- **Sealed output surface** (the campaign's `output_paths`, verbatim; a diff touching anything else
  is `boundary_rejected`, and every `scripts/**` / `references/**` file has its codex mirror listed):
  `scripts/lib/resolve-config.sh`, `platforms/codex/plugin/scripts/lib/resolve-config.sh`,
  `scripts/resolve-doa.sh`, `platforms/codex/plugin/scripts/resolve-doa.sh`,
  `scripts/resolve-review-loop.sh`, `platforms/codex/plugin/scripts/resolve-review-loop.sh`,
  `scripts/qc-panel.js`, `platforms/codex/plugin/scripts/qc-panel.js`,
  `scripts/dispatch-foreman.sh`, `platforms/codex/plugin/scripts/dispatch-foreman.sh`,
  `scripts/dispatch-hetero.sh`, `platforms/codex/plugin/scripts/dispatch-hetero.sh`,
  `scripts/check-hands-commit.js`, `platforms/codex/plugin/scripts/check-hands-commit.js`,
  `references/hetero-dispatch.md`, `platforms/codex/plugin/references/hetero-dispatch.md`,
  `hooks/tests/resolve-config.test.sh`, `hooks/tests/resolve-doa.test.sh`, `hooks/tests/qc-panel.test.sh`,
  `hooks/tests/dispatch-foreman.test.sh`, `hooks/tests/check-hands-commit.test.sh`.
  Nothing is created; no `hooks/tests` mirror exists (the codex payload does not carry tests).

## Review log

- 2026-09-15 plan review G1 (GLM-5.2 architecture seat: CONDITIONAL, one non-blocking R7 finding —
  exit code and refused characters now pinned in §2; MiniMax-M3 skeptic seat: two attempts, both
  unparseable format → transport exhausted; its raw text raised the reference-size / js-syntax scope
  points now folded into §5). G1 is terminal-CONDITIONAL with zero ratified findings, so a second
  generation runs with the panel's second family swapped to codex/gpt-5.6-sol.
- 2026-09-15 plan review G1 (GLM-5.2 READY; codex/gpt-5.6-sol STOP with three blockers, all
  accepted and folded): R8 — `--run-id` is no longer an alternative to `--out` in the foreman brief;
  R4 — `qc-gate.test.sh` added to acceptance; R11 — the sealed `output_paths` are now listed in §5.
  (The first two G1 attempts are recorded as evidence only: MiniMax seat format-exhausted; codex seat
  blocked by a prematurely set l5 marker — recipe order corrected.)
- 2026-09-15 depth-0: read-only spike (sonnet) audited the six `resolve-*` scripts; only three call
  the helper, `resolve-doa.sh` has a parallel ladder, `resolve-dispatch.sh`/`resolve-endpoint.sh`
  have no file tier. Ruling above follows the spike's table. Second spike confirmed tunnel-host
  B/C/E shipped and A/D open.
