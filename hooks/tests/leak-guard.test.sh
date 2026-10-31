#!/usr/bin/env bash
# leak-guard.test.sh — scripts/leak-guard.js + scripts/redact-personal.js, with negative controls.
# Every "red" case is paired with a green twin so a gate that always fails or always passes is caught.
# Personal-looking literals are assembled at run time, so this file itself carries none.
. "$(dirname "$0")/lib.sh"

GUARD="$REPO_ROOT/scripts/leak-guard.js"
REDACT="$REPO_ROOT/scripts/redact-personal.js"
HOMEDIR="/ho""me"
USERSDIR="/Us""ers"
PERSONAL="$HOMEDIR/someone/proj"
TMPCL="/tmp/claude-""1000/scratch"
RUNUSER="/run/user/""1000/x"
HOSTA="cu""da"
SK="sk-""$(printf 'A%.0s' $(seq 1 24))"
GHP="ghp_""$(printf 'b%.0s' $(seq 1 36))"
REG="$TEST_TMP/registry.json"
printf '{"version":1,"entries":[]}\n' > "$REG"

export GIT_AUTHOR_NAME=lg GIT_AUTHOR_EMAIL=lg@example.com GIT_COMMITTER_NAME=lg GIT_COMMITTER_EMAIL=lg@example.com
R="$TEST_TMP/repo"
git init -q "$R"
git -C "$R" config core.hooksPath /dev/null
git -C "$R" config commit.gpgsign false
mkdir -p "$R/docs/plans/evidence/run1" "$R/src"
echo "clean base" > "$R/src/a.txt"
printf 'old note\nlegacy %s/x\n' "$PERSONAL" > "$R/src/old.md"   # a committed legacy file with a hit
git -C "$R" add -A
git -C "$R" commit -q -m base
BASE="$(git -C "$R" rev-parse HEAD)"

guard() { (cd "$R" && node "$GUARD" --staged --registry "${REGISTRY:-$REG}" "$@" 2>&1); }
reset_stage() { git -C "$R" reset -q --hard "$BASE"; git -C "$R" clean -qfd; }

# ── green control: a clean change passes ──
echo "hello" >> "$R/src/a.txt"; git -C "$R" add src/a.txt
OUT="$(guard)"; assert_eq "$?" "0" "control: clean staged change passes"
reset_stage

# ── NC1: personal path under the evidence dir is red (no directory exemption) ──
mkdir -p "$R/docs/plans/evidence/run1"; printf 'ran in %s\n' "$PERSONAL" > "$R/docs/plans/evidence/run1/out.md"; git -C "$R" add -A
OUT="$(guard)"; RC=$?
assert_eq "$RC" "1" "NC1: personal path in docs/plans/evidence/ is red"
assert_contains "$OUT" "docs/plans/evidence/run1/out.md:1" "NC1: names file:line"
assert_contains "$OUT" "[home_path]" "NC1: names the pattern"
assert_contains "$OUT" "redact-personal.js" "NC1: prints the redaction command"
# the printed command, run as printed, turns red into green
CMD="$(printf '%s\n' "$OUT" | grep '^  node ' | head -1)"
(cd "$R" && eval "$CMD" >/dev/null 2>&1)
git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "0" "NC1 twin: after the printed redaction command it is green"
assert_contains "$(cat "$R/docs/plans/evidence/run1/out.md")" '$HOME/proj' "NC1 twin: path became \$HOME"
reset_stage

