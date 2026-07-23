# PROJECT

# 1. プロジェクト概要

## プロジェクト名
听写跟读（ディクテーション＆シャドーイング練習アプリ）

## 目的
中国語のディクテーション・シャドーイング練習を、AIが生成する会話文とAI発音採点によって効率化する。個人の学習継続・苦手克服・発音矯正を支援する。

## 対象ユーザー
開発者本人（悠）のみ。マルチデバイス（iPad Pro / Android スマートフォン）で同一アカウントを使用。

## 動作環境
- iPad Pro（Safari、TTS音声：Meijia zh-TW）
- SHARP AQUOS9 Android（Chrome、TTS音声：中国語 中国 zh_CN）
- HTTPS環境必須（Web Speech API / MediaRecorder APIの制約）

## 使用技術
フロントエンド：Vanilla JS / HTML / CSS（`index.html` / `style.css` / `app.js` の3ファイル構成）
バックエンド：Firebase（Authentication + Firestore）
AIプロキシ：Cloudflare Workers
AI：Google Gemini API
音声：Web Speech API、MediaRecorder API、Web Audio API

---

# 2. 要件定義

## 必須機能
- AIによる会話文自動生成（レベル/トピック/HSK優先/練習スタイル指定）
- ディクテーション（書取）とLCSベースの客観採点
- シャドーイング（音読・追読・録音・AI発音採点）
- 声調（ピッチ）の可視化と改善点提示
- 学習履歴の保存・分析（トレンドチャート、レーダーチャート、AI傾向分析）
- 苦手リストの自動登録・復習
- Google認証によるマルチデバイス同期
- AIコーチモード（今日の学習メニュー自動生成、簡易SRS、声掛け・締めコメント）

## 任意機能
- カスタム文での練習、文セットの保存
- キーボードショートカット（ON/OFF切替可能）
- Web Speech音声の選択

## 将来追加予定
- AIコーチ Phase2：ディクテーション/シャドーイング結果からの苦手音・苦手単語のより精緻な連携
- AIコーチ Phase3：苦手分析の高度化、学習統計拡充、復習アルゴリズムの精緻化（フルSRS化検討）
- AIコーチ Phase4：HSK合格コース、旅行/ビジネス中国語コース、学習カレンダー、バッジ、週間/月間レポート
- 週間・月間の学習レポート

---

# 3. システム設計

## 全体構成
```
画面（app.js 内 render() 群）
  ↓
状態管理（グローバル State オブジェクト S）
  ↓
サービス層（generateSentence / reviewRecording / scoreDictation / analyzePitch 等）
  ↓
API（Cloudflare Worker 経由の Gemini API、Firebase Auth/Firestore）
  ↓
データ保存（Firestore：history サブコレクション、ユーザードキュメント直下に各種設定・キュー）
```

## セキュリティアーキテクチャ
```
ブラウザ
  │ Authorization: Bearer <Firebase IDトークン>
  ▼
Cloudflare Worker（gemini-proxy）
  │ JWKS公開鍵でトークンをその場検証（外部問い合わせ不要）
  │ uid が ALLOWED_UID と一致するかチェック
  ▼
Gemini API（APIキーはWorker側Secretのみに保持、クライアントには一切露出しない）
```
- Worker Secrets：`GEMINI_API_KEY`、`ALLOWED_UID`
- `worker.js` の `ALLOWED_ORIGIN` はGitHub Pages URLに限定（CORS）
- クライアント側にAPIキー入力欄・保存機構は存在しない

