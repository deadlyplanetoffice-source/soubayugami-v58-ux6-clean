# 相場歪観測機 v58 UX23

UX23 phase 1: 歪み分類エンジンの初期実装。

## 追加内容
- distortionType / distortionTypeLabel / distortionTypeConfidence / distortionTypeReasons / distortionTypeAction
- 自動分類は安全側に限定
  - 需給・イベント型
  - 過熱の正常化
  - ファンダ悪化疑い（要調査）
  - 本物の歪み候補（暫定）
  - 分類保留
- 結論カードに「歪み分類」を表示
- 判定タブに「歪み分類」を表示

## 注意
A(ファンダ悪化) と E(本物の歪み) の確定判定は、会社調査メモがない限り暫定です。
