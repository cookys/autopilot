#!/usr/bin/env bash
# accounts-onboard.sh - G37 account onboarding: docs/guide/accounts.md steps O1-O9 as one interactive command.
#
#   scripts/accounts-onboard.sh [--yes] [--org <name>=<org-label>]... <name>...
#   scripts/accounts-onboard.sh --help          print this usage and do nothing else (so does no argument, exit 2)
#
# Each <name> is a profile: one Claude account plus one organization (an alias in the registry), priority 10, 20,
# 30... in argument order. Validation (names; --org specs) and a plan with a [y/N] question (default N; --yes skips
# it, which a non-interactive stdin needs) come first and create nothing.
#
# Per profile, in order: (org) the org LABEL is --org's label, else the profile name (nothing is read from the
# operator's current login: `claude auth status` is never called, so the window's login does not matter and need
# not be switched; setup-token's browser login picks the org); (O1) create the 0700 directories; ask the operator
# to run `claude setup-token` in another window (this script NEVER runs setup-token), then read the token silently
# with `read -rs` into <accounts-dir>/<name>/token (0600), and write the org record (org_label, org_id null) into
# <accounts-dir>/<name>/token-meta.json (0600; never the e-mail); (O2) add the profile to registry.json (0600,
# written by Node, idempotent); (O4) `claude-account.js env-check --alias`; (orghdr) `POST
# https://api.anthropic.com/v1/messages` with `Authorization: Bearer <token>`, `anthropic-version: 2023-06-01`,
# `anthropic-beta: oauth-2025-04-20`, `content-type: application/json` and a one-token OK body (30 s timeout),
# reading ONLY response headers `anthropic-organization-id` (UUID, lowercased) and
# `anthropic-ratelimit-unified-7d-utilization` (finite number; else empty) — never the response body or any other
# header: with an id and none recorded it writes org_id into token-meta.json (org verified), or refuses with
# "同一個 org 已登記在 <other>" and takes the just-added registry row back if another profile already holds that
# org_id; with an id and one recorded the two are compared (mismatch = failed row); HTTP 401 is a failed
# "token 無效" row and stops at that alias; any other org-header lookup failure marks org unverified and never blocks;
# (O7) one haiku "say OK" call through `claude-account.js run --alias` (independent of orghdr: a rate-limited OK
# call is its own row and never erases a verified org). Re-running on already-registered aliases keeps existing
# tokens by default and (re)verifies any alias whose org_id is still null.
# After all profiles: status, pick --purpose operator-check, selftest --real-binary, selftest --simulate-429 <first>
# (needs two accounts), cooldown --clear <first>; then a summary table (every row marked, no secrets; org label,
# "org 已驗證", 7d utilization as a percent — never the full org id) plus the O5 lane-reopen command and the O10
# rollback command. Exit 0 only when every row is OK; 1 on any failed row or a declined plan; 2 on usage errors.
#
# The registry row is added AFTER the token is written: a registry with an enabled alias that has no token makes
# every later check fail closed, so an alias the operator skips is simply not registered. A bad token (env-check,
# a 401 from the orghdr OK call, or the later haiku OK call fails) stops the whole run at that alias, because the
# registry checks every enabled alias and each later step would only fail again naming that same alias; fix the
# token and re-run (existing aliases are reused).
#
# The token only ever lives in the shell variable T, read from stdin (a tty or a pipe) and written by the
# `printf` builtin (and read into Node memory only inside `orghdr` for the Bearer header); it is never in argv,
# a log, the screen or a temp file. Re-running with the same arguments is safe: registry bytes stay unchanged, and
# an existing token file is kept unless the operator chooses to overwrite.
#
# Environment:
#   AUTOPILOT_ACCOUNTS_DIR  accounts dir (default ~/.config/autopilot/accounts); also AUTOPILOT_LIVE_DIR / AUTOPILOT_STATE_DIR
#   ONBOARD_CLAUDE_BIN      TEST SEAM ONLY: absolute path of a claude stand-in. It is used as the program of the
#                           OK call, and as `--binary` of the two selftests,
#                           nothing else. Unset = the real `claude`.
#   ONBOARD_ORG_URL         TEST SEAM ONLY: overrides the https://api.anthropic.com/v1/messages URL (base or
#                           full path, http/https only) so hermetic tests use a local stub server; unset = real URL.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/scripts/claude-account.js"

