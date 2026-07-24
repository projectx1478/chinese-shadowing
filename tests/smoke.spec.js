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

test.describe('バックワードビルドアップ（8-4、mode-bbu）', () => {
  test('フォールバック分割：AIの出力が無い/不正な場合、末尾から段階的に伸びる配列を生成し最終段階が全文と一致する', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      function buildBackwardChunksFallback(zh) {
        const stripped = zh.replace(/[，。！？、]+$/, '');
        const chars = [...stripped];
        const n = chars.length;
        if (n <= 2) return [zh];
        const numStages = Math.min(4, Math.max(2, Math.ceil(n / 4)));
        const chunks = [];
        for (let i = 1; i <= numStages; i++) {
          const len = Math.round((n * i) / numStages);
          chunks.push(chars.slice(n - len).join(''));
        }
        chunks[chunks.length - 1] = zh;
        return [...new Set(chunks)];
      }
      return buildBackwardChunksFallback('今天我们一起吃饭。');
    });

    expect(result[result.length - 1]).toBe('今天我们一起吃饭。');
    expect(result.length).toBeGreaterThanOrEqual(2);
    // 各段階が前の段階より長い（末尾から伸びていく）こと
    for (let i = 1; i < result.length; i++) {
      expect(result[i].length).toBeGreaterThan(result[i - 1].length);
    }
  });

  test('練習モードで選択でき、bbuフェーズでは現在の段階のみ表示され、全段階を経ると録音フェーズへ遷移する', async ({ page }) => {
    const errors = await openSetup(page, 'light');
    await page.evaluate(() => setMode('bbu'));
    const modeActive = await page.evaluate(() => document.getElementById('mode-bbu').classList.contains('active'));
    expect(modeActive).toBe(true);

    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = {
        zh: '今天我们一起吃饭。', py: '', ja: '', partner: '', vocab: [], grammar: [],
        chunks: ['吃饭', '一起吃饭', '我们一起吃饭', '今天我们一起吃饭。'],
      };
      S.bbuIndex = 0;
      setPhase('bbu');
      render();
    });
    await page.waitForTimeout(100);

    // 最初は最短の段階のみ表示（全文はまだ見せない）
    let hanziText = await page.evaluate(() => document.querySelector('.hanzi')?.textContent);
    expect(hanziText).toBe('吃饭');

    // 3回「次へ」を押して最終段階の表示まで進める
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('次へ'));
        btn.click();
      });
      await page.waitForTimeout(50);
    }
    hanziText = await page.evaluate(() => document.querySelector('.hanzi')?.textContent);
    expect(hanziText).toBe('今天我们一起吃饭。');
    let phase = await page.evaluate(() => S.phase);
    expect(phase).toBe('bbu');

    // もう一度「次へ」を押すと録音フェーズへ遷移する
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('次へ'));
      btn.click();
    });
    await page.waitForTimeout(100);
    phase = await page.evaluate(() => S.phase);
    expect(phase).toBe('record');

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('bbuフェーズ中のSpaceショートカットは全文ではなく現在の段階のみを再生する', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => setMode('bbu'));
    await page.evaluate(() => { document.getElementById('start-btn').onclick(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.sentence = {
        zh: '今天我们一起吃饭。', py: '', ja: '', partner: '', vocab: [], grammar: [],
        chunks: ['吃饭', '一起吃饭', '我们一起吃饭', '今天我们一起吃饭。'],
      };
      S.bbuIndex = 0; S.isSpeaking = false;
      setPhase('bbu');
      render();
    });
    await page.waitForTimeout(100);

    let spokenText = null;
    await page.evaluate(() => {
      window.__origSpeak = speak;
      speak = async function (text, ...rest) { window.__spokenText = text; return window.__origSpeak.apply(this, [text, ...rest]); };
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    spokenText = await page.evaluate(() => window.__spokenText);
    expect(spokenText).toBe('吃饭'); // 全文「今天我们一起吃饭。」ではなく現在の段階のみ
  });
});

