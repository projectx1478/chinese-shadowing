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

test.describe('ミニマルペア聞き分け（8-3、mode-minimal）', () => {
  test('練習モードで選択でき、開始するとstep-barが空になりS.mpがセットされる', async ({ page }) => {
    const errors = await openSetup(page, 'light');
    await page.evaluate(() => setMode('minimal'));
    const modeActive = await page.evaluate(() => document.getElementById('mode-minimal').classList.contains('active'));
    expect(modeActive).toBe(true);

    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => ({
      practiceMode: S.practiceMode,
      phase: S.phase,
      mpQuestionCount: S.mp?.questions?.length,
      stepBarEmpty: document.getElementById('step-bar').innerHTML.trim() === '',
    }));
    expect(state.practiceMode).toBe('minimal');
    expect(state.phase).toBe('minimal');
    expect(state.mpQuestionCount).toBe(10);
    expect(state.stepBarEmpty).toBe(true);

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('正解/不正解の判定とカテゴリ別統計の集計が正しく行われる', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => setMode('minimal'));
    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    // 実機TTSの再生完了を待たず、テスト用に再生完了状態へ直接遷移させる
    await page.evaluate(() => { S.isSpeaking = false; render(); });

    const targetSide = await page.evaluate(() => S.mp.questions[S.mp.index].targetSide);
    const category = await page.evaluate(() => S.mp.questions[S.mp.index].pair.category);
    await page.evaluate((side) => answerMinimalPair(side), targetSide);
    await page.waitForTimeout(100);

    const afterCorrect = await page.evaluate((cat) => ({
      lastCorrect: S.mp.lastCorrect,
      correctCount: S.mp.correctCount,
      statTotal: S.minimalPairStats[cat]?.total,
      statCorrect: S.minimalPairStats[cat]?.correct,
    }), category);
    expect(afterCorrect.lastCorrect).toBe(true);
    expect(afterCorrect.correctCount).toBe(1);
    expect(afterCorrect.statTotal).toBe(1);
    expect(afterCorrect.statCorrect).toBe(1);

    // 1.1秒後に次の問題へ自動的に進む
    await page.waitForTimeout(1200);
    const afterAdvance = await page.evaluate(() => ({ index: S.mp.index, answered: S.mp.answered }));
    expect(afterAdvance.index).toBe(1);
    expect(afterAdvance.answered).toBe(false);
  });

  test('ミニマルペア中はArrowRightショートカットがgenerateSentence()を呼ばない（誤って通常フローに進まない）', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => setMode('minimal'));
    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);

    await page.exposeFunction('__markCalled', () => {});
    let called = false;
    page.on('console', (msg) => { if (msg.text() === '__generateSentenceCalled__') called = true; });
    await page.evaluate(() => {
      window.__origGenerateSentence = generateSentence;
      generateSentence = async function (...args) {
        console.log('__generateSentenceCalled__');
        return window.__origGenerateSentence.apply(this, args);
      };
    });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    expect(called).toBe(false);
    const state = await page.evaluate(() => ({ practiceMode: S.practiceMode, phase: S.phase }));
    expect(state).toEqual({ practiceMode: 'minimal', phase: 'minimal' });
  });
});

test.describe('穴埋めディクテーション（8-1、mode-fillblank）', () => {
  test('generateSentence()応答の「穴埋め」タグが正しい位置・内容でパースされる', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const zh = '我今天要把作业写完了。';
      const blankRaw = '把|bǎ|把構文の虚詞で弱化しやすい；了|le|軽声で聞き取りにくい';
      const candidates = blankRaw.split(/[；;]/).map((s) => s.trim()).filter(Boolean).map((s) => {
        const [word, py2, note] = s.split('|').map((x) => x?.trim());
        if (!word) return null;
        const index = zh.indexOf(word);
        if (index < 0) return null;
        return { index, answer: word, hint: py2 || '', note: note || '' };
      }).filter(Boolean).sort((a, b) => a.index - b.index);
      return candidates.reduce((acc, b) => {
        const end = b.index + b.answer.length;
        const overlap = acc.some((x) => !(end <= x.index || b.index >= x.index + x.answer.length));
        if (!overlap) acc.push(b);
        return acc;
      }, []).slice(0, 3);
    });

    expect(result).toEqual([
      { index: 4, answer: '把', hint: 'bǎ', note: '把構文の虚詞で弱化しやすい' },
      { index: 9, answer: '了', hint: 'le', note: '軽声で聞き取りにくい' },
    ]);
  });

  test('練習モードで選択でき、fillblankフェーズでは全文が隠れ空欄のみ表示される（テキスト漏洩の再発防止）', async ({ page }) => {
    const errors = await openSetup(page, 'light');
    await page.evaluate(() => setMode('fillblank'));
    const modeActive = await page.evaluate(() => document.getElementById('mode-fillblank').classList.contains('active'));
    expect(modeActive).toBe(true);

    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = {
        zh: '我今天要把作业写完了。', py: '', ja: '', partner: '', vocab: [], grammar: [],
        blanks: [
          { index: 4, answer: '把', hint: 'bǎ', note: '' },
          { index: 9, answer: '了', hint: 'le', note: '' },
        ],
      };
      S.fillInputs = []; S.fillResult = null;
      setPhase('fillblank');
      render();
    });
    await page.waitForTimeout(100);

    const hanziText = await page.evaluate(() => document.querySelector('.hanzi')?.textContent);
    // 空欄部分（把・了）が実際の文字ではなく＿に置き換わっており、それ以外の文字はそのまま表示される
    expect(hanziText).toBe('我今天要＿作业写完＿。');
    expect(hanziText).not.toContain('把');
    expect(hanziText.includes('了')).toBe(false);

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('採点：完全一致は正解、声調記号を除いた拼音一致は部分点、それ以外は不正解になる', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => setMode('fillblank'));
    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = {
        zh: '我今天要把作业写完了。', py: '', ja: '', partner: '', vocab: [], grammar: [],
        blanks: [
          { index: 4, answer: '把', hint: 'bǎ', note: '' },
          { index: 9, answer: '了', hint: 'le', note: '' },
          { index: 10, answer: '。', hint: '', note: '' },
        ],
      };
      S.fillInputs = []; S.fillResult = null;
      setPhase('fillblank');
      render();
    });
    await page.waitForTimeout(100);

    await page.fill('#fill-input-0', '把'); // 完全一致
    await page.fill('#fill-input-1', 'le'); // 拼音一致（声調なし）
    await page.fill('#fill-input-2', '吗'); // 不正解
    await page.evaluate(() => submitFillBlank());
    await page.waitForTimeout(100);

    const fr = await page.evaluate(() => S.fillResult);
    expect(fr.results[0]).toMatchObject({ correct: true, partial: false });
    expect(fr.results[1]).toMatchObject({ correct: false, partial: true });
    expect(fr.results[2]).toMatchObject({ correct: false, partial: false });
    expect(fr.correctCount).toBe(1.5);
    expect(fr.total).toBe(3);
  });
});

