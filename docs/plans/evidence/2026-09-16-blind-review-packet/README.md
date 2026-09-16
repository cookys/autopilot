# Evidence — mission `blind-review-packet-2026-09-16` (v2.36.59; blind review redesign cut 1a-A)

- Design: `../2026-09-16-blind-review-redesign/` — two design consults (claude-fable-5-1, gpt-6-astra),
  `bwrap-probe.md` (codex with tools inside bubblewrap; settles UID-drop vs bwrap for cut 1b), and the
  codex plan consult on the first draft (`consult-plan-cut1a-*`) that split the cut into 1a-A / 1a-B.
- Step 0 (chicken-and-egg, HANDOFF): `qc_panel[0]` swapped to `claude-fable-5-1/claude-native` for
  the redesign window (`004cb2da`, operator decision per HANDOFF option (a)); `MiniMax-M3` also pinned.
  Swap back to `gpt-5.6-sol/codex` after cut 1b admits cleanroom seats.
- `base-suites-004cb2da.txt`: ten verification commands green at base before sealing.
- Plan hetero loop: v1 G1 (`g1-*`, GLM READY / sol STOP 2: git archive `export-subst`/`export-ignore`
  leak, symlink oracle newline) — both accepted; the fold falsified frozen R1's own wording, so the
  rubric was re-frozen under logical id `…-v2`. v2 G1 (`v2g1-*`, sol STOP 4: smudge driver before the
  integrity pass, `core.symlinks=false` materialization, non-UTF-8 paths, 40-hex assertion) — all
  accepted; v2 G2 terminal at cap (`v2g2-*`, GLM CONDITIONAL 1 nb / sol STOP 3: ident witness,
  `$GIT_DIR/info/attributes`, count-only alignment) — all accepted, depth-0 freeze with zero
  unaddressed blockers. Every mechanism the folds introduced was probed live before being written
  (Review log). Receipts: `*-receipt.txt` (rc 0). The first v2 G1 process was killed by the harness
  memory guard before any seat returned; its orphaned state was moved aside (scratchpad) and the
  lineage re-run clean.
- Campaign attempt 1 (`prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`): base
  `86f3b651` (product identical to rubric base `004cb2da`).
- Lineage 1 attempt 1 (`impl-run1-attempt1-intake-rejected.json`): the graph checker admits
  `max_wall_seconds` up to 14400 (`mission-execution-graph.js:260`) but the campaign contract schema
  caps it at 7200 and intake rejects the sealed contract (`REJECTED: max_wall_seconds: expected
  integer in 1..7200`) — one grant attempt burned pre-spend, no residue. Rail defect (BACKLOG row);
  re-sealed at 7200 under lineage 2 (`da1e373b`).
- Lineage 2 attempt 1 (`impl-run1.json`, base `da1e373b`): hand cursor-grok-4.6-low `e566ea0c` (9 files, all ⊆ §2.5;
  `src/engine`/`scripts`/`bin`/`schemas` byte-identical to `004cb2da`; `test -x` ok). Rail: verify + in-rail MiniMax
  review SHIP-AS-IS (`review-minimax-r1-raw.log`) + full_suite green; then **all three final-panel seats
  `transport_failed` — rc=124 at the 5m default** (`dispatch-review.sh` gets no `--timeout` from
  `performFinalPanel`; the 90 KB diff is enough to starve claude-native/GLM/MiniMax). Rail defect (BACKLOG row);
  degraded `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- Depth-0 at `e566ea0c` (`head-suites.txt`): six verification commands green; fixtures read — the two controls are
  RED-capable (`git archive` control asserts the expansion/omission; the `.git/info/attributes` control asserts the
  sentinel marker exists) and every assertion calls the real `buildReviewPacket`. One gap found by reading: the tracked
  `.gitattributes` sentinel had no "marker absent" assertion.
- Second-family review, non-blind codex gpt-5.6-sol max (`review-codex-r1.json` + raw): FIX-THEN-SHIP, 🔴 deny only on
  leaf paths (`logs/x.raw.log/verdict.txt` survives), 🟠 ambient `GIT_COMMON_DIR` reaches the isolated git dir, 🟠
  symlink `.gitattributes` restored as a file (fails closed), 🟠 name-status paths not UTF-8-validated, 🟠 backslash
  rewritten to `/` (a valid POSIX name falsely denied). All five re-derived and repaired at depth-0 on the mission branch
  (`6b4aec86`: ancestor-prefix deny, scrub every `GIT_*`, restore by mode, validate bytes, no rewrite; tests (a)
  marker-absent, (g2), (h2d) poisoned `GIT_COMMON_DIR` + `GIT_CONFIG_*`, (h4b), (k) — 6 RED at `e566ea0c`, 54 green;
  `repair-suites.txt` six green). r2 delta (`review-codex-r2.json`): one 🟠 (symlink target decoded as UTF-8) →
  `ab22980d` (raw Buffer target). r3 delta: SHIP-AS-IS.
- Dogfood (plan §5): packet of this repo's HEAD built in 21 s (4236 tracked files, one `hash-object` spawn each —
  batching row filed); `denied_paths` lists `.qc/*.verdict.json`, `docs/plans/evidence/**`, `*.review.md`,
  `*disposition*.json`; `tree/.agents/skills` is a symlink.
- Merge `ad852de2` (QC trailer: codex r3 + MiniMax in-rail); `integration-record.json`.
