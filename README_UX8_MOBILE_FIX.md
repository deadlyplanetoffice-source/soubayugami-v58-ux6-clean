# 相場歪観測機 v58 UX8 mobile fix

UX7 の iPhone UI について、貼り付けレビューで指摘された高優先度の不具合を中心に修正した版。

## 主な修正

- 表示名を `相場歪観測機 v58 UX8` に変更
- モバイル時は legacy PC ツリーをマウントしないようにして、Detail の二重レンダリング/API二重取得を抑制
- 監視銘柄画面で、直前のスキャナー結果ではなく watchlist + quoteCache を表示
- モバイル自動更新を scanner / watch / detail の必要画面だけに限定
- 起動時の広域スキャンを避け、初回は watch 更新に固定
- ホームの「スキャナーで歪みを探す」は `all` から開始
- 銘柄検索で追加後、そのまま詳細画面へ移動
- 詳細から戻る先を直前画面に近づける
- 詳細の単体更新でスキャナー一覧を単一銘柄に置き換えないよう調整
- 監視追加ボタンを `監視中 / 監視追加` 表示に変更し、簡易メッセージを表示
- 条件再スキャン後に条件パネルを閉じる
- モバイル設定に自動更新警告を表示
- iPhone数字入力向けに inputMode を追加
- チャートの横スクロール強制を緩和
- 長い銘柄名でヘッダーが崩れにくいよう調整

## 反映方法

GitHub に中身を上書きアップロードして、Render で `Clear build cache & deploy`。

Build Command:

```bash
npm install --no-package-lock && npm run build
```

Start Command:

```bash
npm run start
```
