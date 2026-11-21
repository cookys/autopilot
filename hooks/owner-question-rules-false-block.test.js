'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const rules = require('./lib/owner-question-rules.js');

describe('owner-question-rules false-block regressions', () => {
  beforeEach(() => {
    rules.setFleetTaskLookup(() => null);
  });

  afterEach(() => {
    rules.setFleetTaskLookup(null);
  });

  describe('1. paragraph task id allows promise/question with due', () => {
    beforeEach(() => {
      rules.setFleetTaskLookup((id) => {
        if (id === '01M7ZV2YKAV1CEYW987P2FW3JE' || id === '01M7ZTYH8VD5TGQHC929KZZ6DA') {
          return { next_evidence_due: '2099-01-01T00:00:00Z' };
        }
        if (id === '01M7ZV2YKAV1CEYW987P2FW3JF') return { next_evidence_due: '-', hard_deadline: '' };
        return null;
      });
    });

    const passCases = [
      {
        name: 'PM seat false block: 跟我說一聲 with task id in same paragraph',
        text: '已派 01M7ZV2YKAV1CEYW987P2FW3JE。如果要讓 agy 跑別的模型，跟我說一聲。',
      },
      {
        name: 'PM seat false block: 到時我會提醒你 with task id in same paragraph',
        text: '換版單是 01M7ZTYH8VD5TGQHC929KZZ6DA。換好以後由 updater 回 sha16，到時我會提醒你。',
      },
      {
        name: 'bullet item with task id and promise',
        text: '- 任務 01M7ZV2YKAV1CEYW987P2FW3JE 已送出。完成後我會提醒你。',
      },
      {
        name: 'multi-line same paragraph with task id on first line',
        text: '已建立 01M7ZV2YKAV1CEYW987P2FW3JE。\n有需要調整再跟我說一聲。',
      },
    ];

    for (const tc of passCases) {
      it(`passes: ${tc.name}`, () => {
        const hits = rules.unresolvedHits(tc.text);
        assert.deepEqual(hits, []);
      });
    }

    const blockCases = [
      {
        name: 'task id without a due does not exempt a promise',
        text: '已派 01M7ZV2YKAV1CEYW987P2FW3JF。如果要讓 agy 跑別的模型，跟我說一聲。',
      },
      {
        name: 'unknown task id does not exempt a promise',
        text: '已派 01M7ZV2YKAV1CEYW987P2FW3JG。如果要讓 agy 跑別的模型，跟我說一聲。',
      },
      {
        name: 'operator question with no task id',
        text: '要選 A 還是 B？',
      },
      {
        name: 'explicit confirmation ask with no task id',
        text: '請你確認是否要合併這個分支。',
      },
      {
        name: 'bullet item without task id even when previous bullet has one',
        text: '- 任務 01M7ZV2YKAV1CEYW987P2FW3JE 已送出。\n- 要選 A 還是 B？',
      },
    ];

    for (const tc of blockCases) {
      it(`blocks: ${tc.name}`, () => {
        const hits = rules.unresolvedHits(tc.text);
        assert.ok(hits.length > 0, `expected hits for: ${tc.text}`);
      });
    }
  });

  describe('2. reply_language strips citations, model/version ids, env vars, flags, fleet addresses', () => {
    const passCases = [
      {
        name: 'markdown links and bare reference links',
        text: '已整理報告，參考 [Release Notes for v2.36.1](https://example.com/notes) 與 [Architecture Design Overview] 的說明。',
      },
      {
        name: 'model and version identifiers',
        text: '目前測試了 gpt-6.1-terra、claude-opus-5-5、v2.36.1 與 3.0.0-alpha.7，結果一致。',
      },
      {
        name: 'env vars and CLI flags',
        text: '請設定 AUTOPILOT_OWNER_QUESTION_GUARD 與 NODE_ENV，並加上 --dry-run 和 --max-turns 參數。',
      },
      {
        name: 'fleet address',
        text: '已通知 team/courier/pm--claude 處理後續流程。',
      },
    ];

    for (const tc of passCases) {
      it(`passes: ${tc.name}`, () => {
        const res = rules.languageCheck(tc.text);
        assert.equal(res, null);
      });
    }

    const blockCases = [
      {
        name: 'English prose reply',
        text: 'This is a regular English sentence explaining what happened in the repository today.',
      },
      {
        name: 'mostly English prose with brief Chinese prefix',
        text: '這個修正：We updated the configuration and verified that all existing unit tests pass without any issues.',
      },
    ];

    for (const tc of blockCases) {
      it(`blocks: ${tc.name}`, () => {
        const res = rules.languageCheck(tc.text);
        assert.ok(res && res.decision === 'block', `expected block for: ${tc.text}`);
      });
    }
  });

  describe('3. bare_card_id evaluates each card id only at its first occurrence', () => {
    const passCases = [
      {
        name: 'first occurrence has parenthesized subject, second is bare',
        text: '已開卡 d-12345678（週一手機重連 Wi-Fi），稍後請看 d-12345678。',
      },
      {
        name: 'first occurrence has quoted subject, second is bare',
        text: '請見「修復測試」d-abcdef01；之後討論 d-abcdef01 時會再補充。',
      },
      {
        name: 'first occurrence has title label, second is bare',
        text: '標題：部署確認 d-00112233\n另外 d-00112233 已經同步。',
      },
    ];

    for (const tc of passCases) {
      it(`passes: ${tc.name}`, () => {
        const bare = rules.unresolvedBareIds(tc.text);
        assert.deepEqual(bare, []);
      });
    }

    const blockCases = [
      {
        name: 'first occurrence is bare even if second has subject',
        text: '請看 d-12345678，稍後再確認 d-12345678（週一手機重連 Wi-Fi）。',
        expected: ['d-12345678'],
      },
      {
        name: 'single bare card id',
        text: '這裡有 d-deadbeef 需要處理。',
        expected: ['d-deadbeef'],
      },
    ];

    for (const tc of blockCases) {
      it(`blocks: ${tc.name}`, () => {
        const bare = rules.unresolvedBareIds(tc.text);
        assert.deepEqual(bare, tc.expected);
      });
    }
  });

  describe('4. paragraphHasTaskId requires a real fleet task with a due', () => {
    const DUE_ID = '01M7ZV2YKAV1CEYW987P2FW3JE';
    const NODUE_ID = '01M7ZV2YKAV1CEYW987P2FW3JF';

    it('passes when question is in one bullet and due task id is in the next line of the same paragraph; blocks for no-due id', (t) => {
      rules.setFleetTaskLookup((id) => {
        if (id === DUE_ID) return { next_evidence_due: '2099-01-01T00:00:00Z', hard_deadline: '-', state: 'open' };
        if (id === NODUE_ID) return { next_evidence_due: '-', hard_deadline: '-', state: 'open' };
        return null;
      });
      t.after(() => rules.setFleetTaskLookup(null));

      const withDue = `- 請你確認這項設定是否可行？\n  追在單 ${DUE_ID}`;
      assert.deepEqual(rules.unresolvedHits(withDue), []);

      const withNoDue = `- 請你確認這項設定是否可行？\n  追在單 ${NODUE_ID}`;
      assert.equal(rules.unresolvedHits(withNoDue).length, 1);
    });
  });
});