usage() {
  cat <<'USAGE'
accounts-onboard.sh：替每個「Claude 帳號＋org」登記一個 profile

這支指令在做什麼
  派工時可以指定「用哪一個帳號（哪一個 org）」。這支指令替你的每個帳號建一個 profile
  （一個你自己取的名字），之後 `claude-account.js` 與派工就用這個名字來挑帳號、換帳號。
  同一個 email 底下有好幾個 org（例如個人訂閱和公司 Team）時，每個 org 各建一個 profile。

用法
  scripts/accounts-onboard.sh [--yes] [--org 名稱=org標籤]... <名稱>...

  <名稱> 是你自己取的 profile 名稱，一個或多個；只能用小寫英文字母、數字和 -，最多 24 字。
  不能是 email，也不能長得像 acct-/codex- 加 8 位十六進位。名稱依序得到優先序 10、20、30。

  例子
    scripts/accounts-onboard.sh personal               只登記一個 profile
    scripts/accounts-onboard.sh personal team          登記兩個：個人 org 與團隊 org
    scripts/accounts-onboard.sh main spare             登記兩個：主力與備用

每個 profile 的步驟（約 2–3 分鐘；標「你」的要你親手做）
  ① 不用切換本視窗的登入：org 由 token 自己決定。本指令不讀目前登入的帳號（不呼叫 claude auth status）；
     profile 的 org 標籤用 --org 給的值，沒給就用 profile 名稱。
  ② 你：在【另一個終端視窗】執行 claude setup-token（它的瀏覽器登入選哪個 org，token 就屬於哪個 org），
     複製它印出的那一長串 token。本指令絕不代跑 setup-token。成功的樣子：另一個視窗印出一長串 token。
  ③ 你：回到這個視窗貼上 token（不會顯示、不進命令列、不進記錄）。不想處理這個 profile 就輸入 skip。
     成功的樣子：本視窗出現「已收到 token（不顯示內容）」。
  ④ 本指令自動做：寫入 token 檔與 org 記錄、登記到 registry.json、檢查目錄與權限、
     對這個 token 發一次 messages OK 呼叫（POST /v1/messages），只讀回應標頭裡的 org 識別碼與 7 日用量比例
     （絕不讀回應本文、也不印 email 或完整 org id），再用 haiku 做一次「say OK」的真實呼叫（會用到一點點額度）。
     org 識別碼會記進 token-meta.json（已驗證）；若同一個 org 已登記在別的 profile 就拒絕並把剛登記的列取回；
     若回應 401 代表 token 無效；其他查詢失敗則標為「org 未驗證」，不擋流程。OK 呼叫獨立計列，就算被限流也不會抹掉已驗證的 org。
     成功的樣子：出現 ✅ 與該 profile 名稱、org 標籤、「org 已驗證」與 7 日用量百分比。
  全部 profile 處理完後，再自動做 status、pick、兩個 selftest，最後印出總結表。成功的樣子：每一列都是 ✅。
  任何錯誤訊息都會寫「修法」；修好後重跑即可，已完成的 profile 會被沿用。

開始前
  先印出計畫並問你「繼續？[y/N]」，預設 N。直接按 Enter 或輸入 n 就結束，什麼都不會建立。
  stdin 不是終端機（管線、轉向）時，送進來的 y 不算確認：要加 --yes 才會繼續，否則拒絕並什麼都不建立。

選項
  -h, --help             印出這段說明就結束，不建立任何東西。不帶任何參數時也是這樣（結束碼 2）。
  --yes                  跳過「繼續？」的詢問，直接開始。
  --org 名稱=org標籤     指定某個 profile 的 org 標籤（不可含 @ 或雙引號、不可像 email）；沒給就用 profile 名稱。
                         標籤只是顯示用；org 識別碼永遠來自 token 自己的 messages 回應標頭（查不到就記為未知）。
                         可重複給多個。例：--org team=Acme-Team

安全與重複執行
  重複執行是安全的：token 檔已存在時問「沿用／覆蓋」，預設沿用；已有 org 記錄就不再重設標籤，若先前 org_id 尚未驗證（null）會自動用既有 token 重新查詢並補齊驗證。
  某個 profile 的 token 壞掉會在該 profile 停下並點名，結束碼非 0，修好後再跑一次即可。
  回滾：mv <帳號目錄>/registry.json <帳號目錄>/registry.json.off（跑完會印出完整指令）。

環境變數
  AUTOPILOT_ACCOUNTS_DIR  帳號目錄（預設 ~/.config/autopilot/accounts）
  ONBOARD_CLAUDE_BIN      僅供測試：指定替身 claude 的絕對路徑，只用在 OK 呼叫以及兩個 selftest
                          的 --binary，不開放其他行為；不設就用真的 claude。
  ONBOARD_ORG_URL         僅供測試：覆寫 org 標頭查詢網址（指向本機測試替身伺服器）；不設就用預設網址。
USAGE
}

YES=0
ORGS=()
ALIASES=()
want_org=0
for a in "$@"; do
  if [ "$want_org" -eq 1 ]; then ORGS+=("$a"); want_org=0; continue; fi
  case "$a" in
    -h|--help) usage; exit 0 ;;
    --yes) YES=1 ;;
    --org) want_org=1 ;;
    -*) echo "不認得的選項。修法：用 --help 看可用的選項（--yes、--org 名稱=org標籤），拿掉多餘的再重跑。" >&2; exit 2 ;;
    *) ALIASES+=("$a") ;;
  esac
done
if [ "$want_org" -eq 1 ]; then echo "--org 後面少了值。修法：寫成 --org 名稱=org標籤（例：--org team=Acme-Team）。" >&2; exit 2; fi
if [ "${#ALIASES[@]}" -eq 0 ]; then usage; exit 2; fi
set -- "${ALIASES[@]}"

