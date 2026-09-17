# Evidence — mission `blind-review-packet-deny-config-2026-09-17` (v2.36.64; blind review redesign cut 1c)

- Plan: `../../2026-09-17-blind-review-packet-deny-config.md` (base `6a414c3c` = v2.36.63; sealed at `10c50297`).
  `base-suites-6a414c3c.txt`: nine §4.1 commands green at base, detached checkout.
- Unknown-escalation: `ladder-classify.json` U0 — no consult.
- Plan hetero loop (GLM-5.2 anthropic-compatible + claude-fable-5-1 claude-native, MiniMax fallback): G1 attempt 1
  `required_seat_transport_exhausted` — the claude seat tried to run tools in its scratch cwd twice
  (`g1-attempt1-claude-raw.log`; zero ratified findings) → the plan gained the "citations are provenance, not reading
  assignments" clause, fresh `--state-dir`. G1 (`g1-*`, `plan.as-reviewed-g1.md`): 7 findings, 6 accepted, 1 refuted with
  evidence (no consumer recomputes `packet_hash`). G2 terminal at the cap (`g2-*`, `plan.as-reviewed-g2.md`): 6 accepted —
  single floor in `review.js`, the character allowlist dropped (shell projects `otherGlobSyntax`, JSON-escapes), template
  mirror sealed, `undefined`-only absence, real-builder tests. Receipts rc 0. Growth 1.19×.
- Campaign attempt 1 (`grant.json`, `impl-brief.md`, `impl-run1-attempt1-dirty-tree.json`, `impl-run2.json`; rails in
  `scratch/`): the first intake was refused pre-spend — `repository has uncommitted changes` (an untracked copy of the
  dispatch script in this scratch dir; lesson re-learned, no attempt burned, grant returned `replay`). Then: hand
  cursor-grok-4.6-low `3d6b4c02`, 58 min, 19 files ⊆ §2.5 (+651/−18); in-rail scope + verification (9 commands) + full
  suite green; in-rail MiniMax-M3 SHIP-AS-IS (`review-minimax-r1-raw.log`); **final panel**: claude-fable-5-1
  FIX-THEN-SHIP 1 🟡 + 3 🔵 in 3 min (`panel-claude-raw.log`), GLM-5.2 rc=124 after 4 min, MiniMax-M3 rc=124 after 3 min
  (`panel-*-124-raw.log`) → `final_panel_seat_transport_failed`. Rail observation (BACKLOG row): after implement,
  verification and the full suite consumed the sealed wall, the v2.36.60 per-seat split left ~4 min per panel seat.
  Degraded per doc: `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- Depth-0 at `3d6b4c02`: scope ⊆ §2.5; `review-packet.js`/`campaign-intake.js`/`dispatch-review.sh`/`scripts/lib`/`bin`
  byte-identical; nine commands green on a scratch branch (`head-suites-3d6b4c02.txt`).
- Adjudication of the panel: ❌ 🟡 `schema-items-pattern-missing` refuted — plan §1.2 (G1 fold `71b5943a`) rules the schema
  declares type only and the grammar has one owner; a schema `pattern` is exactly the second definition the loop
  removed. ✅ 🔵 `builder-caller-grep-vacuous-without-rg` re-derived (a host without `rg` passes with
  `builder_callers=0`) → repaired at `91f07aa7`: Node walk over `src/**/*.js`, `builder_callers=2` pinned. ✅ 🔵
  `oracle-brace-probe-split-on-comma` → `a[b`, `a]b`, `a{b`, `a}b` probes added. 🔵 `review-js-null-deny-extra-spread`:
  the engine gate blocks every malformed shape before dispatch — follow-up.
- Second-family review of `10c50297..3d6b4c02` (no path filter; GLM-5.2 anthropic-compatible, `review-glm-r2.json`, raw
  `review-glm-r2-raw.log`): FIX-THEN-SHIP, 1 🟠 `deny-extra-backslash-parity` — **refuted empirically**: in bash
  `[[ "$s" == *[\?\[\]\{\}]* ]]` the backslashes quote the members, `back\slash` → accept, `a?b`/`a[b` → reject on this host
  (`dogfood-bash-bracket.txt`); the resolver suite's oracle case (which probes `back\slash/**`) is green in-rail and at
  depth-0. 🔵 base-sha comment drift: the tests cite the sealed base `10c50297`, the plan the code base `6a414c3c` — same
  bytes for every sealed file; provenance only.
- Delta review of `3d6b4c02..91f07aa7` (claude-fable-5-1, `review-claude-r3.json`, raw): SHIP-AS-IS, 2 🔵 (substring pin,
  comment brittleness — optional hardening). Nine commands green again at `91f07aa7` (`head-suites-91f07aa7.txt`).
- Plan §5 dogfood: `dogfood-deny-extra.txt` — scratch config with `review_packet_deny_extra:
  docs/projects/ongoing-maintenance/HANDOFF.md`: the resolver emits the field; a packet built with the composed list
  omits the file from `tree/` and its `MANIFEST.json` `deny_list` carries the pattern with the eight defaults;
  `packet_hash` differs from the default-list build of the same range; an invalid pattern is refused by the resolver
  before any seat is spent.
- Merge `f6cb9a1a`; `integration-record.json`, `reap-*.json`, `residue-receipt.json` = closeout.
