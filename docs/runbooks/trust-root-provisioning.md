# Runbook — provisioning the Owner Kernel trust roots

**Audience**: a human operator with root on the host that will run the Owner Kernel.

**Why a human does this.** Everything else in this project is automatable and most of it is
automated. This step is not, and the reason is structural rather than cautious: the Owner Kernel
decides *within* an authority that something outside it established. An agent that mints its own
trust anchor has certified itself, which is the one genuine circularity two independent review panels
identified. The operator establishes **which evidence source is trusted**; the kernel then decides
qualification *from* that source. Do not automate this step, and do not let an agent perform it —
including when the host has passwordless sudo, which is a statement about convenience, not authority.

---

## What you are creating

| Artifact | Location | Owner |
|---|---|---|
| Witness adapter (deployed copy) | outside the repo, e.g. `/usr/local/lib/autopilot/witness-adapter.js` | root |
| Adapter state journal | outside the repo, e.g. `/var/lib/autopilot/witness/` | the account running the host |
| Installed witness authority | `/etc/autopilot/trusted-installed-witness-authority.json` | root |
| Trusted witness adapter binding | `/etc/autopilot/trusted-witness-adapter-binding.json` | root |

Both `/etc/autopilot` paths are **fixed**. `check-owner-kernel-release-gates.js` reads only those
exact locations — never an environment variable, never a CLI flag, never a path under the repo or the
project directory. That is deliberate: a trust root a caller can point elsewhere is not a trust root.

---

## Step 1 — deploy the adapter outside the repo

The source lives at `src/host-adapters/witness-adapter.js`. The **deployed copy** must resolve
outside both the repo and the project evidence directory; `loadTrustedWitnessAdapterBinding` refuses
an `adapter_module` inside either.

```bash
sudo install -d -m 0755 -o root -g root /usr/local/lib/autopilot
sudo install -m 0644 -o root -g root \
    src/host-adapters/witness-adapter.js \
    /usr/local/lib/autopilot/witness-adapter.js
```

The adapter is self-contained (Node built-ins only) precisely so this copy needs nothing from the
repo. If a future edit adds a `require()` of repo code, this deployment model breaks — the parity
test in `hooks/tests/host-witness-adapter.test.sh` exists to make that visible.

## Step 2 — pin the deployed bytes

```bash
sudo sha256sum /usr/local/lib/autopilot/witness-adapter.js | cut -d' ' -f1
```

Record the value. It goes in the binding as `adapter_sha256`, and the loader refuses to `require()`
an adapter whose bytes do not match the pin. **Re-run this and update the binding after every
redeploy** — a stale pin fails closed, which is correct but looks like a mysterious outage.

## Step 3 — create the adapter's own state directory

```bash
sudo install -d -m 0750 -o root -g root /var/lib/autopilot/witness
```

The adapter owns its append-time state; the checker passes it no storage location. If the host runs
the kernel as a non-root service account, `chown` this directory to that account — it needs write
access, and it is the only path here that does.

## Step 4 — write the authority file

Choose a `stream_id` (the witnessed stream) and an `authority_id`. Both must match
`/^[A-Za-z0-9._:-]{1,128}$/`, and `stream_id` additionally has to survive being embedded in the
adapter's `identity`, so keep it to that character set.

```bash
sudo tee /etc/autopilot/trusted-installed-witness-authority.json >/dev/null <<'JSON'
{
  "kind": "trusted_installed_witness_authority",
  "authority_id": "example.host.authority",
  "stream_id": "owner-kernel-dogfood",
  "receipt_journal": []
}
JSON
```

Rules the loader enforces, each of which fails closed:

- `kind` must be `trusted_installed_witness_authority` or `p37_installed_witness_authority`.
- `stream_id` must be a non-empty string.
- `receipts` **or** `receipt_journal` must be present as an array (empty is fine at bootstrap).
- `authority_id` must match the pattern **and equal the binding's** `authority_id`.
- The file must **not** contain `adapter_module`, `adapter_sha256`, `external_adapter_module`, or
  `external_witness_adapter_module`. Adapter identity comes only from the binding — a config that
  could name its own adapter could name a friendly one.

## Step 5 — write the adapter binding

```bash
sudo tee /etc/autopilot/trusted-witness-adapter-binding.json >/dev/null <<'JSON'
{
  "kind": "trusted_installed_witness_adapter_binding",
  "authority_id": "example.host.authority",
  "adapter_module": "/usr/local/lib/autopilot/witness-adapter.js",
  "adapter_sha256": "PASTE_THE_SHA256_FROM_STEP_2"
}
JSON
```

Rules the loader enforces:

- `kind` must be `trusted_installed_witness_adapter_binding` or
  `p37_installed_witness_adapter_binding`.
- `adapter_module` must resolve, must be outside the repo, and outside the project evidence dir.
- `adapter_sha256` must match the deployed file's actual digest.
- `authority_id` must match the pattern and the authority file.
- The file must **not** supply `anchored_append_timestamps`. The adapter owns append time; a
  config-supplied timestamp is forgery by construction.

## Step 6 — lock down ownership and mode

```bash
sudo chown root:root /etc/autopilot /etc/autopilot/*.json
sudo chmod 0755 /etc/autopilot
sudo chmod 0644 /etc/autopilot/*.json
```

`assertSecureInstallationPath` requires, for each file **and every ancestor directory**:

- a regular file, never a symlink;
- `uid 0`;
- not group- or other-writable (`mode & 0o022 == 0`).

## Step 7 — verify

```bash
node scripts/check-owner-kernel-release-gates.js \
    --project docs/projects/2026-07-20-owner-kernel-governance \
    --release-claim production | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);
    console.log('trusted authority present:', o.alias_retirement.trusted_authority_present);
    for (const r of o.blocking_reasons) console.log('-', r);})"
```

Success at this step means `trusted authority present: true` and the disappearance of every blocking
reason that names a missing trust root. KR8 will still hold until real dogfood telemetry exists —
that is expected and is the next phase's work, not a provisioning failure.

If it still reports the authority absent, the reason string names the exact check that failed. Read
it literally; each one corresponds to a rule above.

---

## Never do these

The loader already refuses all of them. They are listed so nobody implements a workaround by mistake:

- **Never** set `skipInstallationOwnershipChecks`. It is a test seam, not a deployment option.
- **Never** source trust content from the repo, the project directory, or an environment variable.
  The loader explicitly skips any candidate resolving inside the repo or project boundary.
- **Never** place the adapter or its journal inside the repo or project evidence directory.
- **Never** hand-write a `receipt_journal` entry to represent an append that did not happen. The
  adapter re-derives every stored line's hash on lookup; a fabricated entry yields no anchored
  timestamp and fails verification.
- **Never** let an agent perform Steps 4-6. See the top of this document.

## Rollback

Provisioning is fully reversible and leaves no state in the repo:

```bash
sudo rm -f /etc/autopilot/trusted-installed-witness-authority.json \
           /etc/autopilot/trusted-witness-adapter-binding.json
```

The release gate returns to holding on absent trust roots, which is its correct behaviour when no
authority is installed. The adapter journal under `/var/lib/autopilot/witness/` is append-only
history; keep it unless you are deliberately discarding the witnessed chain, because deleting it
discards the evidence of every append it recorded.