BIN_ARGS=()
CLAUDE_PROG="claude"
if [ -n "${ONBOARD_CLAUDE_BIN:-}" ]; then
  case "$ONBOARD_CLAUDE_BIN" in /*) ;; *) echo "ONBOARD_CLAUDE_BIN 必須是絕對路徑。修法：改成替身 claude 的完整路徑，或不要設定它（用真的 claude）。" >&2; exit 2 ;; esac
  [ -x "$ONBOARD_CLAUDE_BIN" ] || { echo "ONBOARD_CLAUDE_BIN 不可執行。修法：確認該檔存在且有執行權限（chmod +x），或不要設定它。" >&2; exit 2; }
  BIN_ARGS=(--binary "$ONBOARD_CLAUDE_BIN")
  CLAUDE_PROG="$ONBOARD_CLAUDE_BIN"
fi

# --- Node helper (registry reads and writes never go through sed) -----------------------------------------------
read -r -d '' NODE_HELPER <<'JS' || true
const fs = require('fs');
const path = require('path');
const [root, mode, ...args] = process.argv.slice(1);
const reg = require(path.join(root, 'scripts', 'lib', 'account-registry.js'));
const die = (m) => { process.stderr.write(m + '\n'); process.exit(2); };
function secureDir(p) {
  let st = null;
  try { st = fs.lstatSync(p); } catch (e) { if (!e || e.code !== 'ENOENT') die('無法檢查目錄 ' + p + '。修法：確認上層目錄存在且你有權限後重跑。'); }
  if (!st) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  else if (st.isSymbolicLink() || !st.isDirectory()) die('不是一般目錄（或是符號連結）：' + p + '。修法：把它移走或改用別的 AUTOPILOT_ACCOUNTS_DIR 後重跑。');
  fs.chmodSync(p, 0o700);
}
if (mode === 'dir') {
  process.stdout.write(reg.accountsDir({}) + '\n');
} else if (mode === 'validate') {
  const cut = args.indexOf('--');
  const names = cut < 0 ? args : args.slice(0, cut);
  const specs = cut < 0 ? [] : args.slice(cut + 1);
  const seen = new Set();
  names.forEach((a, i) => {
    if (a.includes('@')) die(`第 ${i + 1} 個名稱看起來像 email（含 @）。profile 名稱是你自己取的短名字，例如 personal、team；請改用不含 email 的名稱，沒有建立任何東西。`);
    const p = reg.aliasProblem(a);
    if (p) die(`第 ${i + 1} 個名稱不合法（${p}）：只能用小寫英文字母、數字和 -，最多 24 字，且不能長得像 acct-/codex- 加 8 位十六進位。請改名後重跑，沒有建立任何東西。`);
    if (seen.has(a)) die(`第 ${i + 1} 個名稱重複，沒有建立任何東西。修法：每個 profile 只列一次，重複的拿掉再重跑。`);
    seen.add(a);
  });
  const seenOrg = new Set();
  specs.forEach((sp, i) => {
    const eq = sp.indexOf('=');
    const al = eq < 0 ? '' : sp.slice(0, eq);
    const label = eq < 0 ? '' : sp.slice(eq + 1);
    if (!seen.has(al)) die(`第 ${i + 1} 個 --org 要寫成「名稱=org標籤」，且名稱必須是這次要登記的 profile 之一；沒有建立任何東西。修法：寫成 --org 名稱=org標籤，名稱要是你列出的 profile 之一。`);
    if (seenOrg.has(al)) die(`第 ${i + 1} 個 --org 的 profile 重複，沒有建立任何東西。修法：每個 profile 只給一個 --org，重複的拿掉再重跑。`);
    seenOrg.add(al);
    const lp = reg.orgLabelProblem(label);
    if (lp) die(`第 ${i + 1} 個 --org 的標籤不合法（${lp}）：1 到 64 字、不可含 @ 或雙引號、不可像 email 或帳號資訊。修法：改用不含 email 的單純標籤再重跑，沒有建立任何東西。`);
  });
} else if (mode === 'hasorg') {
  const m = reg.readTokenMeta(reg.accountsDir({}), args[0], {});
  process.stdout.write(m && typeof m.org_label === 'string' ? 'yes\n' : 'no\n');
} else if (mode === 'relabel') {
  const [alias, label] = args;
  const lp = reg.orgLabelProblem(label);
  if (lp) die('org 標籤不合法：' + lp + '。修法：改用單純的名稱（1 到 64 字、不含 @ 和雙引號）。');
  reg.writeTokenMeta(reg.accountsDir({}), alias, { org_label: label });
} else if (mode === 'metaset') {
  const [alias, id, label, chk] = args;
  const lp = reg.orgLabelProblem(label);
  if (lp) die('org 標籤不合法：' + lp + '。修法：改用單純的名稱（1 到 64 字、不含 @ 和雙引號）。');
  if (id !== '-' && reg.orgIdProblem(id)) die('org 識別碼不合法。修法：重跑；若仍如此，請回報這個 token 的 org 標頭格式。');
  reg.writeTokenMeta(reg.accountsDir({}), alias, { org_id: id === '-' ? null : id, org_label: label, org_check: chk === 'verified' ? 'verified' : 'unverified' });
} else if (mode === 'orghdr') {
  // Read <accounts-dir>/<alias>/token into memory only; POST /v1/messages OK call (30 s timeout); read ONLY
  // anthropic-organization-id (UUID) and anthropic-ratelimit-unified-7d-utilization (finite number) from headers;
  // never read or output the body. Always exit 0: prints ok\n<uuid>\n<7d util or ''>\n or fail:<code>\n.
  const alias = args[0] || '';
  const ORG_PATH = '/v1/messages';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const fail = (code) => { process.stdout.write(`fail:${code}\n`); };
  (async () => {
    try {
      if (reg.aliasProblem(alias)) return fail('request_failed');
      const acc = reg.accountsDir({});
      const info = reg.checkAlias({ dir: acc }, alias, { create: false });
      let token = fs.readFileSync(info.tokenFile, 'utf8').replace(/\r?\n$/, '');
      if (!token || /\s/.test(token)) { token = ''; return fail('request_failed'); }
      let url = 'https://api.anthropic.com' + ORG_PATH;
      const seam = process.env.ONBOARD_ORG_URL;
      if (typeof seam === 'string' && seam !== '') {
        const u = new URL(seam);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') { token = ''; return fail('request_failed'); }
        if (!u.pathname.endsWith(ORG_PATH)) u.pathname = u.pathname.replace(/\/+$/, '') + ORG_PATH;
        url = u.toString();
      }
      let res;
      try {
        res = await globalThis.fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'oauth-2025-04-20',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-5-5',
            max_tokens: 1,
            system: "You are Claude Code, Anthropic's official CLI for Claude.",
            messages: [{ role: 'user', content: 'OK' }],
          }),
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) { token = ''; return fail('request_failed'); }
      token = '';
      if (!res || typeof res.status !== 'number') return fail('request_failed');
      // Only status and two headers are used; the body is never read, just cancelled.
      if (res.body) { try { await res.body.cancel(); } catch (e) { /* discard */ } }
      if (res.status === 401) return fail('http_401');
      if (res.status < 200 || res.status > 299) return fail(`http_${res.status}`);
      const rawUuid = res.headers.get('anthropic-organization-id');
      if (typeof rawUuid !== 'string' || !UUID_RE.test(rawUuid)) return fail('no_org_id');
      const utilRaw = res.headers.get('anthropic-ratelimit-unified-7d-utilization');
      let utilOut = '';
      if (typeof utilRaw === 'string' && utilRaw !== '') {
        const n = Number(utilRaw);
        if (Number.isFinite(n)) utilOut = String(n);
      }
      process.stdout.write(`ok\n${rawUuid.toLowerCase()}\n${utilOut}\n`);
    } catch (e) {
      fail('request_failed');
    }
  })();
} else if (mode === 'orgapply') {
  // Apply orghdr output to token-meta.json (0600). Prints <verdict>\n<label>\n<7d percent or ''>\n.
  const [alias, status, oid, outil] = args;
  const acc = reg.accountsDir({});
  const m = reg.readTokenMeta(acc, alias, {});
  const label = m && typeof m.org_label === 'string' && !reg.orgLabelProblem(m.org_label) ? m.org_label : alias;
  const nUtil = Number(outil);
  const utilShow = (outil && Number.isFinite(nUtil)) ? (String(Math.round(nUtil * 100)) + '%') : '';
  const emit = (v) => { process.stdout.write(`${v}\n${label}\n${utilShow}\n`); };
  if (status === 'fail:http_401') {
    emit('http_401');
  } else if (status === 'ok' && oid && !reg.orgIdProblem(oid)) {
    if (m && typeof m.org_id === 'string') {
      if (oid.toLowerCase() === m.org_id.toLowerCase()) {
        try { reg.writeTokenMeta(acc, alias, { org_check: 'verified' }); } catch (e) { die('org 記錄寫入失敗。修法：檢查該別名目錄的權限後重跑。'); }
        emit('verified');
      } else {
        try { reg.writeTokenMeta(acc, alias, { org_check: 'mismatch' }); } catch (e) { /* summary row still reports mismatch */ }
        emit('mismatch');
      }
    } else {
      const owner = reg.findOrgOwner(acc, oid, alias);
      if (owner) {
        emit('duplicate:' + owner);
      } else {
        const base = m ? {} : { org_label: label };
        try { reg.writeTokenMeta(acc, alias, Object.assign(base, { org_id: oid, org_check: 'verified' })); } catch (e) { die('org 識別碼寫入失敗。修法：檢查該別名目錄的權限後重跑。'); }
        emit('recorded');
      }
    }
  } else {
    if (m && m.org_check === 'verified') emit('kept'); // an earlier verified id stays
    else if (m && m.org_check === 'mismatch') emit('kept_mismatch'); // a failed orghdr read does not erase an earlier mismatch
    else {
      if (m) { try { reg.writeTokenMeta(acc, alias, { org_check: 'unverified' }); } catch (e) { /* the summary row still reports unverified */ } }
      emit('unverified');
    }
  }
} else if (mode === 'unregister') { // take back a row this run just added (its org turned out to be a duplicate)
  const alias = args[0];
  const acc = reg.accountsDir({});
  const r = reg.loadRegistry({});
  const rows = r.accounts.filter((x) => x.alias !== alias).map((x) => ({ alias: x.alias, enabled: x.enabled, priority: x.priority }));
  const file = path.join(acc, 'registry.json');
  const tmp = path.join(acc, `registry.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify({ schema: reg.SCHEMA, accounts: rows }) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
} else if (mode === 'prepare') {
  const alias = args[0];
  const p = reg.aliasProblem(alias);
  if (p) die(`別名不合法（${p}）。修法：改用小寫英文字母、數字和 -，最多 24 字。`);
  const acc = reg.accountsDir({});
  if (!process.env.AUTOPILOT_ACCOUNTS_DIR) secureDir(path.dirname(acc));
  secureDir(acc);
  for (const d of [alias, path.join(alias, 'claude'), path.join(alias, 'home')]) secureDir(path.join(acc, d));
} else if (mode === 'register') {
  const alias = args[0];
  const priority = Number(args[1]);
  if (reg.aliasProblem(alias)) die('別名不合法。修法：改用小寫英文字母、數字和 -，最多 24 字。');
  const acc = reg.accountsDir({});
  let r;
  try { r = reg.loadRegistry({}); } catch (e) { die('registry 無法讀取：' + (e && e.message ? e.message : 'error') + '。修法：依訊息修正 registry.json（權限須為 0600）；損壞時先備份再移走後重跑。'); }
  const have = new Set(r.accounts.map((x) => x.alias));
  if (have.has(alias)) { process.stdout.write('exists\n'); process.exit(0); } // onboard:idempotent
  const rows = r.accounts.map((x) => ({ alias: x.alias, enabled: x.enabled, priority: x.priority }));
  rows.push({ alias, enabled: true, priority });
  const file = path.join(acc, 'registry.json');
  const tmp = path.join(acc, `registry.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify({ schema: reg.SCHEMA, accounts: rows }) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  process.stdout.write(r.configured ? 'added\n' : 'created\n');
}
JS
nodeh() { node -e "$NODE_HELPER" "$ROOT" "$@" < /dev/null; }

# --- summary bookkeeping ----------------------------------------------------------------------------------------
ROWS=()
FAILED=0
row() { # <mark> <item> <reason>
  ROWS+=("$1|$2|$3")
  [ "$1" = "❌" ] && FAILED=1
  return 0
}
claude_account() { node "$CLI" "$@" < /dev/null; }

nodeh validate "$@" ${ORGS[@]+-- "${ORGS[@]}"} || exit 2
ACC_DIR="$(nodeh dir)" || exit 2

org_given() { # <alias>: prints the --org label given for that alias, or nothing
  local sp
  for sp in ${ORGS[@]+"${ORGS[@]}"}; do
    [ "${sp%%=*}" = "$1" ] && { printf '%s' "${sp#*=}"; return 0; }
  done
  return 0
}

names=""
for n in "$@"; do names="$names${names:+、}$n"; done
cat <<EOF
將登記 $# 個 profile：$names。
每個約 2–3 分鐘，需要你：①在另一個視窗切到對應的帳號／org ②在另一個視窗跑 claude setup-token ③回到這裡貼上 token。
帳號目錄：$(nodeh dir)
本指令不會執行 claude setup-token，也不會把 token 或 email 印出來。
EOF
if [ "$YES" -eq 1 ]; then
  echo "（已加 --yes，不再詢問。）"
elif [ ! -t 0 ]; then
  echo "stdin 不是終端機，而且沒有加 --yes，所以不繼續（管線或轉向送進來的 y 不算確認），沒有建立任何東西。"
  echo "修法：在互動式終端機直接執行，或確認計畫無誤後加上 --yes 重跑。"
  exit 1
else
  printf '繼續？[y/N] '
  go_ans=""
  read -r go_ans || go_ans=""
  echo
  case "$go_ans" in
    y|Y|yes|YES) ;;
    *)
      echo "已取消，沒有建立任何東西。要開始請重跑並輸入 y；非互動環境請加 --yes。"
      exit 1 ;;
  esac
