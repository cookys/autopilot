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
# Per profile, in order: (org) run `claude auth status --json` through the binary, show ONLY the org name and plan
# (never the e-mail), refuse an org another profile already has, ask the operator to confirm; (O1) create the 0700
# directories; ask the operator to run `claude setup-token` in another window (this script NEVER runs setup-token),
# then read the token silently with `read -rs` into <accounts-dir>/<name>/token (0600), and write the org record
# (org_id, org_label) into <accounts-dir>/<name>/token-meta.json (0600; never the e-mail); (O2) add the profile to
# registry.json (0600, written by Node, idempotent); (O4) `claude-account.js env-check --alias`; (O7) one haiku
# "say OK" call through `claude-account.js run`; if its result envelope carries an org id it is compared with the
# recorded one (mismatch = failed row), if not the org check is marked unverified (never blocks).
# `--org <name>=<label>` is the explicit confirmation for a profile whose auth status cannot be read or has no orgId:
# org_id is then recorded as unknown (null) and the label as given; the summary says so. Without it that case fails.
# After all profiles: status, pick --purpose operator-check, selftest --real-binary, selftest --simulate-429 <first>
# (needs two accounts), cooldown --clear <first>; then a summary table (every row marked, no secrets) plus the
# O5 lane-reopen command and the O10 rollback command. Exit 0 only when every row is OK; 1 on any failed row or a
# declined plan; 2 on usage errors.
#
# The registry row is added AFTER the token is written: a registry with an enabled alias that has no token makes
# every later check fail closed, so an alias the operator skips is simply not registered. A bad token (env-check or
# the OK call fails) stops the whole run at that alias, because the registry checks every enabled alias and each
# later step would only fail again naming that same alias; fix the token and re-run (existing aliases are reused).
#
# The token only ever lives in the shell variable T, read from stdin (a tty or a pipe) and written by the
# `printf` builtin; it is never in argv, a log, the screen or a temp file. Re-running with the same arguments is
# safe: registry bytes stay unchanged, and an existing token file is kept unless the operator chooses to overwrite.
#
# Environment:
#   AUTOPILOT_ACCOUNTS_DIR  accounts dir (default ~/.config/autopilot/accounts); also AUTOPILOT_LIVE_DIR / AUTOPILOT_STATE_DIR
#   ONBOARD_CLAUDE_BIN      TEST SEAM ONLY: absolute path of a claude stand-in. It is used as the program of the
#                           `auth status --json` call and the OK call, and as `--binary` of the two selftests,
#                           nothing else. Unset = the real `claude`.
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
  ① 你：在【另一個終端視窗】登入該 profile 要用的 Claude 帳號，需要的話切到對的 org。
     本指令會讀 claude auth status 並只顯示 org 名稱與方案（不顯示 email），請你確認。
     已有別的 profile 用了同一個 org 就會拒絕（避免同一份額度被算兩次）。
     成功的樣子：本視窗出現「目前登入的 org：名稱（方案：…）」，名稱對就輸入 y。
  ② 你：在【另一個終端視窗】執行 claude setup-token，複製它印出的那一長串 token。
     本指令絕不代跑 setup-token。成功的樣子：另一個視窗印出一長串 token。
  ③ 你：回到這個視窗貼上 token（不會顯示、不進命令列、不進記錄）。不想處理這個 profile 就輸入 skip。
     成功的樣子：本視窗出現「已收到 token（不顯示內容）」。
  ④ 本指令自動做：寫入 token 檔與 org 記錄、登記到 registry.json、檢查目錄與權限、
     用 haiku 做一次「say OK」的真實呼叫（會用到一點點額度）。成功的樣子：出現 ✅ 與該 profile 名稱。
  全部 profile 處理完後，再自動做 status、pick、兩個 selftest，最後印出總結表。成功的樣子：每一列都是 ✅。
  任何錯誤訊息都會寫「修法」；修好後重跑即可，已完成的 profile 會被沿用。

開始前
  先印出計畫並問你「繼續？[y/N]」，預設 N。直接按 Enter 或輸入 n 就結束，什麼都不會建立。
  在非互動環境（stdin 不是終端機）要加 --yes 才會繼續。

選項
  -h, --help             印出這段說明就結束，不建立任何東西。不帶任何參數時也是這樣（結束碼 2）。
  --yes                  跳過「繼續？」的詢問，直接開始。
  --org 名稱=org標籤     手動確認某個 profile 的 org。只在 claude auth status 讀不到、或沒有 orgId 時才需要：
                         這時 org 識別碼記為未知，標籤記成你給的字（不可含 @、不可像 email），
                         總結表會寫明「org 未驗證」。可重複給多個。例：--org team=Acme-Team