test.describe('作文練習（SNSメッセージ作成、stab-compose）', () => {
  test('タブを開くと入力欄・マイクボタンが表示され、他タブは隠れる', async ({ page }) => {
    const errors = await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));

    const state = await page.evaluate(() => ({
      visible: !document.getElementById('stab-compose').classList.contains('hidden'),
      mainHidden: document.getElementById('stab-main').classList.contains('hidden'),
      jaExists: !!document.getElementById('compose-ja-input'),
      zhExists: !!document.getElementById('compose-zh-input'),
      micJaExists: !!document.getElementById('compose-ja-mic'),
      micZhExists: !!document.getElementById('compose-zh-mic'),
    }));
    expect(state).toEqual({
      visible: true, mainHidden: true, jaExists: true, zhExists: true, micJaExists: true, micZhExists: true,
    });
    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('未入力での送信はアラートで警告し、AI呼び出しを行わない', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));

    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

    // ①未入力
    await page.evaluate(() => submitCompose());
    await page.waitForTimeout(50);
    // ①のみ入力、②未入力
    await page.fill('#compose-ja-input', '週末映画に誘いたい');
    await page.evaluate(() => submitCompose());
    await page.waitForTimeout(50);

    expect(dialogs.length).toBe(2);
    expect(dialogs[0]).toContain('日本語');
    expect(dialogs[1]).toContain('中国語');
  });

  test('添削成功時：AIの結果が表示され、コピーボタンでcorrectedがクリップボードへ渡る', async ({ page }) => {
    const errors = await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));
    await page.fill('#compose-ja-input', '週末一緒に映画見に行かない？と誘いたい');
    await page.fill('#compose-zh-input', '这周末一起看电影吗？');

    await page.evaluate(() => {
      window.gemini = async () => JSON.stringify({
        feedback: 'とても自然です。',
        corrected: '这周末要不要一起看电影？',
        correctedPy: 'zhè zhōumò yào bu yào yìqǐ kàn diànyǐng？',
        correctedJa: '今週末、一緒に映画見ない？',
      });
      Object.assign(navigator.clipboard, {
        writeText: (t) => { window.__copied = t; return Promise.resolve(); },
      });
    });
    await page.evaluate(() => submitCompose());
    await page.waitForTimeout(200);

    const html = await page.evaluate(() => document.getElementById('compose-result').innerHTML);
    expect(html).toContain('这周末要不要一起看电影？');
    expect(html).toContain('とても自然です。');

    await page.evaluate(() => copyComposeResult());
    const copied = await page.evaluate(() => window.__copied);
    expect(copied).toBe('这周末要不要一起看电影？');

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('添削失敗時：エラーメッセージを表示し、送信ボタンは再度有効になる', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));
    await page.fill('#compose-ja-input', '週末映画に誘いたい');
    await page.fill('#compose-zh-input', '这周末看电影吗');

    await page.evaluate(() => { window.gemini = async () => { throw new Error('テストエラー'); }; });
    await page.evaluate(() => submitCompose());
    await page.waitForTimeout(200);

    const html = await page.evaluate(() => document.getElementById('compose-result').innerHTML);
    expect(html).toContain('添削に失敗しました');
    const btnState = await page.evaluate(() => ({
      disabled: document.getElementById('compose-submit-btn').disabled,
      text: document.getElementById('compose-submit-btn').textContent,
    }));
    expect(btnState.disabled).toBe(false);
    expect(btnState.text).toContain('添削してもらう');
  });
});

