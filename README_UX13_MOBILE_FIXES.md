# 相場歪観測機 v58 UX13

## 変更点

- 信用ボタン/調査メモボタンから目的のアコーディオンを直接開くよう修正
- モバイル詳細のアコーディオンを複数同時に開けるよう変更
- stickyヘッダーの重なりを修正
- 監視タブからスキャナータブへ移動した時に、監視データがスキャナー表示に残る不一致を修正
- 端末保存スナップショットの自動復元を停止し、明示復元方式に変更
- addToWatchのstale closureを修正
- 監視タブの先頭に「前回からの変化」を追加
- 会社調査貼り付け欄に「AI自動調査β」ボタンを追加（Render環境変数 ANTHROPIC_API_KEY が必要）

## 起動確認

ビルド確認済み。

```bash
npm install --no-package-lock && npm run build
npm run start
```

## Render

Build Command:

```bash
npm install --no-package-lock && npm run build
```

Start Command:

```bash
npm run start
```