# ── NC1b: a directory entry in the registry is refused, so evidence cannot be exempted wholesale ──
printf '{"version":1,"entries":[{"path":"docs/plans/evidence/","category":"home_path","reason":"whole directory"}]}\n' > "$TEST_TMP/dirreg.json"
mkdir -p "$R/docs/plans/evidence/run1"; printf 'x %s\n' "$PERSONAL" > "$R/docs/plans/evidence/run1/out.md"; git -C "$R" add -A
OUT="$(REGISTRY="$TEST_TMP/dirreg.json" guard)"; assert_eq "$?" "2" "NC1b: directory registry entry is refused (exit 2)"
printf '{"version":1,"entries":[{"path":"docs/plans/evidence/*","category":"home_path","reason":"a glob entry"}]}\n' > "$TEST_TMP/globreg.json"
OUT="$(REGISTRY="$TEST_TMP/globreg.json" guard)"; assert_eq "$?" "2" "NC1b: glob registry entry is refused (exit 2)"
printf '{"version":1,"entries":[{"path":"docs/plans/evidence/run1/out.md","category":"home_path","reason":"exact file, reasoned"}]}\n' > "$TEST_TMP/filereg.json"
OUT="$(REGISTRY="$TEST_TMP/filereg.json" guard)"; assert_eq "$?" "0" "NC1b twin: exact file+category entry is honoured"
printf '{"version":1,"entries":[{"path":"docs/plans/evidence/run1/out.md","category":"host","reason":"wrong category entry"}]}\n' > "$TEST_TMP/catreg.json"
OUT="$(REGISTRY="$TEST_TMP/catreg.json" guard)"; assert_eq "$?" "1" "NC1b: an entry for another category does not exempt"
printf '{"version":1,"entries":[{"path":"docs/plans/evidence/run1/out.md","category":"home_path"}]}\n' > "$TEST_TMP/noreason.json"
OUT="$(REGISTRY="$TEST_TMP/noreason.json" guard)"; assert_eq "$?" "2" "NC1b: an entry without a reason is refused"
reset_stage

# ── NC2: registry missing / broken is red, even for a clean change ──
echo "hello" >> "$R/src/a.txt"; git -C "$R" add src/a.txt
OUT="$(REGISTRY="$TEST_TMP/does-not-exist.json" guard)"; assert_eq "$?" "2" "NC2: missing registry is red"
assert_contains "$OUT" "missing registry is a failure" "NC2: says why"
printf '{not json' > "$TEST_TMP/bad.json"
OUT="$(REGISTRY="$TEST_TMP/bad.json" guard)"; assert_eq "$?" "2" "NC2: unparsable registry is red"
printf '{"version":2,"entries":[]}\n' > "$TEST_TMP/badver.json"
OUT="$(REGISTRY="$TEST_TMP/badver.json" guard)"; assert_eq "$?" "2" "NC2: malformed registry (version) is red"
printf '{"version":1}\n' > "$TEST_TMP/noentries.json"
OUT="$(REGISTRY="$TEST_TMP/noentries.json" guard)"; assert_eq "$?" "2" "NC2: malformed registry (no entries) is red"
OUT="$(guard)"; assert_eq "$?" "0" "NC2 twin: the valid registry on the same change is green"
reset_stage

# ── NC3: planted personal path, synthetic key, new .env — each red, with a green twin ──
printf 'cfg %s/x\n' "$USERSDIR/someone" > "$R/src/b.txt"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC3a: /Users/<name> path is red"
assert_contains "$OUT" "[home_path]" "NC3a: names home_path"
reset_stage
printf 'k = %s\n' "$SK" > "$R/src/c.txt"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC3b: synthetic sk- key is red"
assert_contains "$OUT" "[secret]" "NC3b: names secret"
assert_not_contains "$OUT" "$SK" "NC3b: the full key is not echoed"
reset_stage
printf 'k = %s\n' "$GHP" > "$R/src/c.txt"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC3b2: synthetic ghp_ token is red"
reset_stage
printf 'A=1\n' > "$R/.env"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC3c: new .env file is red"
assert_contains "$OUT" "[env_file]" "NC3c: names env_file"
reset_stage
printf 'A=1\n' > "$R/prod.env"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC3c: new prod.env file is red"
reset_stage
printf 'A=1\n' > "$R/src/env.txt"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "0" "NC3 twin: an innocent file name with the same content is green"
reset_stage

