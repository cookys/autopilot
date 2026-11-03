#!/usr/bin/env bash
# accounts-onboard.sh - G37 account onboarding: docs/guide/accounts.md steps O1-O9 as one interactive command.
#
#   scripts/accounts-onboard.sh <alias>...      one alias per Claude account, priority 10, 20, 30... in argument order
#   scripts/accounts-onboard.sh --help          print this usage and do nothing else
#
# Per alias, in order: (O1) create the 0700 directories; ask the operator to sign in and run `claude setup-token`
# in another pane (this script NEVER runs setup-token), then read the token silently with `read -rs` into
# <accounts-dir>/<alias>/token (0600); (O2) add the alias to registry.json (0600, written by Node, idempotent);
# (O4) `claude-account.js env-check --alias`; (O7) one haiku "say OK" call through `claude-account.js run`.
# After all aliases: status, pick --purpose operator-check, selftest --real-binary, selftest --simulate-429 <first>
# (needs two accounts), cooldown --clear <first>; then a summary table (every row marked, no secrets) plus the
# O5 lane-reopen command and the O10 rollback command. Exit 0 only when every row is OK; 1 on any failed row;
# 2 on usage errors.
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
#   ONBOARD_CLAUDE_BIN      TEST SEAM ONLY: absolute path of a claude stand-in. It is used as the program of the OK call
#                           and as `--binary` of the two selftests, nothing else. Unset = the real `claude`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/scripts/claude-account.js"

usage() {
  cat <<'USAGE'
用法：scripts/accounts-onboard.sh <別名>...
      scripts/accounts-onboard.sh --help

把 docs/guide/accounts.md 的 O1-O9 收成一個互動指令。每個別名對應一個 Claude 帳號，
優先序依參數順序給 10、20、30。

每個別名依序做：
  1. 建立 0700 目錄
  2. 請你在另一個窗格登入該帳號並執行 claude setup-token（本腳本絕不代跑），
     再把 token 貼進來（不顯示、不進命令列、不進 log）
  3. 寫入 registry.json（可重複執行，已存在就不動）
  4. env-check，再用 haiku 做一次 say OK 的真實呼叫
全部別名處理完後：status、pick、selftest --real-binary、selftest --simulate-429（需兩個帳號）、
cooldown --clear，最後印出總結表。

重複執行是安全的：token 檔已存在時問「沿用／覆蓋」，預設沿用。
某個別名的 token 壞掉會在該別名停下並點名，結束碼非 0。

環境變數：
  AUTOPILOT_ACCOUNTS_DIR  帳號目錄（預設 ~/.config/autopilot/accounts）
  ONBOARD_CLAUDE_BIN      僅供測試：指定替身 claude 的絕對路徑，只用在 OK 呼叫與兩個 selftest 的 --binary，
                          不開放其他行為；不設就用真的 claude。
USAGE
}

for a in "$@"; do
  case "$a" in -h|--help) usage; exit 0 ;; esac
done
if [ "$#" -eq 0 ]; then usage >&2; exit 2; fi

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
  const seen = new Set();
  args.forEach((a, i) => {
    const p = reg.aliasProblem(a);
    if (p) die(`第 ${i + 1} 個別名不合法（${p}）：小寫字母、數字、-，最多 24 字，且不能長得像 acct-/codex- 加 8 位十六進位`);
    if (seen.has(a)) die(`第 ${i + 1} 個別名重複`);
    seen.add(a);
  });
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

nodeh validate "$@" || exit 2
ACC_DIR="$(nodeh dir)" || exit 2

WORK=""
trap 'rm -rf "${WORK:-}"' EXIT
WORK="$(mktemp -d "${TMPDIR:-/tmp}/accounts-onboard.XXXXXX")" || exit 2
chmod 700 "$WORK"

cat <<EOF
帳號引導：共 $# 個帳號（$*）
帳號目錄：$ACC_DIR
腳本不會執行 claude setup-token，也不會把 token 印出來。
EOF

