# UX24.3B Mobile Atlas List fix

UX24.3AではAtlas List PanelがPC/legacyレイアウト側にのみ差し込まれており、iPhoneの「図鑑」画面には表示されていませんでした。

## 変更
- mobileView === 'watch' の図鑑画面にも AtlasListPanel を追加
- モバイルの暗色UIに合わせて .mobileAtlasListWrap のCSSを追加
- APP_VERSION を UX24.3B Atlas List mobile に更新

## 目的
- iPhoneでもカード前に一覧・検索・フォルダ絞り込み・星付き・上下移動を表示する
- 既存のNextActionCard/判定ロジックは変更しない