fi

WORK=""
trap 'rm -rf "${WORK:-}"' EXIT
WORK="$(mktemp -d "${TMPDIR:-/tmp}/accounts-onboard.XXXXXX")" || exit 2
chmod 700 "$WORK"

OK_ALIASES=()
STOPPED=""
idx=0
for alias in "$@"; do
  idx=$((idx + 1))
  echo
  echo "== 別名 $alias（第 $idx 個，優先序 $((idx * 10))） =="

  # --- org: the label only. The org ID (and 7d utilization for the summary) are learned from this token's
  # orghdr OK-call response headers below; the operator's current login (claude auth status) plays no part. ----
  ORG_PENDING=0; ORG_ID="-"; ORG_LABEL=""; ORG_CHECK="unverified"
  ORG_RELABEL=0
  given="$(org_given "$alias")"
  if [ "$(nodeh hasorg "$alias")" = "yes" ]; then
    if [ -n "$given" ]; then
      ORG_RELABEL=1; ORG_LABEL="$given"
      row "✅" "$alias org" "標籤「$given」（以 --org 更新既有 org 記錄）"
    else
      row "✅" "$alias org" "沿用既有 org 記錄（token-meta.json）"
    fi
  else
    ORG_PENDING=1
    if [ -n "$given" ]; then
      ORG_LABEL="$given"
      row "✅" "$alias org" "標籤「$given」（以 --org 指定）；org 識別碼稍後由 messages 回應標頭取得"
    else
      ORG_LABEL="$alias"
      row "✅" "$alias org" "標籤「$alias」（沿用 profile 名稱）；org 識別碼稍後由 messages 回應標頭取得"
    fi
  fi

  if ! nodeh prepare "$alias"; then
    row "❌" "$alias 目錄" "目錄建立或權限設定失敗；修法：確認帳號目錄（AUTOPILOT_ACCOUNTS_DIR）可寫、不是符號連結後重跑"
    STOPPED="$alias"; break
  fi
  row "✅" "$alias 目錄" "已建立或確認為 0700"

  tf="$ACC_DIR/$alias/token"
  keep=0
  if [ -L "$tf" ] || { [ -e "$tf" ] && [ ! -f "$tf" ]; }; then # onboard:token-guard
    echo "別名 $alias 的 token 路徑是符號連結或不是一般檔案，拒絕寫入（不會動任何內容）。修法：把 $tf 移走（例如 mv 到別處）後重跑。"
    row "❌" "$alias token" "token 路徑是符號連結或不是一般檔案，拒絕寫入，未登記；修法：把該路徑移走後重跑"
    row "❌" "$alias env-check" "未執行"
    row "❌" "$alias haiku OK 呼叫" "未執行"
    continue
  fi
  if [ -s "$tf" ]; then
    printf '別名 %s 的 token 檔已存在。沿用或覆蓋？[沿用/覆蓋，預設沿用] ' "$alias"
    choice=""
    read -r choice || choice=""
    case "$choice" in
      覆蓋|o|O|overwrite) keep=0 ;;
      *) keep=1 ;;
    esac
    echo
  fi

  if [ "$keep" -eq 1 ]; then
    row "✅" "$alias token" "沿用既有 token 檔"
  else
    cat <<EOF
