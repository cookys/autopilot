# trwc REPORT (final head e0cf0511, stacked on 63c4caeb)
LAND 0 362d2a45   (hands/trwc/0)    SHIP-AS-IS; 1 file +8; RED comment recorded
LAND 1 c6755303   (hands/trwc/1-r2) r1 FIX-THEN-SHIP (G11 protocol creep, inv1 quoted form) -> repaired; r2 review still raised 2 orange findings (value-quoted empty capture, catch-all) -> fixed in 1-r3 per depth-0
LAND 2 183c6e9e   (hands/trwc/2-r2) round 1 got boundary_rejected (clone ref changed, cause unattributed; commit 2c0597e6 existed); redone as repair hand on top (warn-name-set, slash-key); SHIP-AS-IS
LAND 3 414ef8ac   (hands/trwc/3-r2) r1 FIX-THEN-SHIP (fixtures under bare TMPDIR) -> repaired; SHIP-AS-IS. Push cases call pre-push directly with synthesized stdin (file transport failed with 128), not a real git push
LAND 4a 5d5785fb  (hands/trwc/4a-r2) r1 FIX-THEN-SHIP (stray tracked.txt, --parallel bypass, no own pgroup, test env) -> repaired; r2 left SIGPIPE-ignored-by-python-shim, folded into 4b
LAND 4b 9a8e1414  (hands/trwc/4b-r2) r1 FIX-THEN-SHIP (flock-missing degrade, oracle-lock silent opt-out) -> repaired; SHIP-AS-IS
LAND 1-r3 e0cf0511 (hands/trwc/1-r3-r2) catch-all inventory + quoted -c capture; r1 FIX-THEN-SHIP (control list widened) -> repaired; SHIP-AS-IS
Open nits (blue/yellow, not dismissed): setsid-branch cannot reset ignored signals; no-setsid fallback no own pgroup; catch-all skips trailing-dot domains; reaper cases assume flock on host.
Verify (throwaway worktree at e0cf0511, solo): all rc=0 except test-snapshot rc=1 once ("P4 pgid: SIGINT to inner group is trapped (130): expected 130, got 0"), then rc=0 twice solo (117 assertions) -> timing-flaky pgid case, depth-0 to judge.
Suites rc=0: test-identity-guard check-canonical-invariants qc-gate mission-terminal-rollover codex-plugin-package dispatch-lifecycle-residue-mission dispatch-status-reap lifecycle-residue-receipt prune-tmp-residue reap-dispatch-branches reap-dispatch-worktrees repo-residue-sweep suite-oracle-lock suite-residue-reaper worktree-reap check-js-syntax sync-check
