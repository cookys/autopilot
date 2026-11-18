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
HOSTA="test""word"
SK="sk-""$(printf 'A%.0s' $(seq 1 24))"
GHP="ghp_""$(printf 'b%.0s' $(seq 1 36))"
REG="$TEST_TMP/registry.json"
printf '{"version":1,"entries":[]}\n' > "$REG"
HOSTS_FILE="$TEST_TMP/hosts.json"
printf '{"strong":["testhost-a","testhost-b"],"contextual":["%s"]}\n' "$HOSTA" > "$HOSTS_FILE"
export AUTOPILOT_LEAK_GUARD_HOSTS="$HOSTS_FILE"

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
printf '{"version":1,"entries":[{"path":"docs/plans/evidence","category":"home_path","reason":"existing dir, no slash"}]}\n' > "$TEST_TMP/dirreg2.json"
OUT="$(REGISTRY="$TEST_TMP/dirreg2.json" guard)"; assert_eq "$?" "2" "NC1b: existing directory without trailing slash is refused (exit 2)"
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
sed_mutate "$R/src/old.md" 's/^old note/old note edited/'; git -C "$R" add -A
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
chk 0 "contextual word upper" "TESTWORD toolkit"
chk 0 "usr local path" "/usr/local/$HOSTA/lib"
chk 0 "bare ordinary word" "the $HOSTA toolkit is great"

# ── NC5: new categories — email, composite host, flattened home, runtime ids (each red, with a green twin) ──
MAIL="user@""example.invalid"
printf 'contact %s\n' "$MAIL" > "$R/src/m.txt"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "NC5a: a personal e-mail address is red"
assert_contains "$OUT" "[email]" "NC5a: names email"
reset_stage
for ok in "noreply@anthr""opic.com" "bob@example.com" "bob@example.org" "bob@example.net"; do
  chk 0 "allowed e-mail $ok" "mail $ok"
done
chk 1 "other noreply is not allowed" "mail noreply@""example.invalid"
chk 1 "composite host token" "on cookys-testhost-a today"
chk 1 "composite host token, any prefix" "on lab-testhost-b-box"
chk 1 "flattened home dir" "dir -ho""me-alice-projects-x"
chk 1 "flattened Users dir" "dir -Us""ers-alice-projects-x"
chk 0 "flattened placeholder" "dir -ho""me-<user>-projects-x"
chk 1 "tmp/claude-1234" "see /tmp/claude-""1234"
chk 0 "tmp/claude-<uid> placeholder" "see /tmp/claude-<uid>/x"
chk 0 "run/user/<uid> placeholder" "see /run/user/<uid>/x"
RC5="$TEST_TMP/rc5"; mkdir -p "$RC5"
CH="cookys-testhost-a"; FH="-ho""me-alice-projects-x"; TC="/tmp/claude-""1234/y"; RU="/run/user/""1234/z"
NR="noreply@anthr""opic.com"
printf 'a %s\nb %s\nc %s\nd %s\ne %s\nf %s\n' "$MAIL" "$CH" "$FH" "$TC" "$RU" "$NR" > "$RC5/in.md"
node "$REDACT" "$RC5/in.md" >/dev/null 2>&1; assert_eq "$?" "0" "NC5 redact: write mode exits 0"
assert_eq "$(cat "$RC5/in.md")" "$(printf 'a <email>\nb <host>\nc -home-<user>-projects-x\nd /tmp/claude-<uid>/y\ne /run/user/<uid>/z\nf %s' "$NR")" "NC5 redact: output is exactly the expected placeholders"
# NC6: two distinct hosts on one line are lettered in order; a repeat reuses its letter; one host stays <host>
H1="cookys-testhost-a"; H2="testhost-b"
printf 'x %s and %s then %s again\ny only %s\n' "$H1" "$H2" "$H1" "$H2" > "$RC5/mh.md"
node "$REDACT" "$RC5/mh.md" >/dev/null 2>&1; assert_eq "$?" "0" "NC6 redact: multi-host write mode exits 0"
assert_eq "$(cat "$RC5/mh.md")" "$(printf 'x <host-a> and <host-b> then <host-a> again\ny only <host>')" "NC6 redact: distinct hosts on one line are lettered; single host stays <host>"
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
cp "$REPO_ROOT"/scripts/lib/personal-data-patterns.js "$REPO_ROOT"/scripts/lib/personal-data-redact.js "$MUT/scripts/lib/"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$MUT/hooks/_shared/"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const s = fs.readFileSync(f, "utf8");
  const t = s.replace("out += text.slice(pos, h.index) + ph;", "out += text.slice(pos, h.index + h.length);");
  if (t === s) { process.stderr.write("mutation did not apply\n"); process.exit(3); }
  fs.writeFileSync(f, t);
' "$MUT/scripts/lib/personal-data-patterns.js"
assert_eq "$?" "0" "redact mutation: replacement switched off in the copy"
assert_eq "$(redaction_ok "$MUT/scripts/lib")" "FAIL" "redact mutation: with replacement off the redaction check is RED"

# ── BL-0348 item 1: a deliberate path for reverting a redaction commit (range mode only) ──
revert_setup() { # leaves $A = the cleanup commit, HEAD = a plain `git revert` of it on branch rv
  reset_stage; git -C "$R" checkout -q -B rv "$BASE"
  printf 'old note\nlegacy clean line\n' > "$R/src/old.md"; git -C "$R" commit -q -am "redact old.md"
  A="$(git -C "$R" rev-parse HEAD)"
  git -C "$R" revert --no-edit "$A" >/dev/null 2>&1
}
add_trailer() { # add_trailer <sha>
  git -C "$R" log -1 --format=%B | git -C "$R" interpret-trailers --trailer "Leak-Guard-Allow-Revert: $1" | git -C "$R" commit -q --amend -F -
}
rguard() { (cd "$R" && node "$GUARD" --range "$1" --registry "$REG" 2>&1); }
revert_setup
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert NC-a: a plain git revert that restores a cleaned line is red (no trailer)"
add_trailer "$A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "0" "revert twin: revert message + matching Leak-Guard-Allow-Revert trailer is green"
revert_setup; add_trailer "$BASE"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert NC-b: trailer naming the wrong sha is red"
revert_setup
git -C "$R" commit -q --amend -m "restore line" -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert NC-c: trailer without a 'This reverts commit' line is red"
revert_setup
git -C "$R" reset -q --soft "$A"
printf 'old note\nlegacy %s/x\nextra %s/zzz\n' "$PERSONAL" "$PERSONAL" > "$R/src/old.md"
git -C "$R" commit -q -am "Revert x" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; RC=$?
assert_eq "$RC" "1" "revert NC-d: a new personal line smuggled into the revert is red"
assert_contains "$OUT" "src/old.md:3" "revert NC-d: the new line (3) is named"
assert_not_contains "$OUT" "src/old.md:2" "revert NC-d: the restored line (2) is not named"
reset_stage; git -C "$R" checkout -q -f master 2>/dev/null || git -C "$R" checkout -q -f main 2>/dev/null

# ── BL-0348 item 2: a local host name that is a plain word only counts in host contexts ──
hostcount() { # hostcount <fake hostname> <text> <lib dir>
  node -e '
    const os = require("os"); os.hostname = () => process.argv[1];
    const p = require(process.argv[3] + "/personal-data-patterns.js");
    process.stdout.write(String(p.findAll(process.argv[2]).length));
  ' "$1" "$2" "$3"
}
hostword_ok() { # hostword_ok <lib dir> -> OK | FAIL
  local w="tea""pot" d="lab7""box"
  if [ "$(hostcount "$w" "the $w kettle" "$1")" = "0" ] && [ "$(hostcount "$w" "ssh $w now" "$1")" = "1" ] \
     && [ "$(hostcount "$w" "$w: busy" "$1")" = "1" ] && [ "$(hostcount "$d" "run on $d today" "$1")" = "1" ]; then printf OK; else printf FAIL; fi
}
assert_eq "$(hostword_ok "$REPO_ROOT/scripts/lib")" "OK" "hostname word: plain-word local host is context-only, a distinctive one (digit/hyphen) stays strong"
MUT2="$TEST_TMP/mut2"; mkdir -p "$MUT2/scripts/lib" "$MUT2/hooks/_shared"
cp "$REPO_ROOT"/scripts/lib/personal-data-patterns.js "$MUT2/scripts/lib/"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$MUT2/hooks/_shared/"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const s = fs.readFileSync(f, "utf8");
  const t = s.replace("/[-0-9_]/.test(local)", "true");
  if (t === s) { process.stderr.write("mutation did not apply\n"); process.exit(3); }
  fs.writeFileSync(f, t);