步驟 ②（在【另一個終端視窗】做）：確認那個視窗登入的就是 $alias 要用的帳號／org，然後執行
    claude setup-token
  成功的樣子：那個視窗印出一長串 token；把整串複製起來。若報錯或沒有印出 token，請先在那個視窗重新登入再試。
步驟 ③（回到【這個視窗】）：貼上 token 後按 Enter。畫面不會顯示你貼的內容，這是正常的；
  成功的樣子：出現「已收到 token（不顯示內容）」。
不想處理這個別名就輸入 skip。
EOF
    T=""
    got=0
    while :; do
      printf '請貼上 %s 的 token：' "$alias"
      if ! read -rs T; then
        echo
        echo "讀不到輸入，略過別名 $alias。修法：請在互動式終端機執行，或確認 stdin 有內容，再重跑。"
        T=""; break
      fi
      echo
      if [ "$T" = "skip" ]; then T=""; break; fi
      if [ -z "$T" ]; then echo "空白輸入。修法：回到另一個視窗複製 token 後再貼一次（或輸入 skip）。"; continue; fi
      if [[ "$T" == *[[:space:]]* ]]; then echo "token 不可含空白或換行。修法：只複製 token 那一長串，不要連同前後說明文字，再貼一次。"; continue; fi
      if [ "${#T}" -gt 4096 ]; then echo "token 超過 4096 位元組。修法：你貼的可能不是 token（多貼了別的內容），重新複製後再貼一次。"; continue; fi
      got=1; break
    done
    if [ "$got" -eq 1 ]; then
      # New 0600 file beside the target (noclobber = O_EXCL, never reuses a file), then rename over it: a
      # rename replaces a symlink or a loose-mode old file instead of writing through it.
      tmpf="$ACC_DIR/$alias/.token.new.$$"
      wrc=0
      ( umask 077; set -C; printf '%s' "$T" > "$tmpf" ) && chmod 600 "$tmpf" && mv -f "$tmpf" "$tf" || wrc=1 # onboard:token-write
      unset T
      if [ "$wrc" -ne 0 ]; then
        rm -f "$tmpf"
        echo "別名 $alias 的 token 寫入失敗，未登記。修法：檢查帳號目錄 $ACC_DIR 的磁碟空間與權限後重跑。"
        row "❌" "$alias token" "token 檔寫入失敗，未登記；修法：檢查磁碟空間與目錄權限後重跑"
        row "❌" "$alias env-check" "未執行"
        row "❌" "$alias haiku OK 呼叫" "未執行"
        continue
      fi
      echo "步驟 ③ 完成 ✅ 已收到 token（不顯示內容），已寫入 $alias 的 token 檔。"
      row "✅" "$alias token" "已寫入 token 檔（0600）"
    else
      unset T
      row "❌" "$alias token" "你略過了這個別名，沒有 token，所以沒有登記；修法：要登記請重跑並貼上 token"
      row "❌" "$alias env-check" "未執行（沒有 token）"
      row "❌" "$alias haiku OK 呼叫" "未執行（沒有 token）"
      echo "別名 $alias 已略過，繼續下一個。"
      continue
    fi
  fi

  if [ "$ORG_PENDING" -eq 1 ]; then
    if ! mr="$(nodeh metaset "$alias" "$ORG_ID" "$ORG_LABEL" "$ORG_CHECK" 2>&1)"; then
      row "❌" "$alias org 記錄" "token-meta.json 寫入失敗：$mr；修法：檢查該別名目錄的權限，或先備份再移走既有的 token-meta.json 後重跑（meta_unreadable 代表既有檔案讀不懂，不會被蓋掉）"
      STOPPED="$alias"; break
    fi
  elif [ "$ORG_RELABEL" -eq 1 ]; then
    if ! mr="$(nodeh relabel "$alias" "$ORG_LABEL" 2>&1)"; then
      row "❌" "$alias org 記錄" "token-meta.json 寫入失敗：$mr；修法：檢查該別名目錄的權限，或先備份再移走既有的 token-meta.json 後重跑"
      STOPPED="$alias"; break
    fi
  fi

  if r="$(nodeh register "$alias" $((idx * 10)) 2>&1)"; then
    case "$r" in
      exists) row "✅" "$alias registry" "已在 registry 裡，未改動" ;;
      *) row "✅" "$alias registry" "已加入 registry（priority $((idx * 10))）" ;;
    esac
  else
    row "❌" "$alias registry" "registry 寫入失敗：$r；修法：檢查帳號目錄權限；若 registry.json 損壞，先備份再移走後重跑"
    STOPPED="$alias"; break
  fi

  if envout="$(claude_account env-check --alias "$alias" 2>&1)"; then
    echo "$envout"
    row "✅" "$alias env-check" "目錄與 token 檔權限正確"
  else
    echo "$envout"
    echo "別名 $alias 的 env-check 失敗，停止整個流程（registry 會逐一檢查每個啟用的別名，繼續只會再次失敗並指向這個別名）。