安全與重複執行
  重複執行是安全的：token 檔已存在時問「沿用／覆蓋」，預設沿用；已有 org 記錄就不再問 org。
  某個 profile 的 token 壞掉會在該 profile 停下並點名，結束碼非 0，修好後再跑一次即可。
  如果你的 org 名稱本身含 email，本指令不會顯示它，請改用 --org 給一個不含 email 的標籤。
  回滾：mv <帳號目錄>/registry.json <帳號目錄>/registry.json.off（跑完會印出完整指令）。

環境變數
  AUTOPILOT_ACCOUNTS_DIR  帳號目錄（預設 ~/.config/autopilot/accounts）
  ONBOARD_CLAUDE_BIN      僅供測試：指定替身 claude 的絕對路徑，只用在 auth status 與 OK 呼叫以及兩個 selftest
                          的 --binary，不開放其他行為；不設就用真的 claude。
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
    -*) echo "不認得的選項（用 --help 看用法）。" >&2; exit 2 ;;
    *) ALIASES+=("$a") ;;
  esac
done
if [ "$want_org" -eq 1 ]; then echo "--org 後面要接「名稱=org標籤」（例：--org team=Acme-Team）。" >&2; exit 2; fi
if [ "${#ALIASES[@]}" -eq 0 ]; then usage; exit 2; fi
set -- "${ALIASES[@]}"