' "$MUT2/scripts/lib/personal-data-patterns.js"
assert_eq "$?" "0" "hostname word mutation: demotion switched off in the copy"
assert_eq "$(hostword_ok "$MUT2/scripts/lib")" "FAIL" "hostname word mutation: with demotion off the check is RED"

# ── BL-0348 item 3: the printed redaction command runs from any directory ──
mkdir -p "$R/docs/plans/evidence/run1"; printf 'ran in %s\n' "$PERSONAL" > "$R/docs/plans/evidence/run1/out.md"; git -C "$R" add -A
OUT="$(guard)"; CMD="$(printf '%s\n' "$OUT" | grep '^  node ' | head -1)"
OTHER="$TEST_TMP/elsewhere"; mkdir -p "$OTHER"
(cd "$OTHER" && eval "$CMD" >/dev/null 2>&1)
git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "0" "redact-cmd cwd: the printed command, run from an unrelated directory, turns red into green"
reset_stage

# ── BL-0348 item 4: a symlink swapped for a regular file (typechange) is scanned ──
ln -s a.txt "$R/src/link"; git -C "$R" add -A; git -C "$R" commit -q -m "add link"; TBASE="$(git -C "$R" rev-parse HEAD)"
rm "$R/src/link"; printf 'ran in %s\n' "$PERSONAL" > "$R/src/link"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "1" "typechange: symlink replaced by a regular file with a personal path is red"
assert_contains "$OUT" "src/link:1" "typechange: names the file"
git -C "$R" reset -q --hard "$TBASE"; git -C "$R" clean -qfd
rm "$R/src/link"; printf 'clean text\n' > "$R/src/link"; git -C "$R" add -A
OUT="$(guard)"; assert_eq "$?" "0" "typechange twin: a clean symlink-to-file swap is green"
git -C "$R" reset -q --hard "$BASE"; git -C "$R" clean -qfd

# ── BL-0348 item 6: a failing registry check must exit (fail() is not swallowed) ──
MUT3="$TEST_TMP/mut3"; mkdir -p "$MUT3/scripts/lib" "$MUT3/hooks/_shared"
cp "$REPO_ROOT"/scripts/lib/personal-data-patterns.js "$MUT3/scripts/lib/"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$MUT3/hooks/_shared/"
node -e '
  const fs = require("fs"); const s = fs.readFileSync(process.argv[1], "utf8");
  const t = s.replace("process.stderr.write(`leak-guard: ${msg}\\n`);\n  process.exit(code);", "process.stderr.write(`leak-guard: ${msg}\\n`);");
  if (t === s) { process.stderr.write("mutation did not apply\n"); process.exit(3); }
  fs.writeFileSync(process.argv[2], t);
' "$REPO_ROOT/scripts/leak-guard.js" "$MUT3/scripts/leak-guard.js"
assert_eq "$?" "0" "stat-try mutation: fail() made non-exiting in the copy"
mkdir -p "$R/docs/plans/evidence/run1"; printf 'x %s\n' "$PERSONAL" > "$R/docs/plans/evidence/run1/out.md"; git -C "$R" add -A
(cd "$R" && node "$MUT3/scripts/leak-guard.js" --staged --registry "$TEST_TMP/dirreg2.json" >/dev/null 2>&1); MRC=$?
assert_eq "$([ "$MRC" = 2 ] && echo same || echo differs)" "differs" "stat-try mutation: with fail() not exiting, the dirreg2 case is RED (rc is no longer 2)"
OUT="$(REGISTRY="$TEST_TMP/dirreg2.json" guard)"; assert_eq "$?" "2" "stat-try twin: the real script still exits 2 on a directory entry"
reset_stage

# ── BL-0348 item 7: more than 26 distinct hosts on one line get unique letter labels ──
MH="$RC5/many.md"
node -e '
  const hs = []; for (let i = 0; i < 28; i++) hs.push("p" + i + "-testhost-a");
  require("fs").writeFileSync(process.argv[1], "x " + hs.join(" ") + "\n");
' "$MH"
node "$REDACT" "$MH" >/dev/null 2>&1; assert_eq "$?" "0" "host letters: 28-host line redacts"
LABELS="$(grep -o '<host-[a-z0-9]*>' "$MH")"
assert_eq "$(printf '%s\n' "$LABELS" | wc -l | tr -d ' ')" "28" "host letters: 28 labels written"
assert_eq "$(printf '%s\n' "$LABELS" | sort -u | wc -l | tr -d ' ')" "28" "host letters: all 28 labels are distinct"
assert_not_contains "$LABELS" "<host-27>" "host letters: no numeric fallback"
assert_contains "$LABELS" "<host-aa>" "host letters: the 27th host is aa"
assert_contains "$LABELS" "<host-ab>" "host letters: the 28th host is ab"

# ── review round 1: the revert path reads the message and the diff strictly ──
# (1) the trailer must be in the final trailer block, not a line followed by another paragraph
revert_setup
git -C "$R" log -1 --format=%B | git -C "$R" interpret-trailers --trailer "Leak-Guard-Allow-Revert: $A" > "$TEST_TMP/msg1"
printf '\nA closing paragraph after the trailer.\n' >> "$TEST_TMP/msg1"
git -C "$R" commit -q --amend -F "$TEST_TMP/msg1"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert strict-1: a trailer followed by another paragraph is not a trailer (red)"
# (2) the full stop of 'This reverts commit <sha>.' is required
revert_setup
git -C "$R" commit -q --amend -m "Revert x" -m "This reverts commit $A" -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert strict-2: 'This reverts commit <sha>' without the full stop is red"
git -C "$R" commit -q --amend -m "Revert x" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "0" "revert strict-2 twin: with the full stop and a trailer block it is green"
# (3) a redaction that also renames the file: the revert restores the line under the OLD path
reset_stage; git -C "$R" checkout -q -B rn "$BASE"
{ for i in 1 2 3 4 5 6 7 8; do echo "stable line number $i of the file"; done; printf 'legacy %s/x\n' "$PERSONAL"; } > "$R/src/big.txt"
git -C "$R" add -A; git -C "$R" commit -q -m "add big"
git -C "$R" mv src/big.txt src/big2.txt
{ for i in 1 2 3 4 5 6 7 8; do echo "stable line number $i of the file"; done; echo "legacy clean line"; } > "$R/src/big2.txt"
git -C "$R" add -A; git -C "$R" commit -q -m "redact and rename big"
A="$(git -C "$R" rev-parse HEAD)"
git -C "$R" revert --no-edit "$A" >/dev/null 2>&1; add_trailer "$A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "0" "revert strict-3: redact+rename then revert restores the line under the old path (green)"
git -C "$R" reset -q --soft "$A"; git -C "$R" reset -q
git -C "$R" checkout -q -- . ; git -C "$R" clean -qfd
printf 'legacy %s/x\n' "$PERSONAL" > "$R/src/other.txt"; git -C "$R" add -A
git -C "$R" commit -q -m "Revert x" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert strict-3 NC: the same line added to a different file is red"
assert_contains "$OUT" "src/other.txt:1" "revert strict-3 NC: names the other file"
# (4) a restored line is allowed as many times as the reverted commit removed it
revert_setup
git -C "$R" reset -q --soft "$A"
printf 'old note\nlegacy %s/x\nlegacy %s/x\n' "$PERSONAL" "$PERSONAL" > "$R/src/old.md"
git -C "$R" commit -q -am "Revert x" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert strict-4: adding the removed line back twice is red"
assert_contains "$OUT" "src/old.md:3" "revert strict-4: the second copy (line 3) is named"
assert_not_contains "$OUT" "src/old.md:2" "revert strict-4: the first copy (line 2) is allowed"
reset_stage; git -C "$R" checkout -q -f master 2>/dev/null || git -C "$R" checkout -q -f main 2>/dev/null