修法：依上面訊息修正；token 有問題就重新在另一個視窗跑 claude setup-token，重跑本指令並選「覆蓋」。"
    row "❌" "$alias env-check" "別名 $alias 的 token 檔或目錄有問題，請照上面訊息修正後重跑"
    row "❌" "$alias haiku OK 呼叫" "未執行"
    STOPPED="$alias"; break
  fi

  prof_out="$(nodeh orghdr "$alias")"
  ost=""; oid=""; outil=""
  {
    IFS= read -r ost || ost=""
    IFS= read -r oid || oid=""
    IFS= read -r outil || outil=""
  } <<< "$prof_out"
  if ! app_out="$(nodeh orgapply "$alias" "$ost" "$oid" "$outil" 2>&1)"; then
    row "❌" "$alias org 核對" "token-meta.json 寫入失敗：$app_out；修法：檢查該別名目錄的權限，或先備份再移走既有的 token-meta.json 後重跑"
    row "❌" "$alias haiku OK 呼叫" "未執行"
    STOPPED="$alias"; break
  fi
  orgv=""; olabel=""; outil_show=""
  {
    IFS= read -r orgv || orgv=""
    IFS= read -r olabel || olabel=""
    IFS= read -r outil_show || outil_show=""
  } <<< "$app_out"
  [ -n "$olabel" ] || olabel="$alias"
  plan_part=""
  [ -n "$outil_show" ] && plan_part="，7d 用量 $outil_show"
  case "$ost" in fail:*) ofail="${ost#fail:}" ;; *) ofail="no_org_id" ;; esac
  [ -n "$ofail" ] || ofail="request_failed"
  case "$orgv" in
    duplicate:*)
      owner="${orgv#duplicate:}"
      took_back=0
      case "$r" in
        added|created)
          if nodeh unregister "$alias" >/dev/null 2>&1; then
            took_back=1
          fi ;;
      esac
      if [ "$took_back" -eq 1 ]; then # onboard:dup-takeback
        echo "別名 $alias：同一個 org 已登記在 $owner；同一個 org 登記兩次會讓同一份額度被算兩次，所以拒絕，$alias 不留在 registry 裡。"
        echo "修法：重新在另一個視窗用另一個 org 的登入跑 claude setup-token，重跑本指令並選「覆蓋」；如果其實不需要，就不要登記 $alias。"
        row "❌" "$alias org 核對" "同一個 org 已登記在 $owner（標籤「$olabel」${plan_part}），拒絕重複登記（已從 registry 取回）；修法：換用另一個 org 的 token 後重跑，選「覆蓋」"
      else
        echo "別名 $alias：同一個 org 已登記在 $owner；同一個 org 登記兩次會讓同一份額度被算兩次。$alias 仍在 registry 裡（未移除），請手動移除其中一個。"
        echo "修法：請手動編輯 $ACC_DIR/registry.json 移除或停用其中一個（$alias 或 $owner），或改用另一個 org 的 token 重跑本指令並選「覆蓋」。"
        row "❌" "$alias org 核對" "別名 $alias 仍在 registry 裡，且同一個 org 已登記在 $owner（標籤「$olabel」${plan_part}），未寫入 org 識別碼；修法：請手動從 registry.json 移除其中一個（$alias 或 $owner），或換用另一個 org 的 token 後重跑，選「覆蓋」"
      fi
      continue ;;
    http_401)
      echo "別名 $alias 的 org 標頭查詢回應 401（token 無效），停止整個流程。"
      echo "修法：重新在另一個視窗跑 claude setup-token，重跑本指令並選「覆蓋」。"
      row "❌" "$alias org 核對" "token 無效（標籤「$olabel」，org 標頭查詢回應 401）；修法：重新跑 claude setup-token，重跑本指令並選「覆蓋」"
      row "❌" "$alias haiku OK 呼叫" "未執行（token 無效）"
      STOPPED="$alias"; break ;;
    recorded)
      row "✅" "$alias org 核對" "標籤「$olabel」${plan_part}；org 已驗證" ;;
    verified)
      row "✅" "$alias org 核對" "標籤「$olabel」${plan_part}；org 已驗證" ;;
    mismatch)
      echo "別名 $alias 的 org 識別碼與先前紀錄不同。修法：重新跑 claude setup-token 並確認 org，重跑選「覆蓋」。"
      row "❌" "$alias org 核對" "標籤「$olabel」${plan_part}；org 識別碼與記錄不同（這個 token 綁到別的 org）；修法：重新 setup-token 並確認 org，重跑選「覆蓋」" ;;
    kept)
      row "➖" "$alias org 核對" "標籤「$olabel」${plan_part}；這次 org 標頭未取得（$ofail），保留先前已驗證的 org 記錄" ;;
    kept_mismatch)
      row "➖" "$alias org 核對" "標籤「$olabel」${plan_part}；這次 org 標頭未取得（$ofail），先前的 mismatch 仍然有效（status 會顯示 org_check=mismatch）" ;;
    *)
      row "➖" "$alias org 核對" "標籤「$olabel」${plan_part}；org 未驗證（org 標頭：$ofail，不影響通過）" ;;
  esac

  okf="$WORK/ok-$idx.json"
  claude_account run --alias "$alias" --purpose operator-check --stdout "$okf" --stderr "$WORK/err-$idx.txt" -- \
    "$CLAUDE_PROG" -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config
  rc=$?
  if [ "$rc" -eq 0 ] && grep -Eq '"is_error": ?false' "$okf" 2>/dev/null; then
    echo "步驟 ④ 完成 ✅ 別名 $alias：haiku OK 呼叫成功。"
    row "✅" "$alias haiku OK 呼叫" "回應正常（is_error:false）"
    OK_ALIASES+=("$alias")
  else
    case "$rc" in
      6) why="認證被拒（401），別名 $alias 的 token 無效或已撤銷；修法：重新跑 claude setup-token，重跑本指令並選「覆蓋」" ;;
      4) why="別名 $alias 被限流；修法：稍後再重跑（額度恢復後）" ;;
      7) why="別名 $alias 的子行程把 token 印了出來，輸出已洗掉；修法：把這個 token 視為外洩，撤銷後重新 setup-token" ;;
      3) why="沒有可用的別名；修法：確認 registry.json 裡該別名是啟用的" ;;
      2) why="別名 $alias 的設定檢查失敗；修法：看上面的 env-check 訊息修正" ;;
      0) why="呼叫結束但回應不是 is_error:false；修法：重跑一次，仍然如此就重新 setup-token" ;;
      *) why="呼叫失敗（結束碼 $rc）；修法：確認 claude 已安裝且網路可用後重跑" ;;
    esac
    echo "別名 $alias 的 OK 呼叫失敗：$why。停止整個流程，原因同上（後面的別名會被同一個壞別名擋住）。"
    row "❌" "$alias haiku OK 呼叫" "$why"
    STOPPED="$alias"; break
  fi
