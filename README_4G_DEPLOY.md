# iPhone 4G/5G単独運用版メモ

この版は、iPhoneのSafariから4G/5Gで開くための「外部サーバー配置」向けです。

## 変更点

- `src/main.jsx` の API 参照を `http://localhost:8787` から同一オリジン `''` に変更
- `npm run build` を追加
- `npm start` を追加
- Render用の `render.yaml` を追加

## Renderに置く場合

1. このフォルダをGitHubにアップロード
2. Renderで New → Web Service
3. GitHubリポジトリを選択
4. Build Command: `npm install && npm run build`
5. Start Command: `npm start`
6. デプロイ完了後、表示されたURLをiPhoneのSafariで開く
7. Safari共有ボタン → ホーム画面に追加

## 注意

- 4G/5Gで使うには外部サーバーが必要です。
- Yahoo/JPX/AI APIなど、外部取得機能は通信が必要です。
- AI会社調査を使う場合はRenderの環境変数に `OPENAI_API_KEY` または `ANTHROPIC_API_KEY` を設定してください。
- APIキーなしでも、通常の株価・チャート・スキャナー系はサーバー側取得が動く範囲で使用できます。
