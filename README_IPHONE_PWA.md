# iPhone / PWA更新メモ

この版は v58 の4G/5G運用版に、iPhone向け表示調整とPWA設定を追加した版です。

## 追加内容

- `public/manifest.webmanifest`
- `public/sw.js`
- `public/icon-180.png`
- `public/icon-192.png`
- `public/icon-512.png`
- `index.html` のiPhone/PWA用metaタグ
- `src/styles.css` のスマホ表示補正
- `render.yaml` のBuild Commandを `npm install --no-package-lock && npm run build` に変更

## iPhoneでの使い方

1. RenderのURLをiPhone Safariで開く
2. 共有ボタンを押す
3. 「ホーム画面に追加」
4. ホーム画面のアイコンから起動

## 注意

Service Workerはアプリ本体を軽くキャッシュしますが、株価/APIデータは古い値を固定しないようにネットワーク優先です。
