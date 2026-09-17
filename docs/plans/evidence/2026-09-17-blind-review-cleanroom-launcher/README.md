# Evidence — mission `blind-review-cleanroom-launcher-2026-09-17` (v2.36.62; blind review redesign cut 1b-A)

- Plan: `../../2026-09-17-blind-review-cleanroom-launcher.md` (base `ceb7c81d` = v2.36.61; sealed at `c69f4bc5`).
  `bwrap-probe-2026-09-17.md` = the no-model probe run before the plan (`bwrap --args 9` leaves no host path in
  pid-1 argv). `base-suites-ceb7c81d.txt`: seven pre-existing §4.1 commands green at base, detached checkout;
  `cleanroom-launch.test.sh` recorded absent (created by this cut).
- Unknown-escalation: `ladder-classify.json` U1, `ladder.jsonl`; consult rail attempted and failed on the codex quota
  (`consult-codex-quota-rail-failed.json`, `rail-failed`, budget not a climb). Pointing the consult seat at GLM needs an
  operator pin — not done.
- Plan hetero loop (GLM-5.2 + claude-fable-5-1, codex quota out): G1 `g1-*` (9 folded, `plan.as-reviewed-g1.md`),
  G2 `g2-*` terminal at the cap (9 folded, `plan.as-reviewed-g2.md`), receipts `*-receipt.txt` rc 0. One frozen-rubric
  wording edit was refused (`g2-drifted-rubric-attempt.err`) and reverted to the G1 bytes before G2 — the rubric is
  frozen to the byte, and the receipt must be taken against the as-reviewed plan bytes (copy before folding).
- Campaign attempt 1 (`prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`; `scratch/` = the rails that
  ran it): hand cursor-grok-4.6-low `575a5fe0`, 46 min, 11 files ⊆ §2.5 (+1411/−19). In-rail: eight verification
  commands green (the isolation suite is green inside the rail's detached checkout too), MiniMax-M3 SHIP-AS-IS
  (`panel-raw-vWvlYQ.log`), then the **final panel returned all three seats** — claude-fable-5-1 FIX-THEN-SHIP 2 🟠
  (`panel-raw-tkGEU3.log`), GLM-5.2 FIX-THEN-SHIP 2 🟡 + 2 🔵 (`panel-raw-dAFzMg.log`), MiniMax-M3 SHIP-AS-IS
  (`panel-raw-xsEvcZ.log`). All four reviews carry one `packet_hash 5ee8c79c…` (1a-B live) and the in-rail seat ran
  with the sealed-budget `--timeout` (v2.36.60 live). The campaign stopped at `final_adjudication: final finding
  registry is incomplete` — no `--campaign-disposition-policy/authority` was given, and the panel has no repair loop
  by design (BACKLOG row). Documented path: `session-mode set --level l3 --entry-level l5 --fallback
  precondition_failed`, depth-0 repair on the mission branch.
- Panel adjudication (all in `6d7dc38c`): ✅ preflight probe used `cat`, so a directory deny path hit EISDIR and the
  check was vacuous → presence test `[ -e ] || [ -L ]` + `--deny-path /usr` exit-3 case; ✅ `assert_not_contains …
  $'\nlaunch\n'` could never match → `grep -cx launch`; ✅ fd-listing assertions (no 7/9); ✅ explicit
  `AUTOPILOT_CLEANROOM_CODEX_AUTH` naming a missing file is refused, never falls back (+ portable test); ✅ dead
  `probe.stderr` branch removed; ❌ GLM `cl-md-line-shape` refuted — the CLAUDE.md line is 806 B, over the pre-commit
  800 B line cap, so the hand's wrap is right (rejoining it was blocked by pre-commit, which is how it was found).
  `4936e27c`: the new credential-override case needed the stub launcher env (`repair-suites-partial.txt`).
- Depth-0 at `4936e27c` (`head-suites-4936e27c.txt`): 8/8 §4.1 commands green on a detached checkout, sequential
  (dispatch-review 504, cleanroom-launch 47, review-runner 39, review-packet 54); `git diff --stat c69f4bc5 -- src
  schemas bin/autopilot.js scripts/resolve-review-loop.sh scripts/qualification-review-provider.js` empty;
  launcher and test file `test -x`.
- Second-family review at `4936e27c` (`review-glm-r2.json`, raw `review-glm-r2-raw.log`; GLM-5.2 via
  anthropic-compatible, diff `c69f4bc5..4936e27c` with no path filter, spec = plan): SHIP-AS-IS, 4 🔵 all scoped
  CUT/FOLLOW-UP by the reviewer — isolation suite never asserts `HOME=DENIED`; `_pf_err` mktemp never unlinked;
  legacy non-zero block unreachable on the blind path; and the CLAUDE.md line wrap (the 800 B cap again, refuted).
  The three real ones are carry-in items for 1b-B (which edits `dispatch-review.sh` anyway).
- Plan §5 dogfood at `4936e27c` (`dogfood-cleanroom-codex.json`, raw `dogfood-cleanroom-codex-raw.log`,
  `dogfood-packet-MANIFEST.json`): a real packet built from the mission worktree (`buildReviewPacket`, base
  `c69f4bc5` → `4936e27c`, 3391 entries, `packet_hash c495e41d…`), then `dispatch-review.sh --runner codex --model
  gpt-5.6-sol` under `AUTOPILOT_BLIND_DISCOVERY=1` with the REAL codex 0.154.0 release bin/ and the real
  `~/.codex/auth.json`. Outcome: codex started inside the seat (`workdir: /home/review/work`, `sandbox:
  danger-full-access`), read the prompt from stdin, and hit `ERROR: You've hit your usage limit … try again at Sep
  19th, 2026 8:26 AM` **inside the boundary** — the copied credential was read from the seat HOME and the transport
  left the sandbox; the seat clock says 08:26 where the host says 16:26 for the same instant, so no host TZ leaks in.
  Launcher JSON: `exit_status 1, timed_out false, seat_root_removed true`, seat root `<packet-dir>/../seat` (beside the
  packet, not `/tmp`) confirmed absent afterwards; `dispatch-review` → `no_verdict` (`cleanroom codex exited non-zero
  (rc=1)`). `sha256sum ~/.codex/auth.json` before and after: `3d5c2669…` both times; a host `codex exec` control
  afterwards is still quota-gated with the same usage-limit error (the host credential authenticates; a second host
  control run timed out at 120 s before printing, recorded as such). The copied-credential refresh limitation stands
  as stated. No live codex verdict this cut; the first real cleanroom verdict is 1b-B's dogfood after 2026-09-19.
- v2.36.60 live datapoint (peer, openclaw): fleet-comms cockpit-followups Phase 2 (2026-09-17 morning, after the
  push) ran its in-loop GLM review round to completion and reached `ready` — the first live campaign whose review
  round did not die at 5 m.
- Merge `94d44940` (`--no-ff`, QC trailer: in-rail MiniMax + three panel seats + GLM second review; 8/8 green);
  `integration-record.json`, `reap-*.json`, `residue-receipt.json` = closeout.
