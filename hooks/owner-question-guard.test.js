'use strict';
// Shared rules: hooks/lib/owner-question-rules.js.

// Synthetic paraphrases only. Real transcripts are operator-owned replay inputs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Diagnostics (reply-language.jsonl) land in a throwaway live dir, never the machine's real one.
const LIVE_DIR = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'owner-guard-live-'));
process.env.AUTOPILOT_LIVE_DIR = LIVE_DIR;
process.on('exit', () => fs.rmSync(LIVE_DIR, { recursive: true, force: true }));
const guard = require('./owner-question-guard');
const cards = require('../scripts/open-decision');

const TEST_GITCONFIG = path.join(__dirname, '..', 'scripts', 'lib', 'test-gitconfig');

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-guard-test-'));
  const modes = path.join(cwd, 'modes');
  const configFile = path.join(cwd, 'config.json');
  fs.mkdirSync(modes, { recursive: true });
  // Never let a pre-commit runner's Git environment redirect in-process or child fixture writes,
  // and never read the operator's real ~/.autopilot/config.json or ambient AUTOPILOT_REPLY_LANGUAGE.
  const savedGit = Object.entries(process.env).filter(([k]) => k.startsWith('GIT_'));
  const hadModeDir = Object.hasOwn(process.env, 'AUTOPILOT_SESSION_MODE_DIR');
  const savedModeDir = process.env.AUTOPILOT_SESSION_MODE_DIR;
  const hadCfgFile = Object.hasOwn(process.env, 'AUTOPILOT_CONFIG_FILE');
  const savedCfgFile = process.env.AUTOPILOT_CONFIG_FILE;
  const hadReplyLang = Object.hasOwn(process.env, 'AUTOPILOT_REPLY_LANGUAGE');
  const savedReplyLang = process.env.AUTOPILOT_REPLY_LANGUAGE;
  for (const [k] of savedGit) delete process.env[k];
  process.env.GIT_CONFIG_GLOBAL = TEST_GITCONFIG;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.AUTOPILOT_SESSION_MODE_DIR = modes;
  process.env.AUTOPILOT_CONFIG_FILE = configFile;
  delete process.env.AUTOPILOT_REPLY_LANGUAGE;
  t.after(() => {
    for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
    for (const [k, v] of savedGit) process.env[k] = v;
    if (hadModeDir) process.env.AUTOPILOT_SESSION_MODE_DIR = savedModeDir;
    else delete process.env.AUTOPILOT_SESSION_MODE_DIR;
    if (hadCfgFile) process.env.AUTOPILOT_CONFIG_FILE = savedCfgFile;
    else delete process.env.AUTOPILOT_CONFIG_FILE;
    if (hadReplyLang) process.env.AUTOPILOT_REPLY_LANGUAGE = savedReplyLang;
    else delete process.env.AUTOPILOT_REPLY_LANGUAGE;
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const env = { ...process.env };
  assert.equal(spawnSync('git', ['-C', cwd, 'init', '-q'], { env }).status, 0);
  const transcript_path = path.join(cwd, 'turn.jsonl');
  function check(text, extra = {}, before = []) {
    fs.writeFileSync(transcript_path, [...before, { type: 'assistant', message: { content: [{ type: 'text', text }] } }].map(JSON.stringify).join('\n'));
    return guard.decide({ cwd, transcript_path, session_id: 'synthetic', ...extra });
  }
  function card(status = 'open', root = null) {
    const c = cards.openDecision({ cwd, root, session: 'synthetic', question: 'Synthetic choice?', options: null });
    assert.equal(c.status, 'ok');
    if (status !== 'open') cards.patchDecision(c.file, c.id, () => ({ status }), { any: true });
    return c.id;
  }
  return { cwd, modes, configFile, env, transcript_path, check, card };
}

function withReplyLang(t, value) {
  const had = Object.hasOwn(process.env, 'AUTOPILOT_REPLY_LANGUAGE');
  const prev = process.env.AUTOPILOT_REPLY_LANGUAGE;
  if (value === undefined) delete process.env.AUTOPILOT_REPLY_LANGUAGE;
  else process.env.AUTOPILOT_REPLY_LANGUAGE = value;
  t.after(() => {
    if (had) process.env.AUTOPILOT_REPLY_LANGUAGE = prev;
    else delete process.env.AUTOPILOT_REPLY_LANGUAGE;
  });
}

const replayShapes = [
  ['dated login and reminder', '明天上午輪到你：輸入 `/login`，我會提醒你。'],
  ['promise after another report', '清單交齊後，我開一張卡，公開項目由你決定。'],
  ['visit checklist', '畫面還沒目視確認，已併進你下次到場的清單。'],
  ['card after review', '等最後一次審查結束，我會開一張卡，約一段維護時段。'],
  ['approval later and login wait', '上線前再開卡請你決定，另一項等你登入後再補。'],
  ['expiring login', '登入下週到期，到時需要你重新登入，我會提前開卡。'],
  ['one login after a test', '試驗結束後，登入工作介面一次就好。'],
  ['operator instructions', '要你本人處理，有空時照做：你自己執行指令。'],
];

for (const [name, text] of replayShapes) {
  test(`must block shape: ${name}`, (t) => {
    assert.ok(guard.findOwnerQuestion(text));
    assert.equal(fixture(t).check(text)?.decision, 'block');
  });
}

test('PM asks, operator imperatives and promises are detected', () => {
  for (const text of [
    '你覺得如何', '請你看結果', '跟我說一聲', '告訴我你選的版本', '你看要留哪份',
    '你希望換版就跟進', '你點頭後繼續', '你拍板', '請你回一個字',
    '要你本人登入', '你自己執行', '有空時照做', '輸入 /login', '下次到場確認',
    '登入介面一次', 'You run the command.', 'Please run the command.',
    '我會開卡', '會提前開卡', '到時開卡', '會提醒你', '併進維護清單', '明天再麻煩你',
    "I'll open a card.", "I'll remind you.",
  ]) assert.ok(guard.findOwnerQuestion(text), text);
});

test('status and quoted lane text pass', () => {
  for (const text of [
    '已完成更新，測試通過，沒有待決事項。',
    '不用你登入，沒有要你決定的事。',
    '狀態：已決定要不要重跑，答案是不用。',
    '另一位成員回報：\n> 請你確認，明天你自己執行。\n已記錄。',
    '另一位成員回報：\n「請你確認。\n我會開卡。」\n已記錄。',
    'The lane wrote:\n“Please run the check.\nI\'ll remind you.”\nRecorded.',
  ]) assert.equal(guard.findOwnerQuestion(text), null, text);
});

test('closed card must block', (t) => {
  const f = fixture(t);
  assert.equal(f.check(`Please confirm ${f.card('closed')}（合成待決）.`)?.decision, 'block');
});

test('only open and awaiting operator cards exempt their own sentence', (t) => {
  const f = fixture(t);
  const open = f.card(), awaiting = f.card('awaiting_operator_action', 'other-root');
  assert.equal(f.check(`Please confirm ${open}（合成待決）.`), null);
  assert.equal(f.check(`Please run the check ${awaiting}（合成待決）.`), null);
  assert.equal(f.check(`Please confirm ${open.toUpperCase()}（合成待決）.`), null);
  assert.equal(f.check(`Please confirm \`${open}\`.`), null);
  assert.equal(f.check(`Please confirm ${f.card('pending_dispatch')}（合成待決）.`)?.decision, 'block');
  assert.equal(f.check('Please confirm d-00000000（合成待決）.')?.decision, 'block');
  assert.equal(f.check('Please confirm d-12345678ffff.')?.decision, 'block');
  assert.equal(f.check(`Please confirm. Card ${open}（合成待決）.`)?.decision, 'block');
  assert.equal(f.check(`Please confirm ${open}（合成待決）. Please run the check.`)?.decision, 'block');
  assert.equal(f.check(`Please confirm ${open}（合成待決）.\nI'll remind you.`)?.decision, 'block');
  assert.equal(f.check(`已完成。\n待決卡：${open}（合成待決）、${awaiting}（合成待決）`), null);
});

test('one card opened for a different hit still blocks', (t) => {
  const f = fixture(t), id = f.card();
  const before = [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node scripts/open-decision.js open --category goal --question "Different choice"' } }] } }];
  assert.equal(f.check(`Please confirm ${id}（合成待決）.\nPlease run the check.`, {}, before)?.decision, 'block');
});

test('fleet exemption requires a task and explicit due date in the same sentence', (t) => {
  const f = fixture(t);
  for (const ref of [
    'fleet task create check --due 2027-02-01',
    '`fleet task create check --due 2027-02-01T08:00:00Z`',
    'task_id=task-abc123 due=2027-02-01',
  ]) assert.equal(f.check(`Please run the check (${ref}).`), null, ref);
  for (const fullSentence of [
    '你自己執行（fleet task create x --due 2027-02-01）。',
    '要不要現在處理，或照排程 fleet task create x --due 2027-02-01？',
    '你自己執行——fleet task create x --due 2027-02-01！',
    '你自己執行（fleet task create x --due 2027-02-01：已排程）。',
    '你自己執行（fleet task create x --due 2027-02-01、已排程）。',
    'Please run the check【fleet task create x --due 2027-02-01】。',
    'Please run the check [fleet task create x --due 2027-02-01].',
    'Should I wait, or use fleet task create x --due 2027-02-01?',
    'Please run the check via fleet task create x --due 2027-02-01!',
    'Please run the check (fleet task create x --due 2027-02-01: logged).',
  ]) {
    assert.ok(guard.findOwnerQuestion(fullSentence), fullSentence);
    assert.equal(f.check(fullSentence), null, fullSentence);
  }
  for (const ref of [
    'fleet task create check', 'fleet task create check --due',
    'fleet task create check --due someday', 'task_id=task-abc123',
    'due=2027-02-01', 'fleet task create check --due 2027-02-31',
  ]) assert.equal(f.check(`Please run the check (${ref}).`)?.decision, 'block', ref);
  assert.equal(f.check('Please run the check. fleet task create check --due 2027-02-01.')?.decision, 'block');
});

test('root-scoped session blocks unbound cards and points to close + reopen with --root-run-id', (t) => {
  const f = fixture(t);
  const unbound = f.card('open', null);
  assert.equal(f.check(`待決卡片 ${unbound}（合成待決），等你回覆。`), null);

  fs.writeFileSync(path.join(f.modes, 'synthetic.json'), JSON.stringify({
    session_id: 'synthetic',
    level: null,
    repo_root: f.cwd,
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    root_run_id: 'root-xyz',
  }));

  const out = f.check(`待決卡片 ${unbound}（合成待決），等你回覆。`);
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, new RegExp(`${unbound}.*未綁定`));
  assert.match(out.reason, new RegExp(`close --id ${unbound}`));
  assert.match(out.reason, /open --root-run-id root-xyz/);

  const statusOut = f.check(`已開立待決卡片 ${unbound}（合成待決）。`);
  assert.equal(statusOut?.decision, 'block');
  assert.match(statusOut.reason, new RegExp(`close --id ${unbound}`));
  assert.match(statusOut.reason, /open --root-run-id root-xyz/);

  assert.equal(f.check('已完成更新，測試通過，沒有待決事項。'), null);

  const bound = f.card('open', 'root-xyz');
  assert.equal(f.check(`待決卡片 ${bound}（合成待決），等你回覆。`), null);
});

test('hasLiveCard fails closed when cwd is not a git repo or card lookup throws', (t) => {
  const f = fixture(t);
  const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-guard-nongit-'));
  t.after(() => fs.rmSync(nonGit, { recursive: true, force: true }));
  const tp = path.join(nonGit, 'turn.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Please confirm d-00000000（合成待決）.' }] } }));
  assert.equal(guard.decide({ cwd: nonGit, transcript_path: tp, session_id: 'synthetic' })?.decision, 'block');

  const cli = spawnSync(process.execPath, [path.join(__dirname, 'owner-question-guard.js')], {
    input: JSON.stringify({ cwd: 123, transcript_path: tp, session_id: 'synthetic', stop_hook_active: false }),
    env: { ...f.env, AUTOPILOT_OWNER_QUESTION_GUARD: 'on', AUTOPILOT_SESSION_MODE_DIR: nonGit },
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0);
  assert.equal(cli.stderr, '');
  assert.equal(JSON.parse(cli.stdout).decision, 'block');

  const origFindCard = cards.findCard;
  t.after(() => { cards.findCard = origFindCard; });
  cards.findCard = () => { throw new Error('corrupt decision store'); };
  assert.equal(f.check('Please confirm d-00000000（合成待決）.')?.decision, 'block');
});