# ── NC4: a pure rename of an old file that carries a hit is green; added lines are not ──
mkdir -p "$R/moved"; git -C "$R" mv src/old.md moved/old.md
OUT="$(guard)"; assert_eq "$?" "0" "NC4: pure rename of a legacy file with a hit is green"
printf 'new %s/y\n' "$PERSONAL" >> "$R/moved/old.md"; git -C "$R" add -A
OUT="$(guard)"; RC=$?
assert_eq "$RC" "1" "NC4 twin: a rename plus an added personal line is red"
assert_contains "$OUT" "moved/old.md:3" "NC4 twin: only the added line (3) is named"
assert_not_contains "$OUT" "moved/old.md:2" "NC4 twin: the legacy line (2) is not named"
reset_stage
# an old hit that is left alone while the file is edited elsewhere stays green
sed -i 's/^old note/old note edited/' "$R/src/old.md"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "0" "NC4: editing another line of a file with a legacy hit is green"
reset_stage

# ── pattern boundaries (green twins keep the rules honest) ──
chk() { # chk <expect-rc> <label> <text>
  printf '%s\n' "$3" > "$R/src/t.txt"; git -C "$R" add -A
  guard >/dev/null; assert_eq "$?" "$1" "pattern: $2"; reset_stage
}
chk 1 "tmp/claude-<n> path" "see $TMPCL"
chk 1 "/run/user/<n> path" "see $RUNUSER"
chk 1 "private 192.168" "ip 192.168.101.7"
chk 1 "private 10/8" "ip 10.1.2.3"
chk 1 "private 172.16/12" "ip 172.20.0.9"
chk 1 "private 100.64/10" "ip 100.100.1.1"
chk 0 "public ip" "ip 8.8.8.8"
chk 0 "172.32 is public" "ip 172.32.0.1"
chk 0 "documentation ip" "ip 192.0.2.1"
chk 0 "placeholder <user> path" "see $HOMEDIR/<user>/x"
chk 0 "relative src/home dir" "see src/ho""me/index.js"
chk 0 "dotted user is not a user" "see $USERSDIR/.hidden/x"
chk 1 "@host context" "ping @$HOSTA now"
chk 1 "ssh host context" "ssh $HOSTA uptime"
chk 1 "host: label" "$HOSTA: busy"
chk 1 "/host/ segment" "dev/$HOSTA/x"
chk 0 "GPU device name" "torch.device('$HOSTA:0')"
chk 0 "GPU word upper" "CUDA toolkit"
chk 0 "GPU toolkit path" "/usr/local/$HOSTA/lib"
chk 0 "bare ordinary word" "the $HOSTA toolkit is great"

# ── NC5: new categories — email, composite host, flattened home, runtime ids (each red, with a green twin) ──
MAIL="al""ice@corp""mail.org"
printf 'contact %s\n' "$MAIL" > "$R/src/m.txt"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC5a: a personal e-mail address is red"
assert_contains "$OUT" "[email]" "NC5a: names email"
reset_stage
for ok in "noreply@anthropic.com" "bob@example.com" "bob@example.org" "bob@example.net"; do
  chk 0 "allowed e-mail $ok" "mail $ok"
