# v58 iPhone UX 修正版

## 変更点

- iPhoneの上部操作盤をフル幅巨大ボタンから、横スクロールできる小型チップ型に修正
- 監視リスト・スキャナー・詳細をスマホでは縦1列に整理
- 会社調査・信用需給・監視リストをJSONで書き出し/読み込みできる「保存書出」「保存読込」を追加
- PCのlocalhost版とiPhoneのonrender.com版でlocalStorageが別になる問題に対応

## GitHubに上げるもの

このZIPを解凍して、中身を既存リポジトリへ上書きアップロードしてください。

入れるもの:
- index.html
- package.json
- server.js
- render.yaml
- src/
- public/
- README系

入れないもの:
- node_modules/
- dist/
- package-lock.json

## Render

Build Command:

```bash
npm install --no-package-lock && npm run build
```

Start Command:

```bash
npm run start
```
