# 中国語シャドーイング練習アプリ

AIを使った中国語シャドーイング練習アプリです。

## 機能

- AIが練習文（HSK3〜6）を自動生成
- 6ステップの計画的な練習フロー（初聴→確認→音読→追読→録音→採点）
- 録音した自分の音声を再生して確認
- AI による発音・声調の詳細フィードバック
- 練習履歴をブラウザに保存（localStorage）

## 使い方

1. [Google AI Studio](https://aistudio.google.com/app/apikey) で Gemini API キーを取得（無料）
2. サイトを開いてAPIキーを入力
3. レベル・トピックを選んで「練習スタート」

## GitHub Pages でのデプロイ手順

1. このリポジトリをフォーク or `index.html` をアップロード
2. Settings → Pages → Branch: main → Save
3. `https://ユーザー名.github.io/リポジトリ名/` でアクセス

## 注意

- APIキーはブラウザのメモリ内にのみ保存されます
- 練習履歴はブラウザのlocalStorageに保存されます（同じデバイス・同じURLでのみ参照可能）
- マイク使用のため、HTTPSでのアクセスが必要です（GitHub PagesはHTTPS対応）