OK_ALIASES=()
STOPPED=""
idx=0
for alias in "$@"; do
  idx=$((idx + 1))
  echo
  echo "== 別名 $alias（第 $idx 個，優先序 $((idx * 10))） =="

  if ! nodeh prepare "$alias"; then
    row "❌" "$alias 目錄" "目錄建立或權限設定失敗"
    STOPPED="$alias"; break
  fi
  row "✅" "$alias 目錄" "已建立或確認為 0700"

  tf="$ACC_DIR/$alias/token"
  keep=0
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
請在另一個窗格登入別名 $alias 對應的 Claude 帳號，確認 claude auth status 顯示的是正確帳號，
然後執行 claude setup-token，把印出來的 token 貼到這裡（不會顯示）。
不想處理這個別名就輸入 skip。
EOF
    T=""
    got=0
    while :; do
      printf '請貼上 %s 的 token：' "$alias"
      if ! read -rs T; then
        echo
        echo "讀不到輸入，略過別名 $alias。"
        T=""; break
      fi
      echo
      if [ "$T" = "skip" ]; then T=""; break; fi
      if [ -z "$T" ]; then echo "空白輸入，請再貼一次（或輸入 skip）。"; continue; fi
      if [[ "$T" == *[[:space:]]* ]]; then echo "token 不可含空白，請再貼一次。"; continue; fi
      if [ "${#T}" -gt 4096 ]; then echo "token 超過 4096 位元組，請再貼一次。"; continue; fi
      got=1; break
    done
    if [ "$got" -eq 1 ]; then
      ( umask 077; printf '%s' "$T" > "$tf" ) # onboard:token-write
      chmod 600 "$tf"
      unset T
      row "✅" "$alias token" "已寫入 token 檔（0600）"
    else
      unset T
      row "❌" "$alias token" "你略過了這個別名，沒有 token，所以沒有登記"
      row "❌" "$alias env-check" "未執行（沒有 token）"
      row "❌" "$alias haiku OK 呼叫" "未執行（沒有 token）"
      echo "別名 $alias 已略過，繼續下一個。"
      continue
    fi
  fi

  if r="$(nodeh register "$alias" $((idx * 10)) 2>&1)"; then
    case "$r" in
      exists) row "✅" "$alias registry" "已在 registry 裡，未改動" ;;
      *) row "✅" "$alias registry" "已加入 registry（priority $((idx * 10))）" ;;
    esac
  else
    row "❌" "$alias registry" "registry 寫入失敗：$r"
    STOPPED="$alias"; break
  fi

  if envout="$(claude_account env-check --alias "$alias" 2>&1)"; then
    echo "$envout"
    row "✅" "$alias env-check" "目錄與 token 檔權限正確"
  else
    echo "$envout"
    echo "別名 $alias 的 env-check 失敗，停止整個流程（registry 會逐一檢查每個啟用的別名，繼續只會再次失敗並指向這個別名）。"
    row "❌" "$alias env-check" "別名 $alias 的 token 檔或目錄有問題，請修正後重跑"
    row "❌" "$alias haiku OK 呼叫" "未執行"
    STOPPED="$alias"; break
  fi

  okf="$WORK/ok-$idx.json"
  claude_account run --alias "$alias" --purpose operator-check --stdout "$okf" --stderr "$WORK/err-$idx.txt" -- \
    "$CLAUDE_PROG" -p "say OK" --model haiku --output-format json --tools "" --strict-mcp-config
  rc=$?
  if [ "$rc" -eq 0 ] && grep -Eq '"is_error": ?false' "$okf" 2>/dev/null; then
    echo "別名 $alias：haiku OK 呼叫成功。"
    row "✅" "$alias haiku OK 呼叫" "回應正常（is_error:false）"
    OK_ALIASES+=("$alias")
  else
    case "$rc" in
      6) why="認證被拒（401），別名 $alias 的 token 無效或已撤銷" ;;
      4) why="別名 $alias 被限流" ;;
      7) why="別名 $alias 的子行程把 token 印了出來，輸出已洗掉" ;;
      3) why="沒有可用的別名" ;;
      2) why="別名 $alias 的設定檢查失敗" ;;
      0) why="呼叫結束但回應不是 is_error:false" ;;
      *) why="呼叫失敗（結束碼 $rc）" ;;
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
  if claude_account status; then row "✅" "status" "registry 與別名狀態可讀"; else row "❌" "status" "status 失敗"; fi
  if claude_account pick --purpose operator-check; then row "✅" "pick" "挑選器有回答"; else row "❌" "pick" "pick 失敗"; fi
  if claude_account selftest --real-binary ${BIN_ARGS[@]+"${BIN_ARGS[@]}"}; then
    row "✅" "selftest --real-binary" "假 token 得 401，沒有退回你自己的登入"
  else
    row "❌" "selftest --real-binary" "沒通過，請看上面的 FAIL 行；若提示答案回來了，代表動到你自己的登入，請立刻回報"
  fi
  if [ "${#OK_ALIASES[@]}" -ge 2 ]; then
    sim_rc=0
    claude_account selftest --simulate-429 "$FIRST" ${BIN_ARGS[@]+"${BIN_ARGS[@]}"} || sim_rc=$?
    if [ "$sim_rc" -eq 0 ]; then row "✅" "selftest --simulate-429 $FIRST" "$FIRST 限流後改走下一個別名"; else row "❌" "selftest --simulate-429 $FIRST" "沒通過，請看上面的 FAIL 行"; fi
    if claude_account cooldown --clear "$FIRST"; then row "✅" "cooldown --clear $FIRST" "已解除冷卻"; else row "❌" "cooldown --clear $FIRST" "解除冷卻失敗"; fi
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
echo
echo "O5（每個別名第一次互動啟動）先預覽，確認命令列只帶別名、不帶 token："
echo "  node scripts/lane-reopen.js --alias $FIRST --cwd $ROOT --dry-run"
echo "  要真的開窗，請在 tmux 裡拿掉 --dry-run 再跑一次。"
echo "O10 回滾："
echo "  mv $ACC_DIR/registry.json $ACC_DIR/registry.json.off"

if [ "$FAILED" -ne 0 ]; then exit 1; fi
exit 0
