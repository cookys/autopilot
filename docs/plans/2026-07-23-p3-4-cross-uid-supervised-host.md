# P3.4a Cross-UID Supervised Host Mechanism Probe

## Background

P3.2 is a same-UID, HMAC-bound lifecycle observer. P3.3 freezes the Engine-to-Kernel
mapping and requires a host-owned intake verifier, but neither component creates an
operating-system boundary between an untrusted worker and a broker. They therefore
remain explicitly non-authoritative.

The local host was probed on 2026-07-23 before this phase: it is Linux; the current
broker candidate is `cookys` (UID 1000); `bwrap 0.11.1`, `systemd-run`, and
passwordless `sudo -n` are available; and direct rootless `unshare --map-root-user`
is refused. The existing P0 bubblewrap profile still executes its narrow fixture.
Crucially, a bubblewrap user namespace mapped to UID 65534 reports root to the host
through `SO_PEERCRED`, so it cannot be used as the proof of a real worker UID.
P3.4 must not treat that fixture, a same-UID socket, or a model assertion as a
production host boundary.

## Decision

Build P3.4 in bounded phases. P3.4a is a manual, host-specific mechanism probe.
It proves that this host can obtain a real cross-UID `SO_PEERCRED` observation and
bind it to one exact transient systemd cgroup. It is not a reusable supervised-host
substrate: no root-owned launcher currently invokes preflight, provisions the
plan-specific layout, and executes only the frozen argv. That installed boundary is
P3.4b work.

1. The privileged test fixture manually starts a transient systemd worker unit under the
   existing non-login `nobody:nogroup` identity (UID/GID 65534). The broker remains
   the owner UID (currently 1000, primary GID 1000). Both identities are frozen in
   the runtime configuration; a root broker is rejected.
2. A root-started, bounded live probe starts the broker and worker children under
   those exact identities. The broker-side Unix socket verifies the connecting worker
   through Linux `SO_PEERCRED` and the exact `/system.slice/<unit>` transient-unit
   cgroup path. A string, HMAC,
   pathname, or caller supplied UID is never a substitute for the kernel credential.
3. Root creates a per-run directory as `root:nogroup 0710`, a state directory as
   `root:root 0700`, a root-owned helper snapshot, and a dedicated socket parent as
   `broker:nogroup 0710`. The broker has `nogroup` only as a supplementary group so it
   can create a `broker:nogroup 0660` socket while retaining its frozen primary GID.
   The worker can traverse the known socket path but cannot list, write, or remove its
   parent, and cannot access state. This is a deliberate traverse-only endpoint, not
   a claim that the parent pathname is invisible.
4. The transient unit uses `NoNewPrivileges`, private network/tmp, protected system
   and home, hidden `/proc`, restricted namespaces/SUID, empty capability bounding,
   a fixed probe command, `--collect`, and `CollectMode=inactive-or-failed` so passed
   and failed test units are unloaded.
   Bubblewrap may later add mount hardening, but it is not an identity evidence source.
   Failure to establish the unit, observe the peer PID with `SO_PEERCRED` and match
   that PID's exact unit cgroup, or complete peer authentication is `blocked`, never
   a downgrade to same-UID operation.

The shared `nobody:nogroup` identity deliberately leaves a fail-closed availability
gap: another process in that group can consume the one-use socket before the expected
unit reaches it. It cannot pass the exact cgroup gate or obtain authority, but it can
cause a denied probe. P3.4b must use a dedicated non-login `autopilot-worker` identity
and bind each launch to its own endpoint/PID before any unattended use.

P3.4a does not create an Owner Kernel, accept a P3.3 bridge plan, mint a decision,
issue a permit, execute an action, write a broker receipt, append a witnessed event,
or mark a run accepted. Those remain P3.4b/P3.5 integration work after the mechanism
evidence is independently reviewed.

## Implementation

- Add `src/engine/supervised-host-preflight.js` for strict configuration validation,
  fixed UID/path/command normalization, immutable probe bindings, root-owned-path
  preflight, and frozen gateway/worker/systemd arguments. It does not spawn a child or
  create a runtime layout. P3.4b supplies a separate root-installed preflight for its
  dedicated-worker schema; this P3.4a API remains a strict contract check for the
  original `nobody:nogroup` mechanism probe.
