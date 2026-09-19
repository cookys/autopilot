# Plan L — stale leases become collectable
1. RED: a dead-pid, heartbeat-silent, worktree-absent lease is carried across rotation and keeps its journal rows alive.
2. `run-ledger.sh lease-gc`: dead only if pid dead AND heartbeat silent > TTL (12 h default) AND worktree absent / no flock holder (worktree-activity.js via shim); append `leased → dead` with a named reason through the normal transition path; `--dry-run`, `--json`.
3. Wire into the residue reap step (one place), inventory row.
4. GREEN: dead lease dropped from the carry (segment shrinks); live pid, live flock, recent heartbeat each skipped and named; existing rotation suites untouched; ONE commit.
Acceptance: after the merge the operator runs `lease-gc` once on this host and the next rotation's carry no longer spans five 2.5 MB segments.