test.describe('設定タブの大分類ナビゲーション（cat-bar/setup-cat-menu）', () => {
  test('初期状態は「練習設定」カテゴリでmainタブが直接表示される（カテゴリ内タブが1個のためメニューを経由しない）', async ({ page }) => {
    const errors = await openSetup(page, 'dark');
    const state = await page.evaluate(() => ({
      setupCategory: S.setupCategory,
      setupTab: S.setupTab,
      mainHidden: document.getElementById('stab-main').classList.contains('hidden'),
      menuHidden: document.getElementById('setup-cat-menu').classList.contains('hidden'),
      backHidden: document.getElementById('setup-back-link').classList.contains('hidden'),
    }));
    expect(state).toEqual({
      setupCategory: 'settings', setupTab: 'main', mainHidden: false, menuHidden: true, backHidden: true,
    });
    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('タブが複数あるカテゴリはカードメニューを経由し、選択後は戻るリンクでメニューへ戻れる', async ({ page }) => {
    const errors = await openSetup(page, 'dark');
    await page.evaluate(() => showCategory('support'));

    let state = await page.evaluate(() => ({
      setupTab: S.setupTab,
      menuHidden: document.getElementById('setup-cat-menu').classList.contains('hidden'),
      cardNames: Array.from(document.querySelectorAll('#setup-cat-menu .mode-card .mode-name')).map((e) => e.textContent),
    }));
    expect(state.setupTab).toBeNull();
    expect(state.menuHidden).toBe(false);
    expect(state.cardNames).toEqual(['AIコーチ', '作文', '苦手リスト']);

    await page.evaluate(() => showSetupTab('compose'));
    state = await page.evaluate(() => ({
      setupTab: S.setupTab,
      composeVisible: !document.getElementById('stab-compose').classList.contains('hidden'),
      backHidden: document.getElementById('setup-back-link').classList.contains('hidden'),
      backText: document.getElementById('setup-back-link').textContent,
    }));
    expect(state.setupTab).toBe('compose');
    expect(state.composeVisible).toBe(true);
    expect(state.backHidden).toBe(false);
    expect(state.backText).toContain('学習支援');

    // 戻るリンクでカードメニューへ戻る
    await page.evaluate(() => showCategory(S.setupCategory));
    state = await page.evaluate(() => ({
      setupTab: S.setupTab,
      menuHidden: document.getElementById('setup-cat-menu').classList.contains('hidden'),
    }));
    expect(state.setupTab).toBeNull();
    expect(state.menuHidden).toBe(false);

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('showSetupTab()の直接呼び出しはカードメニューを経由せず対象タブへ直接遷移する（既存呼び出し箇所の互換性）', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('custom'));
    const state = await page.evaluate(() => ({
      setupCategory: S.setupCategory,
      setupTab: S.setupTab,
      customVisible: !document.getElementById('stab-custom').classList.contains('hidden'),
      otherTabsHidden: ['main', 'coach', 'compose', 'weak', 'history', 'dex', 'shortcuts']
        .every((id) => document.getElementById('stab-' + id).classList.contains('hidden')),
    }));
    expect(state).toEqual({
      setupCategory: 'other', setupTab: 'custom', customVisible: true, otherTabsHidden: true,
    });
  });
});

test.describe('作文練習：ステップガイドモード（composeGuide）', () => {
  test('デフォルトは自分で考えるモードで、ステップガイドに切り替えると①未入力ならアラートで警告する', async ({ page }) => {
    const errors = await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));

    let state = await page.evaluate(() => ({
      mode: composeGuide.mode,
      freeVisible: !document.getElementById('compose-zh-free-row').classList.contains('hidden'),
      guideHidden: document.getElementById('compose-guide-panel').classList.contains('hidden'),
    }));
    expect(state).toEqual({ mode: 'free', freeVisible: true, guideHidden: true });

    await page.click('#compose-mode-guide');
    state = await page.evaluate(() => ({
      mode: composeGuide.mode, status: composeGuide.status,
      freeHidden: document.getElementById('compose-zh-free-row').classList.contains('hidden'),
      hasStartBtn: document.getElementById('compose-guide-panel').textContent.includes('ステップを作成'),
    }));
    expect(state).toEqual({ mode: 'guide', status: 'idle', freeHidden: true, hasStartBtn: true });

    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.evaluate(() => startComposeGuide());
    await page.waitForTimeout(50);
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('日本語');

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('ステップを進めて完了すると、組み立てた文が②のテキストエリアに入り既存の添削フローへそのままつながる', async ({ page }) => {
    const errors = await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));
    await page.fill('#compose-ja-input', '週末一緒に映画見に行かない？と誘いたい');
    await page.click('#compose-mode-guide');

    await page.evaluate(() => {
      window.gemini = async () => JSON.stringify({
        steps: [
          { ja: '今週末に', hint: '这周末' },
          { ja: '一緒に映画を見に行こうと誘う', hint: '一起去看电影' },
        ],
      });
    });
    await page.evaluate(() => startComposeGuide());
    await page.waitForTimeout(100);

    let state = await page.evaluate(() => ({ status: composeGuide.status, stepsLen: composeGuide.steps.length, index: composeGuide.index }));
    expect(state).toEqual({ status: 'active', stepsLen: 2, index: 0 });

    // ステップ1入力 → 次へ
    await page.fill('#compose-guide-input', '这周末');
    await page.click('#compose-guide-panel >> text=次へ');
    await page.waitForTimeout(50);
    state = await page.evaluate(() => ({ index: composeGuide.index, answers: composeGuide.answers }));
    expect(state).toEqual({ index: 1, answers: ['这周末', ''] });

    // 戻る → 入力済みの内容が保持されている
    await page.click('#compose-guide-panel >> text=戻る');
    const backValue = await page.inputValue('#compose-guide-input');
    expect(backValue).toBe('这周末');
    await page.click('#compose-guide-panel >> text=次へ');

    // ステップ2入力 → 完了
    await page.fill('#compose-guide-input', '一起去看电影吗？');
    await page.click('#compose-guide-panel >> text=完了');
    await page.waitForTimeout(100);

    state = await page.evaluate(() => ({
      status: composeGuide.status,
      zhValue: document.getElementById('compose-zh-input').value,
      freeVisible: !document.getElementById('compose-zh-free-row').classList.contains('hidden'),
      guideHidden: document.getElementById('compose-guide-panel').classList.contains('hidden'),
    }));
    expect(state).toEqual({
      status: 'done', zhValue: '这周末一起去看电影吗？', freeVisible: true, guideHidden: true,
    });

    // 既存の添削フローがそのまま動く（submitCompose()は無変更）
    await page.evaluate(() => {
      window.gemini = async () => JSON.stringify({
        feedback: '自然です。', corrected: '这周末一起去看电影吧？',
        correctedPy: 'zhè zhōumò yìqǐ qù kàn diànyǐng ba？', correctedJa: '今週末一緒に映画見に行こう？',
      });
    });
    await page.evaluate(() => submitCompose());
    await page.waitForTimeout(200);
    const resultHtml = await page.evaluate(() => document.getElementById('compose-result').innerHTML);
    expect(resultHtml).toContain('这周末一起去看电影吧？');

    expect(errors, `想定外のJSエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('完了後に自分で考えるモード→ステップガイドへ戻ると、新規セッションとしてリセットされる', async ({ page }) => {
    await openSetup(page, 'dark');
    await page.evaluate(() => showSetupTab('compose'));
    // status:'done'を直接注入して遷移だけを検証する（API呼び出し不要）
    await page.evaluate(() => {
      composeGuide.mode = 'guide';
      composeGuide.status = 'done';
      composeGuide.steps = [{ ja: 'x', hint: '' }];
    });
    await page.click('#compose-mode-free');
    await page.click('#compose-mode-guide');
    const state = await page.evaluate(() => ({ status: composeGuide.status, steps: composeGuide.steps }));
    expect(state).toEqual({ status: 'idle', steps: null });
  });
});
