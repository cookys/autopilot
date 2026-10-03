# Final-panel seat artifacts under the git common dir are never reaped

Source: v2.36.111 closeout residue check, 2026-10-03.

- **Trigger**: next touch of campaign terminal cleanup or `scripts/repo-residue-sweep.js`.
- **Context**: `src/engine/final-panel-seat-store.js` writes `<git-common-dir>/autopilot/final-panel-seats/<campaign>/<station>-<binding>/seat-N.json`. Nothing in `scripts/repo-residue-sweep.js`, `scripts/lib/prune-tmp-residue.sh`, `scripts/reap-dispatch-*.sh`, `scripts/lib/worktree-reap.sh`, or the engine's terminal cleanup references the directory (grep over scripts/src/bin/hooks: only the engine, the store, and two tests mention it). The directory grows by one subtree per campaign that reaches the final panel.
- **Fix shape**: remove `<campaign>/` at campaign terminal (converged, terminal-blocked, abandoned) and add a sweep arm in `repo-residue-sweep.js` for campaigns with no live lease; reaping must keep a resumable (parked) campaign's artifacts, since a resume reads them.
- **Effort**: S