## データ構造（Firestore）
```
users/{uid}
  - weakList: array                 // 苦手な文（score<=3 で自動登録）
  - savedSets: array                // カスタム文セット
  - reviewQueue: array              // AIコーチの復習キュー
      [{ id, zh, py, ja, priority, dueDate, reviewCount, lastMatchPct }]
  - coach: object                   // AIコーチの状態
      { lastSessionDate, streak, greetingText, greetingDate, lastComment, lastCommentDate }
  - settings: object
      { levelId, topic, speed, reps, hskPrio, practiceStyle, practiceMode,
        shortcutsEnabled, voiceURI }

users/{uid}/history（subcollection）
  - sentence: { zh, py, ja, partner, partnerPy, partnerJa, topic }
  - result: { score, match, recognized, pronun, feedback }
  - type: "dictation" | undefined
  - dictResult: { matchPct, miss, extra, explain, input }   // dictationのみ
  - date: ISO string
  - createdAt: serverTimestamp
```

## API

**使用するAPI**
- Google Gemini API（`gemini-3.1-flash-lite` → `gemini-2.5-flash-lite` → `gemini-2.5-flash` の順にフォールバック）
- Firebase Authentication API（Google OAuth経由）
- Firestore API
- Cloudflare Workers（自前のGeminiプロキシ）

**認証方法**
- ユーザー：Firebase Authentication（Google ログイン）
- Worker→Gemini間：Worker Secretとして保持するAPIキー
- ブラウザ→Worker間：Firebase IDトークン（JWKS方式でWorker内検証）

**利用制限・方針**
- Gemini APIはWorker経由のみ。呼び出し回数を最小化する方針（採点はJS側LCSアルゴリズムを優先、AIは解説・コメント生成など補助的用途に限定）
- Gemini TTS（音声合成）は無料枠のレート制限（実質1日10回程度）が既知の問題のため不採用。Web Speech APIで代替

---

# 4. 開発ルール

## 基本方針
- AIは共同開発者として振る舞う。
- 既存機能を壊さない。
- 差分修正を基本とする。
- 小さな変更を積み重ねる。
- 不要なリファクタリングは行わない。
- **コード修正の前に実装方針を提示し、確認を得てから着手する。**
- 仕様が不明な場合は推測せず確認する。

## GitHub運用
- GitHubを唯一のソースコード管理場所とする（Private Repository）。
- Small Commit / Small Pull Request。
- **Claudeによるmainへの直接pushは禁止。** 必ずブランチ作成→コミット→Pull Request作成とする。
- Mergeは人が行う（差分レビュー必須）。
- レビュー必須対象：Google認証、Firestore、State管理、データ保存、API通信、Firebase Security Rules。
- UI・CSS・文言変更のみの場合は簡易レビュー可。
- ブランチ命名：`feature/xxx` 形式。

## セキュリティ
以下はリポジトリへ保存しない。
- Gemini APIキー
- Firebaseサービスアカウントキー
- OAuth Secret
- .env
- 秘密鍵
- 各種認証情報

Firebase Web Config（`apiKey`等）はpublicな値のため保存可（Firestore Security Rulesでアクセス制御）。
Gemini APIキーは Cloudflare Worker の Secret としてのみ保持し、リポジトリ・クライアントコードには一切含めない。

**GitHubトークン運用**
- Fine-grained Personal Access Tokenを使用
- 対象リポジトリを限定
- 必要最小権限のみ付与（Contents, Pull requests。Actions/Pages操作が必要な場合のみ都度追加）
- 有効期限は短め（7〜14日目安）に設定
- 作業終了後は速やかに失効（Delete または Regenerate）
- **トークン文字列そのものをチャット等に貼り付けない。共有してしまった場合は直ちにDeleteする。**

## コーディング規約
- 可読性を優先する。
- 保守性を優先する。
- コメントを整理する。
- 修正範囲外は変更しない。
- 既存の設計を尊重する。
- ファイル構成：`index.html`（骨格）/ `style.css`（全CSS）/ `app.js`（全JS）の3ファイル構成を維持する。
- `app.js` 内はコードの実行順序（関数宣言の巻き上げ依存を含む）を変えない差分修正を基本とする。さらなる機能別分割（複数JSファイルへの分割等）を行う場合は、依存関係・読み込み順序を含めて別途合意の上で実施する。
- ビルドツールは導入しない。

