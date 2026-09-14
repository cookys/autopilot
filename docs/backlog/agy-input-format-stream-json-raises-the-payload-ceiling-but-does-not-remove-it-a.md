# agy `--input-format stream-json` raises the payload ceiling but does NOT remove it — and above it the failure is SILENT

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next agy-rail dispatch refused by `agy_argv_ceiling_assert`, or any work that proposes routing `dispatch-review.sh` / `dispatch-hetero.sh` / `dispatch-author.sh` through stream-json.
- **Context**: a peer host (twgs-revival, 2026-09-11) reported that agy 1.2.0's `--input-format stream-json` reads NDJSON from stdin and so bypasses the 131072-byte `MAX_ARG_STRLEN` argv wall, measured at 208951 bytes with `status: SUCCESS`, and suggested the payload ceiling could be removed. **Re-derived on this host (agy 1.2.1) with a trailing-nonce probe — the transport claim holds, the conclusion does not.** Each probe put a unique token at the very END of the payload and asked for it back, so a partial read cannot answer:

| payload | tail token returned | `result.status` |
|---|---|---|
| 49,595 B | yes | SUCCESS |
| 140,047 B (above the argv wall) | yes | SUCCESS |
| 175,145 B | yes | SUCCESS |
| 200,344 B | **no** | SUCCESS |
| 207,103 B | **no** (model volunteered "repeated many times and truncated") | SUCCESS |

- **The finding**: stream-json genuinely buys a real window above the argv wall — 140 KB and 175 KB both deliver intact where argv fails at 131072. But somewhere between **175 KB and 200 KB** the tail stops being readable, and the run still reports `status: SUCCESS` with a fluent answer about the beginning of the payload. The peer's 208,951-byte measurement was above that line; `status: SUCCESS` measured transport, not delivery.
- **Cross-host disagreement, and what it eliminates.** The peer re-ran the tail-nonce design on their host (agy **1.2.0**) and saw the tail returned at 199,976 B, 208,944 B, 249,984 B, 319,980 B and **449,940 B** — no wall at all. Controlled locally afterwards on agy **1.2.1**, using the REAL model id (`agy models` lists `gemini-3.8-flash-high|medium|low`; there is no bare `gemini-3.8-flash`, and the first probes here wrongly passed one with `--effort`):

| local probe (agy 1.2.1, `gemini-3.8-flash-high`) | tail token |
|---|---|
| 175,145 B, repeated-pangram padding | returned |
| 200,344 B, repeated-pangram padding | **not returned** |
| 199,166 B, varied random-word padding | **not returned** |

  So on this host the wall is real and is NOT explained by model alias, effort tier, or padding
  compressibility. The remaining difference against the peer is the **agy version** (1.2.1 vs 1.2.0)
  — a plausible regression, unverified from here.
- **Consequence for the fix, sharpened by the peer**: if the wall moves with the model AND the agy
  version, a constant in a dispatch script is the wrong shape entirely — it would silently regress on
  a roster change or an agy upgrade, both of which happen without anyone touching the rail. The
  threshold belongs **per seat**, measured by the tail-nonce probe during `engine-onboarding` /
  qualification and stored beside the seat's other capability facts, with a re-measure trigger on
  runner-version change (the capability store already tracks `runner_version`).
- **Input difference is eliminated; the wall is a DEPLOYMENT property** (2026-09-11, final exchange).
  The peer supplied a deterministic generator (fixed nonce, fixed padding, exact byte count) so both
  hosts could run byte-identical payloads. Verified: `p175000.ndjson` sha256 `0faa4a59c046…` and
  `p200000.ndjson` sha256 `38ec8965ccf6…` match across hosts, and the agy binary itself is the same
  file on both (`sha256 38f130cdd0757e1d…`). Same bytes, same binary, same model id
  (`gemini-3.8-flash-high`), same probe script:

  | payload | this host | peer host |
  |---|---|---|
  | 175,000 B | tail nonce returned | tail nonce returned |
  | 200,000 B | **not returned, `"response":""`** | tail nonce returned |

  So it is neither the transport, nor the model, nor the runner version, nor the input. What is left
  is the account / plan / region / quota tier the two hosts run under.
- **The failure is worse than truncation: it is an EMPTY response reported as SUCCESS.** Under the
  stricter tail-nonce instruction this host returns `status: SUCCESS` with `response: ""` at 200 KB.
  A reviewer rail consuming that records a seat that "reviewed" and found nothing — indistinguishable
  from a clean review. (An earlier, looser probe instead got a fluent answer about the head of the
  payload, which is the same hazard wearing better clothes.)
