#!/usr/bin/env bash
# final-panel-kimi-agy-intake.test.sh — final-panel isolation phase 4: kimi/agy become cleanroom tier
# behind a per-runner host probe; tier tables (JS, dispatch-review.sh, resolve-review-loop.sh) agree.
#
# RED at acd03d9c (phase 3 head, before this change):
#   FAIL tier tables: kimi: js=none shell=none resolver=none, expected cleanroom
#   FAIL kimi intake with green probe stub passes the tier gate: final_panel_seat_blind_incompatible
#   FAIL launcher preflight JSON records runner_version: '"runner_version"' not found
. "$(dirname "$0")/lib.sh"

JS_Q="$REPO_ROOT/src/engine/final-panel-qualification.js"
DISPATCH="$REPO_ROOT/scripts/dispatch-review.sh"
RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
LAUNCHER="$REPO_ROOT/scripts/lib/cleanroom-launch.sh"

# ---------- Part 1: three-table parity ----------
tier_of_shell() { # file runner
  bash -c 'eval "$(sed -n "/^review_seat_tier()/,/^}/p" "$1")"; review_seat_tier "$2"' bash "$1" "$2"
}
tier_of_js() {
  node -e 'process.stdout.write(require(process.argv[1]).reviewSeatTier(process.argv[2]))' "$JS_Q" "$1"
}
RUNNERS="codex agy grok cc-shim anthropic-compatible claude-native qoderclicn kimi cursor opencode"
for R in $RUNNERS; do
  J="$(tier_of_js "$R")"; S="$(tier_of_shell "$DISPATCH" "$R")"; V="$(tier_of_shell "$RESOLVER" "$R")"
  assert_eq "$J" "$S" "$R: JS tier equals dispatch-review.sh tier"
  assert_eq "$J" "$V" "$R: JS tier equals resolve-review-loop.sh tier"
  case "$R" in
    kimi|agy|codex) assert_eq "cleanroom" "$J" "tier tables: $R: js=$J shell=$S resolver=$V, expected cleanroom" ;;
    grok|cursor|opencode) assert_eq "none" "$J" "$R stays tier none" ;;
    *) assert_eq "packet" "$J" "$R stays tier packet" ;;
  esac
done
# negative control: a drifted copy of the shell table must be detected by the same comparison
DRIFT_J="$(tier_of_js grok)"
sed 's/^    \*) printf .%s\\n. none ;;/    grok) printf "%s\\n" cleanroom ;;\n    *) printf "%s\\n" none ;;/' "$DISPATCH" > "$TEST_TMP/dispatch-drift3.sh"
DRIFT_S="$(tier_of_shell "$TEST_TMP/dispatch-drift3.sh" grok)"
assert_neq "$DRIFT_J" "$DRIFT_S" "negative control: drifted shell table disagrees with JS (parity comparison would fail)"

# ---------- Part 2: intake per-runner probe ----------
STUBS="$TEST_TMP/stubs"; mkdir -p "$STUBS"
mk_stub() { # name rc json
  cat > "$STUBS/$1" <<EOF
#!/bin/sh
printf '%s\n' "\$@" > "$STUBS/$1.argv"
env > "$STUBS/$1.env"
[ -n '$3' ] && printf '%s\n' '$3'
exit $2
EOF
  chmod +x "$STUBS/$1"
}
mk_stub green-kimi 0 '{"artifact_type":"cleanroom_launch","profile":"preflight","runner":"kimi","runner_version":"2.1.1","exit_status":0}'
mk_stub green-agy 0 '{"artifact_type":"cleanroom_launch","profile":"preflight","runner":"agy","runner_version":"1.2.14","exit_status":0}'
mk_stub green-wrongrunner 0 '{"artifact_type":"cleanroom_launch","profile":"preflight","runner":"agy","exit_status":0}'
mk_stub green-nojson 0 ''
mk_stub red2 2 ''
mk_stub red3 3 ''
printf '#!/bin/sh\nsleep 30\n' > "$STUBS/sleeper"; chmod +x "$STUBS/sleeper"

REPO_SHADOW="$TEST_TMP/repo-shadow"; REPO_ENFORCE="$TEST_TMP/repo-enforce"
for D in "$REPO_SHADOW:shadow" "$REPO_ENFORCE:enforce"; do
  P="${D%%:*}"; M="${D##*:}"
  mkdir -p "$P/.claude"; git -C "$P" init -q
  write_mission_governance "$P/.claude/owner-kernel-governance.json" "$M"
done