done
chk 1 "other noreply is not allowed" "mail noreply@corp""mail.org"
chk 1 "composite host token" "on cookys-7840""hs today"
chk 1 "composite host token, any prefix" "on lab-itx-""win-box"
chk 1 "flattened home dir" "dir -ho""me-alice-projects-x"
chk 1 "flattened Users dir" "dir -Us""ers-alice-projects-x"
chk 0 "flattened placeholder" "dir -ho""me-<user>-projects-x"
chk 1 "tmp/claude-1234" "see /tmp/claude-""1234"
chk 0 "tmp/claude-<uid> placeholder" "see /tmp/claude-<uid>/x"
chk 0 "run/user/<uid> placeholder" "see /run/user/<uid>/x"
RC5="$TEST_TMP/rc5"; mkdir -p "$RC5"
CH="cookys-7840""hs"; FH="-ho""me-alice-projects-x"; TC="/tmp/claude-""1234/y"; RU="/run/user/""1234/z"
printf 'a %s\nb %s\nc %s\nd %s\ne %s\nf noreply@anthropic.com\n' "$MAIL" "$CH" "$FH" "$TC" "$RU" > "$RC5/in.md"
node "$REDACT" "$RC5/in.md" >/dev/null 2>&1; assert_eq "$?" "0" "NC5 redact: write mode exits 0"
assert_eq "$(cat "$RC5/in.md")" "$(printf 'a <email>\nb <host>\nc -home-<user>-projects-x\nd /tmp/claude-<uid>/y\ne /run/user/<uid>/z\nf noreply@anthropic.com')" "NC5 redact: output is exactly the expected placeholders"
# a registry entry for the email category exempts a named file, and only for that category
printf '{"version":1,"entries":[{"path":"src/m.txt","category":"email","reason":"git author identity"}]}\n' > "$TEST_TMP/mailreg.json"
printf 'contact %s\n' "$MAIL" > "$R/src/m.txt"; git -C "$R" add -A
OUT="$(REGISTRY="$TEST_TMP/mailreg.json" guard)"; assert_eq "$?" "0" "NC5 twin: per-file email registry entry is honoured"
reset_stage

# ── range mode (the CI shape) ──
git -C "$R" checkout -q -b feat
printf 'x %s\n' "$PERSONAL" > "$R/src/r.txt"; git -C "$R" add -A; git -C "$R" commit -q -m leak
OUT="$(cd "$R" && node "$GUARD" --range "$BASE..HEAD" --registry "$REG" 2>&1)"; assert_eq "$?" "1" "range: base..head with an added personal path is red"
assert_contains "$OUT" "src/r.txt:1" "range: names file:line"
git -C "$R" mv src/r.txt src/r2.txt; git -C "$R" commit -q -m rename
OUT="$(cd "$R" && node "$GUARD" --range "HEAD~1..HEAD" --registry "$REG" 2>&1)"; assert_eq "$?" "0" "range: a pure rename commit is green"
OUT="$(cd "$R" && node "$GUARD" --range "$BASE..$BASE" --registry "$REG" 2>&1)"; assert_eq "$?" "0" "range: empty range is green"
OUT="$(cd "$R" && node "$GUARD" --range "nonexistent-ref..HEAD" --registry "$REG" 2>&1)"; assert_eq "$?" "2" "range: a bad ref is red, not a silent pass"
git -C "$R" checkout -q -f master 2>/dev/null || git -C "$R" checkout -q -f main 2>/dev/null

# ── wiring ──
assert_contains "$(cat "$REPO_ROOT/.githooks/pre-commit")" "leak-guard.js --staged" "wiring: pre-commit runs leak-guard --staged"
assert_contains "$(cat "$REPO_ROOT/.github/workflows/checks.yml")" "leak-guard.js --range" "wiring: CI workflow runs leak-guard --range"
assert_contains "$(cat "$REPO_ROOT/.github/workflows/checks.yml")" "pull_request" "wiring: CI runs on pull_request"
(cd "$REPO_ROOT" && node "$GUARD" --registry "$REPO_ROOT/scripts/leak-guard-registry.json" --range "HEAD..HEAD" >/dev/null 2>&1)
assert_eq "$?" "0" "wiring: the shipped registry parses and validates"