test('fixture strips ambient GIT_* so synthetic cards never land in an outer repo and restores env after', async (t) => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-guard-outer-'));
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  const initEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  initEnv.GIT_CONFIG_GLOBAL = TEST_GITCONFIG;
  initEnv.GIT_CONFIG_NOSYSTEM = '1';
  assert.equal(spawnSync('git', ['-C', outer, 'init', '-q'], { env: initEnv }).status, 0);
  const outerGitDir = path.join(outer, '.git');

  const hadGitDir = Object.hasOwn(process.env, 'GIT_DIR');
  const prevGitDir = process.env.GIT_DIR;
  const hadWorkTree = Object.hasOwn(process.env, 'GIT_WORK_TREE');
  const prevWorkTree = process.env.GIT_WORK_TREE;
  t.after(() => {
    if (hadGitDir) process.env.GIT_DIR = prevGitDir; else delete process.env.GIT_DIR;
    if (hadWorkTree) process.env.GIT_WORK_TREE = prevWorkTree; else delete process.env.GIT_WORK_TREE;
  });
  process.env.GIT_DIR = outerGitDir;
  process.env.GIT_WORK_TREE = outer;

  await t.test('isolated inner fixture', (sub) => {
    const f = fixture(sub);
    assert.equal(process.env.GIT_DIR, undefined);
    assert.equal(process.env.GIT_WORK_TREE, undefined);
    assert.equal(f.env.GIT_DIR, undefined);
    assert.equal(f.env.GIT_WORK_TREE, undefined);
    const id = f.card();
    assert.equal(f.check(`Please confirm ${id}（合成待決）.`), null);
    assert.equal(fs.existsSync(path.join(outerGitDir, 'autopilot')), false);
    assert.equal(fs.existsSync(path.join(f.cwd, '.git', 'autopilot', 'decisions')), true);
  });

  assert.equal(process.env.GIT_DIR, outerGitDir);
  assert.equal(process.env.GIT_WORK_TREE, outer);
});

