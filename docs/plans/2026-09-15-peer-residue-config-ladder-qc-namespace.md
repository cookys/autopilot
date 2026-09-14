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
  `--out "$RUN_DIR/panel/<node>"` (or `--run-id "$RUN_ID"`); grep-able instruction, pinned by test.
- Tests: `hooks/tests/qc-panel.test.sh` — two nodes on one project produce two directories, neither
  clobbers the other; `--run-id` with a path-traversal value is refused; explicit `--out` unchanged.
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
  `resolve-worktree-teardown.test.sh`, `qc-panel.test.sh`, `check-hands-commit.test.sh` all PASS;
  `dispatch-foreman.test.sh` assertion count for the brief string is green (suite total may stay
  red on the known TEST_TMP defect — that is not this deliverable's).
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`,
  `node scripts/check-reference-sizes.js` clean.
- Every new assertion has a recorded red against the base commit.

## Review log

- 2026-09-15 depth-0: read-only spike (sonnet) audited the six `resolve-*` scripts; only three call
  the helper, `resolve-doa.sh` has a parallel ladder, `resolve-dispatch.sh`/`resolve-endpoint.sh`
  have no file tier. Ruling above follows the spike's table. Second spike confirmed tunnel-host
  B/C/E shipped and A/D open.
