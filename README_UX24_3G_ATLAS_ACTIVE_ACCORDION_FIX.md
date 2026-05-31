# UX24.3G Atlas active accordion fix

- Header: MDO v58 / UX24.3G
- Default Atlas list scope is now 「監視中のみ」, so old atlas-only memo rows do not pollute the practical list.
- Added scope chips: 監視中のみ / 全図鑑 / 図鑑のみ.
- Code-only archive rows no longer display duplicated `code code`; they show 名称未取得.
- Row tap remains accordion expansion. Detail navigation only happens inside expanded actions.
- Delete moved from the main row to the expanded action area as a small text button to reduce accidental deletion and visual weight.