# ── review round 1, item 5: the allowance belongs to the revert commit, not to the whole range ──
revert_setup; add_trailer "$A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "0" "revert bind: the single legitimate revert stays green"
printf 'old note\n' > "$R/src/old.md"; git -C "$R" commit -q -am "drop the line again"
printf 'old note\nlegacy %s/x\n' "$PERSONAL" > "$R/src/old.md"; git -C "$R" commit -q -am "plain re-add, no trailer"
OUT="$(rguard "$A..HEAD")"; RC=$?
assert_eq "$RC" "1" "revert bind: revert, delete, then a trailer-less re-add of the same line is red"
assert_contains "$OUT" "src/old.md:2" "revert bind: names the re-added line"
assert_contains "$OUT" "1 personal-data finding(s)" "revert bind: exactly one finding (the legitimate revert's line stays allowed)"
reset_stage; git -C "$R" checkout -q -f master 2>/dev/null || git -C "$R" checkout -q -f main 2>/dev/null

# ── review round 3: one shared ledger for the range; merge commits are scanned; self-scan holes ──
back_to_master() { reset_stage; git -C "$R" checkout -q -f master 2>/dev/null || git -C "$R" checkout -q -f main 2>/dev/null; }
# (1) two revert commits naming the same cleanup commit share ONE allowance
revert_setup; add_trailer "$A"
printf 'old note\n' > "$R/src/old.md"; git -C "$R" commit -q -am "drop the line again"
printf 'old note\nlegacy %s/x\n' "$PERSONAL" > "$R/src/old.md"
git -C "$R" commit -q -am "Revert again" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; RC=$?
assert_eq "$RC" "1" "ledger: a second revert commit naming the same cleanup gets no second allowance (red)"
assert_contains "$OUT" "1 personal-data finding(s)" "ledger: exactly the second restore is named"
back_to_master
# (2) an evil merge: legitimate revert in the range, personal data introduced by the merge commit itself
revert_setup; add_trailer "$A"
git -C "$R" checkout -q -B side; echo s > "$R/src/side.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "side work"
git -C "$R" checkout -q rv; echo m > "$R/src/main.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "main work"
git -C "$R" merge -q --no-ff --no-commit side >/dev/null 2>&1
printf 'evil %s/q\n' "$PERSONAL" > "$R/src/merge.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "merge side"
OUT="$(rguard "$A..HEAD")"; RC=$?
assert_eq "$RC" "1" "merge: personal data added by a merge commit (range tip is the merge) is red"
assert_contains "$OUT" "src/merge.txt:1" "merge: names the merge's file"
assert_not_contains "$OUT" "side.txt" "merge: side-branch content already scanned is not re-reported"
back_to_master
# (2b) a merge cannot use the allowance even with a revert message and trailer
revert_setup
git -C "$R" checkout -q -B side "$A"; echo s > "$R/src/side.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "side work"
git -C "$R" checkout -q -B mrg "$A"; echo m > "$R/src/main.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "main work"
git -C "$R" merge -q --no-ff --no-commit side >/dev/null 2>&1
printf 'old note\nlegacy %s/x\n' "$PERSONAL" > "$R/src/old.md"; git -C "$R" add -A
git -C "$R" commit -q -m "Merge side" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "merge: a merge commit with a revert message and trailer gets no allowance (red)"
back_to_master
# (3) self-scan: typechange inside a trailer range
revert_setup; add_trailer "$A"
ln -s a.txt "$R/src/lk"; git -C "$R" add -A; git -C "$R" commit -q -m "add link"
rm "$R/src/lk"; printf 'in %s\n' "$PERSONAL" > "$R/src/lk"; git -C "$R" add -A; git -C "$R" commit -q -m "link becomes a file"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "self-scan typechange: symlink to file swap with personal data in a trailer range is red"
assert_contains "$OUT" "src/lk:1" "self-scan typechange: names the file"
back_to_master
# (4) self-scan: a root commit inside the range
revert_setup; add_trailer "$A"; REVTIP="$(git -C "$R" rev-parse HEAD)"
git -C "$R" checkout -q --orphan orph; git -C "$R" rm -rfq . ; printf 'root %s/r\n' "$PERSONAL" > "$R/root.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "unrelated root"
git -C "$R" commit -q --allow-empty -m "Revert z" -m "This reverts commit $A." -m "Leak-Guard-Allow-Revert: $A"
OUT="$(rguard "$BASE..HEAD")"; assert_eq "$?" "1" "self-scan root: a root commit inside a trailer range is scanned (red)"
assert_contains "$OUT" "root.txt:1" "self-scan root: names the root commit's file"
back_to_master
# (5) self-scan: rename plus edit across commits, an emptied commit and a binary file in a trailer range are scanned like the whole-range diff
revert_setup; add_trailer "$A"
git -C "$R" commit -q --allow-empty -m "empty"
printf 'bin\0data\n' > "$R/src/blob.bin"; git -C "$R" add -A; git -C "$R" commit -q -m "binary"
git -C "$R" mv src/a.txt src/a3.txt; git -C "$R" commit -q -m "pure rename"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "0" "self-scan empty/binary/pure rename: nothing added, green"
printf 'more %s/z\n' "$PERSONAL" >> "$R/src/a3.txt"; git -C "$R" commit -q -am "edit after rename"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "self-scan rename then edit: the added line is red"
assert_contains "$OUT" "src/a3.txt" "self-scan rename then edit: names the new path"
back_to_master

# ── review round 4: the whole-range diff is the floor; blame decides which revert commit may cover a line ──
# (cv3) stale merge: a side branch forked before the cleanup, the merge picks its old personal line back
reset_stage; git -C "$R" checkout -q -B rv "$BASE"
printf 'old note\nlegacy clean line\n' > "$R/src/old.md"; git -C "$R" commit -q -am "redact old.md"
printf 'z %s/zz\n' "$PERSONAL" > "$R/src/z.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "z old"
printf 'z clean\n' > "$R/src/z.txt"; git -C "$R" commit -q -am "cleanup z"; ZC="$(git -C "$R" rev-parse HEAD)"
printf 'z %s/zz\n' "$PERSONAL" > "$R/src/z.txt"; git -C "$R" commit -q -am "Revert z" -m "This reverts commit $ZC." -m "Leak-Guard-Allow-Revert: $ZC"
git -C "$R" checkout -q -B stale "$BASE"; echo s > "$R/src/side.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "stale side"
git -C "$R" checkout -q rv; git -C "$R" merge -q --no-ff --no-commit stale >/dev/null 2>&1
printf 'old note\nlegacy %s/x\n' "$PERSONAL" > "$R/src/old.md"; git -C "$R" add -A; git -C "$R" commit -q -m "merge picks the stale side"
OUT="$(rguard "$ZC..HEAD")"; RC=$?
assert_eq "$RC" "1" "stale merge: a merge that picks the old side's personal line back is red although the range has a valid revert"
assert_contains "$OUT" "src/old.md:2" "stale merge: names the line the merge put back"
assert_not_contains "$OUT" "src/z.txt" "stale merge: the legitimate revert's own line stays allowed"
# an anchor inside the range may be where the data first entered: no allowance
OUT="$(rguard "$BASE..HEAD")"; assert_eq "$?" "1" "anchor in range: a cleanup commit that is itself in the range gives no allowance (red)"
back_to_master

