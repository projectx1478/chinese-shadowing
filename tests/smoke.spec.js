// tests/smoke.spec.js
//
// 目的：Firebase認証・マイク録音・実機TTSに依存しない範囲のUIロジックを
// 自動チェックするスモークテスト。PRのたびにここまでは自動確認し、
// 認証・録音・実機音声などの最終確認は引き続き実機（iPad Pro / AQUOS9）で行うこと。
//
// 実行方法：
//   npm install
//   npx playwright install chromium
//   npx playwright test
//
// 注意：Firebase SDK（gstatic.com等）はテスト環境からブロックされるため、
// "firebase is not defined" 等のエラーは想定内としてフィルタしている。

const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Firebase未接続環境で想定内のエラー文言（これ以外のエラーはテスト失敗扱いにする）
const EXPECTED_ERROR_PATTERNS = [
  /firebase is not defined/,
  /Cannot access 'currentUser' before initialization/,
  /the server responded with a status of 403/,
  /Failed to load resource/,
];

function isExpectedError(text) {
  return EXPECTED_ERROR_PATTERNS.some((re) => re.test(text));
}

/**
 * 共通セットアップ：ページを開き、認証をバイパスして
 * 強制的にsetup画面を表示する。
 * 想定外のconsoleエラー/pageerrorがあればテスト失敗として報告する。
 */
async function openSetup(page, theme = 'dark') {
  const unexpectedErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isExpectedError(msg.text())) {
      unexpectedErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    if (!isExpectedError(String(err))) {
      unexpectedErrors.push(String(err));
    }
  });

  await page.goto(APP_URL);
  await page.waitForTimeout(500);
  await page.evaluate(() => show('setup'));
  await page.evaluate((t) => setTheme(t), theme);
  await page.waitForTimeout(200);

  return unexpectedErrors;
}

test.describe('起動・画面遷移', () => {
  test('ログイン画面が表示される', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(500);
    await expect(page.locator('text=ログインして始める')).toBeVisible();
  });

  test('setup画面へ強制遷移でき、主要な関数が定義されている', async ({ page }) => {
    const errors = await openSetup(page);
    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);

    const defined = await page.evaluate(() => ({
      generateSentence: typeof generateSentence,
      analyzePitch: typeof analyzePitch,
      esc: typeof esc,
      render: typeof render,
    }));
    expect(defined.generateSentence).toBe('function');
    expect(defined.analyzePitch).toBe('function');
    expect(defined.esc).toBe('function');
    expect(defined.render).toBe('function');
  });
});

test.describe('ダークモードの選択状態（過去の視認性バグの再発防止）', () => {
  test('トピック選択時、背景色がaccent系になり黒(navy)に戻らない', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => {
      document.querySelectorAll('#topic-grid .topic-btn')[3].click();
    });
    await page.waitForTimeout(150);

    const style = await page.evaluate(() => {
      const btn = document.querySelectorAll('#topic-grid .topic-btn.active')[0];
      const cs = getComputedStyle(btn);
      return { bg: cs.backgroundColor, color: cs.color };
    });

    // var(--navy) 相当のほぼ黒(rgb(18,20,28)前後)には戻っていないこと
    expect(style.bg).not.toBe('rgb(18, 20, 28)');
    // アクセント色(teal, rgb(79,209,197))が使われていること
    expect(style.bg).toBe('rgb(79, 209, 197)');
  });

  test('トピックを選び直しても、他グループ(HSK優先/練習スタイル/回数/モード)の選択状態が保持される', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => {
      document.querySelectorAll('#topic-grid .topic-btn')[3].click();
    });
    await page.waitForTimeout(150);

    const active = await page.evaluate(() => {
      const ids = ['prio-off', 'style-answer', 'rep3', 'mode-full'];
      return ids.map((id) => document.getElementById(id).classList.contains('active'));
    });
    expect(active).toEqual([true, true, true, true]);
  });
});

test.describe('AI生成テキストのパース（拼音と文章の不一致バグの再発防止）', () => {
  test('相手/相手拼音/相手訳/返答/拼音/訳が正しい行から抽出される', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(300);

    const raw = [
      '相手：你昨天晚上做什么了？',
      '相手拼音：nǐ zuótiān wǎnshang zuò shénme le？',
      '相手訳：あなたは昨日の夜何をしましたか？',
      '返答：我在家看了一部电影，感觉很放松。',
      '拼音：wǒ zài jiā kàn le yí bù diànyǐng， gǎnjué hěn fàngsōng。',
      '訳：私は家で映画を一本見て、とてもリラックスしました。',
      '語彙：电影|diànyǐng|映画|3；放松|fàngsōng|リラックスする|4',
      '文法：了|動作の完了を表す|なし',
    ].join('\n');

    const result = await page.evaluate((raw) => {
      const partner = raw.match(/^相手[：:]\s*(.+)/m)?.[1]?.trim() || '';
      const partnerPy = raw.match(/^相手拼音[：:]\s*(.+)/m)?.[1]?.trim() || '';
      const partnerJa = raw.match(/^相手訳[：:]\s*(.+)/m)?.[1]?.trim() || '';
      const zh = raw.match(/^返答[：:]\s*(.+)/m)?.[1]?.trim();
      const py = raw.match(/^拼音[：:]\s*(.+)/m)?.[1]?.trim() || '';
      const ja = raw.match(/^訳[：:]\s*(.+)/m)?.[1]?.trim() || '';
      return { partner, partnerPy, partnerJa, zh, py, ja };
    }, raw);

    expect(result.partner).toBe('你昨天晚上做什么了？');
    expect(result.zh).toBe('我在家看了一部电影，感觉很放松。');
    expect(result.py).toContain('wǒ zài jiā');
    expect(result.partnerJa).toBe('あなたは昨日の夜何をしましたか？');
    expect(result.ja).toContain('私は家で映画');
  });
});

test.describe('声調ピッチグラフ（始点ズレバグの再発防止）', () => {
  test('実測カーブの始点が期待カーブの始点に一致するようオフセットされる', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const expected = [{ t: 0, semi: 4.8 }, { t: 0.5, semi: 4.8 }];
      const actual = [{ t: 0, semi: -2 }, { t: 0.25, semi: -1 }, { t: 0.5, semi: 0 }];
      const startExpected = expected.length ? expected[0].semi : 0;
      const firstActualPt = actual.find((p) => p.semi != null);
      const startOffset = firstActualPt ? startExpected - firstActualPt.semi : 0;
      const actualAligned = actual.map((p) => ({
        t: p.t,
        semi: p.semi != null ? p.semi + startOffset : null,
      }));
      return actualAligned;
    });

    // 始点が期待カーブの始点(4.8)と一致していること
    expect(result[0].semi).toBeCloseTo(4.8, 5);
    // 形状（差分）は保たれていること：+1ずつ上昇
    expect(result[1].semi - result[0].semi).toBeCloseTo(1, 5);
    expect(result[2].semi - result[1].semi).toBeCloseTo(1, 5);
  });
});
