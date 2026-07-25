# P3.4b Root-Owned Supervised Host Launcher

## Background

P3.4a proved a Linux host can observe a real cross-UID Unix peer through
`SO_PEERCRED` and an exact transient-unit cgroup path. Its fixture intentionally
compiled argv from a user-writable checkout and manually performed root setup, so it
is evidence only, not a runtime trust boundary.

P3.4b supplies the missing launch boundary without connecting P3.3, an Owner Kernel,
an action sink, a witness, or acceptance. It must make the root process choose every
executable, identity, runtime path, service property, and worker command from a
root-owned installation snapshot. A caller may start the bounded probe, but may not
substitute any of those inputs.

## Design Decisions

1. A root-only installer creates a versioned root-owned snapshot containing the
   launcher, peer-credential helper, and worker wait wrapper. Installation is an
   explicit root-operator trust handoff: source may be a checked-out release at that
   moment, but the installed runtime never re-reads it. Hashes of every installed
   executable are frozen into a root-owned config.
2. The installed launcher accepts no helper, command, config, runtime-root, broker, or
   worker override. It validates its own config/file ancestry as root-owned and
   non-group/world-writable before every launch.
3. The launcher provisions a dedicated non-login `autopilot-worker` system account and
   its private primary group. It records the resolved UID/GID in the installed config;
   it does not use shared `nobody:nogroup` for P3.4b. Installation and every run reject
   any supplementary group membership so systemd cannot inherit later account drift.
4. Each run gets a random service unit, endpoint, nonce, and root-created release file.
   The fixed runtime parent is an exclusive lease: a pre-existing parent is a fail-closed
   overlapping or stale run, never a shared cleanup namespace.
   The worker starts in systemd but cannot connect until the launcher has discovered
   its `MainPID`, verified its unified cgroup-v2 path, and started a gateway pinned to
   that exact PID plus cgroup. The wait wrapper then `exec`s the fixed client command,
   preserving the verified PID. Its 15-second release budget is distinct from the
   fixed 5-second gateway/client protocol budget, so bounded host scheduling does not
   race normal staging.
5. The launcher uses absolute, root-owned Python/systemd/setpriv paths, a sanitized
   child environment, `-I`, fixed systemd hardening, `--collect`, and
   `CollectMode=inactive-or-failed`. Cleanup treats every attempted systemd launch as
   potentially accepted, stops/resets only its exact unit, waits for `LoadState=not-found`,
   and removes only paths it created.
6. The resulting record remains `preflight_only`,
   `owner_kernel_authority: "none"`, and `acceptance: "not_available"`. It is not an
   authorization, intake verifier, action permit, witness, or release activation.

## Implementation Steps

1. Extend the P3.4 peer helper with optional exact peer-PID and unified-cgroup-v2
   requirements, preserving P3.4a's cgroup-only compatibility path.
2. Add a root-owned worker wait wrapper that only waits for the launcher-created
   release file, then `exec`s the fixed client argv.
3. Add a root-only installer/launcher module that snapshots files, creates or validates
   the dedicated account, validates the installed config, provisions runtime paths,
   starts the systemd unit and gateway in the safe order, validates the result, and
   cleans up.
4. Add deterministic tests for config shape, no override surface, hash/path rejection,
   PID/cgroup controls, and no Owner Kernel/action imports. Add an explicit privileged
   live wrapper that installs to a disposable root-owned test root, mutates the
   user-writable installation source after install, runs the installed launcher, and
   proves the installed snapshot still owns execution.
5. Sync the Codex source mirror and update P3/project documentation with the precise
   P3.4b boundary and required self-hosted gate.

## Acceptance Criteria

1. A non-root launcher, user-writable config/helper/wrapper path, symlinked executable,
   config hash mismatch, worker identity or supplementary-group drift, pre-existing
   runtime parent, or any user-supplied runtime command fails before a child starts.
2. The live launcher proves that the worker uses the dedicated account, its observed
   `SO_PEERCRED` PID is the pre-discovered systemd `MainPID`, and that PID is in the
   exact cgroup-v2 path for the unique unit.
3. Editing the source staging copy after installation cannot change the installed
   launcher's helper hash or child command. The launcher has no CLI option that accepts
   an alternate config, helper, worker, runtime root, or command.
4. Failed and successful units are unloaded; the exact runtime tree is removed; no
   `autopilot-p34-*` test unit remains. The persistent dedicated account is intentional
   host provisioning, not test residue.
5. No P3.3 verifier, Owner Kernel construction, action mediation, witness append, or
   acceptance integration is introduced.

## Local Evidence

On 2026-07-23, `bash hooks/tests/supervised-host-live-launcher.sh` passed 37
assertions on this Linux host. It provisioned the persistent non-login
`autopilot-worker` account and private group, installed a disposable root-owned
snapshot under `/run`, changed the user-writable helper staging copy after install,
then completed the installed launch. The receipt bound the observed dedicated-worker
peer PID to the unique systemd unit. It then mutated the installed config and observed
a binding-hash failure before a runtime parent could be created; both the runtime
parent and transient unit were absent afterward. The disposable installed tree was
removed; the dedicated account is the intentional remaining host state.

## Risks

- A root operator who installs a malicious source snapshot can control the host. That
  trust handoff is explicit and is not solved by this phase; later release signing and
  deployment policy must constrain it.
- The current interactive owner has unrestricted passwordless sudo. The live gate
  demonstrates installed-runtime containment, not a deployment policy for callers who
  already have root.
- Linux cgroup-v2/systemd and the named self-hosted privileged gate remain required.
  Non-Linux and ordinary CI stay fail-closed or skipped, never silently downgraded.
- The fixed runtime parent intentionally permits one P3.4b probe at a time. A stale or
  overlapping parent must be investigated and removed by the trusted host operator;
  orchestration must serialize this preflight instead of weakening the lease.

## Out of Scope

- P3.3 trusted-intake signature/attestation verification.
- Owner Kernel decisions, action permits, broker-held effects, witness durability,
  acceptance coordination, Engine integration, remote supervision, and release
  activation.