OUT="$(node - "$REPO_ROOT" "$STUBS" "$REPO_SHADOW" "$REPO_ENFORCE" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [root, stubs, repoShadow, repoEnforce] = process.argv.slice(2);
const { runCampaignIntake, defaultCleanroomProbe } = require(path.join(root, 'src', 'engine', 'campaign-intake.js'));
const NOW = { now: () => '2026-07-26T00:00:00.000Z' };
const seatOf = (runner, model) => ({ role: 'qc', runner, model, effort: 'high', endpoint: null, family: 'x' });
function roster(runner, model, extra = {}) {
  return {
    reviewer_engine: 'fixture-reviewer', reviewer_effort: 'high', reviewer_runner: 'cc-shim',
    reviewer_qualified: true, min_panel_size: 1, qc_panel_seats_complete: true,
    qc_panel_seats: [seatOf(runner, model)],
    fallback_ladder: [{ runner, model, effort: 'high', family: 'x' }],
    implementer_engine: 'fixture-implementer', implementer_effort: 'high', implementer_runner: 'fixture',
    ...extra,
  };
}
function intake(repo, runner, launcher, extra, adapters) {
  const prev = process.env.AUTOPILOT_CLEANROOM_LAUNCHER;
  if (launcher) process.env.AUTOPILOT_CLEANROOM_LAUNCHER = path.join(stubs, launcher);
  try {
    return runCampaignIntake({ repo, roster: roster(runner, `m-${runner}`, extra) }, { ...NOW, ...(adapters || {}) });
  } finally {
    if (prev === undefined) delete process.env.AUTOPILOT_CLEANROOM_LAUNCHER; else process.env.AUTOPILOT_CLEANROOM_LAUNCHER = prev;
  }
}
const code = (r) => (r.rejection && r.rejection.code) || null;
const probeStep = (r) => (r.steps || []).find((s) => s && s.owner === 'cleanroom_probe');
const NOT_TIER = ['final_panel_seat_blind_incompatible', 'final_panel_seat_cleanroom_unavailable'];

// green probe admits (passes the tier + probe gates), per runner, in both mission modes
for (const [runner, stub, ver] of [['kimi', 'green-kimi', '2.1.1'], ['agy', 'green-agy', '1.2.14']]) {
  for (const repo of [repoShadow, repoEnforce]) {
    const r = intake(repo, runner, stub);
    assert.ok(!NOT_TIER.includes(code(r)), `${runner} green probe refused: ${JSON.stringify(r.rejection)}`);
    const p = probeStep(r);
    assert.ok(p && p.status === 'ready' && p.runner === runner, JSON.stringify(r.steps));
    assert.strictEqual(p.runner_version, ver, 'probed version is recorded on the probe step');
    const argv = fs.readFileSync(path.join(stubs, `${stub}.argv`), 'utf8').split('\n');
    assert.ok(argv.includes('--preflight'), argv.join(' '));
    assert.strictEqual(argv[argv.indexOf('--profile') + 1], runner, 'probe is per-runner (--profile)');
    const flat = argv.join('\n');
    assert.ok(!/--packet-dir|--prompt-file|--auth-file|--cred-dir/.test(flat), `probe argv carries packet/credential: ${flat}`);
    const env = fs.readFileSync(path.join(stubs, `${stub}.env`), 'utf8');
    assert.ok(!/ANTHROPIC|TOKEN|SECRET|CREDENTIAL/i.test(env.split('\n').filter((l) => /^(ANTHROPIC|[A-Z_]*TOKEN|[A-Z_]*SECRET)/.test(l)).join('\n')));
  }
}
console.log('green_admits=true');

// red / wrong-runner / no launch line / timeout / missing launcher => refused, both modes
const refuse = (r, label) => assert.strictEqual(code(r), 'final_panel_seat_cleanroom_unavailable', `${label}: ${JSON.stringify(r.rejection)}`);
for (const runner of ['kimi', 'agy']) {
  for (const repo of [repoShadow, repoEnforce]) {
    refuse(intake(repo, runner, 'red2'), `${runner} red rc2`);
    refuse(intake(repo, runner, 'red3'), `${runner} red rc3`);
    refuse(intake(repo, runner, 'green-nojson'), `${runner} no launch line`);
    refuse(intake(repo, runner, 'no-such-launcher'), `${runner} missing launcher`);
  }
  // a green answer that names another runner is not this runner's probe
  refuse(intake(repoShadow, 'kimi', 'green-wrongrunner'), 'kimi probe answered for agy');
}
const timed = defaultCleanroomProbe({ runner: 'kimi', repo: repoShadow }, { launcher: path.join(stubs, 'sleeper'), timeoutMs: 400 });
assert.strictEqual(timed.status, 'rejected'); assert.match(timed.reason, /timed out/);
// missing launcher: codex stays shadow-unknown (unchanged), kimi/agy are rejected, never unknown
const missing = path.join(stubs, 'no-such-launcher');
assert.strictEqual(defaultCleanroomProbe({ runner: 'codex', repo: repoShadow }, { launcher: missing }).status, 'unknown');
for (const runner of ['kimi', 'agy']) {
  assert.strictEqual(defaultCleanroomProbe({ runner, repo: repoShadow }, { launcher: missing }).status, 'rejected');
}
// shadow-mode codex with a missing launcher is NOT refused (negative control: kimi in the same setup IS)
const codexShadow = intake(repoShadow, 'codex', 'no-such-launcher');
assert.notStrictEqual(code(codexShadow), 'final_panel_seat_cleanroom_unavailable', JSON.stringify(codexShadow.rejection));
assert.strictEqual(probeStep(codexShadow).status, 'unknown');
refuse(intake(repoShadow, 'kimi', 'no-such-launcher'), 'kimi missing launcher in shadow mode');
console.log('refusals=true');

