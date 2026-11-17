# Inspect settings without printing values

The existing `depth0-delegate-gate` PreToolUse Bash guard checks every depth, including subagents. Its default-on `secret-print` rule denies Docker inspect dumps and Env/Config formats, Docker exec env/printenv, Compose config, bare env/printenv/set/export dumps, reads of sensitive filenames, Kubernetes secret YAML/JSON/template output or describe, and systemd unit/drop-in dumps. This includes `systemctl cat`, unfiltered `systemctl show`, `show` property lists containing `Environment` or `EnvironmentFiles`, and file-printing reads of `*.service.d/*` or `*/systemd/*/*.conf`. Ordinary status/restart commands, `show` restricted to safe properties, `cat x.service` outside a drop-in directory, and grep count/filename/quiet modes pass. No additional hook is registered.

The denial is one line, without the original command or its arguments:

```text
這個指令會印出秘密。要檢查設定，請用 safe-inspect（自動遮罩），或用 grep -c / -l 只看有沒有、在哪一行。整行指令一起判斷：同一行若也在建檔或寫檔，請把建檔和讀取拆成兩次執行。 (secret-print)
```

Use the shared viewer from the plugin checkout:

```sh
node scripts/safe-inspect.js docker web
node scripts/safe-inspect.js env
node scripts/safe-inspect.js file path/to/config
```

Docker mode runs `docker inspect -- <container>` directly without a shell. It masks every Env value and every other scalar, including password/passwd/secret/token/key/credential/DSN fields and URLs with userinfo. Environment mode masks every variable value. File mode supports JSON, KEY=VALUE/.env, YAML-like mappings and lists, PHP `define`/variable assignments and C `#define`. Keys and recognized structure remain; every scalar value is replaced. Unknown lines, comments and multiline bodies are masked as whole lines. File mode is a diagnostic display, not a config rewriter or a full language parser.

Masks use `***len=N sha8=xxxxxxxx`: N is the JavaScript string length of the value, and sha8 is the first eight hex digits of its SHA-256 over UTF-8. These show presence and change; the digest is deterministic and is not encryption. Empty values have length zero. JSON numbers, booleans and null are masked from their string representations. Docker failures, parse errors and file errors produce fixed diagnostics; raw child stdout/stderr and error messages are never forwarded. Docker inspection has a 15-second timeout and a 16 MiB output limit.

For presence or filenames, use `grep -c PASSWORD .env` or `grep -l DB_PASS -r config/`. The grep/rg/ugrep `-l`, `-L`, `-c`, `-q` modes (including combined flags) and equivalent long options pass. `-l` lists filenames and `-c` counts matching lines. `env FOO=1 node x.js`, `docker inspect -f '{{.State.Status}}' web`, ordinary files and SSH `.pub` files also pass. Docker formats that read Env or the whole Config/root are blocked; scalar formats such as `.Config.Image` pass.

To change this rule, set `depth0_delegate_gate.secret_print` in the operator config or `AUTOPILOT_BASH_GUARD_SECRET_MODE` in the hook's environment to `block` (default), `warn` or `off`. Nonempty env overrides config; invalid env values select `block`. The existing gate-wide mode `off` also disables this rule. [Settings reference](settings-reference.md).

Detection reuses the guard's executable-text, segment, token and prefix helpers, including pipelines, command lists, nested shell commands and command substitutions. It is a syntactic guard with the existing bounded expansion and fail-open error policy; computed paths/commands and code inside arbitrary programs are outside its scope.