BIN_ARGS=()
CLAUDE_PROG="claude"
if [ -n "${ONBOARD_CLAUDE_BIN:-}" ]; then
  case "$ONBOARD_CLAUDE_BIN" in /*) ;; *) echo "ONBOARD_CLAUDE_BIN 必須是絕對路徑" >&2; exit 2 ;; esac
  [ -x "$ONBOARD_CLAUDE_BIN" ] || { echo "ONBOARD_CLAUDE_BIN 不可執行" >&2; exit 2; }
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
  try { st = fs.lstatSync(p); } catch (e) { if (!e || e.code !== 'ENOENT') die('無法檢查目錄 ' + p); }
  if (!st) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  else if (st.isSymbolicLink() || !st.isDirectory()) die('不是一般目錄（或是符號連結）：' + p);
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
    if (seen.has(a)) die(`第 ${i + 1} 個名稱重複，沒有建立任何東西。`);
    seen.add(a);
  });
  const seenOrg = new Set();
  specs.forEach((sp, i) => {
    const eq = sp.indexOf('=');
    const al = eq < 0 ? '' : sp.slice(0, eq);
    const label = eq < 0 ? '' : sp.slice(eq + 1);
    if (!seen.has(al)) die(`第 ${i + 1} 個 --org 要寫成「名稱=org標籤」，且名稱必須是這次要登記的 profile 之一；沒有建立任何東西。`);
    if (seenOrg.has(al)) die(`第 ${i + 1} 個 --org 的 profile 重複，沒有建立任何東西。`);
    seenOrg.add(al);
    const lp = reg.orgLabelProblem(label);
    if (lp) die(`第 ${i + 1} 個 --org 的標籤不合法（${lp}）：1 到 64 字、不可含 @、不可像 email 或帳號資訊。請改用不含 email 的標籤，沒有建立任何東西。`);
  });
} else if (mode === 'authstatus') {
  // `claude auth status --json` through the given program. Prints: status line (ok|fail:<code>), orgId, org name
  // ('' when it is not printable-safe, e.g. it carries an e-mail), plan. The e-mail field is never read out.
  const r = require('child_process').spawnSync(args[0], ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 20 });
  const fail = (c) => { process.stdout.write(`fail:${c}\n`); process.exit(0); };
  if (r.error || r.status !== 0) fail('unreadable');
  let j;
  try { j = JSON.parse(r.stdout); } catch (e) { fail('not_json'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) fail('not_json');
  if (reg.orgIdProblem(j.orgId)) fail('no_org_id');
  const name = typeof j.orgName === 'string' && !reg.orgLabelProblem(j.orgName) ? j.orgName : '';
  const sub = typeof j.subscriptionType === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(j.subscriptionType) ? j.subscriptionType : '';
  process.stdout.write(`ok\n${j.orgId}\n${name}\n${sub}\n`);
} else if (mode === 'orgowner') {
  const o = reg.findOrgOwner(reg.accountsDir({}), args[1], args[0]);
  process.stdout.write((o || '') + '\n');
} else if (mode === 'hasorg') {
  const m = reg.readTokenMeta(reg.accountsDir({}), args[0], {});
  process.stdout.write(m && typeof m.org_label === 'string' ? 'yes\n' : 'no\n');
} else if (mode === 'metaset') {
  const [alias, id, label] = args;
  const lp = reg.orgLabelProblem(label);
  if (lp) die('org 標籤不合法：' + lp);
  if (id !== '-' && reg.orgIdProblem(id)) die('org 識別碼不合法');
  reg.writeTokenMeta(reg.accountsDir({}), alias, { org_id: id === '-' ? null : id, org_label: label, org_check: 'unverified' });
} else if (mode === 'orgcmp') {
  // Compare the result envelope's org id (if it carries one) with the recorded org_id; set org_check.
  const [alias, file] = args;
  const acc = reg.accountsDir({});
  const m = reg.readTokenMeta(acc, alias, {});
  let env = null;
  try { env = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* not a single JSON document */ }
  const seen = env && typeof env === 'object' ? [env.orgId, env.org_id, env.organization_id].find((v) => typeof v === 'string') : undefined;
  let verdict = 'unverified';
  if (seen !== undefined && m && typeof m.org_id === 'string') verdict = seen === m.org_id ? 'verified' : 'mismatch';
  if (m && verdict !== 'mismatch') reg.writeTokenMeta(acc, alias, { org_check: verdict });
  process.stdout.write(verdict + '\n');
} else if (mode === 'prepare') {
  const alias = args[0];
  const p = reg.aliasProblem(alias);
  if (p) die(`別名不合法（${p}）`);
  const acc = reg.accountsDir({});
  if (!process.env.AUTOPILOT_ACCOUNTS_DIR) secureDir(path.dirname(acc));
  secureDir(acc);
  for (const d of [alias, path.join(alias, 'claude'), path.join(alias, 'home')]) secureDir(path.join(acc, d));
} else if (mode === 'register') {
  const alias = args[0];
  const priority = Number(args[1]);
  if (reg.aliasProblem(alias)) die('別名不合法');
  const acc = reg.accountsDir({});
  let r;
  try { r = reg.loadRegistry({}); } catch (e) { die('registry 無法讀取：' + (e && e.message ? e.message : 'error')); }
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
else
  printf '繼續？[y/N] '
  go_ans=""
  read -r go_ans || go_ans=""
  echo
  case "$go_ans" in
    y|Y|yes|YES) ;;
    *)
      echo "已取消，沒有建立任何東西。要開始請輸入 y；在非互動環境請加 --yes。"
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

  # --- org: which organization is this profile? Decided before anything is written for it. ---------------------
  ORG_PENDING=0; ORG_ID="-"; ORG_LABEL=""; ORG_NOTE=""
  org_skip() { # <reason>: the profile is not registered
    row "❌" "$alias org" "$1"
    row "❌" "$alias token" "未處理（org 未確認），沒有登記"
    row "❌" "$alias env-check" "未執行"
    row "❌" "$alias haiku OK 呼叫" "未執行"
  }
  if [ "$(nodeh hasorg "$alias")" = "yes" ]; then
    row "✅" "$alias org" "沿用既有 org 記錄（token-meta.json）"
  else
    given="$(org_given "$alias")"
    if [ -n "$given" ]; then
      ORG_PENDING=1; ORG_ID="-"; ORG_LABEL="$given"
      echo "已用 --org 手動確認：$alias 的 org 標籤是「$given」（org 識別碼記為未知，不做重複 org 偵測）。"
      row "✅" "$alias org" "標籤「$given」（以 --org 手動確認；org 識別碼未知，org 未驗證）"
    else
      echo "步驟 ①（在【另一個終端視窗】做）：登入 $alias 要用的 Claude 帳號，需要的話切到對的 org。"
      echo "準備好後本視窗會讀 claude auth status，只顯示 org 名稱與方案（不顯示 email）。"
      echo "成功的樣子：下面出現「目前登入的 org：<名稱>（方案：…）」，名稱對就輸入 y 確認；不對就輸入 n，先在另一個視窗切換再重跑。"
      if ! aout="$(nodeh authstatus "$CLAUDE_PROG" 2>/dev/null)"; then aout="fail:unreadable"; fi
      { IFS= read -r ast; IFS= read -r oid; IFS= read -r oname; IFS= read -r osub; } <<< "$aout"
      if [ "$ast" != "ok" ]; then
        echo "讀不到 $alias 的 org：claude auth status --json 失敗、不是 JSON，或沒有 orgId（${ast#fail:}）。"
        echo "修法：先在另一個視窗登入該帳號後重跑；或你確定是哪個 org 時，加 --org $alias=<org 標籤> 重跑（org 識別碼會記為未知）。"
        org_skip "讀不到 org（${ast#fail:}），為避免登記錯誤的 org 已停止；修法：先登入再重跑，或加 --org $alias=<org 標籤>"
        continue
      fi
      owner="$(nodeh orgowner "$alias" "$oid" 2>/dev/null)"
      if [ -n "$owner" ]; then
        echo "這個 org 已經由 profile $owner 登記了；同一個 org 登記兩次會讓同一份額度被算兩次，所以拒絕，$alias 沒有建立任何東西。"
        echo "修法：在另一個視窗切到 $alias 真正要用的另一個 org 後重跑；如果其實不需要，就不要登記 $alias。"
        org_skip "org 已由 profile $owner 登記，拒絕重複登記；修法：切到另一個 org 後重跑"
        continue
      fi
      if [ -z "$oname" ]; then
        echo "目前登入的 org 名稱含帳號資訊或無法顯示，不予顯示。請改用 --org $alias=<org 標籤> 自訂一個標籤後重跑。"
        org_skip "org 名稱不可顯示（可能含 email）；修法：加 --org $alias=<org 標籤> 重跑"
        continue
      fi
      echo "目前登入的 org：$oname${osub:+（方案：$osub）}"
      printf '這是 profile %s 要用的 org 嗎？（對：輸入 y；不對：直接按 Enter）[y/N] ' "$alias"
      oc=""
      read -r oc || oc=""
      echo
      case "$oc" in
        y|Y|yes|YES) ;;
        *)
          echo "已略過 $alias。請在另一個視窗切到正確的帳號／org 後重跑本指令。"
          org_skip "你沒有確認 org，沒有登記；修法：切到正確的 org 後重跑"
          continue ;;
      esac
      ORG_PENDING=1; ORG_ID="$oid"; ORG_LABEL="$oname"
      row "✅" "$alias org" "$oname${osub:+（$osub）}，已由你確認"
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
        row "❌" "$alias token" "token 檔寫入失敗，未登記"
        row "❌" "$alias env-check" "未執行"
        row "❌" "$alias haiku OK 呼叫" "未執行"
        continue
      fi
      echo "步驟 ③ 完成 ✅ 已收到 token（不顯示內容），已寫入 $alias 的 token 檔。"
      row "✅" "$alias token" "已寫入 token 檔（0600）"
    else
      unset T
      row "❌" "$alias token" "你略過了這個別名，沒有 token，所以沒有登記；要登記請重跑並貼上 token"
      row "❌" "$alias env-check" "未執行（沒有 token）"
      row "❌" "$alias haiku OK 呼叫" "未執行（沒有 token）"
      echo "別名 $alias 已略過，繼續下一個。"
      continue
    fi
  fi

  if [ "$ORG_PENDING" -eq 1 ]; then
    if ! mr="$(nodeh metaset "$alias" "$ORG_ID" "$ORG_LABEL" 2>&1)"; then
      row "❌" "$alias org 記錄" "token-meta.json 寫入失敗：$mr；修法：檢查該別名目錄的權限，或移走既有的 token-meta.json 後重跑"
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

  okf="$WORK/ok-$idx.json"
  claude_account run --alias "$alias" --purpose operator-check --stdout "$okf" --stderr "$WORK/err-$idx.txt" -- \
    "$CLAUDE_PROG" -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config
  rc=$?
  if [ "$rc" -eq 0 ] && grep -Eq '"is_error": ?false' "$okf" 2>/dev/null; then
    echo "步驟 ④ 完成 ✅ 別名 $alias：haiku OK 呼叫成功。"
    row "✅" "$alias haiku OK 呼叫" "回應正常（is_error:false）"
    OK_ALIASES+=("$alias")
    case "$(nodeh orgcmp "$alias" "$okf" 2>/dev/null)" in
      verified) row "✅" "$alias org 核對" "OK 呼叫的回應帶有 org 識別碼，與記錄相符" ;;
      mismatch) row "❌" "$alias org 核對" "OK 呼叫的回應帶的 org 識別碼與記錄不同：這個 token 可能綁到別的 org，請重新 setup-token 並確認 org" ;;
      *) row "➖" "$alias org 核對" "org 未驗證：OK 呼叫的回應沒有 org 識別碼或記錄的識別碼未知（不影響通過）" ;;
    esac
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
    row "❌" "selftest --real-binary" "沒通過，請看上面的 FAIL 行；若提示答案回來了，代表動到你自己的登入，請立刻回報"
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