# ── review round 5: restore through a revert, then rename the file, stays blocked ──
reset_stage; git -C "$R" checkout -q -B rv "$BASE"
{ for i in 1 2 3 4 5 6 7 8; do echo "stable line number $i of the file"; done; printf 'legacy %s/x\n' "$PERSONAL"; } > "$R/src/big.txt"
git -C "$R" add -A; git -C "$R" commit -q -m "add big"
{ for i in 1 2 3 4 5 6 7 8; do echo "stable line number $i of the file"; done; echo "legacy clean line"; } > "$R/src/big.txt"
git -C "$R" commit -q -am "redact big"; A="$(git -C "$R" rev-parse HEAD)"
git -C "$R" revert --no-edit "$A" >/dev/null 2>&1; add_trailer "$A"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "0" "revert then rename: the plain revert is green"
git -C "$R" mv src/big.txt src/big3.txt; git -C "$R" commit -q -m "rename after the revert"
OUT="$(rguard "$A..HEAD")"; assert_eq "$?" "1" "revert then rename: the restored line under the new name is red"
assert_contains "$OUT" "src/big3.txt:9" "revert then rename: names the renamed file"
# many findings in one file are attributed by a single blame call per file
{ for i in $(seq 1 40); do printf 'row %s %s/q\n' "$i" "$PERSONAL"; done; } > "$R/src/many.txt"; git -C "$R" add -A; git -C "$R" commit -q -m "many rows"
OUT="$(rguard "$A..HEAD")"; assert_contains "$OUT" "src/many.txt:40" "many findings: every flagged line of a file is still reported"
back_to_master

# ── review round 5 extras: env_file is never covered; the range end is parsed whole ──
reset_stage; git -C "$R" checkout -q -B rv "$BASE"
printf 'k legacy %s/x\n' "$PERSONAL" > "$R/.env"; git -C "$R" add -A; git -C "$R" commit -q -m "old env"
git -C "$R" rm -q .env; git -C "$R" commit -q -m "drop env"; A="$(git -C "$R" rev-parse HEAD)"
git -C "$R" revert --no-edit "$A" >/dev/null 2>&1; add_trailer "$A"
OUT="$(rguard "$A..HEAD")"; RC=$?
assert_eq "$RC" "1" "env cover: a legitimate revert that brings a .env file back is still red"
assert_contains "$OUT" "[env_file]" "env cover: the env_file finding is kept"
assert_not_contains "$OUT" "[home_path]" "env cover: the covered content line is still allowed"
back_to_master
revert_setup; add_trailer "$A"
git -C "$R" branch -f rel-1.2 rv; git -C "$R" checkout -q -f master 2>/dev/null || git -C "$R" checkout -q -f main 2>/dev/null
OUT="$(rguard "$A..rel-1.2")"; assert_eq "$?" "0" "range end: a dotted branch name as the end, checkout elsewhere, covers the legitimate revert (green)"
OUT="$(rguard "$A...rel-1.2")"; assert_eq "$?" "0" "range end: the three-dot form works"
OUT="$(rguard "$A..nonexistent-1.2")"; assert_eq "$?" "2" "range end: an unknown end ref is an error, not a pass"
git -C "$R" checkout -q -f rv; OUT="$(rguard "$A..")"; assert_eq "$?" "0" "range end: 'base..' means HEAD"
back_to_master

# ── pre-push: an annotated tag on a commit already on the remote must pass ──
# The published commit's tree contains a leak. origin/HEAD is a different ref, which is the
# old base. Pushing the annotated tag (right end is the tag object, not the commit) must not
# re-scan that already-public history.
LP="$TEST_TMP/lgpush"
git init -q "$LP"
git -C "$LP" config core.hooksPath /dev/null
git -C "$LP" config commit.gpgsign false
mkdir -p "$LP/src"
echo clean > "$LP/src/u.txt"
git -C "$LP" add src/u.txt
git -C "$LP" commit -q -m unrelated
UNREL="$(git -C "$LP" rev-parse HEAD)"
git -C "$LP" checkout -q --orphan develop
git -C "$LP" rm -qrf .
mkdir -p "$LP/src"
printf 'legacy %s/x\n' "$PERSONAL" > "$LP/src/oldleak.txt"
git -C "$LP" add src/oldleak.txt
git -C "$LP" commit -q -m published
PUB="$(git -C "$LP" rev-parse HEAD)"
git -C "$LP" update-ref refs/remotes/origin/develop "$PUB"
git -C "$LP" update-ref refs/remotes/origin/unrelated "$UNREL"
git -C "$LP" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/unrelated
git -C "$LP" tag -a live-20261113-2 "$PUB" -m live
TAG="$(git -C "$LP" rev-parse refs/tags/live-20261113-2)"
ZERO="$(printf '%040d' 0)"
# scripts stay untracked: the hook reads them from the work tree, and they must not be part of either commit
mkdir -p "$LP/scripts/lib" "$LP/hooks/_shared"
cp "$REPO_ROOT/scripts/leak-guard.js" "$LP/scripts/leak-guard.js"
cp "$REPO_ROOT/scripts/lib/personal-data-patterns.js" "$LP/scripts/lib/personal-data-patterns.js"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$LP/hooks/_shared/secret-patterns.js"
printf '{"version":1,"entries":[]}\n' > "$LP/scripts/leak-guard-registry.json"
assert_neq "$TAG" "$PUB" "push-tag: annotated tag object is not the commit"
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/tags/live-20261113-2 $TAG refs/tags/live-20261113-2 $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "0" "push-tag: annotated tag on a commit already on the remote passes"
assert_not_contains "$LG_PUSH_OUT" "oldleak.txt" "push-tag: the published leak is not scanned"

# ── a branch push that carries a new leak commit is still blocked ──
printf 'new %s/y\n' "$PERSONAL" > "$LP/src/newleak.txt"
git -C "$LP" add src/newleak.txt
git -C "$LP" commit -q -m "add leak"
NEW="$(git -C "$LP" rev-parse HEAD)"
git -C "$LP" update-ref refs/remotes/origin/feature "$PUB"
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/heads/feature $NEW refs/heads/feature $PUB" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "1" "push-branch: a new commit that adds a leak is blocked"
assert_contains "$LG_PUSH_OUT" "newleak.txt" "push-branch: the new leak is named"
assert_contains "$LG_PUSH_OUT" "refs/heads/feature" "push-branch: the block names the pushed ref"
assert_not_contains "$LG_PUSH_OUT" "oldleak.txt" "push-branch: the published leak is not part of the new commit's diff"

# ── a tag on a new, not-yet-pushed commit that adds a leak is blocked ──
git -C "$LP" tag -a live-new "$NEW" -m new
TAGNEW="$(git -C "$LP" rev-parse refs/tags/live-new)"
assert_neq "$TAGNEW" "$NEW" "push-new-tag: annotated tag object is not the new commit"
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/tags/live-new $TAGNEW refs/tags/live-new $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "1" "push-new-tag: a tag on a not-yet-pushed leak commit is blocked"
assert_contains "$LG_PUSH_OUT" "newleak.txt" "push-new-tag: the new leak is named"
assert_contains "$LG_PUSH_OUT" "refs/tags/live-new" "push-new-tag: the block names the tag"
assert_not_contains "$LG_PUSH_OUT" "oldleak.txt" "push-new-tag: the published leak is not scanned"

# Negative control: the old range (origin/HEAD .. the annotated tag object) flags the published
# leak on the same tag as case 1. Case 1 is green only because that range is no longer scanned.
OLD_BASE="$(git -C "$LP" rev-parse --verify --quiet origin/HEAD)"
OLD_RANGE="${OLD_BASE}..${TAG}"
OLD_OUT="$(cd "$LP" && node "$REPO_ROOT/scripts/leak-guard.js" --range "$OLD_RANGE" 2>&1)"
OLD_RC=$?
assert_neq "$OLD_BASE" "$PUB" "push-tag NC: the old base is an unrelated ref, not the published commit"
assert_contains "$OLD_RANGE" "$TAG" "push-tag NC: the old right end is the tag object"
assert_eq "$OLD_RC" "1" "push-tag NC: old range origin/HEAD..tag-object is red"
assert_contains "$OLD_OUT" "oldleak.txt" "push-tag NC: old range flags the leak already on the remote"