test('second Stop must block again', (t) => {
  const f = fixture(t);
  assert.equal(f.check('Please confirm the choice.')?.decision, 'block');
  assert.equal(f.check('Please confirm the choice.', { stop_hook_active: true })?.decision, 'block');
});

test('false positive escape names each exact sentence and class with a reason', (t) => {
  const f = fixture(t);
  const one = 'Please run the example.';
  const two = "I'll remind you.";
  const marker = 'OWNER-GUARD-FALSE-POSITIVE [operator-step] Please run the example. :: documentation example';
  assert.equal(f.check(`${one}\n${marker}`, { stop_hook_active: true }), null);
  assert.equal(f.check(`${one}\n${two}\n${marker}`, { stop_hook_active: true })?.decision, 'block');
  assert.equal(f.check(`${one}\n${two}\n${marker}\nOWNER-GUARD-FALSE-POSITIVE [promise] I'll remind you. :: dialogue example`), null);
  for (const bad of [
    'OWNER-GUARD-FALSE-POSITIVE [operator-step] * :: everything',
    'OWNER-GUARD-FALSE-POSITIVE [question] Please run the example. :: wrong class',
    'OWNER-GUARD-FALSE-POSITIVE [operator-step] Please run the example. :: ',
    '> ' + marker, '```\n' + marker + '\n```',
    '另一位成員回報：\n「' + marker + '」',
    Array(9).fill(marker).join('\n'),
  ]) assert.equal(f.check(`${one}\n${bad}`, { stop_hook_active: true })?.decision, 'block', bad);
});

