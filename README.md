# Soubayugami Kansokuki v58 fast scan

## Start

Double-click `run-v58.bat` in the extracted root folder.

This build adds a faster broad scanner:

- Prime / Standard / Growth / All scans first use Yahoo quote batch data for price and volume prefiltering.
- Only the filtered candidates fetch the heavier 1-year chart data.
- Broad scans skip per-symbol fundamentals during the list scan; use detail view for deeper confirmation.
- This mainly speeds up full-market scans with max price / min volume filters.

## Manual command

```powershell
cd C:\Users\physi\Downloads\soubayugami-kansokuki-v58\soubayugami-kansokuki-v58
npm install
npm run dev
```