## Claude Code
Claude Code 固有の実装方針・回答方針・トークン最適化ルールは CLAUDE.md を参照すること。

---

# 5. このプロジェクト固有の設計

## 学習フロー（practiceMode別）
| モード | ステップ |
|---|---|
| full | 初聴→書取→確認・音読→追読→録音→採点 |
| dictation | 初聴→書取→採点 |
| shadow | 初聴→確認・音読→追読→録音→採点 |

「確認」と「音読」は画面・操作が実質同一（意味確認と音読が同じ音声再生UIで行われる）だったため、1ステップ（`check`フェーズ）に統合済み（旧`read`フェーズは廃止）。

AIコーチモードは上記フローを流用し、次に出す文の選択元をキュー制御する（`S.coachActive` 時に `nextStep()` が `coachOnItemComplete()` に分岐）。

## 採点ロジック
| 種別 | 採点主体 | AIの役割 |
|---|---|---|
| シャドーイング | JS（LCS差分、盲目文字起こしとの比較） | 2段階方式：①音声のみでお手本非提示の文字起こし → ②JSでスコア算出 → ③発音詳細・総評のみAI生成 |
| ディクテーション | JS（LCS差分比較） | 解説のみ生成（100〜150字） |

盲目文字起こし方式を採用した理由：お手本を提示した状態でGeminiに文字起こしさせると、実際の発話よりお手本に引っ張られた（＝甘い）認識結果が返りやすいため。録り直し比較モードも同様の方式。

## AIコーチ（Phase1実装済み）
- 今日の学習メニュー：復習3・ディクテーション2・シャドーイング3・会話1の固定テンプレ（JS側で構成）
- 復習項目：`reviewQueue` から期日到来分を優先度順に抽出
- 簡易SRS：正解(score≥4)→7日後／普通(score=3)→3日後／不正解→翌日
- 初回のみ既存 `weakList` から `reviewQueue` へ自動移行
- コーチの声掛け：連続日数・復習件数・苦手文をもとにGeminiが40字以内で生成（1日1回キャッシュ）
- セッション終了コメント：平均一致率・連続日数を踏まえてGeminiが80字以内で生成
- Gemini利用は「教材生成・学習終了後分析・コメント生成」のみに限定し、採点・集計・苦手登録はJSで行う方針（API利用量最小化）
- AIコーチタブの「今日の学習」見出しに、人型キャラクターのアバターサムネイル（インラインSVG、`.coach-avatar`）を配置。画像ファイルを追加せず`index.html`に直接埋め込み、円形の縁取りは`var(--accent-text)`でテーマに追従する（キャラクター自体の配色は固定）。練習中に表示される小さな「🤖 AIコーチ」バッジ等は対象外（絵文字のまま）

## 声調（ピッチ）分析
- 録音BlobをWeb Audio APIで解析（自己相関法によるF0推定、Gemini不使用）
- 拼音の声調記号からChao式簡易概形を生成し、実測ピッチ曲線と重ねて表示（縦軸：相対音高＝半音差）
- 実測カーブは開始点が期待カーブの開始点と一致するよう縦方向オフセット補正してから描画する（両カーブの基準点＝正規化方式が異なるため、始点を揃えないと視覚比較がしづらいことが判明し対応）
- 音節ごとの実測傾きと期待方向を比較し、不一致箇所をテキストで提示
- グラフ下部に、音節数と文字数が一致する場合のみ対応する文字を区切り線付きで表示し、グラフのどの区間がどの文字に対応するか視覚的に分かるようにしている（`analyzePitch()`が`chars`/`segDur`を返し、`drawPitchChart()`が描画）
- **教訓**：canvasの`fillStyle`/`strokeStyle`に`"var(--accent-text)"`のようなCSS変数の文字列をそのまま代入しても解決されず無視される（直前の値が残る）。canvas描画でテーマ変数の色を使う場合は`getComputedStyle(canvas).getPropertyValue('--xxx')`で解決してから代入すること（実測ピッチ曲線の色がこの原因で意図した配色になっていなかった不具合を修正済み）