# A deletion and a tag that does not point at a commit are skipped.
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/heads/feature $ZERO refs/heads/feature $PUB" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "0" "push-delete: an all-zero local sha is skipped"
assert_not_contains "$LG_PUSH_OUT" "blocked" "push-delete: nothing is scanned"
printf 'blob\n' > "$LP/src/blob-src.txt"
BLOB="$(git -C "$LP" hash-object -w "$LP/src/blob-src.txt")"
git -C "$LP" tag -a blobtag "$BLOB" -m blob
BLOBTAG="$(git -C "$LP" rev-parse refs/tags/blobtag)"
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/tags/blobtag $BLOBTAG refs/tags/blobtag $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "0" "push-blob-tag: a tag that does not point at a commit is skipped"
assert_not_contains "$LG_PUSH_OUT" "blocked" "push-blob-tag: nothing is scanned"

# No remote name falls back to --remotes, so the published tag still passes.
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/tags/live-20261113-2 $TAG refs/tags/live-20261113-2 $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "0" "push-tag: no remote name uses --remotes and the published tag passes"
assert_not_contains "$LG_PUSH_OUT" "oldleak.txt" "push-tag: no remote name does not scan the published leak"
# A different remote name has no tracking refs, so the same published commit is not known there.
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/tags/live-20261113-2 $TAG refs/tags/live-20261113-2 $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" other 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "1" "push-tag: remote name from argv is the one whose tracking refs count"
assert_contains "$LG_PUSH_OUT" "oldleak.txt" "push-tag: with no tracking refs for that remote the published leak is scanned"

# rev-list failure is fail-closed. The same published tag passes above (green twin).
# A PATH git that exits non-zero only for rev-list must block the push, and must not
# fall through into a scan of the already-published leak.
LG_WRAP="$TEST_TMP/lg-git-wrap"
mkdir -p "$LG_WRAP"
LG_REAL_GIT="$(command -v git)"
cat > "$LG_WRAP/git" << EOF
#!/bin/bash
if [ "\${1-}" = "rev-list" ]; then
  printf '%s\n' 'rev-list refused' >&2
  exit 1
fi
exec $(printf '%q' "$LG_REAL_GIT") "\$@"
EOF
chmod +x "$LG_WRAP/git"
LG_PUSH_OUT="$(cd "$LP" && printf '%s\n' "refs/tags/live-20261113-2 $TAG refs/tags/live-20261113-2 $ZERO" | PATH="$LG_WRAP:$PATH" bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "1" "push-rev-list-fail: a failed rev-list blocks the push"
assert_contains "$LG_PUSH_OUT" "could not list commits" "push-rev-list-fail: the block says the commit list failed"
assert_not_contains "$LG_PUSH_OUT" "oldleak.txt" "push-rev-list-fail: the published tree is not scanned when the list fails"

# A brand-new history whose only commit is a root, pushed at an empty remote
# (no remote-tracking refs). leak-guard --range is git diff/log on A..B; both accept
# the empty tree on the left, and there is no single-commit mode.
LR="$TEST_TMP/lgroot"
git init -q "$LR"
git -C "$LR" config core.hooksPath /dev/null
git -C "$LR" config commit.gpgsign false
mkdir -p "$LR/src" "$LR/scripts/lib" "$LR/hooks/_shared"
cp "$REPO_ROOT/scripts/leak-guard.js" "$LR/scripts/leak-guard.js"
cp "$REPO_ROOT/scripts/lib/personal-data-patterns.js" "$LR/scripts/lib/personal-data-patterns.js"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$LR/hooks/_shared/secret-patterns.js"
printf '{"version":1,"entries":[]}\n' > "$LR/scripts/leak-guard-registry.json"
printf 'root %s/r\n' "$PERSONAL" > "$LR/src/rootleak.txt"
git -C "$LR" add src/rootleak.txt
git -C "$LR" commit -q -m "root with a leak"
ROOTLEAK="$(git -C "$LR" rev-parse HEAD)"
assert_eq "$(git -C "$LR" rev-list --max-parents=0 HEAD)" "$ROOTLEAK" "push-root: the leak commit is a root"
EMPTY_TREE="$(git -C "$LR" hash-object -t tree /dev/null)"
LG_RANGE_OUT="$(cd "$LR" && node "$REPO_ROOT/scripts/leak-guard.js" --range "${EMPTY_TREE}..${ROOTLEAK}" 2>&1)"
LG_RANGE_RC=$?
assert_eq "$LG_RANGE_RC" "1" "push-root: leak-guard --range accepts empty-tree..root and flags the leak"
assert_contains "$LG_RANGE_OUT" "rootleak.txt" "push-root: the range names the root leak"
LG_PUSH_OUT="$(cd "$LR" && printf '%s\n' "refs/heads/main $ROOTLEAK refs/heads/main $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "1" "push-root: a root commit that adds a leak, pushed to an empty remote, is blocked"
assert_contains "$LG_PUSH_OUT" "rootleak.txt" "push-root: the leak in the root commit is named"

# Green twin: a different root with no leak, still an empty remote, passes.
git -C "$LR" checkout -q --orphan cleanroot
git -C "$LR" rm -rfq .
mkdir -p "$LR/src"
echo clean > "$LR/src/clean.txt"
git -C "$LR" add src/clean.txt
git -C "$LR" commit -q -m "clean root"
ROOTCLEAN="$(git -C "$LR" rev-parse HEAD)"
assert_eq "$(git -C "$LR" rev-parse --verify --quiet "${ROOTCLEAN}^" 2>/dev/null || true)" "" "push-root twin: the clean commit has no parent"
LG_PUSH_OUT="$(cd "$LR" && printf '%s\n' "refs/heads/main $ROOTCLEAN refs/heads/main $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LG_PUSH_RC=$?
assert_eq "$LG_PUSH_RC" "0" "push-root twin: a clean root commit pushed to an empty remote passes"
assert_not_contains "$LG_PUSH_OUT" "blocked" "push-root twin: a clean root is not blocked"
assert_not_contains "$LG_PUSH_OUT" "rootleak.txt" "push-root twin: the other root's leak is not scanned"

# ── Part 1: per-user host deny list leaves the tracked tree ──
assert_eq "$([ ! -e "$REPO_ROOT/scripts/lib/leak-guard-hosts.json" ] && echo absent || echo present)" "absent" "hosts-file: tracked scripts/lib/leak-guard-hosts.json is deleted"
assert_eq "$([ ! -e "$REPO_ROOT/platforms/codex/plugin/scripts/lib/leak-guard-hosts.json" ] && echo absent || echo present)" "absent" "hosts-file: codex mirror leak-guard-hosts.json is deleted"
assert_eq "$([ -f "$REPO_ROOT/scripts/lib/leak-guard-hosts.example.json" ] && echo present || echo absent)" "present" "hosts-file: leak-guard-hosts.example.json exists"

# Missing file at default ~/.autopilot/leak-guard-hosts.json: runs with local hostname only + 1 stderr line (not an error)
reset_stage
printf 'on testhost-a today\n' > "$R/src/h.txt"; git -C "$R" add src/h.txt
MISS_ERR="$TEST_TMP/miss.err"
MISS_OUT="$(cd "$R" && env -u AUTOPILOT_LEAK_GUARD_HOSTS HOME="$TEST_TMP/empty-home" node "$GUARD" --staged --registry "$REG" --json 2>"$MISS_ERR")"
MISS_RC=$?
assert_eq "$MISS_RC" "0" "hosts-file missing: default path absent exits 0 (not an error)"
assert_contains "$(cat "$MISS_ERR")" "$TEST_TMP/empty-home/.autopilot/leak-guard-hosts.json" "hosts-file missing: stderr names the expected default path"
assert_eq "$(wc -l < "$MISS_ERR" | tr -d ' ')" "1" "hosts-file missing: prints exactly one stderr line"
# Local hostname still matches when host file is absent
LOCAL_MISS="$(env -u AUTOPILOT_LEAK_GUARD_HOSTS HOME="$TEST_TMP/empty-home" node -e '
  const os = require("os"); os.hostname = () => "localbox-9";
  const p = require(process.argv[1]);
  process.stdout.write(String(p.findAll("run on localbox-9 now").length));
