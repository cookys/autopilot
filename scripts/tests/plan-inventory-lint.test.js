'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { lintPlanPhases } = require('../check-plan-phases');
const { isMechanismPlan, lintPlanInventory } = require('../lib/plan-inventory-lint');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'plan-tracking-resume-v3.md');
const CHECK_SCRIPT = path.join(__dirname, '..', 'check-plan-phases.js');

function runCheckCli(markdown) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-inv-lint-'));
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-inv-home-'));
  const planFile = path.join(tmpDir, 'plan.md');
  fs.writeFileSync(planFile, markdown, 'utf8');
  try {
    return spawnSync(process.execPath, [CHECK_SCRIPT, planFile], {
      encoding: 'utf8',
      env: { ...process.env, HOME: sandboxHome },
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  }
}

describe('plan-inventory-lint', () => {
  it('1. 第三版 fixture 應放行（exit 0）', () => {
    const v3 = fs.readFileSync(FIXTURE_PATH, 'utf8');
    assert.equal(isMechanismPlan(v3), true);
    const res = runCheckCli(v3);
    assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  });

  it('2. 刪掉「既有計畫盤點」整節（§3）應被擋，訊息含「既有計畫盤點」', () => {
    const v3 = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const withoutInventory = v3.replace(
      /## 3\. 既有計畫盤點[\s\S]*?(?=## 4\. 架構)/,
      ''
    );
    assert.notEqual(withoutInventory, v3);
    const res = runCheckCli(withoutInventory);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /既有計畫盤點/);
  });

  it('3. 非機制的一般功能計畫（例如「加一個 CSV 匯出按鈕」）應放行', () => {
    const featurePlan = `# 加一個 CSV 匯出按鈕

- 目標：在報表頁面右上角加一個 CSV 匯出按鈕，點選後下載當頁資料。

## 1. 實作步驟
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S | - | node --test tests/csv.test.js | no | 實作 CSV 匯出按鈕 |
<!-- /phases -->
`;
    assert.equal(isMechanismPlan(featurePlan), false);
    const res = runCheckCli(featurePlan);
    assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  });

  it('4. 該節存在但缺一項（拿掉「要退役的零件」）應被擋，訊息指出那一項', () => {
    const v3 = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const missingRetired = v3
      .replace(/10 項答應退役但還在/, '10 項待處理')
      .replace(/答應的退役沒做/, '答應的整理沒做');
    const res = runCheckCli(missingRetired);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /要退役的零件/);
  });

  it('5. 負控制：isMechanismPlan 強制回傳 false 時，案例 2 不會報錯', () => {
    const v3 = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const withoutInventory = v3.replace(
      /## 3\. 既有計畫盤點[\s\S]*?(?=## 4\. 架構)/,
      ''
    );
    const normalErrors = lintPlanPhases(withoutInventory);
    assert.ok(normalErrors.some((e) => e.includes('既有計畫盤點')));

    const negControlErrors = lintPlanInventory(withoutInventory, {
      isMechanismPlan: () => false,
    });
    assert.deepEqual(negControlErrors, []);
  });
});