## デザイン・テーマシステム
- CSS変数（`--bg`/`--card`/`--card-alt`/`--border`/`--border-strong`/`--text`/`--text-sec`/`--text-muted`/`--text-faint`/`--accent`/`--accent-fg`/`--accent-text`/`--accent2`系）に配色を集約
- ダーク（声調グラフテーマ：背景#0e0f16・カード#171a24・アクセント ティール#4FD1C5/コーラル#FF6B5C）とライト（背景#f2efe9・カード#ffffff・アクセント ディープティール#0d9488）の2テーマを実装
- 設定タブから即時切り替え可能、選択状態はFirestore（`settings.theme`）に保存
- 成功・警告・危険を示す状態色、HSKレベル別の色は視認性維持のためテーマ変数化せず固定
- 発音解説・フィードバック等、内部で配色が完結する一部ボックスもテーマに関わらず固定色
- トピック・練習スタイル・HSK優先・繰り返し回数・練習モード等の選択状態（`.topic-btn.active`）は `var(--accent)` 系配色を使用する。`var(--navy)` は両テーマとも背景色に近く選択状態が視認しづらくなるため使用しない
- **教訓**：ダーク単色テーマ導入時、既存の「明るいカード用の濃色見出しテキスト」を一括変換で見落とし、暗背景と同化する重大なコントラストバグを発生させた実績あり。色をテーマ変数化する際は、CSSクラス定義だけでなくJS内で生成される全インラインスタイルまで見落としなく変換する必要がある

## モード表示・図鑑・ニュースリンク
- 練習画面上部にモード表示バッジ（初聴/ディクテーション/シャドーイング/採点結果）を表示。AIコーチ実行中は🤖タグを併記し、自動で切り替わるモードでも迷わないようにしている
- 単語・文法図鑑：`generateSentence()`のプロンプトに語彙（単語・拼音・意味・HSK級）・文法パターンのタグ出力を追加（既存呼び出しに相乗り、追加API呼び出しなし）。練習に登場した時点で常に登録し、出現回数・正答率・平均一致率を記録。単語はHSK級別にグループ表示
- 採点結果画面に、練習した文に関連するニュース検索リンク（Google/百度）を追加。検索クエリは`S.topic`（トピック名）ではなく、文から抽出済みの`sentence.vocab`（重要単語）を使用し、なければ文本文・トピック名の順にフォールバックする（トピック名だけでは内容に無関係な結果になりやすいため）。実際の記事取得はせず検索結果ページへのリンク方式のため追加API・費用は不要

## AI生成テキストのパース規約
- `generateSentence()` の応答パース用正規表現は、フィールド名の部分一致による誤マッチ（例：「相手訳：」に対して「訳：」がマッチしてしまう等）を防ぐため、**全フィールドで行頭アンカー（`^ラベル[：:]\s*(.+)`、`m`フラグ）を使用する**こと。将来フィールドを追加する場合もこの方式を踏襲する。

## 既知の技術的制約
- Web Speech API / MediaRecorder はiframe内・HTTP環境では動作しない（GitHub Pages = HTTPSで解決済み）
- Web Speech APIの音声はOS/ブラウザ管理のため、アプリ側から新規ダウンロードは不可能。OSの音声設定画面へアプリから直接遷移させる手段もない（iOS/Android共にWeb標準APIでは非対応）
- `gemini-1.5-flash` 等旧モデル名は無効。`gemini-2.x`/`3.x` 系を使用
- textareaのinnerHTML埋め込みは `render()` 再描画で消えるため、`dict-input.value` を手動復元している
- `app.js` は単一ファイル内で関数宣言の巻き上げに依存した実行順序になっている箇所が複数ある（例：即時実行コードが後方で定義される関数を呼び出す等）。複数JSファイルへの分割時は読み込み順序を誤ると `ReferenceError` が発生するため要注意