' "$REPO_ROOT/scripts/lib/personal-data-patterns.js" 2>/dev/null)"
assert_eq "$LOCAL_MISS" "1" "hosts-file missing: local distinctive hostname is still matched"
# Default ~/.autopilot/leak-guard-hosts.json is read when AUTOPILOT_LEAK_GUARD_HOSTS is unset
mkdir -p "$TEST_TMP/def-home/.autopilot"
printf '{"strong":["testhost-a"],"contextual":[]}\n' > "$TEST_TMP/def-home/.autopilot/leak-guard-hosts.json"
DEF_OUT="$(cd "$R" && env -u AUTOPILOT_LEAK_GUARD_HOSTS HOME="$TEST_TMP/def-home" node "$GUARD" --staged --registry "$REG" 2>&1)"
DEF_RC=$?
assert_eq "$DEF_RC" "1" "hosts-file default: ~/.autopilot/leak-guard-hosts.json blocks fake host"
assert_contains "$DEF_OUT" "[host]" "hosts-file default: reports host category"
reset_stage

# Unreadable or invalid JSON host list exits 2 (never a pass)
echo "clean check" >> "$R/src/a.txt"; git -C "$R" add src/a.txt
printf '{bad-json\n' > "$TEST_TMP/bad-hosts.json"
BADH_OUT="$(cd "$R" && AUTOPILOT_LEAK_GUARD_HOSTS="$TEST_TMP/bad-hosts.json" node "$GUARD" --staged --registry "$REG" 2>&1)"
assert_eq "$?" "2" "hosts-file invalid JSON: leak-guard exits 2"
printf '{"strong":"not-an-array"}\n' > "$TEST_TMP/malformed-hosts.json"
MALH_OUT="$(cd "$R" && AUTOPILOT_LEAK_GUARD_HOSTS="$TEST_TMP/malformed-hosts.json" node "$GUARD" --staged --registry "$REG" 2>&1)"
assert_eq "$?" "2" "hosts-file malformed schema: leak-guard exits 2"
mkdir -p "$TEST_TMP/hosts-as-dir"
DIRH_OUT="$(cd "$R" && AUTOPILOT_LEAK_GUARD_HOSTS="$TEST_TMP/hosts-as-dir" node "$GUARD" --staged --registry "$REG" 2>&1)"
assert_eq "$?" "2" "hosts-file unreadable directory: leak-guard exits 2"
AUTOPILOT_LEAK_GUARD_HOSTS="$TEST_TMP/bad-hosts.json" node "$REDACT" --check "$R/src/a.txt" >/dev/null 2>&1
assert_eq "$?" "2" "hosts-file invalid JSON: redact-personal exits 2"
reset_stage

# ── Part 2: leak-guard --tree <rev> [--categories ...] + pre-push full-tree host scan ──
LT="$TEST_TMP/lgtree"
git init -q "$LT"
git -C "$LT" config core.hooksPath /dev/null
git -C "$LT" config commit.gpgsign false
mkdir -p "$LT/src" "$LT/evidence" "$LT/docs/plans/evidence/r1" "$LT/scripts/lib" "$LT/hooks/_shared"
cp "$REPO_ROOT/scripts/leak-guard.js" "$LT/scripts/leak-guard.js"
cp "$REPO_ROOT/scripts/lib/personal-data-patterns.js" "$LT/scripts/lib/personal-data-patterns.js"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$LT/hooks/_shared/secret-patterns.js"
printf '{"version":1,"entries":[]}\n' > "$LT/scripts/leak-guard-registry.json"

# Commit 1 (already on remote): old file with fake host name + non-host personal path + binary with host + evidence files with host
printf 'deployed to testhost-a yesterday\n' > "$LT/src/legacy-host.txt"
printf 'legacy path %s/x and ip 192.168.55.4\n' "$PERSONAL" > "$LT/src/legacy-other.txt"
printf 'bin\0testhost-a\n' > "$LT/src/blob.bin"
printf 'host testhost-a in top evidence\n' > "$LT/evidence/note.md"
printf 'host testhost-a in nested evidence\n' > "$LT/docs/plans/evidence/r1/log.md"
git -C "$LT" add src evidence docs
git -C "$LT" commit -q -m "old published tree"
LT_PUB="$(git -C "$LT" rev-parse HEAD)"
git -C "$LT" update-ref refs/remotes/origin/develop "$LT_PUB"

# Direct --tree CLI checks
TREE_JSON="$(cd "$LT" && node "$GUARD" --tree "$LT_PUB" --registry "$REG" --json)"
TREE_RC=$?
assert_eq "$TREE_RC" "1" "tree-cli: --tree flags fake host in tracked file (exit 1)"
assert_contains "$TREE_JSON" '"file": "src/legacy-host.txt"' "tree-cli: JSON names src/legacy-host.txt"
assert_contains "$TREE_JSON" '"category": "host"' "tree-cli: JSON category is host"
assert_not_contains "$TREE_JSON" "legacy-other.txt" "tree-cli: default --tree ignores home_path and private_ip"
assert_not_contains "$TREE_JSON" "blob.bin" "tree-cli: binary file is skipped"
assert_not_contains "$TREE_JSON" "evidence/" "tree-cli: evidence/ directories are excluded"

TREE_MULTI="$(cd "$LT" && node "$GUARD" --tree "$LT_PUB" --categories host,home_path,private_ip --registry "$REG" --json)"
assert_eq "$?" "1" "tree-cli: --categories host,home_path,private_ip exits 1"
assert_contains "$TREE_MULTI" '"category": "home_path"' "tree-cli: --categories includes home_path when asked"
assert_contains "$TREE_MULTI" '"category": "private_ip"' "tree-cli: --categories includes private_ip when asked"

(cd "$LT" && node "$GUARD" --tree "no-such-revision" --registry "$REG" >/dev/null 2>&1)
assert_eq "$?" "2" "tree-cli: unknown revision exits 2"
(cd "$LT" && node "$GUARD" --tree "$LT_PUB" --categories not_a_category --registry "$REG" >/dev/null 2>&1)
assert_eq "$?" "2" "tree-cli: unknown category exits 2"
(cd "$LT" && node "$GUARD" --staged --tree "$LT_PUB" --registry "$REG" >/dev/null 2>&1)
assert_eq "$?" "2" "tree-cli: conflicting mode flags exit 2"

# Pre-push RED: pushing a clean commit on top of an old, already-pushed commit whose tree still has testhost-a blocks
echo "clean work" > "$LT/src/feature.txt"
git -C "$LT" add src/feature.txt
git -C "$LT" commit -q -m "clean commit on top"
LT_NEW="$(git -C "$LT" rev-parse HEAD)"
LT_PUSH_OUT="$(cd "$LT" && printf '%s\n' "refs/heads/feature $LT_NEW refs/heads/feature $LT_PUB" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LT_PUSH_RC=$?
assert_eq "$LT_PUSH_RC" "1" "push-tree: fake host in an old, already-pushed file blocks pre-push"
assert_contains "$LT_PUSH_OUT" "src/legacy-host.txt:1" "push-tree: names the old file and line"
assert_contains "$LT_PUSH_OUT" "[host]" "push-tree: names the host category"

# Pre-push GREEN + evidence exclusion: removing testhost-a from src/legacy-host.txt while keeping testhost-a in evidence/ passes
printf 'deployed to <host> yesterday\n' > "$LT/src/legacy-host.txt"
git -C "$LT" add src/legacy-host.txt
git -C "$LT" commit -q -m "redact host in src while evidence keeps host"
LT_CLEAN="$(git -C "$LT" rev-parse HEAD)"
LT_PUSH_OUT="$(cd "$LT" && printf '%s\n' "refs/heads/feature $LT_CLEAN refs/heads/feature $LT_PUB" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
LT_PUSH_RC=$?
assert_eq "$LT_PUSH_RC" "0" "push-tree twin: same tree without host in non-evidence files passes (evidence/ host does not block)"

