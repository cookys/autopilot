# Identity-containment rail — port onto develop v2.32.48 (release as v2.32.49)

**Context.** The git-identity containment rail (snapshot/restore of the consuming repo's
`user.name`/`user.email` around a dispatched worker, additive `"identity_drift": true` result
field, loud no-value-echo warning) was implemented and adversarially verified on the local
branch `feat/identity-containment` (11 commits, based on v2.32.44-era develop) but never
merged. Mainline develop has since advanced 24 commits to v2.32.48 with **no conflict in the
two core scripts** (`scripts/dispatch-hetero.sh`, `scripts/dispatch-author.sh` are untouched
on the develop side since the merge-base) — but the release materials (CHANGELOG / INDEX /
version mirrors / README badges) and three shared test files diverged. This plan ports the
feature onto current develop as **one unit commit** on top of the spec-commit base.

**Source of truth.** The exact feature diff (`git diff 2827f51..feat/identity-containment`,
18 files, +372/−54) is embedded verbatim in the U1 dispatch prompt. Where this plan and the
raw diff disagree on ADAPTATION (retargeting, files to skip), this plan wins.

## U1 implementer — port identity-containment rail

Apply the identity-containment feature to the current tree (base = this plan's commit on
top of v2.32.48). Concretely:

1. **`scripts/dispatch-hetero.sh`** — apply all four identity hunks from the source diff:
   (a) the `IDENTITY_DRIFT` / `IDENTITY_PRE_NAME` / `IDENTITY_PRE_EMAIL` /
   `IDENTITY_REPO_ROOT` variable declarations near the other early-init state;
   (b) the drift compare + restore block at the TOP of `emit()` (every outcome path) using
   `git -C "$IDENTITY_REPO_ROOT"` and never echoing identity values;
   (c) the additive `identity_fields` (`, "identity_drift": true` only when drift detected)
   appended to the final JSON printf — keep the existing printf field order, add `%s` at the
   tail exactly as the source diff does;
   (d) the pre-runner snapshot (host repo root via `git rev-parse --show-toplevel`) right
   after `BASE_SHA` is resolved, and the four `IDENTITY_*` names added to the `declare -p`
   list in `dispatch_detached_run()`.
2. **`scripts/dispatch-author.sh`** — apply all three identity hunks: variable init
   alongside `CONTAINMENT_PRE_*`; the pre-runner snapshot gated on `--repo-root`
   (`IDENTITY_SNAPSHOT_TAKEN=1`); the drift compare + restore + additive
   `"identity_drift": true` in `emit_result()`.
3. **`hooks/tests/dispatch-identity-containment.test.sh`** — add the new 162-line
   RED→GREEN oracle from the source diff verbatim (adapt only if a helper it sources moved
   on develop; `hooks/tests/lib.sh` changed on develop — verify the oracle still runs green).
4. **CHANGELOG.md** — add the identity-containment release entry at the TOP, retargeted:
   the source diff's `## v2.32.44 — Dispatch worker git-identity containment` becomes
   `## v2.32.49 — Dispatch worker git-identity containment`. Keep the body's factual claims;
   update the provenance line to say the rail was implemented by grok-4.5 under the
   strict-contract dispatch rail and ported onto v2.32.48 by grok-4.5 (this run). Do NOT
   claim reviews that have not happened yet.
5. **Version bump v2.32.48 → v2.32.49** — run `node scripts/sync-version.js --version 2.32.49`
   (no count flags; counts preserved from canonical). Then regenerate the codex payload with
   `bash scripts/sync-codex-plugin-skills.sh`. Ensure BOTH README version badges (EN + zh-TW)
   read 2.32.49 and `node scripts/check-readme-parity.js` passes. Ensure the codex-side
   version mirrors (`platforms/codex/plugin/.codex-plugin/plugin.json`,
   `platforms/codex/.agents/plugins/marketplace.json`) match — use the sync scripts, do not
   hand-edit generated payload files except via the sync commands.
6. **docs/BACKLOG.md** — apply the source diff's two identity follow-up notes (author
   non-strict path follow-up + detach verification note), adapted to the current BACKLOG
   text (develop edited BACKLOG since the merge-base; place the notes sensibly, keep both).
7. **docs/projects/INDEX.md** — apply the source diff's identity release row retargeted to
   v2.32.49, adapted to the current INDEX state.

**Deliberately NOT ported** (develop already carries equivalent changes — bringing them
would duplicate or regress): the source diff's edits to
`hooks/tests/autopilot-cli.test.sh`, `hooks/tests/review-loop-runner.test.sh`, and
`hooks/tests/resolve-review-loop.test.sh` (roster-follow expectation fixes; develop fixed
these its own way). Leave those three files exactly as they are on the base.

**Acceptance (executed mechanically in the unit worktree):**

- `bash hooks/tests/dispatch-identity-containment.test.sh` exits 0 (the ported oracle is GREEN);
- `bash hooks/tests/dispatch-hetero-contract.test.sh` exits 0 (strict-contract emit path unregressed);
- `node scripts/sync-version.js --check` exits 0 (all version mirrors in lockstep at 2.32.49);
- `node scripts/check-readme-parity.js` exits 0;
- `bash scripts/sync-codex-plugin-skills.sh --check` exits 0 (payload regenerated, no drift).