---

# 6. 今後追加予定
- AIコーチ Phase2〜4（上記「将来追加予定」参照）
- 週間・月間の学習レポート
- 復習アルゴリズムの精緻化
- `app.js` のさらなる機能別分割（依存関係を精査した上で段階的に実施）

---

# 7. AIへの指示

作業開始時は
1. PROJECT.md
2. SESSION.md

を読むこと。

チャット履歴ではなく、このファイルを仕様書とする。
設計変更時は本ファイルを更新する。
コード修正を伴う依頼では、着手前に実装方針を提示し、確認を得てから実施する。

---

# 8. 練習スタイル追加要件（新機能）

既存のディクテーション・シャドーイングに加え、リスニング習得強化のため以下4モードを追加する。

## 8-1. 穴埋めディクテーション（クローズ）

**目的**：聞き取りにくい機能語・弱音節に絞って音声知覚を鍛える

**フロー**
1. 全文を音声再生（テキスト非表示）
2. 一部が空欄になった文を表示
3. 空欄に聞き取った語を入力
4. 判定 → 解説

**空欄の選定**
- `generateSentence()` にタグ出力を追加し、聞き取り困難な語（機能語・軽声・弱化音節）をAIに指定させる
- 文長に応じて1〜3箇所
- 難易度設定：易＝内容語 / 難＝機能語（了・的・把・被・就・才 等）

**採点**：完全一致 or 声調記号を除いた一致で部分点。AIは解説のみ生成

**データ構造**：`blanks: [{index, answer, hint}]`（既存の文生成レスポンスに追加）

**実装状況**：実装済み
- `S.practiceMode==="fillblank"` の時だけ `generateSentence()` のプロンプトに「穴埋め」タグを追加要求（他モードでは付与しないため無駄なトークン消費なし）。出力形式は `単語|拼音|聞き取りにくい理由` を；区切りで最大3個
- 「解説」もこの同一呼び出しの中で各空欄ごとの一言理由として取得し、採点時に追加のGemini呼び出しは行わない（8-5の「追加API呼び出しなし」方針を厳守）
- `blanks`の`hint`フィールドには拼音を格納し、正誤判定に利用：入力が空欄の正解（漢字）と完全一致なら正解、声調記号を除いた拼音同士が一致すれば部分点（0.5点）、それ以外は不正解（`stripTones()`でUnicode NFD正規化してから声調記号の結合文字を除去して比較）
- 難易度設定（易＝内容語／難＝機能語）は設定タブの「穴埋めディクテーションの難易度」トグルとして実装（`S.fillBlankDifficulty`、デフォルト「難」）
- 練習モードは`full`等とは独立した単独モードとして実装（`orderMap.fillblank=["listen","fillblank"]`）。`render()`内の共通の文表示エリアも`ph==="fillblank"`を専用分岐させ、空欄を含む全文が漏洩しないようにしている（実装中に、共通エリアが`else`分岐にフォールスルーして全文をそのまま表示してしまうバグを発見・修正）
- 履歴には`type:"fillblank"`として保存し、一覧画面に専用バッジを表示

## 8-2. 音声のみ内容理解クイズ

**目的**：字面に頼らず意味を取る力を鍛える

**フロー**
1. 会話（相手＋返答）を音声のみで再生。テキスト非表示
2. 再生は最大2回まで
3. 4択の内容質問を1〜2問表示
4. 回答 → 正誤判定（JS完結、API消費なし）→ 全文テキスト開示

**質問の型**：誰が何をしたか／いつ・どこで／話者の感情・意図／次に起こること

**データ構造**：`quiz: [{question, options[4], answerIndex, explanation}]`（文生成時に同時取得）

