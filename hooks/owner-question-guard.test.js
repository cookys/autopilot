'use strict';

// Synthetic paraphrases only. Real transcripts are operator-owned replay inputs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  assert.equal(offCli.stdout, '');
});

test('negative controls turn the closed-card, second-stop and reply-language assertions red', (t) => {
  const f = fixture(t);
  const sourcePath = require.resolve('./owner-question-guard');
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const [name, before, after] of [
    ['closed card must block', "return card && ['open', 'awaiting_operator_action'].includes(cardState(card.entry));", 'return true;'],
    ['second Stop must block again', 'function decide(input) {', 'function decide(input) {\n  if (input.stop_hook_active === true) return null;'],
    ['reply language zh-Hant blocks pure English reply', 'const LANGUAGE_MIN_CJK_RATIO = 0.60;', 'const LANGUAGE_MIN_CJK_RATIO = 0;'],
  ]) {
    assert.equal(source.split(before).length, 2, 'mutation anchor occurs once');
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
