# P2.0 — assertions that move when rail worktrees go under `<main>/.claude/worktrees/`

Recorded before any P2 change (plan §3 P2.0). The P2 red run must not add a moved assertion that is not on this list.

## Search

```
ls hooks/tests | grep -E 'dispatch-hetero|dispatch-foreman|dispatch-batch|dispatch-detach|dispatch-worktree-lifecycle|worktree-reap|reap-dispatch|residue|orchestrator-edit-gate|foreman-guard'
grep -nE 'porcelain|status --short|untracked|--others' <each matching hooks/tests/*.test.sh>
grep -nE "hetero-\*|foreman-\*|batch-integ|find .*(TMPDIR|CASE_TMP|/tmp)|ls .*(TMPDIR|CASE_TMP|/tmp)|mktemp.*(hetero|foreman|batch)" <same files>
grep -nE "status( |')|diff --quiet|diff --exit|diff --name-only|clean tree|is clean" <rail and reaper suites>
grep -nE "porcelain|status --short|untracked|tmpdir|TMPDIR|hetero-|foreman-|batch-integ" hooks/orchestrator-edit-gate.test.js hooks/residue-auto-reap.test.js
```

## Result

**No suite asserts the sandbox main checkout's `git status` / `--porcelain` is clean.** Every porcelain check is on a
fixture worktree the test builds itself (dispatch-worktree-lifecycle:600/602, dispatch-hetero-gc:412,
repo-residue-sweep, repo-residue-auto). D11's exclude therefore protects consumers, not an existing assertion; P2
adds the assertion (sandbox porcelain clean after a rail run).

| Site | What | Moves? | Why |
|---|---|---|---|
| `dispatch-hetero-contract.test.sh:151` (`assert_no_hetero_worktrees`) | `find "$CASE_TMP" -maxdepth 1 -name 'hetero-*'` count | **Yes — repoint** | Goes vacuous: worktrees no longer appear in `$CASE_TMP`. Repoint to `git worktree list` (plan P2.2). |
| `dispatch-foreman.test.sh` case 6 (224–230), `dispatch-hetero.test.sh` 22j/22k (2428–2453) | `main_checkout_mutated` expected on a real edit | No (must stay red on real edits) | D3 prunes only `.claude/worktrees`; `.venv` and README edits stay visible. |
| Every rail case expecting a non-mutated result | implicit `boundary_code` | Behaviour, not text | Without D3 the rail's own worktree under the sandbox trips `main_checkout_mutated` — the P2.2 red. |
| `suite-residue-reaper.test.sh:612`, cases 13–14 (332–369) | hand-built `hetero-*` fixtures in a temp dir | No | Legacy `$TMPDIR/hetero-*` reaping stays valid (old residue still sits there, D9). |
| `dispatch-foreman.test.sh:113`, `:362` | `worktree list` grep for `/foreman-` | No | Basename match, location-free (D4 keeps the prefix). |
| `dispatch-batch.test.sh:176`, `:231` | `worktree list \| grep -c integ` | No | Basename match. |
| `dispatch-detach.test.sh:291/344/370/460`, `dispatch-hetero.test.sh:470/492/1853/1870`, `dispatch-worktree-lifecycle.test.sh:85/418/482` | registry by branch / count / exact rail-reported path | No | Path-independent. |
| `prune-tmp-residue.test.sh:80`, `suite-residue-reaper` 18–19, `dispatch-detach.test.sh:200` | `hetero-*-log-*`, packed-prompt temp files | No | Log/temp files, not worktrees. |
| `prune-tmp-residue.test.sh:114` | runs `dispatch-hetero.sh` with no args (wiring) | No | Exits at usage before any placement call. |
| `tmp-residue-registry.test.sh:63` | forbidden-pattern list | No | Registry entries are kept (D9). |

## Added by P2

- Per rail: the worktree sits under `$SBX/.claude/worktrees/<prefix>-…`.
- Per rail: first run in a sandbox with no `.claude/` is not `main_checkout_mutated`.
- The sandbox's porcelain stays clean after a rail run (D11).