test('malformed escape prefixes cannot hide instructions; multiline lane quotes pass', (t) => {
  const f = fixture(t);
  assert.equal(f.check('OWNER-GUARD-FALSE-POSITIVE Please run the check.')?.decision, 'block');
  assert.equal(f.check('OWNER-GUARD-FALSE-POSITIVE [wrong] Please run the check. :: excuse')?.decision, 'block');
  assert.equal(f.check('The lane wrote:\n"Please run the check.\nI will remind you."\nRecorded.'), null);
});

test('bare card ids need a plain-language subject', (t) => {
  const f = fixture(t);
  const bare = '卡片狀態：d-47602dd8 開著；d-25817f3a、d-eb29b32b 已答待步驟。d-1428cdd6 我決定 B 收掉。';
  const out = f.check(bare);
  assert.equal(out?.decision, 'block');
  for (const id of ['d-47602dd8', 'd-25817f3a', 'd-eb29b32b', 'd-1428cdd6']) {
    assert.match(out.reason, new RegExp(id));
  }
  assert.match(out.reason, /d-47602dd8（週一手機重連 Wi-Fi）/);
  assert.equal(f.check('d-47602dd8（週一手機重連 Wi-Fi）開著'), null);
  assert.equal(f.check('d-47602dd8 (週一手機重連 Wi-Fi) 開著'), null);
  assert.equal(f.check('「週一手機重連」d-47602dd8 開著'), null);
  assert.equal(f.check('標題：d-47602dd8 開著'), null);
  assert.equal(f.check('見 `d-47602dd8`。'), null);
  assert.equal(f.check('見\n```\nd-47602dd8\n```\n。'), null);
  assert.equal(f.check('他寫「d-47602dd8 開著」。'), null);
  assert.equal(f.check('d-47602dd8 開著。\nOWNER-GUARD-FALSE-POSITIVE [bare_card_id] d-47602dd8 :: 範例編號'), null);
  const team = require('../scripts/lib/team.js');
  const origResolve = team.resolve;
  team.resolve = () => ({ role: 'lane', source: 'test', pm: null });
  t.after(() => { team.resolve = origResolve; });
  const laneBare = f.check('d-47602dd8 開著。');
  assert.equal(laneBare?.decision, 'block');
  assert.match(laneBare.reason, /d-47602dd8（週一手機重連 Wi-Fi）/);
  assert.doesNotMatch(laneBare.reason, /request-decision\.js/);
  assert.equal(f.check('可以強制刪嗎？見待決 d-4290499d（合成待決）。'), null);
  const prev = process.env.AUTOPILOT_BARE_CARD_ID_LINT;
  process.env.AUTOPILOT_BARE_CARD_ID_LINT = 'off';
  t.after(() => {
    if (prev === undefined) delete process.env.AUTOPILOT_BARE_CARD_ID_LINT;
    else process.env.AUTOPILOT_BARE_CARD_ID_LINT = prev;
  });
  assert.equal(f.check(bare), null);
});