- Add `src/engine/supervised-host-peercred.py`, a small standard-library Linux helper
  that obtains `SO_PEERCRED` directly. Node's Unix socket API does not expose peer
  credentials, so a caller-provided JSON field is not accepted. The only operation is
  `p34_hello`; the endpoint accepts one connection, rejects anything invalid, removes
  the socket, and cannot be retried or reused. The worker checks the socket ancestry,
  inode ownership/mode, the connected broker's `SO_PEERCRED` UID/GID, and receipt
  binding before accepting a response.
- Add a focused deterministic contract test. Its live cross-UID section remains
  opt-in so ordinary CI never needs sudo. The explicit
  `hooks/tests/supervised-host-live-preflight.sh` wrapper runs the manual privileged
  probe, verifies both transient units were collected, and removes its unique runtime
  directory.
- Mirror all source into the Codex package. Update the P3 project record with the
  exact boundary and the local evidence result.

## Acceptance Criteria

1. Same broker/worker UID or GID, root broker, non-Linux host, non-root preflight,
   untrusted root-owned-path preflight input, malformed configuration, tampered plan,
   or nonce mismatch fail closed. The P3.4a fixture itself is not a trusted launcher.
2. The broker observes the worker's actual kernel UID and rejects a peer from the
   broker UID, an unexpected worker UID, a correct UID/GID from a different cgroup,
   a nonce mismatch, or an unknown operation. The cgroup comparison is exact against
   `/system.slice/<service-unit>`. The one-use endpoint closes after every result, so
   replay has no live endpoint to target.
3. The successful live path proves that the broker child runs as the configured
   broker UID, the worker runs as the configured systemd unit UID, its peer PID is
   in that run's exact cgroup, and the worker cannot read root-only state. It does not
   claim a complete filesystem or socket allowlist.
4. The result is an explicitly non-authoritative substrate receipt. It cannot be
   supplied to P2/P3.3 as an action permit, receipt, witness, challenge, or final
   manifest.
5. The manual privileged probe leaves neither its unique runtime tree nor either
   successful/failed transient unit on the host.

## Local Evidence

On 2026-07-23, `bash hooks/tests/supervised-host-live-preflight.sh` passed 30 assertions
on this Linux host. It copied the helper to a root-owned snapshot, rejected a same-UID
broker connection before parsing its request, rejected a valid `nobody:nogroup` peer
outside the exact transient unit cgroup, denied that systemd worker read access to
root-only state, then accepted the matching worker after `SO_PEERCRED` and exact cgroup
checks. `systemd-run --collect` plus `CollectMode=inactive-or-failed` removed both
successful and failed units, and the test
removed its unique `/run/autopilot-supervisor` runtime directory afterward. The checkout
that compiles the fixture is user-writable and the test manually invokes root commands,
so this is mechanism evidence on this host only, not a production launch path, P2
authority, P3.3 trusted intake verification, durable witness evidence, or P3 activation.

## Risks and Boundaries

- `SO_PEERCRED` proves local kernel credentials, not remote identity or a trusted
  user approval channel. P3.5 must bind the P3.3 host verifier and P2 broker
  authority to this substrate.
- The current interactive broker account has passwordless sudo. That is trusted-host
  authority, not worker authority; the systemd worker must not inherit it. A future
  deployment must replace the probe fixture with a narrowly scoped root-installed
  launcher, a dedicated worker account, and no unrestricted sudo from an untrusted
  runner context.
- Because P3.4a uses the shared `nobody:nogroup` identity, a same-group local process
  can only cause a fail-closed one-shot denial. It cannot become an accepted worker due
  to exact cgroup verification. P3.4b must remove this availability gap before any
  unattended use.
- The P0 bubblewrap fixture is not imported as an authority source. Its attack corpus
  must be re-run against the P3.4 implementation before any autonomous activation.

## Out of Scope

- Live `AutopilotEngine` action-sink mediation.
- Owner Kernel decision, permit, executor, witness, coordinator, or acceptance
  integration.
- Network/remote supervision, cross-platform support, alias retirement, and release
  metadata.
- The P3.3 verifier pinning, durable witness coordination, Engine action mediation,
  acceptance, and unattended autonomous operation.