done

FIRST="$1"

if [ -n "$STOPPED" ]; then
  echo
  echo "流程在別名 $STOPPED 停止；之後的別名與全域檢查都未執行。"
  row "❌" "status / pick / selftest" "未執行（別名 $STOPPED 出錯）"
else
  echo
  echo "== 全域檢查 =="
  if claude_account status; then row "✅" "status" "registry 與別名狀態可讀"; else row "❌" "status" "status 失敗；修法：看上面的錯誤訊息（通常是某個別名的 token 或目錄），修正後重跑"; fi
  if claude_account pick --purpose operator-check; then row "✅" "pick" "挑選器有回答"; else row "❌" "pick" "pick 失敗；修法：看上面的錯誤訊息，通常是沒有可用別名或全部被限流，修正或稍後重跑"; fi
  if claude_account selftest --real-binary ${BIN_ARGS[@]+"${BIN_ARGS[@]}"}; then
    row "✅" "selftest --real-binary" "假 token 得 401，沒有退回你自己的登入"
  else
    row "❌" "selftest --real-binary" "沒通過；修法：照上面的 FAIL 行處理後重跑；若提示答案回來了，代表動到你自己的登入，請立刻停手並回報"
  fi
  # Failover self-test eligibility: enabled aliases in the registry whose env-check passes (not just this run's).
  USABLE=()
  if usable_out="$(claude_account env-check 2>/dev/null)"; then
    while IFS= read -r l; do
      case "$l" in "ok alias="*) l="${l#ok alias=}"; USABLE+=("${l%% *}") ;; esac
    done <<< "$usable_out"
  fi
  SIM="$FIRST"
  in_usable=0
  for u in ${USABLE[@]+"${USABLE[@]}"}; do [ "$u" = "$FIRST" ] && in_usable=1; done
  [ "$in_usable" -eq 1 ] || SIM="${USABLE[0]:-$FIRST}"
  if [ "${#USABLE[@]}" -ge 2 ]; then # onboard:failover-gate
    sim_rc=0
    claude_account selftest --simulate-429 "$SIM" ${BIN_ARGS[@]+"${BIN_ARGS[@]}"} || sim_rc=$?
    if [ "$sim_rc" -eq 0 ]; then row "✅" "selftest --simulate-429 $SIM" "$SIM 限流後改走下一個別名"; else row "❌" "selftest --simulate-429 $SIM" "沒通過，請看上面的 FAIL 行；修法：照該行訊息處理後重跑"; fi
    if claude_account cooldown --clear "$SIM"; then row "✅" "cooldown --clear $SIM" "已解除冷卻"; else row "❌" "cooldown --clear $SIM" "解除冷卻失敗；修法：手動執行 node scripts/claude-account.js cooldown --clear $SIM"; fi
  else
    row "➖" "selftest --simulate-429" "略過：需要兩個帳號"
    row "➖" "cooldown --clear" "略過：需要兩個帳號（沒有跑 simulate-429）"
  fi
fi

echo
echo "== 總結 =="
for r in "${ROWS[@]}"; do
  IFS='|' read -r mark item reason <<< "$r"
  printf '%s  %s：%s\n' "$mark" "$item" "$reason"
done
echo "（✅ 通過　❌ 失敗　➖ 略過）"
if [ "$FAILED" -eq 0 ]; then
  echo "成功的樣子：每一列都是 ✅（➖ 只是略過）。你這次就是這樣，登記完成。"
else
  echo "有 ❌：照該列「修法」處理後重跑本指令（已完成的別名會被沿用，不會重做）。"
fi
echo
echo "O5（每個別名第一次互動啟動）先預覽，確認命令列只帶別名、不帶 token："
echo "  node scripts/lane-reopen.js --alias $FIRST --cwd $ROOT --dry-run"
echo "  要真的開窗，請在 tmux 裡拿掉 --dry-run 再跑一次。"
echo "O10 回滾："
echo "  mv $ACC_DIR/registry.json $ACC_DIR/registry.json.off"

if [ "$FAILED" -ne 0 ]; then exit 1; fi
exit 0