// an injected probe answering `unknown` for kimi/agy is refused like red (enforcing and shadow);
// for codex an injected `unknown` stays an invalid adapter answer (unchanged)
for (const runner of ['kimi', 'agy']) {
  for (const repo of [repoShadow, repoEnforce]) {
    const r = intake(repo, runner, null, {}, {
      cleanroomProbe: ({ runner: rr }) => ({ owner: 'cleanroom_probe', status: 'unknown', enforcement: 'shadow', reason: 'x', runner: rr }),
    });
    refuse(r, `${runner} injected unknown`);
  }
}
const codexUnknownInjected = intake(repoShadow, 'codex', null, {}, {
  cleanroomProbe: ({ runner }) => ({ owner: 'cleanroom_probe', status: 'unknown', runner }),
});
assert.strictEqual(code(codexUnknownInjected), 'cleanroom_probe_adapter_invalid');
// the injected probe is asked per runner
const asked = [];
intake(repoShadow, 'kimi', null, {}, { cleanroomProbe: (i) => { asked.push(i.runner); return { owner: 'cleanroom_probe', status: 'ready', runner: i.runner }; } });
assert.deepStrictEqual(asked, ['kimi']);
console.log('unknown=true');

// pins / overrides cannot bypass a rejected probe
for (const runner of ['kimi', 'agy']) {
  const r = intake(repoShadow, runner, 'red2', { override_admitted_seats: ['qc_panel[0]'], reviewer_qualified: true });
  refuse(r, `${runner} override on a red probe`);
}
console.log('no_bypass=true');

// none-tier runners keep the blind-incompatible refusal (and never reach a probe)
for (const runner of ['grok', 'cursor', 'opencode']) {
  const r = intake(repoShadow, runner, 'green-kimi');
  assert.strictEqual(code(r), 'final_panel_seat_blind_incompatible', `${runner}: ${JSON.stringify(r.rejection)}`);
  assert.ok(!probeStep(r), `${runner} must not be probed`);
}
console.log('none_tier=true');
NODE
)"
assert_exit_code "$?" "0" "intake kimi/agy probe suite: $OUT"
for M in green_admits refusals unknown no_bypass none_tier; do
  assert_contains "$OUT" "${M}=true" "intake probe section $M"
done

# ordering safety: every blind (managed) review dispatch in the engine supplies a packet identity,
# otherwise an admitted kimi/agy seat would die at the rail with "cleanroom seat requires a review packet".
PK="$(grep -c "blindDiscovery: true" "$REPO_ROOT/src/engine/autopilot-engine.js")"
PKT="$(node -e '
const s=require("fs").readFileSync(process.argv[1],"utf8");
const re=/this\.reviewDiff\(\{\s*packet: \{/g; process.stdout.write(String((s.match(re)||[]).length));
' "$REPO_ROOT/src/engine/autopilot-engine.js")"
assert_eq "2" "$PK" "two engine call sites run blindDiscovery"
assert_eq "2" "$PKT" "both blind call sites pass a packet identity to reviewDiff"
assert_contains "$(cat "$REPO_ROOT/src/engine/autopilot-engine.js")" "reviewOptions.packet = identity" "reviewDiff pins packet identity under blind discovery"

# ---------- Part 3: launcher records the probed version (fake bwrap writes the probe's version file) ----------
cat > "$STUBS/fakebwrap-ver" <<EOF
#!/bin/sh
printf '%s\n' "9.9.9-fixture" > "\$FAKE_SEAT/work/preflight.version"
exit 0
EOF
chmod +x "$STUBS/fakebwrap-ver"
mkdir -p "$STUBS/nd/bin" "$STUBS/nd/lib/kimi"; printf '#!/bin/sh\n' > "$STUBS/nd/bin/node"; chmod +x "$STUBS/nd/bin/node"; : > "$STUBS/nd/lib/kimi/main.mjs"
printf '#!/bin/sh\n' > "$STUBS/agybin"; chmod +x "$STUBS/agybin"
mkdir -p "$STUBS/denyme"
for R in kimi agy; do
  if [ "$R" = kimi ]; then B="$STUBS/nd/lib/kimi/main.mjs"; else B="$STUBS/agybin"; fi
  SEAT="$TEST_TMP/seat-ver-$R"
  J="$(FAKE_SEAT="$SEAT" "$LAUNCHER" --preflight --profile "$R" --deny-path "$STUBS/denyme" --bin "$B" \
        --node-dir "$STUBS/nd" --bwrap "$STUBS/fakebwrap-ver" --seat-root "$SEAT" --keep-seat 2>/dev/null)"
  assert_contains "$J" '"runner_version": "9.9.9-fixture"' "launcher preflight JSON records runner_version ($R)"
done

finalize_test