# ── redactor ──
RT="$TEST_TMP/rt"; mkdir -p "$RT"
printf 'a %s/p\nb %s\nc 192.168.101.7\nd %s\ne %s\nf @%s\n' "$PERSONAL" "$TMPCL" "$SK" "$RUNUSER" "$HOSTA" > "$RT/in.md"
cp "$RT/in.md" "$RT/orig.md"
chmod 640 "$RT/in.md"
node "$REDACT" --check "$RT/in.md" >/dev/null 2>&1; assert_eq "$?" "1" "redact: --check reports hits (exit 1)"
assert_eq "$(cmp -s "$RT/in.md" "$RT/orig.md"; echo $?)" "0" "redact: --check wrote nothing"
node "$REDACT" --dry-run "$RT/in.md" >/dev/null 2>&1; assert_eq "$?" "0" "redact: --dry-run exits 0"
assert_eq "$(cmp -s "$RT/in.md" "$RT/orig.md"; echo $?)" "0" "redact: --dry-run wrote nothing"
node "$REDACT" "$RT/in.md" >/dev/null 2>&1; assert_eq "$?" "0" "redact: write mode exits 0"
RED="$(cat "$RT/in.md")"
for orig in "$PERSONAL" "$TMPCL" "192.168.101.7" "$SK" "$RUNUSER" "@$HOSTA"; do
  assert_not_contains "$RED" "$orig" "redact: output has no original value ($(printf '%s' "$orig" | cut -c1-6)...)"
done
for ph in '$HOME/proj' '/tmp/claude-<uid>' '<private-ip>' '<redacted-secret>' '/run/user/<uid>' '@<host>'; do
  assert_contains "$RED" "$ph" "redact: output carries $ph"
done
assert_eq "$(stat -c %a "$RT/in.md")" "640" "redact: file mode preserved"
assert_eq "$(command ls -A "$RT" | grep -c 'redact-.*tmp')" "0" "redact: no tmp file left behind"
node "$REDACT" --check "$RT/in.md" >/dev/null 2>&1; assert_eq "$?" "0" "redact: a redacted file is clean on --check"
printf 'bin\0%s\n' "$PERSONAL" > "$RT/bin.dat"; cp "$RT/bin.dat" "$RT/bin.orig"
node "$REDACT" "$RT/bin.dat" >/dev/null 2>&1; assert_eq "$(cmp -s "$RT/bin.dat" "$RT/bin.orig"; echo $?)" "0" "redact: binary file untouched"
node "$REDACT" "$RT/missing" >/dev/null 2>&1; assert_eq "$?" "2" "redact: unreadable file is exit 2"

# mutation: with the replacement switched off, the redaction check must go red
redaction_ok() { # redaction_ok <lib dir>  -> prints OK or FAIL
  PERS="$PERSONAL" IP="10.9.8.7" KEY="$SK" node -e '
    const lib = require(process.argv[1] + "/personal-data-redact.js");
    const input = [process.env.PERS + "/x", "ip " + process.env.IP, process.env.KEY].join("\n");
    const out = lib.redactText(input).text;
    const leaked = [process.env.PERS, process.env.IP, process.env.KEY].some((v) => out.includes(v));
    const placed = out.includes("$HOME") && out.includes("<private-ip>") && out.includes("<redacted-secret>");
    process.stdout.write(!leaked && placed ? "OK" : "FAIL");
  ' "$1"
}
assert_eq "$(redaction_ok "$REPO_ROOT/scripts/lib")" "OK" "redact mutation: real lib passes the redaction check"
MUT="$TEST_TMP/mut"; mkdir -p "$MUT/scripts/lib" "$MUT/hooks/_shared"
cp "$REPO_ROOT"/scripts/lib/personal-data-patterns.js "$REPO_ROOT"/scripts/lib/personal-data-redact.js "$REPO_ROOT"/scripts/lib/leak-guard-hosts.json "$MUT/scripts/lib/"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$MUT/hooks/_shared/"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const s = fs.readFileSync(f, "utf8");
  const t = s.replace("out += text.slice(pos, h.index) + (PLACEHOLDER[h.kind] || PLACEHOLDER[h.category]);", "out += text.slice(pos, h.index + h.length);");
  if (t === s) { process.stderr.write("mutation did not apply\n"); process.exit(3); }
  fs.writeFileSync(f, t);
' "$MUT/scripts/lib/personal-data-patterns.js"
assert_eq "$?" "0" "redact mutation: replacement switched off in the copy"
assert_eq "$(redaction_ok "$MUT/scripts/lib")" "FAIL" "redact mutation: with replacement off the redaction check is RED"

finalize_test