- **Consequence for where the threshold lives**: it cannot be a constant in a dispatch script, and it
  cannot live in the scorecard either, because the scorecard is shared across hosts and this varies
  BY HOST at identical seat identity. Either it is measured on the machine and stored machine-locally
  beside the capability store, or — safer — the rail stops trying to predict it and performs the
  tail-nonce self-check itself on any over-threshold payload, turning a silent fail-open into one
  cheap extra probe.
- **`agy --version` is not version evidence** (peer finding, 2026-09-11): the same binary — byte-identical
  sha256, untouched mtime — reported `1.2.0` before `agy update` and `1.2.1` after. The string is
  cached, not read from the binary. Anything pinning a runner version (the capability store tracks
  `runner_version`, and this plan proposes using it as a re-measure trigger) must hash the binary
  instead.
- **RESOLVED: load is eliminated in both directions; the wall is SERVICE-SIDE.** The peer proposed the
  load hypothesis, then killed it with their own measurements: their host was at load 27 (same
  magnitude as this host's 29-30) and still returned the tail nonce at 200 KB, and running agy under
  `systemd-run --scope -p CPUQuota=5%` — starving it far harder than ambient load ever would — also
  returned it. High ambient load: passes. Severe CPU starvation: passes. Combined with this host's
  175 KB probe passing under identical load, a load×size interaction is excluded.
  **Full elimination list**: input (byte-identical payloads, verified by sha256), binary (same file,
  `sha256 38f130cd…`), agy version, model alias, effort tier, padding compressibility, machine load,
  CPU availability. What remains — account / plan / region / server-side quota — is entirely on the
  service side, unobservable from either client.
  **Stop chasing the root cause.** Which of the four it is does not change the engineering: none is
  predictable from a dispatch script, and the tail-nonce self-check is equally effective against all
  of them. The defensible statement is "the wall is a service-side property the client cannot
  predict, with every client-side, input-side and load-side candidate excluded" — NOT "it is the
  account".
- **Superseded note — the earlier load caveat.** The peer asked whether the empty response
  could be a quota/concurrency degradation rather than a stable host property. Checked afterwards:
  load average was 29-30 throughout every probe on this host, from work belonging to OTHER sessions
  (another Claude session's `dispatch-hetero.sh` grok run, plus four ~396%-CPU `las` compute
  processes). Two fresh re-runs of the identical `p200000.ndjson` reproduced `tail_nonce=NO`,
  `response: ""` — but still under that load, so the hypothesis is **not** ruled out.
  Partial control that survives: the 175,000 B probe ran under the SAME load and returned the nonce,
  so load alone does not explain a size-dependent failure — but a load×size interaction cannot be
  excluded without an idle run. **Anyone re-testing should run `p200000.ndjson` on a genuinely idle
  host first.** If it returns the nonce when idle, the wall drifts with load, which kills the
  "measure it once and store it" option entirely and leaves only a per-dispatch self-check.
- **Preferred fix, sharpened by the peer**: do NOT run a separate probe. Stitch an `INTEGRITY:
  <nonce>` line into the tail of the REAL payload and require the reviewer's output contract to
  return it; a missing or wrong nonce is `no_verdict`. That costs zero extra dispatches, and it
  proves the tail of the payload that was actually reviewed rather than a same-sized synthetic stand-in
  — which matters here, since byte-identical inputs already behave differently across hosts. It
  proves the tail arrived, not that the middle was read; the middle is a separate problem.
- **Honest bound**: this probe still does not distinguish transport truncation from model-side
  context/skim behaviour — only that the tail stops being answerable in that band, on this host. The
  operational consequence is the same either way.
- **Why removing the ceiling would be a regression, not a fix**: today an over-size agy prompt fails CLOSED and loudly (execve fails, the rail records `no_verdict`, nobody mistakes it for a review). A silently truncated stream-json prompt fails OPEN: the reviewer reads the first ~175 KB of a diff and returns a confident verdict on the part it saw. A hetero review loop's whole purpose is defeated by a reviewer that cannot tell you it only read half.
- **Reproducer kept in-repo**: [`hooks/fixtures/agy-payload-probe/`](../hooks/fixtures/agy-payload-probe/)
  — the deterministic generator, the runner, the expected payload digests, and the two methodology
  errors the design prevents. It lived in `/tmp` during the investigation; reconstructing it is
  exactly where both hosts went wrong, so it is version-controlled next to the row it supports.
- **Candidate**: keep `agy_argv_ceiling_assert` as a hard gate, add a stream-json transport behind it with its own empirically-derived ceiling (start conservative, e.g. 150 KB), and make the probe above a regression test with the nonce at the tail — never assert on `status` alone. Splitting the unit remains the correct answer above that.
- **Effort**: S (transport + ceiling constant + the nonce regression test); the per-rail wiring is Fix each.
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; `scripts/lib/agy-argv-ceiling.sh`, callers at `dispatch-hetero.sh:2750`, `dispatch-author.sh:728`, `dispatch-review.sh:1398`.