# ── Part 3: pre-push refuses newly added evidence/ files; allows modify and delete ──
LE="$TEST_TMP/lgev"
git init -q "$LE"
git -C "$LE" config core.hooksPath /dev/null
git -C "$LE" config commit.gpgsign false
mkdir -p "$LE/src" "$LE/evidence" "$LE/docs/plans/evidence/x" "$LE/scripts/lib" "$LE/hooks/_shared"
cp "$REPO_ROOT/scripts/leak-guard.js" "$LE/scripts/leak-guard.js"
cp "$REPO_ROOT/scripts/lib/personal-data-patterns.js" "$LE/scripts/lib/personal-data-patterns.js"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$LE/hooks/_shared/secret-patterns.js"
printf '{"version":1,"entries":[]}\n' > "$LE/scripts/leak-guard-registry.json"

echo "base file" > "$LE/src/plain.md"
echo "existing nested evidence" > "$LE/docs/plans/evidence/x/old.md"
echo "existing top evidence" > "$LE/evidence/old-top.md"
git -C "$LE" add src evidence docs
git -C "$LE" commit -q -m "base with existing evidence"
LE_BASE="$(git -C "$LE" rev-parse HEAD)"
git -C "$LE" update-ref refs/remotes/origin/develop "$LE_BASE"

# (3a) RED: adding docs/plans/evidence/x/new.md is refused
git -C "$LE" checkout -q -B ev-add "$LE_BASE"
echo "new local evidence" > "$LE/docs/plans/evidence/x/new.md"
git -C "$LE" add docs/plans/evidence/x/new.md
git -C "$LE" commit -q -m "add nested evidence"
LE_ADD="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-add $LE_ADD refs/heads/ev-add $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence: adding docs/plans/evidence/x/new.md is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/new.md" "push-evidence: prints the refused nested evidence path"
assert_contains "$LE_OUT" "evidence stays local; keep it in an untracked directory." "push-evidence: prints the local-evidence guidance"

# (3b) RED: adding top-level evidence/new-top.md is refused
git -C "$LE" checkout -q -B ev-top "$LE_BASE"
echo "new top evidence" > "$LE/evidence/new-top.md"
git -C "$LE" add evidence/new-top.md
git -C "$LE" commit -q -m "add top evidence"
LE_TOP="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-top $LE_TOP refs/heads/ev-top $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence: adding top-level evidence/new-top.md is refused"
assert_contains "$LE_OUT" "evidence/new-top.md" "push-evidence: prints the refused top-level evidence path"

# (3c) RED: renaming or copying an existing file into evidence/ is refused
git -C "$LE" checkout -q -B ev-mv "$LE_BASE"
git -C "$LE" mv src/plain.md docs/plans/evidence/x/renamed.md
git -C "$LE" commit -q -m "rename into evidence"
LE_MV="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-mv $LE_MV refs/heads/ev-mv $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence: renaming a file into docs/plans/evidence/ is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/renamed.md" "push-evidence: prints the renamed evidence path"

git -C "$LE" checkout -q -B ev-cp "$LE_BASE"
cp "$LE/src/plain.md" "$LE/docs/plans/evidence/x/copied.md"
git -C "$LE" add docs/plans/evidence/x/copied.md
git -C "$LE" commit -q -m "copy into evidence"
LE_CP="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-cp $LE_CP refs/heads/ev-cp $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence: copying a file into docs/plans/evidence/ is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/copied.md" "push-evidence: prints the copied evidence path"

# (3d) GREEN: modifying an existing evidence file passes
git -C "$LE" checkout -q -B ev-mod "$LE_BASE"
echo "updated content" >> "$LE/docs/plans/evidence/x/old.md"
echo "updated top" >> "$LE/evidence/old-top.md"
git -C "$LE" add docs/plans/evidence/x/old.md evidence/old-top.md
git -C "$LE" commit -q -m "modify existing evidence"
LE_MOD="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-mod $LE_MOD refs/heads/ev-mod $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "0" "push-evidence twin: modifying an existing evidence file passes"

# (3e) GREEN: deleting an existing evidence file passes
git -C "$LE" checkout -q -B ev-del "$LE_BASE"
git -C "$LE" rm -q docs/plans/evidence/x/old.md evidence/old-top.md
git -C "$LE" commit -q -m "delete existing evidence"
LE_DEL="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-del $LE_DEL refs/heads/ev-del $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "0" "push-evidence twin: deleting an existing evidence file passes"

# (3f) GREEN: adding a file whose name contains 'evidence' without an evidence/ segment passes
git -C "$LE" checkout -q -B ev-nonseg "$LE_BASE"
echo "ok" > "$LE/src/evidence-helper.txt"
git -C "$LE" add src/evidence-helper.txt
git -C "$LE" commit -q -m "add non-evidence file"
LE_NONSEG="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-nonseg $LE_NONSEG refs/heads/ev-nonseg $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "0" "push-evidence twin: file without evidence/ directory segment passes"

# (3g) RED regression: one pushed commit adds docs/plans/evidence/x/new.md and the next deletes it -> push refused
git -C "$LE" checkout -q -B ev-add-del "$LE_BASE"
echo "transient evidence" > "$LE/docs/plans/evidence/x/new.md"
git -C "$LE" add docs/plans/evidence/x/new.md
git -C "$LE" commit -q -m "add transient evidence"
git -C "$LE" rm -q docs/plans/evidence/x/new.md
git -C "$LE" commit -q -m "delete transient evidence"
LE_ADD_DEL="$(git -C "$LE" rev-parse HEAD)"
assert_eq "$(git -C "$LE" diff --name-only "$LE_BASE" "$LE_ADD_DEL")" "" "push-evidence add-del: endpoint trees are identical"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-add-del $LE_ADD_DEL refs/heads/ev-add-del $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence add-del: adding then deleting docs/plans/evidence/x/new.md in pushed range is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/new.md" "push-evidence add-del: names docs/plans/evidence/x/new.md"
assert_contains "$LE_OUT" "evidence stays local; keep it in an untracked directory." "push-evidence add-del: prints local-evidence guidance"

# (3h) RED regression: same add-then-delete range pushed as a brand-new ref (remote sha all zeros, --not --remotes) is refused
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-add-del-new $LE_ADD_DEL refs/heads/ev-add-del-new $ZERO" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence add-del new-ref: new ref with transient evidence commit is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/new.md" "push-evidence add-del new-ref: names docs/plans/evidence/x/new.md"

# (3i) RED: rename into evidence/ in commit 1, renamed back out in commit 2 -> push refused
git -C "$LE" checkout -q -B ev-mv-back "$LE_BASE"
git -C "$LE" mv src/plain.md docs/plans/evidence/x/mv-temp.md
git -C "$LE" commit -q -m "rename into evidence temporarily"
git -C "$LE" mv docs/plans/evidence/x/mv-temp.md src/plain.md
git -C "$LE" commit -q -m "rename back out of evidence"
LE_MV_BACK="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-mv-back $LE_MV_BACK refs/heads/ev-mv-back $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence mv-back: temporary rename into evidence/ is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/mv-temp.md" "push-evidence mv-back: names docs/plans/evidence/x/mv-temp.md"

# (3j) GREEN twin: adding and deleting a non-evidence file across pushed commits passes
git -C "$LE" checkout -q -B ev-clean-transient "$LE_BASE"
echo "temp" > "$LE/src/temp.md"
git -C "$LE" add src/temp.md
git -C "$LE" commit -q -m "add src/temp.md"
git -C "$LE" rm -q src/temp.md
git -C "$LE" commit -q -m "delete src/temp.md"
LE_CLEAN_TR="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-clean-transient $LE_CLEAN_TR refs/heads/ev-clean-transient $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "0" "push-evidence add-del twin: transient non-evidence file passes"

