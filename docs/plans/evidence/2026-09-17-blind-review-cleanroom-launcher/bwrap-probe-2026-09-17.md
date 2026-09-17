# bwrap no-model probe — 2026-09-17 (aimax395, before plan 1b-A)

Host: bubblewrap 0.11.1; `unprivileged_userns_clone=1`; `apparmor_restrict_unprivileged_userns=1` with the
distro `bwrap-userns-restrict` profile; `max_user_namespaces` 447821. codex-cli 0.154.0 at
`~/.codex/packages/standalone/releases/0.154.0-x86_64-unknown-linux-musl/bin/{codex,codex-code-mode-host}`.

## Boundary probe (stub in place of codex)

```
bwrap --unshare-all --share-net --die-with-parent --hostname review \
  --ro-bind /usr /usr --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl \
  --ro-bind <seat>/passwd /etc/passwd --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin \
  --proc /proc --dev /dev --tmpfs /tmp --bind <seat> /home/review --clearenv \
  --setenv HOME /home/review --setenv PATH /home/review/bin:/usr/bin --chdir /home/review/work -- probe
```

Output:

```
uid=1000 home=/home/review cwd=/home/review/work pid1=bwrap --unshare-all --share-net --die-with-parent --hostname
DENIED /home/cookys/projects/autopilot/package.json
DENIED /home/cookys/.codex/auth.json
DENIED <scratchpad>/c1c/sibling/verdict.txt
DENIED /etc/hostname
/home: review
/proc numeric entries: 4
packet: README.md
env vars: 4
bwrap rc=0
```

Residual: `/proc/1/cmdline` is the bwrap argv (host paths) → the launcher execs through a wrapper so the
inner argv is `/home/review/bin/codex …` (plan §1.3).

## Credential path probe

`CODEX_HOME=<tmp with only auth.json + two-line config.toml> codex exec --skip-git-repo-check --sandbox read-only
--ignore-user-config -c 'model_reasoning_effort="low"' "Reply with the single word ok."` →
`ERROR: You've hit your usage limit … try again at Sep 19th, 2026 4:26 PM` — i.e. the request was
authenticated from the sanitized HOME. codex then had written into that HOME: `cache/ plugins/ sessions/
shell_snapshots/ skills/ thread-writer-locks/ goals_1.sqlite logs_2.sqlite memories_1.sqlite models_cache.json
queue_1.sqlite state_5.sqlite thread_history_1.sqlite installation_id` → the seat HOME must be writable and
discarded per seat.