**Boundaries.** Touch only the files named above (plus the two generated codex payload
scripts via the sync command). No pushes, no merges, no dependency changes, no edits to
`.claude/`, `.github/`, `schemas/`, `src/`, `bin/`, or any hook JS. Do not weaken, skip, or
delete any existing test. If an instruction here cannot be satisfied (e.g. the oracle
cannot be made green without changing production semantics), STOP and report rather than
adapting the production code beyond the source diff.

## U2 verification author — independent port-fidelity harness

Author (do NOT run) ONE self-contained bash script, `identity-port-fidelity.sh`, that a
depth-0 orchestrator will execute at the ported repo's root as
`bash identity-port-fidelity.sh <repo-root>`. It must exit 0 only if ALL of the following
hold, and print one `FIDELITY: PASS` / `FIDELITY: FAIL <reason>` line at the end:

1. **Rail presence** — `scripts/dispatch-hetero.sh` contains the pre-runner identity
   snapshot (`IDENTITY_REPO_ROOT` capture via `git rev-parse --show-toplevel`), the emit()
   drift compare + restore (`git -C "$IDENTITY_REPO_ROOT" config user.name` both read and
   restore directions), the additive `identity_drift` JSON field, and the `IDENTITY_*`
   names in the `declare -p` detach list; `scripts/dispatch-author.sh` contains the
   `IDENTITY_SNAPSHOT_TAKEN` gate and the `emit_result()` drift block. The codex payload
   mirrors (`platforms/codex/plugin/scripts/dispatch-{hetero,author}.sh`) contain the same
   markers.
2. **Behavioral proof, independent of the shipped oracle** — build a throwaway mini git
   repo (inside `mktemp -d`, never inside the repo under test) with a known
   `user.name`/`user.email`; invoke the REAL `scripts/dispatch-hetero.sh` from the repo
   under test with a stub runner/binary that mutates `git config user.name/email` through
   the worktree (bare `git config`, no `-C`); assert afterwards that (a) the mini repo's
   identity is RESTORED to the original values, (b) the dispatcher's final JSON contains
   `"identity_drift": true`, and (c) the identity VALUES never appear on stderr's warning
   line. Use only flags that exist in the script's usage header; a stub runner may be
   injected via the script's documented bin-override flags (e.g. `--codex-bin`) or PATH.
3. **Release consistency** — the version in `.claude-plugin/plugin.json` equals the version
   in the TOP release heading of CHANGELOG.md, equals both README version badges, and the
   CHANGELOG top entry names the identity-containment feature.

Constraints: bash + git + standard coreutils + node only; no network; no writes outside
`mktemp -d` scratch; must be re-runnable (idempotent); every FAIL path names the failed
check. The script must NOT source or trust the ported repo's own test files (independence
from the implementer's oracle is the point).

## U1b fix round — panel findings remediation

Three verified findings from the authoritative review panel to remediate in
`scripts/dispatch-hetero.sh` and `scripts/dispatch-author.sh` (then regenerate the codex
payload mirrors):

1. **Restore must never degrade to unset on a failed set.** The current
   `[ -n "$PRE" ] && git -C ... config user.X "$PRE" || git -C ... config --unset user.X`
   chains (both keys, both scripts) run the `--unset` branch whenever the SET fails (bash
   `A && B || C` semantics) — e.g. under `config.lock` contention from concurrent dispatch —
   removing the identity instead of restoring it. Replace each chain with an explicit
   `if [ -n "$PRE" ]; then git ... config user.X "$PRE" || <loud warning to stderr>; else
   git ... config --unset user.X 2>/dev/null || true; fi` so a failed set warns but never
   unsets a non-empty original.
2. **Scope-consistent snapshot/restore.** The snapshot reads EFFECTIVE config
   (`git config user.name`, which falls back to `~/.gitconfig`), but restore writes LOCAL
   scope — materializing a local override that did not exist pre-run when the repo relied on
   global identity. The incident vector is the shared `.git/config` (LOCAL scope), so read
   the snapshot with `git -C <root> config --local user.X` (empty when no local value), and
   the drift compare + restore stay on local values; an empty pre-value then restores
   original inheritance via `--unset`. Keep the post-run read on the same `--local` scope.
   Update `hooks/tests/dispatch-identity-containment.test.sh` ONLY if an assertion depends
   on effective-scope reads (the mini-repo fixtures set local identity, so behavior should
   be unchanged); do not weaken any assertion.
3. **Document the containment boundary honestly.** (a) CHANGELOG v2.32.49 entry: add one
   line stating the rail contains ONLY `user.name`/`user.email` — other shared-config keys
   (e.g. `core.hooksPath`, `credential.helper`) remain uncontained, per the repo's standing
   "containment is teardown hygiene, NOT a malicious-worker boundary" stance. (b)
   docs/BACKLOG.md: add a follow-up item for broader shared-config key containment /
   per-worktree config isolation (`extensions.worktreeConfig`), noting two accepted
   limitations: the drift compare is point-in-time (a worker that sets a bad identity,
   commits, then restores it before exit is undetected on its own worktree commits), and an
   escaped descendant could re-poison the shared config after emit-time restore.

Acceptance for this round is unchanged (the same five commands from the U1 section must all
exit 0 on the fixed tree).