# (3k) Merge commit: clean merge of an already-published evidence file passes; evil merge adding new evidence/ is refused
git -C "$LE" checkout -q -B ev-pub-side "$LE_BASE"
echo "already published on remote" > "$LE/docs/plans/evidence/x/pub-side.md"
git -C "$LE" add docs/plans/evidence/x/pub-side.md
git -C "$LE" commit -q -m "published side evidence"
LE_PUB_SIDE="$(git -C "$LE" rev-parse HEAD)"
git -C "$LE" update-ref refs/remotes/origin/ev-pub-side "$LE_PUB_SIDE"
git -C "$LE" checkout -q -B ev-merge-ok "$LE_BASE"
echo "feature change" > "$LE/src/feat-m.txt"
git -C "$LE" add src/feat-m.txt
git -C "$LE" commit -q -m "feature work"
git -C "$LE" merge -q --no-ff -m "merge published side" ev-pub-side
LE_MERGE_OK="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-merge-ok $LE_MERGE_OK refs/heads/ev-merge-ok $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "0" "push-evidence merge twin: merging already-on-remote evidence file passes"

git -C "$LE" checkout -q -B ev-merge-evil "$LE_BASE"
echo "feature change 2" > "$LE/src/feat-m2.txt"
git -C "$LE" add src/feat-m2.txt
git -C "$LE" commit -q -m "feature work 2"
git -C "$LE" merge -q --no-ff --no-commit ev-pub-side >/dev/null 2>&1
echo "smuggled in merge" > "$LE/docs/plans/evidence/x/evil-merge.md"
git -C "$LE" add docs/plans/evidence/x/evil-merge.md
git -C "$LE" commit -q -m "evil merge adds evidence"
LE_MERGE_EVIL="$(git -C "$LE" rev-parse HEAD)"
LE_OUT="$(cd "$LE" && printf '%s\n' "refs/heads/ev-merge-evil $LE_MERGE_EVIL refs/heads/ev-merge-evil $LE_BASE" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-evidence evil merge: merge introducing new evidence/ absent from all parents is refused"
assert_contains "$LE_OUT" "docs/plans/evidence/x/evil-merge.md" "push-evidence evil merge: names docs/plans/evidence/x/evil-merge.md"
assert_not_contains "$LE_OUT" "pub-side.md" "push-evidence evil merge: does not blame parent's published evidence file"

# ── Part 4: leak-guard --tree scans mode 120000 (symlink) blobs without dereferencing (+ codex mirror) ──
LSYM="$TEST_TMP/lgsym"
git init -q "$LSYM"
git -C "$LSYM" config core.hooksPath /dev/null
git -C "$LSYM" config commit.gpgsign false
mkdir -p "$LSYM/src" "$LSYM/docs/plans/evidence/r1" "$LSYM/scripts/lib" "$LSYM/hooks/_shared"
cp "$REPO_ROOT/scripts/leak-guard.js" "$LSYM/scripts/leak-guard.js"
cp "$REPO_ROOT/scripts/lib/personal-data-patterns.js" "$LSYM/scripts/lib/personal-data-patterns.js"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$LSYM/hooks/_shared/secret-patterns.js"
printf '{"version":1,"entries":[]}\n' > "$LSYM/scripts/leak-guard-registry.json"

echo "clean file" > "$LSYM/src/ok.txt"
printf 'host testhost-a inside excluded evidence file\n' > "$LSYM/docs/plans/evidence/r1/log.md"
ln -s "../testhost-a/missing-share" "$LSYM/src/host-link"
ln -s "../docs/plans/evidence/r1/log.md" "$LSYM/src/clean-link"
ln -s "../testhost-a/ev-share" "$LSYM/docs/plans/evidence/r1/ev-link"
git -C "$LSYM" add src docs
git -C "$LSYM" commit -q -m "published tree with symlinks"
LSYM_PUB="$(git -C "$LSYM" rev-parse HEAD)"
git -C "$LSYM" update-ref refs/remotes/origin/develop "$LSYM_PUB"

assert_contains "$(git -C "$LSYM" ls-tree "$LSYM_PUB" -- src/host-link)" "120000 blob" "tree-symlink: src/host-link is stored as mode 120000 blob"

SYM_JSON="$(cd "$LSYM" && node "$GUARD" --tree "$LSYM_PUB" --registry "$REG" --json)"
SYM_RC=$?
assert_eq "$SYM_RC" "1" "tree-symlink: --tree blocks tracked 120000 symlink whose target contains testhost-a"
assert_contains "$SYM_JSON" '"file": "src/host-link"' "tree-symlink: JSON names src/host-link"
assert_contains "$SYM_JSON" '"category": "host"' "tree-symlink: JSON reports host category"
assert_contains "$SYM_JSON" '"snippet": "testhost-a"' "tree-symlink: JSON reports matched host snippet"
assert_not_contains "$SYM_JSON" "clean-link" "tree-symlink: symlink with clean target text is not dereferenced"
assert_not_contains "$SYM_JSON" "ev-link" "tree-symlink: symlink under evidence/ stays excluded"

SYM_MIRROR_JSON="$(cd "$LSYM" && node "$REPO_ROOT/platforms/codex/plugin/scripts/leak-guard.js" --tree "$LSYM_PUB" --registry "$REG" --json)"
assert_eq "$?" "1" "tree-symlink mirror: codex mirror --tree also blocks 120000 symlink target with testhost-a"
assert_contains "$SYM_MIRROR_JSON" '"file": "src/host-link"' "tree-symlink mirror: codex mirror names src/host-link"

echo "unrelated change" > "$LSYM/src/next.txt"
git -C "$LSYM" add src/next.txt
git -C "$LSYM" commit -q -m "clean commit over published symlink"
LSYM_NEW="$(git -C "$LSYM" rev-parse HEAD)"
LSYM_PUSH_OUT="$(cd "$LSYM" && printf '%s\n' "refs/heads/feature $LSYM_NEW refs/heads/feature $LSYM_PUB" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "1" "push-tree-symlink: already-pushed symlink whose target contains testhost-a blocks pre-push"
assert_contains "$LSYM_PUSH_OUT" "src/host-link:1" "push-tree-symlink: names src/host-link:1"
assert_contains "$LSYM_PUSH_OUT" "[host]" "push-tree-symlink: names host category"

ln -sfn "../clean-share/target" "$LSYM/src/host-link"
git -C "$LSYM" add src/host-link
git -C "$LSYM" commit -q -m "point symlink at clean target"
LSYM_CLEAN="$(git -C "$LSYM" rev-parse HEAD)"
LSYM_PUSH_OUT="$(cd "$LSYM" && printf '%s\n' "refs/heads/feature $LSYM_CLEAN refs/heads/feature $LSYM_PUB" | bash "$REPO_ROOT/.githooks/pre-push" origin 2>&1)"
assert_eq "$?" "0" "push-tree-symlink twin: clean symlink target passes pre-push"

MUT4="$TEST_TMP/mut4"; mkdir -p "$MUT4/scripts/lib" "$MUT4/hooks/_shared"
cp "$REPO_ROOT"/scripts/lib/personal-data-patterns.js "$MUT4/scripts/lib/"
cp "$REPO_ROOT/hooks/_shared/secret-patterns.js" "$MUT4/hooks/_shared/"
node -e '
  const fs = require("fs"); const s = fs.readFileSync(process.argv[1], "utf8");
  const t = s.replace("if (type !== \x27blob\x27) continue;", "if (type !== \x27blob\x27 || meta[0] === \x27120000\x27) continue;");
  if (t === s) { process.stderr.write("mutation did not apply\n"); process.exit(3); }
  fs.writeFileSync(process.argv[2], t);
' "$REPO_ROOT/scripts/leak-guard.js" "$MUT4/scripts/leak-guard.js"
assert_eq "$?" "0" "tree-symlink NC: 120000 skip restored in mutant copy"
(cd "$LSYM" && node "$MUT4/scripts/leak-guard.js" --tree "$LSYM_PUB" --registry "$REG" >/dev/null 2>&1)
assert_eq "$?" "0" "tree-symlink NC: with 120000 skipped, --tree misses the symlink host leak"

finalize_test
