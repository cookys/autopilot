# wdogfu REPORT (stack: a1ca251e -> 51def4fb -> 39264663 -> a9973f44 -> 4543f5f1 -> bec1ba91)
Depth-0 cherry-picks hand commits only (a1ca251e is local-only, never land).
LAND R1 51def4fb (hands/wdfu/1) — items 1,9. review SHIP-AS-IS (2 blue). RED recorded at a1ca251e. Note: hand run reported wall timeout (its own pkill killed its watchdog), commit verified green independently.
LAND R2 39264663 (hands/wdfu/2-r2; base hands/wdfu/2 b9fbc8fc) — items 2,6. First review FIX-THEN-SHIP (orange: set -m made cgroup worker inherit stdin); repaired with </dev/null; re-review SHIP-AS-IS. RED at 51def4fb and b9fbc8fc.
LAND R3 a9973f44 (hands/wdfu/3-r2; first hand e577d5a6 broke real timeouts via ps -g, repaired) — item 3, alive-check (non-zombie) before fired marker. review SHIP-AS-IS. RED at 39264663.
LAND R4 4543f5f1 (hands/wdfu/4) — items 5,10 comment fix. SKIP item 4 (strict_manifest_fields carries only unit_id/contract_sha256/go; no dup timeout keys), SKIP item 7 (TIMEOUT_SOURCE caller assignment guarded by -z; campaign preflight never assigns it). review SHIP-AS-IS. RED at a9973f44.
LAND R5 bec1ba91 (hands/wdfu/5) — item 8: detached branch now falls through to reap_container; real detached test. review SHIP-AS-IS. RED at 4543f5f1.
## Verify at bec1ba91 (rc)
dispatch-hetero-watchdog-followups rc=0
dispatch-hetero-wall-timeout rc=0
dispatch-hetero-gc rc=0
dispatch-hetero-contract rc=0
dispatch-hetero rc=0
dispatch-hetero-cursor-routing rc=0
check-js-syntax rc=0
sync --check rc=0