test.describe('音声のみ内容理解クイズ（8-2、mode-quiz）', () => {
  test('練習モードで選択でき、quizフェーズでは全文が非表示（テキスト漏洩の再発防止）', async ({ page }) => {
    const errors = await openSetup(page, 'light');
    await page.evaluate(() => setMode('quiz'));
    const modeActive = await page.evaluate(() => document.getElementById('mode-quiz').classList.contains('active'));
    expect(modeActive).toBe(true);

    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = {
        zh: '我昨天在家看了一部电影。', py: '', ja: '', partner: '你昨天做什么了？', partnerJa: '',
        vocab: [], grammar: [],
        quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], answerIndex: 1, explanation: '' }],
      };
      S.quizPlayCount = 1; S.quizAnswers = []; S.quizResult = null;
      setPhase('quiz');
      render();
    });
    await page.waitForTimeout(100);

    const hanziEl = await page.evaluate(() => document.querySelector('.hanzi'));
    expect(hanziEl).toBeNull();
    const bodyText = await page.evaluate(() => document.getElementById('practice-body').textContent);
    expect(bodyText).not.toContain('我昨天在家看了一部电影');
    expect(bodyText).not.toContain('你昨天做什么了');

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('採点：正解/不正解が正しく判定され、再生回数の上限（2回）に達すると再生ボタンが無効化される', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => setMode('quiz'));
    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = {
        zh: '我昨天在家看了一部电影。', py: '', ja: '', partner: '', vocab: [], grammar: [],
        quiz: [
          { question: 'Q1', options: ['A', 'B', 'C', 'D'], answerIndex: 1, explanation: '' },
          { question: 'Q2', options: ['A', 'B', 'C', 'D'], answerIndex: 2, explanation: '' },
        ],
      };
      S.quizPlayCount = 1; S.quizAnswers = [1, 0]; S.quizResult = null; // Q1正解・Q2不正解を選択済み
      setPhase('quiz');
      render();
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => submitQuiz());
    await page.waitForTimeout(100);

    const qr = await page.evaluate(() => S.quizResult);
    expect(qr.results[0].correct).toBe(true);
    expect(qr.results[1].correct).toBe(false);
    expect(qr.correctCount).toBe(1);
    expect(qr.total).toBe(2);

    await page.evaluate(() => { S.quizPlayCount = 2; S.quizResult = null; S.quizAnswers = []; render(); });
    await page.waitForTimeout(100);
    const playBtnDisabled = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('音声を再生'));
      return btn ? btn.disabled : null;
    });
    expect(playBtnDisabled).toBe(true);
  });

  test('quizフェーズ中はSpaceショートカットが効かない（再生回数上限のバイパス防止）', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => setMode('quiz'));
    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = { zh: '我昨天在家看了一部电影。', py: '', ja: '', partner: '', vocab: [], grammar: [], quiz: [] };
      S.quizPlayCount = 2; S.isSpeaking = false;
      setPhase('quiz');
      render();
    });
    await page.waitForTimeout(100);

    let speakCalled = false;
    await page.evaluate(() => {
      window.__origSpeak = speak;
      speak = async function (...args) { window.__speakCalled = true; return window.__origSpeak.apply(this, args); };
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    speakCalled = await page.evaluate(() => !!window.__speakCalled);
    expect(speakCalled).toBe(false);
  });
});