test('reply language zh-Hant blocks pure English reply', (t) => {
  const f = fixture(t);
  withReplyLang(t, 'zh-Hant');
  const out = f.check('All unit tests passed on the branch. I merged the changes and cleaned up the temporary worktree.');
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /回覆要用正體中文（技術名詞和 id 可保留原文）；請改寫。/);
  assert.match(out.reason, /0%/);
});

test('reply language zh-Hant passes Chinese reply with technical terms, sha, card id, ULID, paths, URLs and inline code', (t) => {
  const f = fixture(t);
  withReplyLang(t, 'zh-Hant');
  const text = '合併到 develop 了，sha 是 1a2b3c4d5，`node --test` 全綠，檔案在 hooks/owner-question-guard.js。'
    + '任務 01M7PP2GHDTXVJ1EJQFMCWPZHE、請求 r-abcdef01 與卡片 d-47602dd8（週一手機重連 Wi-Fi）都已更新狀態，參考 https://example.com/docs/guide/overview 與 docs.example.com/status/check。'
    + '「這段引述的正體中文說明也會算進中文字數裡面」，設定檔 config-keys.json 與整體測試結果全部通過。';
  assert.equal(guard.languageCheck(text), null);
  assert.equal(f.check(text), null);
  assert.equal(f.check('「這整段正體中文雖然放在引號裡面，但仍然算是回覆給操作員的正體中文內容。」'), null);
});

test('reply language zh-Hant blocks Simplified Chinese reply and names Traditional replacements', (t) => {
  const f = fixture(t);
  withReplyLang(t, 'zh-Hant');
  const out = f.check('这个问题应该已经修好了，档案在这里。');
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /回覆要用正體中文（技術名詞和 id 可保留原文）；請改寫。/);
  assert.match(out.reason, /这→這/);
  assert.match(out.reason, /档→檔|应→應/);
  const many = guard.languageCheck('这个问题应该已经修好了，档案在这里，测试没有错误。');
  assert.equal(many?.decision, 'block');
  assert.equal(many.simplified.length, 5);
});

test('reply language zh-Hant does not block fenced-code-only or short replies', (t) => {
  const f = fixture(t);
  withReplyLang(t, 'zh-Hant');
  const codeOnly = '```js\nfunction verifyEverythingWorksProperly() {\n  // 这是一个测试注释 with English prose inside code\n  return "All checks passed without errors";\n}\n```';
  assert.equal(f.check(codeOnly), null);
  assert.equal(f.check('go'), null);
});

