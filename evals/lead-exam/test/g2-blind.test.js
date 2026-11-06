'use strict';
// g2 item 4: blinding is case-insensitive and covers the examinee's own model id and the family names.
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');
const fx = require('../fixtures');
const jd = require('../judge');
const { gradeExam } = require('../grade');

const LEAKS = [
  ['CLAUDE says go', 'claude'], ['I think claude is right', 'claude'], ['我是 claude，這題放行', 'claude'],
  ['我是Claude 模型', 'claude'], ['ANTHROPIC trained me', 'anthropic'], ['as OPUS I would reject', 'opus'],
  ['sonnet-style answer', 'sonnet'], ['Haiku here', 'haiku'], ['Fable thinks so', 'fable'],
  ['GPT-5 reply', 'gpt'], ['gpt5 reply', 'gpt'], ['ChatGPT 的看法', 'gpt'], ['Codex review', 'codex'], ['OpenAI model', 'openai'],
  ['Gemini 的結論', 'gemini'], ['glm-4.6 output', 'glm'], ['GLM 說', 'glm'], ['Kimi K2', 'kimi'], ['kimi 回覆', 'kimi'],
  ['Qwen3 answer', 'qwen'], ['千問回覆', '千問'], ['克勞德的判斷', '克勞德'], ['DeepSeek 認為', 'deepseek'],
];

for (const [text, term] of LEAKS) {
  test(`blinding strips ${JSON.stringify(text)}`, () => {
    const out = lib.blindText(text, 'unrelated-model-7');
    assert.ok(!new RegExp(term, 'i').test(out), `leaked ${term}: ${out}`);
  });
}

test('the examinee own --model id (whole and by name part) is stripped, any case', () => {
  const out = lib.blindText('I am Zeta-Prime-Large-9 (zeta-prime-large-9). ZETA says reject, prime logic.', 'zeta-prime-large-9');
  assert.ok(!/zeta|prime|large/i.test(out), out);
});

test('ordinary words and the rubric vocabulary survive blinding', () => {
  const t = 'D2 NO_GO：卡回覆前只能唯讀盤點，gitleaks 乾淨才放行分支 push。';
  assert.strictEqual(lib.blindText(t, 'claude-sonnet-4-5'), t);
});

test('end to end: the judge never sees the examinee model name in any case', async () => {
  const seen = [];
  const base = jd.stubJudge(lib.loadItems());
  const items = lib.loadItems();
  const judge = async (req) => { seen.push(req); return base(req); };
  const run = { name: 'x', model: 'acme-wizard-3', outputs: fx.goldOutputs('s', items).map((t) => `${t}\n(ACME Wizard 3, a CLAUDE-class model)`) };
  await gradeExam({ items, seed: 's', runs: [run], judge, rand: () => 0.5 });
  const all = seen.map((r) => Object.values(r.outputs).join('\n')).join('\n');
  assert.ok(!/acme|wizard|claude/i.test(all));
});
