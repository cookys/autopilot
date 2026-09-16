# bwrap probe — codex with tools inside a bubblewrap boundary (2026-09-16, aimax395)

Host: Linux 7.0.0-29-generic, bubblewrap 0.11.1, `unprivileged_userns_clone=1`,
`apparmor_restrict_unprivileged_userns=1` (bwrap still works: it is the distro-profiled binary).
codex-cli 0.154.0 (`~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/bin/`).

Why bwrap and not the UID drop the Fable consult preferred: `/home/cookys` is `0750` and every CLI
(`codex`, `node`, `claude`, `cursor-agent`, `qoderclicn`) lives under `~/.local/bin` → a review UID
cannot even exec the binary without host surgery (copy binaries out, `sudoers` for `setpriv`,
`useradd`). bwrap runs as the operator, needs no root, and simply does not mount the operator HOME.
Leftover `autopilot-*` UIDs on this host belong to the archived P3 supervised-host era and are not reused.

## Launch policy that worked

```
bwrap --unshare-all --share-net --die-with-parent --hostname review \
  --ro-bind /usr /usr --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl \
  --ro-bind /etc/ca-certificates /etc/ca-certificates --ro-bind <seat>/passwd /etc/passwd \
  --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind <seat-home> /home/review \
  --ro-bind <codex release bin dir> /home/review/bin \
  --clearenv --setenv HOME /home/review --setenv PATH /home/review/bin:/usr/bin \
  --chdir /home/review/work \
  -- codex exec --sandbox danger-full-access --skip-git-repo-check -c model_reasoning_effort=low "<prompt>"
```

Seat HOME held only `.codex/auth.json` (copied) and a two-line `config.toml` (`model = ...`); no
`history.jsonl`, no `sessions/`, no MCP entries.

## Observations

1. `codex --version` runs; `codex exec` with the shell tool runs and answered from the packet: it
   quoted the planted README canary, listed `/home` = `review` only, `/proc` held five pids, PID 1 is
   bwrap, `/home/cookys` and `/etc/hostname` absent.
2. Nested sandbox: `--sandbox read-only` prints `Codex's Linux sandbox uses bubblewrap and needs access
   to create user namespaces` and the shell tool cannot start. `--sandbox danger-full-access` inside
   our bwrap works — the outer boundary IS the sandbox. The launcher must pass it.
3. `codex-code-mode-host` must sit next to `codex` (bind the whole release `bin/` dir, not the symlink).
4. Residual: `/proc/1/cmdline` shows the bwrap argv, i.e. the host-side seat directory path and the
   codex binary host path. No verdict content, but a launcher should exec through a tiny wrapper so
   the argv inside is `/home/review/bin/codex …` only. `id` warns without `/etc/passwd` (bind a
   two-line one). Set `/etc/hostname` or accept the miss.
5. Network stays on (`--share-net`) — the model transport needs it. The sanitized `config.toml` is the
   only MCP/connector surface and it is written by the launcher.

Not probed yet (cut 1b): timeout/exit-code/raw_log parity through `dispatch-review.sh`, `grok` /
`cursor-agent` / `kimi` / `opencode` binaries under the same policy, CI runners (GitHub Ubuntu images
restrict unprivileged userns by AppArmor profile — the isolation suite must be host-only, not skipped).