test('reply language check is opt-in, env beats config, combines with question blocks, and respects hook opt-out', (t) => {
  const f = fixture(t);
  withReplyLang(t, undefined);
  const english = 'All unit tests passed on the branch. I merged the changes and cleaned up the temporary worktree.';
  assert.equal(f.check(english), null);
  fs.writeFileSync(f.configFile, JSON.stringify({}));
  assert.equal(f.check(english), null);

  fs.writeFileSync(f.configFile, JSON.stringify({ reply_language: 'zh-Hant' }));
  assert.equal(f.check(english)?.decision, 'block');

  fs.writeFileSync(f.configFile, JSON.stringify({ reply_language: 'en' }));
  assert.equal(f.check(english), null);

  fs.writeFileSync(f.configFile, JSON.stringify({ reply_language: 'zh-Hant' }));
  process.env.AUTOPILOT_REPLY_LANGUAGE = 'off';
  assert.equal(f.check(english), null);

  fs.writeFileSync(f.configFile, JSON.stringify({ reply_language: 'off' }));
  process.env.AUTOPILOT_REPLY_LANGUAGE = 'zh-Hant';
  assert.equal(f.check(english)?.decision, 'block');

  const both = f.check('All checks finished on the branch. Should I merge these changes into develop now?');
  assert.equal(both?.decision, 'block');
  assert.ok(both.reason.startsWith('回覆要用正體中文（技術名詞和 id 可保留原文）；請改寫。'));
  assert.match(both.reason, /open-decision\.js/);

  const hookPath = path.join(__dirname, 'owner-question-guard.js');
  const payload = JSON.stringify({ cwd: f.cwd, transcript_path: f.transcript_path, session_id: 'synthetic', stop_hook_active: false });
  const activeCli = spawnSync(process.execPath, [hookPath], {
    input: payload,
    env: { ...f.env, AUTOPILOT_OWNER_QUESTION_GUARD: 'on', AUTOPILOT_REPLY_LANGUAGE: 'zh-Hant' },
    encoding: 'utf8',
  });
  assert.equal(activeCli.status, 0);
  assert.equal(JSON.parse(activeCli.stdout).decision, 'block');

  const offCli = spawnSync(process.execPath, [hookPath], {
    input: payload,
    env: { ...f.env, AUTOPILOT_OWNER_QUESTION_GUARD: 'off', AUTOPILOT_REPLY_LANGUAGE: 'zh-Hant' },
    encoding: 'utf8',
  });
  assert.equal(offCli.status, 0);
  // owner_question_guard off silences the question guard only: reply_language has its own switch (a live seat with the
  // guard off never had its English replies checked).
  const offOut = JSON.parse(offCli.stdout);
  assert.equal(offOut.decision, 'block');
  assert.ok(offOut.reason.startsWith('回覆要用正體中文'));
  assert.doesNotMatch(offOut.reason, /open-decision\.js/);

  const bothOff = spawnSync(process.execPath, [hookPath], {
    input: payload,
    env: { ...f.env, AUTOPILOT_OWNER_QUESTION_GUARD: 'off', AUTOPILOT_REPLY_LANGUAGE: 'off' },
    encoding: 'utf8',
  });
  assert.equal(bothOff.status, 0);
  assert.equal(bothOff.stdout, '');
});