**設定**：選択肢言語を日本語/中国語で切替可能（初級は日本語推奨）

## 8-3. ミニマルペア聞き分け

**目的**：声調・紛らわしい子音母音の弁別能力を鍛える

**フロー**
1. 2つの音声を続けて再生（A・B）
2. 「今聞こえたのはどちら？」2択、または「同じ？違う？」判定
3. 即座に正誤表示、連続10問でセッション完了
4. カテゴリ別正答率を集計・記録

**出題カテゴリ**
- 声調：mā/má/mǎ/mà 等の組み合わせ
- 子音：zh-z／ch-c／sh-s／j-q／n-l
- 母音：an-ang／en-eng／in-ing／ü-u

**データソース**：`MINIMAL_PAIRS` 静的配列をJS内に保持（API不要・無料・高速）

**データ構造**：`MINIMAL_PAIRS = [{category, a:{zh,py}, b:{zh,py}}]`

**採点**：JS完結。カテゴリ別正答率をFirestoreに蓄積し弱点表示

**実装状況**：実装済み
- 出題形式は「2択（今聞こえたのはどちらだったか）」のみを実装（「同じ？違う？」判定は未実装）。まずAとBの参照音を再生し、続けてどちらか一方をランダムに再度再生して「今の音はどちらか」を2択ボタンで回答させる方式
- `S.practiceMode==="minimal"` のとき `render()` は既存のシャドーイング/ディクテーション用ステップフローを使わず `renderMinimalPairs()` に分岐し、ステップバーは非表示にする（`renderStepBar()`側で早期return）
- セッション状態は `S.mp = {questions, index, correctCount, answered, lastCorrect, choice, finished}` で保持し、練習開始のたびに10問をシャッフル生成
- カテゴリ別正答率の累積値は `S.minimalPairStats`（Firestore `minimalPairStats` フィールド、`saveMinimalPairStatsToCloud()`）に保存。結果画面ではセッション内の正解数と、この累積カテゴリ別正答率の両方を表示
- ミニマルペア中はキーボードショートカット（Space/矢印キー等）を全て無効化（`S.practiceMode==="minimal"` で早期return）。既存の`nextStep()`の`orderMap`に"minimal"が無いため、無効化しないと矢印キーで誤って`loadSentence()`（AI呼び出し）に入ってしまう不具合があったため対応

## 8-4. バックワードビルドアップ

**目的**：長文の音の塊（チャンク）を作り、息継ぎ位置を体得する

**フロー**
1. 文を末尾から段階的に伸ばして提示（例：「吃饭」→「一起吃饭」→「我们一起吃饭」→「今天我们一起吃饭」）
2. 各段階で：音声再生 → 音読 → 次へ
3. 最終段階で全文を録音・採点（既存のシャドーイング採点ロジックを流用）

**分割ロジック**
- `generateSentence()` に「意味のまとまりで後ろから分割した配列」をAIに出力させる
- または句読点・助詞（的・了・在・和 等）を手がかりにJS側で分割するフォールバックを用意

**データ構造**：`chunks: ["吃饭", "一起吃饭", "我们一起吃饭", "今天我们一起吃饭"]`

## 8-5. 共通実装方針

| 項目 | 方針 |
|---|---|
| モード選択 | 設定タブに「練習スタイル」セクションを追加（シャドーイング／ディクテーション／穴埋め／内容クイズ／聞き分け／BBU） |
| API利用 | 8-1・8-2・8-4は既存の`generateSentence()`に相乗り（追加タグ出力のみ、追加API呼び出しなし）。8-3はAPI不要 |
| 履歴管理 | 既存`history`に`type`フィールドを追加して統合管理 |
| 苦手記録 | 8-3は専用のカテゴリ別集計、他は既存の`weakList`を流用 |

**実装優先順**：8-3（ミニマルペア・API不要で独立実装可）→ 8-1（既存フロー流用）→ 8-2 → 8-4
