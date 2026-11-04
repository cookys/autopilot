# post-head target: compare with git ls-remote when the network is available (BL-0380)

Source: follow-up recorded when the parent item closed (2026-11-04). Not yet scheduled.

BL-0377 requires the target to be on the first-parent history of the local `refs/remotes/origin/develop`. A local `update-ref` can move that ref; the PM accepted this residual. Wanted: when the network is available, optionally compare the local ref with `git ls-remote origin develop` and fail or warn on a mismatch. Offline behaviour must stay as it is. Red case: a locally moved ref must be reported when the network check runs.