test('reply language waits for a final reply that reaches the transcript after Stop fires, and logs a content-free line', (t) => {
  const f = fixture(t);
  withReplyLang(t, 'zh-Hant');
  const user = { type: 'user', message: { role: 'user', content: '<channel source="fleet">status?</channel>' } };
  const english = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All unit tests passed on the branch. I merged the changes and cleaned up the temporary worktree.' }] } };
  fs.writeFileSync(f.transcript_path, `${JSON.stringify(user)}\n${JSON.stringify({ type: 'attachment' })}\n`);
  // Claude Code writes the final reply line after Stop fires: a worker appends it 300 ms into the hook's read.
  const { Worker } = require('node:worker_threads');
  const w = new Worker(`const fs=require('fs');const {workerData:d}=require('worker_threads');setTimeout(()=>fs.appendFileSync(d.tp,d.line),300);`, { eval: true, workerData: { tp: f.transcript_path, line: `${JSON.stringify(english)}\n` } });
  t.after(() => w.terminate());
  const out = guard.decide({ cwd: f.cwd, transcript_path: f.transcript_path, session_id: 'synthetic-late' }, { guardOn: false });
  assert.equal(out?.decision, 'block');
  const logged = fs.readFileSync(path.join(LIVE_DIR, 'reply-language.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const last = logged[logged.length - 1];
  assert.equal(last.session, 'synthetic-late');
  assert.equal(last.outcome, 'block');
  assert.ok(last.waited_ms > 0);
  assert.ok(!JSON.stringify(logged).includes('unit tests'), 'the log never carries reply text');
});

test('--replay-language prints per-reply verdicts and numbers, never the reply text', (t) => {
  const f = fixture(t);
  const rows = [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '已完成合併，套件全綠，接著處理下一件工作。' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'All unit tests passed on the branch. I merged the changes and cleaned up the temporary worktree.' }] } },
  ];
  fs.writeFileSync(f.transcript_path, rows.map(JSON.stringify).join('\n'));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'owner-question-guard.js'), '--replay-language', f.transcript_path, '2'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.map((x) => x.verdict), ['block', 'pass']);
  assert.ok(!r.stdout.includes('unit tests') && !r.stdout.includes('合併'));
});

test('reply-precheck flags owner asks, bare card ids, and passes a compliant reply', (t) => {
  const f = fixture(t);
  const pre = path.join(__dirname, '..', 'scripts', 'reply-precheck.js');
  function run(text, extraArgs = []) {
    const file = path.join(f.cwd, 'draft.txt');
    fs.writeFileSync(file, text);
    return spawnSync(process.execPath, [pre, '--file', file, '--json', ...extraArgs], {
      encoding: 'utf8',
      cwd: f.cwd,
      env: f.env,
    });
  }
  const ask = run('請你決定要不要合併。');
  assert.equal(ask.status, 1);
  const askJson = JSON.parse(ask.stdout);
  assert.equal(askJson.ok, false);
  assert.ok(askJson.problems.some((p) => p.sentence.includes('請你決定要不要合併') && /卡/.test(p.fix)));
  const login = run('最後要請你登入一次。');
  assert.equal(login.status, 1);
  assert.ok(JSON.parse(login.stdout).problems.some((p) => p.sentence.includes('最後要請你登入一次')));
  const bare = run('卡號 d-1a2b3c4d');
  assert.equal(bare.status, 1);
  assert.ok(JSON.parse(bare.stdout).problems.some((p) => p.rule === 'bare_card_id' && p.sentence.toLowerCase() === 'd-1a2b3c4d'));
  const live = f.card();
  const ok = run(`已完成合併，沒有要你決定的事。見 ${live}（合併）。`);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(ok.stdout.trim(), JSON.stringify({ ok: true, problems: [] }));
  const plain = spawnSync(process.execPath, [pre, '--file', path.join(f.cwd, 'draft.txt')], {
    encoding: 'utf8', cwd: f.cwd, env: f.env,
  });
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout, 'ok\n');
});

test('precheck agrees with the hook on existing single-reply fixtures', (t) => {
  const f = fixture(t);
  const pre = path.join(__dirname, '..', 'scripts', 'reply-precheck.js');
  const sh = fs.readFileSync(path.join(__dirname, 'tests', 'owner-question-guard.test.sh'), 'utf8');
  const texts = new Set();
  for (const m of sh.matchAll(/^mk \w+ (?:'([^']*)'|"([^"]*)")/gm)) texts.add(m[1] ?? m[2]);
  for (const text of [
    'Please confirm the choice.',
    '已完成更新，測試通過，沒有待決事項。',
    'd-47602dd8 開著。',
    'd-47602dd8（週一手機重連 Wi-Fi）開著',
    ...replayShapes.map(([, s]) => s),
  ]) texts.add(text);
  assert.ok(texts.size >= 15);
  for (const text of texts) {
    fs.writeFileSync(f.transcript_path, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
    const hook = guard.decide({ cwd: f.cwd, transcript_path: f.transcript_path, session_id: 'synthetic' });
    const file = path.join(f.cwd, 'draft.txt');
    fs.writeFileSync(file, text);
    const cli = spawnSync(process.execPath, [pre, '--file', file, '--json', '--session', 'synthetic'], {
      encoding: 'utf8', cwd: f.cwd, env: f.env,
    });
    const body = JSON.parse(cli.stdout);
    const hookBlock = hook?.decision === 'block';
    assert.equal(body.ok, !hookBlock, text);
    assert.equal(cli.status, hookBlock ? 1 : 0, text);
    if (hookBlock) {
      assert.ok(body.problems.length > 0, text);
      assert.match(hook.reason, /只送一則短更正|回覆要用正體中文/);
    }
  }
});

test('short correction naming a card passes; the same text as a fresh owner question blocks', (t) => {
  const f = fixture(t);
  const blocked = '請你決定要不要合併。';
  const corr = '請你決定要不要合併，卡號 d-1a2b3c4d（合併）。';
  assert.ok(corr.length <= 400);
  assert.equal(f.check(corr)?.decision, 'block');
  const paired = f.check(corr, {}, [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: blocked }] } },
  ]);
  assert.equal(paired, null);
  const freshAsk = '最後要請你登入一次。';
  assert.equal(f.check(freshAsk)?.decision, 'block');
  assert.equal(f.check(freshAsk, {}, [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: blocked }] } },
  ])?.decision, 'block');
});

