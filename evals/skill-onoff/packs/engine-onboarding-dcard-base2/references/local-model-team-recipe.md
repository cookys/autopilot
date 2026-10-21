# Serving a local model for a team (cc-shim over a named endpoint)

Canonical recipe referenced from `SKILL.md` § Implementer. Worked example (2026-09-03):
`qwen3.8-flash-next` on SGLang, 24/24 implementer,
`docs/plans/evidence/2026-09-03-flash-next-implementer-qualify/`.


A model served on your own hardware needs no new adaptor: `cc-shim` (Claude Code driving an
Anthropic-protocol endpoint) is the implementer rail for anything that speaks `/v1/messages`
(SGLang, vLLM and llama.cpp all do). What it needs is an **endpoint definition that the exam
and daily routing share**, so "the deployment that was examined" is the one that gets routed
to. 
1. **Shared server, several people → TLS + api-key in front of it.** Put caddy/nginx (internal
   CA or mkcert) on the serving host and start the engine with an api key (`sglang serve
   --api-key …`, `vllm serve --api-key …`). autopilot changes nothing for this: every
   member runs `autopilot endpoints set <name> --url https://<host>:<port> --token-stdin`
   and names it in `.claude/review-loop-config.md` (`implementer_endpoint: <name>`, with
   `implementer_runner: cc-shim`). The resolver's default policy (`https://` or loopback
   `http://`) is exactly this shape.
2. **One operator, own LAN, no proxy yet → the disclosed plaintext opt-in.**
   `autopilot endpoints set <name> --url http://<private-ip>:<port> --token-stdin --transport
   plaintext-private` (any placeholder token if the server has no auth). Accepted ONLY for an
   IP literal in a private range (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10)
   — never a hostname, never a public address — and it is never silent: `list`/`which`/`doctor`
   show it, `resolve-endpoint.sh` returns `transport_security: plaintext_private`, and
   `dispatch-hetero --endpoint` prints a notice on every dispatch. What it does NOT protect:
   the bearer and every prompt (repository contents) cross the LAN unencrypted. Treat it as a
   bridge to step 1, not a policy.
3. **Examine THROUGH the same definition.** `engine-qualify.sh implementer --runner cc-shim
   --endpoint <name> …` (or the sweep roster's `"endpoint": "<name>"`) binds the exam's
   dispatch env from the resolver instead of the raw `ANTHROPIC_BASE_URL` passthrough, and the
   row discloses `endpoint: {name, base_url, transport_security}`. A row without that field
   was examined over whatever the ambient env pointed at.
4. **Pin the deployment in the bundle README** (checkpoint revision, engine build, parser
   flags, context length): the seat identity hashes the model token, not the weights — a
   different checkpoint behind the same URL is a different deployment; re-administer.

Not on this path: `dispatch-local-openai.js` (bounded single-shot author/reviewer transport,
no tool surface — it is not an implementer rail) and `src/engine/local-deployment.js` (its own
TLS-outside-loopback rule, no live callers). Forwarding a reasoning effort to a cc-shim
endpoint is not implemented: the exam's `effort` label is nominal for every cc-shim seat.

