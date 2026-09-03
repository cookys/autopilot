# Named-endpoint transport policy: plaintext-private opt-in + exam/routing parity

**Date**: 2026-09-03 · **Target**: v2.35.11 · **Size**: L (3+ modules, config-format extension)
**Trigger**: `qwen3.8-flash-next` (local SGLang on cookys-cuda, `http://192.168.101.7:8001`)
qualified 24/24 as implementer over cc-shim (`docs/plans/evidence/2026-09-03-flash-next-implementer-qualify/`),
but daily routing via `implementer_endpoint:` cannot reach it: `resolve-endpoint.sh` accepts
`http://` only for loopback, while the exam reached it through the raw `ANTHROPIC_BASE_URL`
passthrough. The strongest evidence path is more permissive than the routing path.

## Decision (Board 2026-09-03)

- Keep the loopback rule as the default. The correct multi-user shape is TLS + api-key in front of
  the serving host; autopilot does not change for that — it is a deployment recipe.
- Add an **explicit, per-endpoint, disclosed** opt-in for plaintext to a **private-range IP
  literal** so a single operator on a home/office LAN can route to a local model without a
  proxy. Not hostnames (DNS can point anywhere), not public IPs, not a global switch.
- Make the implementer exam resolve the endpoint the same way routing does (`--endpoint <name>`),
  and disclose `transport_security` on the emitted row.
- Do NOT reactivate `dispatch-local-openai.js` as an implementer path (no tool surface) and do NOT
  add a third adaptor — cc-shim already is the adaptor for any Anthropic-protocol endpoint.

## Design

### D1 — `AUTOPILOT_ENDPOINT_<NAME>_TRANSPORT` (resolve-endpoint.sh, single owner of the policy)

| value | effect |
|---|---|
| absent / `tls` | today's rule: `https://` or `http://` loopback |
| `plaintext-private` | additionally accept `http://<ip-literal>` where the literal is RFC1918 (10/8, 172.16/12, 192.168/16), link-local 169.254/16, or IPv6 ULA/link-local (`[fc..]`/`[fd..]`/`[fe80:..]`) |

Any other value ⇒ `url_unsafe` + `transport_value_invalid`. Output JSON gains
`transport_security ∈ {tls, loopback, plaintext_private}` (also in `--list` rows). `missing[]`
gains explanatory markers: `transport_optin_required` (private http without the flag),
`transport_private_range_required` (flag set but host is not a private IP literal). A
`plaintext_private` resolution prints one stderr warning line. The token is still required
non-empty (cc-shim needs a bearer; a local server without auth takes any placeholder).

The loaders (`load-endpoints-env.sh`, `lib/load-endpoints-env.js`) allowlist the new key.
`autopilot endpoints set --transport plaintext-private` writes it (and permits the private
`--url`); `list`/`which`/`doctor` show `transport`. `dispatch-hetero.sh --endpoint` prints a
stderr notice when the resolved transport is `plaintext_private` (routing must be as loud as the
resolver). The other consumers (`dispatch-review.sh`, `dispatch-author.sh`,
`dispatch-anthropic-review.js`, `qualification-sweep.sh`) parse only `base_url`/`token_env`; the
new field is additive.

### D2 — `engine-qualify.sh implementer --endpoint <name>`

Implementer-only (rejected for other roles like `--dispatch-bin`). Resolved once before the
first dispatch; not-ready ⇒ exit 2 uncharged, naming `missing[]`. The constructed dispatch env
takes `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` from the resolution and **ignores** the raw
process env for those two keys (no ambiguity about which endpoint was examined). The emitted
row gains top-level `endpoint: {name, base_url, transport_security}` (validateRecordRow accepts
additive keys; identity bindings unchanged) and `raw/impl-endpoint.json` mirrors it. Without
`--endpoint` behaviour is byte-identical (raw passthrough, no `endpoint` field).

### D3 — docs

engine-onboarding SKILL.md: "Serving a local model for a team (cc-shim)" — TLS + api-key proxy
recipe, per-user `autopilot endpoints set`, the personal `plaintext-private` bypass and what it
does NOT protect, `--endpoint` on the exam. hetero-dispatch.md runner table cc-shim row;
`scripts/endpoints.env.example`; scripts-inventory row; CHANGELOG.

## Acceptance

- `hooks/tests/run.sh --parallel` green; new assertions in `resolve-endpoint.test.sh`,
  `load-endpoints-env.test.sh`, `endpoints-cli.test.sh`, `engine-qualify-impl.test.js`.
- Negative controls: private http without flag ⇒ `ready:false`; flag + hostname ⇒ `ready:false`;
  flag + public IP ⇒ `ready:false`; flag + `10.x` ⇒ `ready:true`, `transport_security:
  plaintext_private`.
- Dogfood: `AUTOPILOT_ENDPOINT_QWEN38_*` defined with the flag; `resolve-endpoint.sh qwen38` ready;
  one `dispatch-hetero.sh --endpoint qwen38 --runner cc-shim` probe commits.

## Out of scope (BACKLOG candidates)

- `autopilot endpoints test` hardcodes `claude-3-haiku-20240307`; a local server that validates
  model ids returns 404 — a `--model` flag is a separate small change.
- `src/engine/local-deployment.js` keeps its own TLS-outside-loopback rule; it has no live
  callers and is not on the implementer path.
- Forwarding a reasoning-effort to cc-shim endpoints (the exam's `effort` label is nominal for
  every cc-shim seat).