test('a single-problem block reason stays under 600 chars and omits the full open usage', (t) => {
  const f = fixture(t);
  const out = f.check('請你決定要不要合併。');
  assert.equal(out?.decision, 'block');
  assert.ok(out.reason.length < 600, String(out.reason.length));
  assert.match(out.reason, /請你決定要不要合併/);
  assert.match(out.reason, /只送一則短更正（補上缺的卡號／task id／改寫那一句），不要整則重寫。/);
  assert.match(out.reason, /node scripts\/open-decision\.js open --category <c> --executor <addr> --question <q> --option A::<desc> --option B::<desc> --recommendation A --why <r> --not-authorized <b>/);
  assert.doesNotMatch(out.reason, /沒帶或不在其中 exit 7/);
  assert.doesNotMatch(out.reason, /\[待決回覆\]/);
  assert.doesNotMatch(out.reason, /resolve-doa/);
  assert.equal(out.reason.split('\n').filter((l) => l.includes('node scripts/open-decision.js open --category')).length, 1);
});

test('negative controls turn the closed-card, second-stop and reply-language assertions red', (t) => {
  const f = fixture(t);
  const guardPath = require.resolve('./owner-question-guard');
  const rulesPath = require.resolve('./lib/owner-question-rules');
  for (const [name, before, after] of [
    ['closed card must block', "return card && ['open', 'awaiting_operator_action'].includes(cardState(card.entry));", 'return true;'],
    ['second Stop must block again', 'function decide(input, opts = {}) {', 'function decide(input, opts = {}) {\n  if (input.stop_hook_active === true) return null;'],
    ['reply language waits for a final reply that reaches the transcript after Stop fires, and logs a content-free line', 'const READ_SETTLE_MS = 2000;', 'const READ_SETTLE_MS = 0;'],
    ['reply language zh-Hant blocks pure English reply', 'const LANGUAGE_MIN_CJK_RATIO = 0.60;', 'const LANGUAGE_MIN_CJK_RATIO = 0;'],
  ]) {
    const guardSource = fs.readFileSync(guardPath, 'utf8');
    const rulesSource = fs.readFileSync(rulesPath, 'utf8');
    const sourcePath = guardSource.includes(before) ? guardPath : rulesPath;
    const source = sourcePath === guardPath ? guardSource : rulesSource;
    assert.equal(source.split(before).length, 2, `mutation anchor occurs once (${name})`);
    const preload = path.join(f.cwd, 'mutant.cjs');
    // Change only this module in a child; production source is never overwritten.
    fs.writeFileSync(preload, `const Module=require('node:module'); const load=Module._extensions['.js'];
Module._extensions['.js']=(m,file)=>file===${JSON.stringify(sourcePath)}
  ? m._compile(${JSON.stringify(source.replace(before, after))},file) : load(m,file);\n`);
    const env = { ...f.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--require', preload, '--test', '--test-name-pattern', `^${name}$`, __filename], { encoding: 'utf8', env });
    assert.equal(r.status, 1, `${name}: mutant must fail\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, new RegExp(name));
    assert.match(r.stdout, /(?:fail 1|# fail 1)/);
    t.diagnostic(`negative control: ${name}: exit ${r.status}; restored source assertion passes in this suite`);
  }
});
