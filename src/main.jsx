import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Same-origin API. Works on Render/Railway/phone URL and also with local Vite proxy if configured.
const API = '';
const APP_VERSION = '相場歪観測機 v58 UX24.3C Atlas List single';

const DEFAULT_CODES = [
  { code: '3687', name: 'フィックスターズ', sector: 'AI/量子' },
  { code: '290A', name: 'シンスペクティブ', sector: '宇宙/SAR' },
  { code: '9348', name: 'アイスペース', sector: '宇宙' },
  { code: '218A', name: 'リベラウェア', sector: 'ドローン' },
  { code: '3541', name: '農業総合研究所', sector: '農業DX' },
  { code: '5401', name: '日本製鉄', sector: '鉄鋼' },
  { code: '6703', name: '沖電気工業', sector: '防衛/通信' },
  { code: '9432', name: 'NTT', sector: '通信' },
];

const fmt = (v, suffix = '') => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toLocaleString('ja-JP')}${suffix}`);
const yen = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toLocaleString('ja-JP')}円`);
const pct = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const rrText = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(2)}倍`);
const clsBy = (v) => (v == null ? '' : Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : '');
const rrClass = (v) => v == null ? '' : v >= 2 ? 'pos' : v < 1 ? 'neg' : 'warn';

function atlasProgress(companyNote, creditNote, q = null) {
  const raw = String(companyNote?.raw || companyNote?.summary || '').trim();
  const creditRaw = String(creditNote?.raw || creditNote?.sourceText || '').trim();
  const sectionHasBody = (labelPattern) => {
    if (!raw) return false;
    const lines = raw.split(/\r?\n/);
    const idx = lines.findIndex((line) => labelPattern.test(line));
    if (idx < 0) return false;
    const body = lines.slice(idx + 1, idx + 6).join(' ').replace(/[【】#＊*`>|\s]/g, '');
    return body.length >= 30;
  };
  const checks = [
    { key: 'base', label: '会社の核', ok: sectionHasBody(/会社の核|事業内容/) || (!!raw && raw.length >= 80) },
    { key: 'business', label: '稼ぎ方', ok: sectionHasBody(/稼ぎ方|事業|収益|ビジネス|主な稼ぎ方/) },
    { key: 'material', label: '材料', ok: sectionHasBody(/成長材料|直近材料|レジーム|大型材料|ポジティブ要因|悪材料|IR/) },
    { key: 'distortion', label: '歪み判定', ok: sectionHasBody(/歪み判定|押し目判断|自分用の暫定判断|暫定判断|試し玉|Bull|Bear/) },
    { key: 'credit', label: '信用需給', ok: !!creditRaw || !!creditNote?.snapshot || !!creditNote?.diagnosis },
  ];
  const level = checks.filter((x) => x.ok).length;
  const stars = '★★★★★'.slice(0, level) + '☆☆☆☆☆'.slice(0, 5 - level);
  const missing = checks.filter((x) => !x.ok).map((x) => x.label);
  return { level, stars, missing, checks, label: level >= 5 ? '完成度高' : level >= 4 ? '実戦メモ済' : level >= 3 ? '材料あり' : level >= 2 ? '基礎あり' : level >= 1 ? '入口あり' : '未調査' };
}


function extractAtlasCore(note, fallback = '') {
  const raw = String(note?.raw || '').trim();
  if (!raw) return fallback || '会社の核は未記録。図鑑に書き込むと、ここに要約を表示します。';
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const keys = ['会社の核', '【会社の核】', '事業内容', '稼ぎ方', '成長材料', 'レジーム'];
  const idx = lines.findIndex((line) => keys.some((k) => line.includes(k)));
  const picked = idx >= 0 ? lines.slice(idx + 1, idx + 5).join(' ') : lines.slice(0, 4).join(' ');
  const cleaned = picked.replace(/[#＊*`>|【】]/g, '').trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 180)}…` : cleaned;
}

function sectorColor(sector = '') {
  const s = String(sector || '');
  if (/AI|量子|DX|ソフト/.test(s)) return '#9b6bff';
  if (/宇宙|防衛|ドローン|SAR/.test(s)) return '#38bdf8';
  if (/半導体|電子/.test(s)) return '#f59e0b';
  if (/通信|NTT|5G/.test(s)) return '#22c55e';
  if (/鉄鋼|素材|化学/.test(s)) return '#94a3b8';
  if (/農業|水産|食品/.test(s)) return '#84cc16';
  return '#7dd3fc';
}


function atlasStatusText(companyNote, creditNote) {
  const a = atlasProgress(companyNote, creditNote);
  return `${a.label} ${a.stars}`;
}


const ATLAS_DEFAULT_FOLDERS = ['最優先監視', '押し目候補', '強テーマ銘柄', '決算確認待ち', '信用需給注意', '長期候補', '保留', '除外・墓場', '未分類'];

function atlasDefaultFolder({ companyNote, creditNote, q, watched }) {
  const raw = String(companyNote?.raw || companyNote?.summary || '').trim();
  const text = `${raw} ${q?.sector || ''} ${q?.name || ''}`;
  if (/除外|見送り|墓場|壊れ|撤退/.test(text)) return '除外・墓場';
  if (/QPS|キオクシア|宇宙|防衛|半導体|AI|量子|国策|強テーマ|SAR/.test(text)) return '強テーマ銘柄';
  if (/決算|進捗|上方|下方|コンセンサス|四季報/.test(text)) return '決算確認待ち';
  if (creditNote || /信用|買残|売残|貸借|空売り|需給/.test(text)) return '信用需給注意';
  if (/押し目|歪み|下限|反発|試し玉/.test(text)) return '押し目候補';
  if (watched) return '最優先監視';
  return '未分類';
}

function atlasFolderClass(folder = '') {
  if (/最優先/.test(folder)) return 'hot';
  if (/強テーマ/.test(folder)) return 'theme';
  if (/押し目/.test(folder)) return 'dip';
  if (/決算/.test(folder)) return 'earnings';
  if (/信用/.test(folder)) return 'credit';
  if (/除外|墓場/.test(folder)) return 'grave';
  return 'neutral';
}

function atlasTypeLabel(note, q) {
  const raw = String(note?.raw || '').replace(/\s+/g, ' ');
  const text = `${raw} ${q?.sector || ''}`;
  if (/実績上振れ|上方|最高益|進捗|増益/.test(text) && /期待|思惑|テーマ|国策|AI|宇宙|防衛/.test(text)) return '思惑+実績期待';
  if (/実績上振れ|上方|最高益|進捗|増益/.test(text)) return '実績上振れ型';
  if (/思惑|テーマ|国策|材料|急騰|レアアース/.test(text)) return '思惑急騰型';
  if (/半導体|AI|宇宙|防衛|バイオ|レアアース|資源/.test(text)) return 'セクター連動型';
  if (/赤字|希薄化|ワラント|継続前提|資金調達/.test(text)) return '要リスク確認';
  return '未分類';
}

function atlasSnippet(note) {
  const raw = String(note?.raw || note?.summary || '').replace(/[#＊*`>|【】]/g, '').replace(/\s+/g, ' ').trim();
  return raw ? clipText(raw, 72) : '図鑑メモ未記録';
}


function scanMaxCandidatesFor(source, sector, minVolume, maxPrice) {
  const broad = ['prime','topix','all','standard','growth'].includes(String(source));
  const strongFilter = Number(minVolume) >= 100000 && Number(maxPrice) > 0 && Number(maxPrice) <= 5000;
  if (broad && String(sector || 'all') === 'all' && strongFilter) return 2500;
  if (broad && strongFilter) return 1600;
  return 600;
}

const REFRESH_OPTIONS = [
  { label: 'OFF', value: 0, caution: '' },
  { label: '30秒', value: 30_000, caution: '安定重視' },
  { label: '15秒', value: 15_000, caution: '短期監視向き' },
  { label: '10秒', value: 10_000, caution: '銘柄数10件以下推奨' },
  { label: '5秒', value: 5_000, caution: '実験用・銘柄数5件以下推奨' },
];

const SECTOR_OPTIONS = [
  ['all', '全セクター'],
  ['semiconductor', '半導体/電子部品'],
  ['ai', 'AI/DX/ソフト'],
  ['space_defense', '宇宙/防衛/ドローン'],
  ['realestate', '不動産/住宅'],
  ['finance', '金融/証券/銀行'],
  ['resources', '資源/素材/化学'],
  ['consumer', '食品/水産/小売'],
  ['auto_machinery', '自動車/機械'],
  ['pharma_medical', '医療/医薬/バイオ'],
  ['infra', '通信/鉄道/インフラ'],
  ['trading', '商社'],
];

function mobileScoreSortKey(mode) {
  if (mode === 'state') return 'stateScore';
  if (mode === 'trend') return 'trendScore';
  if (mode === 'bottom') return 'bottomScore';
  return 'score';
}

function mobileRRSortKey(mode) {
  if (mode === 'trend') return 'trendRR';
  if (mode === 'bottom') return 'bottomRR';
  return 'rr';
}

function mobileSortOptions(mode) {
  return [
    { label: 'センサー', key: 'default', dir: 'desc' },
    { label: '下落順', key: 'changePct', dir: 'asc' },
    { label: '上昇順', key: 'changePct', dir: 'desc' },
    { label: '出来高', key: 'volume', dir: 'desc' },
    { label: '判定点', key: mobileScoreSortKey(mode), dir: 'desc' },
    { label: 'RR', key: mobileRRSortKey(mode), dir: 'desc' },
    { label: '危険', key: mode === 'trend' ? 'trendDanger' : mode === 'bottom' ? 'bottomDanger' : 'danger', dir: 'desc' },
    { label: '歪み度', key: 'overshootScore', dir: 'desc' },
  ];
}

function isSameSort(a, b) {
  return (a?.key || 'default') === (b?.key || 'default') && (a?.dir || 'desc') === (b?.dir || 'desc');
}

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

const EMPTY_RESEARCH_NOTE = {
  raw: '',
  business: '',
  revenue: '',
  growth: '',
  risks: '',
  dropReason: '',
  distortion: '',
  trial: '',
  nextChecks: '',
  health: '未評価',
  badSeverity: '未評価',
  reasonType: '未評価',
  trialFit: '未評価',
  updatedAt: '',
};
function normalizeResearchNote(note = {}) { return { ...EMPTY_RESEARCH_NOTE, ...(note || {}) }; }
function noteShortLabel(note) {
  if (!note) return '';
  const n = normalizeResearchNote(note);
  const bits = [];
  if (n.health && n.health !== '未評価') bits.push(`健全:${n.health}`);
  if (n.reasonType && n.reasonType !== '未評価') bits.push(n.reasonType);
  if (n.trialFit && n.trialFit !== '未評価') bits.push(`試:${n.trialFit}`);
  if (bits.length) return bits.join(' / ');
  const raw = String(n.raw || '').replace(/\s+/g, ' ').trim();
  return raw ? clipText(raw, 80) : '';
}


function dangerClass(v) {
  const n = Number(v || 0);
  if (n >= 70) return 'danger';
  if (n >= 45) return 'warn';
  if (n >= 25) return 'wait';
  return 'good';
}
function dangerLabel(v) {
  const n = Number(v || 0);
  if (n >= 70) return '高';
  if (n >= 45) return '中高';
  if (n >= 25) return '中';
  return '低';
}
function totalClass(label) {
  if (/危険/.test(label || '')) return 'danger';
  if (/候補/.test(label || '')) return 'good';
  if (/確認|監視/.test(label || '')) return 'wait';
  return 'neutral';
}
function buildQuality(q, company) {
  if (!q) return null;
  const dangerScore = q.dangerScore ?? 0;
  const companyQuality = company?.summary?.quality || {};
  const materialBad = (company?.risks?.badMaterials || []).length;
  const materialGood = (company?.growth?.goodMaterials || []).length;
  const score = q.score || 0;
  let finalJudge = q.totalJudge || '様子見';
  if (materialBad) finalJudge = '材料確認・反発待ち';
  else if (score >= 70 && dangerScore < 35 && (q.predictedRR || 0) >= 1.5) finalJudge = '候補';
  else if (score >= 70 && dangerScore >= 35) finalJudge = '反発確認';
  else if (dangerScore >= 70) finalJudge = '危険';

  const materialLabel = materialBad ? '悪材料候補' : materialGood ? '好材料候補' : (q.materialSignal || '未確認');
  const reasons = [
    ...(q.dangerReasons || []),
    ...(companyQuality.dangerReasons || []),
    ...(materialBad ? ['直近材料に悪材料候補'] : []),
  ].filter(Boolean);
  return {
    dangerScore,
    dangerLabel: q.dangerLabel || dangerLabel(dangerScore),
    dangerClass: dangerClass(dangerScore),
    dropType: q.dropType || '通常調整',
    materialLabel,
    supplyLabel: q.supplySignal || '未取得',
    finalJudge,
    finalClass: totalClass(finalJudge),
    reasons: [...new Set(reasons)].slice(0, 6),
  };
}

function scoreLabel(score = 0) {
  if (score >= 70) return '強い押し目候補';
  if (score >= 45) return '監視候補';
  if (score >= 25) return '軽い調整';
  return '対象外寄り';
}


function trendClass(v) {
  const n = Number(v || 0);
  if (n >= 75) return 'good';
  if (n >= 60) return 'wait';
  if (n >= 40) return 'neutral';
  return 'danger';
}

function sourceLabel(source) {
  return source === 'nikkei225' ? '日経225' : source === 'growth' ? 'グロース' : source === 'prime' ? 'プライム' : source === 'standard' ? 'スタンダード' : source === 'topix' ? 'TOPIX近似' : '全候補';
}


function modeVerdictClass(kind, text = '', score = null, danger = null) {
  const t = String(text || '');
  const d = Number(danger);
  const s = Number(score);
  if (Number.isFinite(d) && d >= 80) return 'danger';
  if (/危険|回避|触らない|崩れ|悪材料|見送り|対象外/.test(t)) return 'danger';
  if (/高リスク|注意|監視|要確認|暫定|待ち/.test(t)) return 'warn';
  if (/候補|反発|試し玉|継続|強い|良好|歪み/.test(t)) return Number.isFinite(s) && s >= 65 ? 'good' : 'watch';
  return 'neutral';
}

function stateKindClass(label) {
  const t = String(label || '');
  if (/distortion|歪み/.test(t)) return 'distortion';
  if (/trial|試し玉/.test(t)) return 'trial';
  if (/trend|上昇継続/.test(t)) return 'trend';
  if (/avoid|回避|触らない/.test(t)) return 'avoid';
  return 'watch';
}

function trendDangerClass(v) {
  const n = Number(v || 0);
  if (n >= 70) return 'danger';
  if (n >= 45) return 'warn';
  if (n >= 25) return 'wait';
  return 'good';
}
function trendJudgeClass(label) {
  if (/候補/.test(label || '')) return 'good';
  if (/過熱|注意/.test(label || '')) return 'warn';
  if (/監視|待ち/.test(label || '')) return 'wait';
  return 'neutral';
}
function bottomJudgeClass(label) {
  if (/試し玉|短期リバ|浅押し|戻り選別/.test(label || '')) return 'good';
  if (/切り上げ|確認|監視|高リスク|反発確認|材料確認|条件付き/.test(label || '')) return 'wait';
  if (/触らない/.test(label || '')) return 'danger';
  return 'neutral';
}

function cleanName(code, fallback) {
  const f = String(fallback || '').trim();
  if (!f || f === String(code)) return String(code);
  return f.replace(/\s*CORPORATION$/i, '').replace(/\s*CO\.,?\s*LTD\.?$/i, '').trim();
}

function buildAutoResearch(q, selected) {
  if (!q || q.error) return null;
  const price = Number(q.price);
  const mid = Number(q.bbMid);
  const lower = Number(q.bbLower);
  const upper = Number(q.bbUpper);
  const rr = q.predictedRR == null ? null : Number(q.predictedRR);
  const bbPos = q.bbPos == null ? null : Number(q.bbPos);
  const score = q.score ?? 0;

  let stance = '様子見';
  let stanceClass = 'neutral';
  let main = 'データ不足のため、価格更新後に再判定してください。';

  if (Number.isFinite(price) && Number.isFinite(mid) && Number.isFinite(lower) && Number.isFinite(upper)) {
    if (price > upper) {
      stance = '高値圏・追い買い注意'; stanceClass = 'danger';
      main = '現在値がBB上限より上です。短期では上に伸びていますが、押し目狙いとしては飛びつき注意。利確候補や次の中心線待ちの方が自然です。';
    } else if (price > mid) {
      stance = '中心線待ち'; stanceClass = 'wait';
      main = '現在値はBB中心より上です。押し目狙いなら、現在値で追うよりBB中心付近までの調整を待つ形が見やすいです。';
    } else if (price <= lower) {
      stance = '下限割れ・反発確認'; stanceClass = 'danger';
      main = '現在値はBB下限以下です。値ごろ感はありますが、下落継続リスクもあるため、陽線反転・出来高減少・下げ止まり確認が必要です。';
    } else if (bbPos != null && bbPos <= -1) {
      stance = '押し目候補'; stanceClass = 'good';
      main = '現在値は-1σ〜BB下限寄りです。短期押し目として監視しやすい位置です。出来高と反発初動を確認したい場面です。';
    } else {
      stance = '浅い押し目'; stanceClass = 'neutral';
      main = '現在値はBB中心線をやや下回る程度です。浅い押し目ですが、RRが十分かを確認してから判断したい位置です。';
    }
  }

  if (rr != null) {
    if (rr >= 2 && stanceClass !== 'danger') {
      stance = `${stance} / RR良好`;
      main += ' 予測RRは2倍以上で、数値上はリスクに対してリワードが大きめです。';
    } else if (rr < 1) {
      stance = `${stance} / RR不足`;
      main += ' 予測RRは1倍未満で、現値からの期待値は薄めです。';
    }
  }

  const checks = [];
  if (q.volumeRatio == null) checks.push('出来高倍率が取れていないため、流動性を別途確認');
  else if (q.volumeRatio >= 1.8 && q.changePct < 0) checks.push('下落日に出来高が増えているため、投げ売りか悪材料の確認');
  else if (q.volumeRatio <= 0.75 && q.changePct < 0) checks.push('薄商いでの下落なら、売り枯れか単なる閑散か確認');
  else checks.push('出来高倍率は通常範囲。急な資金流入・流出は限定的');

  if (q.drawdown20 != null && q.drawdown20 <= -10) checks.push('20日高値からの下落が大きく、反発余地と悪材料有無を両方確認');
  if (q.changePct != null && q.changePct > 3) checks.push('当日上昇が大きいため、押し目ではなく反発後の位置か確認');
  if (q.changePct != null && q.changePct < -3) checks.push('当日下落が大きいため、ナンピンより下げ止まり確認を優先');
  if (rr != null && rr >= 2) checks.push('RRは良好。ただしBB上限到達の材料・地合いが必要');
  if (rr != null && rr < 1.3) checks.push('RRが薄い。買うならさらに下の押し目候補まで待つ方が自然');

  const zones = [
    { label: '第1押し目', price: q.bbMid, note: 'BB中心。浅い押し目・強い銘柄向け' },
    { label: '第2押し目', price: q.bbMinus1, note: '-1σ。通常の押し目候補' },
    { label: '第3押し目', price: q.bbLower, note: 'BB下限。深い押し目・反発確認必須' },
    { label: '目標目安', price: q.rrTarget, note: 'BB上限。短期利確候補' },
    { label: '撤退目安', price: q.rrStop, note: 'BB下限下。損切り・見直し候補' },
  ];

  return { stance, stanceClass, main, checks, zones, reasons: q.reasons || [], name: q.name || selected?.name || q.code, score };
}

function App() {
  const [watch, setWatch] = useState(() => load('watchlist', DEFAULT_CODES));
  const [quotes, setQuotes] = useState([]);
  const [quoteCache, setQuoteCache] = useState({});
  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(null);
  const [newInput, setNewInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [scannerMode, setScannerMode] = useState(() => load('scannerMode', 'oshime'));
  const [manual, setManual] = useState(() => load('manualRows', ''));
  const [refreshInterval, setRefreshInterval] = useState(() => load('refreshInterval', 30_000));
  const [lastUpdated, setLastUpdated] = useState(null);
  const [scannerSource, setScannerSource] = useState(() => load('scannerSource', 'watch'));
  const [nikkeiMaxPrice, setNikkeiMaxPrice] = useState(() => load('nikkeiMaxPrice', 3000));
  const [scannerMinPrice, setScannerMinPrice] = useState(() => load('scannerMinPrice', 0));
  const [scannerMinVolume, setScannerMinVolume] = useState(() => load('scannerMinVolume', 100000));
  const [scannerSector, setScannerSector] = useState(() => load('scannerSector', 'all'));
  const [marketMeta, setMarketMeta] = useState(null);
  const [scanPreview, setScanPreview] = useState(null);
  const [scanPreviewLoading, setScanPreviewLoading] = useState(false);
  const [irCache, setIrCache] = useState({});
  const [irLoading, setIrLoading] = useState(false);
  const [irError, setIrError] = useState('');
  const [dropInput, setDropInput] = useState('');
  const [dropReport, setDropReport] = useState(null);
  const [dropLoading, setDropLoading] = useState(false);
  const [dropError, setDropError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => load('sidebarOpen', true));
  const [detailOpen, setDetailOpen] = useState(() => load('detailOpen', true));
  const [dragCode, setDragCode] = useState(null);
  const [miniChartMode, setMiniChartMode] = useState({});
  const [miniChartCache, setMiniChartCache] = useState({});
  const [miniChartLoading, setMiniChartLoading] = useState({});
  const [layoutMode, setLayoutMode] = useState(() => load('layoutMode', 'balanced'));
  const [sortSpec, setSortSpec] = useState(() => load('sortSpec', { key: 'default', dir: 'desc' }));
  const [detailTab, setDetailTab] = useState('summary');
  const [companyNotes, setCompanyNotes] = useState(() => load('companyResearchNotes', {}));
  const [creditNotes, setCreditNotes] = useState(() => load('creditBalanceNotes', {}));
  const [atlasPrefs, setAtlasPrefs] = useState(() => load('atlasPrefs', {}));
  const [atlasSearch, setAtlasSearch] = useState('');
  const [atlasFolderFilter, setAtlasFolderFilter] = useState(() => load('atlasFolderFilter', 'all'));
  const [atlasListOpen, setAtlasListOpen] = useState(() => load('atlasListOpen', true));
  const [clockTick, setClockTick] = useState(Date.now());
  const refreshInFlightRef = useRef(false);
  const importFileRef = useRef(null);
  const [dataTransferMsg, setDataTransferMsg] = useState('');
  const [lastExportAt, setLastExportAt] = useState(() => load('lastExportAt', null));
  const [controlDrawerOpen, setControlDrawerOpen] = useState(false);
  const [mobileView, setMobileView] = useState('watch');
  const [mobileBackView, setMobileBackView] = useState('watch');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(max-width: 780px)').matches : false);
  const [lastSeen, setLastSeen] = useState(() => load('mobileLastSeen', { at: null, prices: {} }));

  useEffect(() => save('watchlist', watch), [watch]);
  useEffect(() => save('manualRows', manual), [manual]);
  useEffect(() => save('scannerMode', scannerMode), [scannerMode]);
  useEffect(() => save('refreshInterval', refreshInterval), [refreshInterval]);
  useEffect(() => save('detailOpen', detailOpen), [detailOpen]);
  useEffect(() => save('scannerSource', scannerSource), [scannerSource]);
  useEffect(() => save('nikkeiMaxPrice', nikkeiMaxPrice), [nikkeiMaxPrice]);
  useEffect(() => save('scannerMinPrice', scannerMinPrice), [scannerMinPrice]);
  useEffect(() => save('scannerMinVolume', scannerMinVolume), [scannerMinVolume]);
  useEffect(() => save('scannerSector', scannerSector), [scannerSector]);
  useEffect(() => save('sortSpec', sortSpec), [sortSpec]);
  useEffect(() => save('companyResearchNotes', companyNotes), [companyNotes]);
  useEffect(() => save('creditBalanceNotes', creditNotes), [creditNotes]);
  useEffect(() => save('atlasPrefs', atlasPrefs), [atlasPrefs]);
  useEffect(() => save('atlasFolderFilter', atlasFolderFilter), [atlasFolderFilter]);
  useEffect(() => save('atlasListOpen', atlasListOpen), [atlasListOpen]);
  useEffect(() => save('mobileLastSeen', lastSeen), [lastSeen]);

  // UX13: 端末保存スナップショットの自動復元は停止。
  // 理由: 監視リストを意図的に空にした場合のゾンビ復活と、起動直後refreshとの競合を避けるため。
  // 復元は「設定 → 端末保存を復元（上書き）」で明示的に行う。

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { const t = setInterval(() => setClockTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 780px)');
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (scannerSource === 'watch') { setScanPreview(null); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setScanPreviewLoading(true);
      try {
        const qs = new URLSearchParams({
          universe: scannerSource,
          sector: scannerSector || 'all',
          minVolume: String(scannerMinVolume || 0),
          maxPrice: String(nikkeiMaxPrice || 0),
          maxCandidates: String(scanMaxCandidatesFor(scannerSource, scannerSector, scannerMinVolume, nikkeiMaxPrice)),
        });
        const res = await fetch(`${API}/api/universe-preview?${qs.toString()}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '探索プレビュー取得に失敗');
        setScanPreview(data);
      } catch (e) {
        if (e.name !== 'AbortError') setScanPreview({ error: e.message });
      } finally {
        setScanPreviewLoading(false);
      }
    }, 350);
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [scannerSource, scannerSector, scannerMinVolume, nikkeiMaxPrice]);

  const selectedQuote = selected ? (quotes.find((q) => String(q.code) === String(selected.code)) || quoteCache[String(selected.code)] || null) : null;
  const research = useMemo(() => buildAutoResearch(selectedQuote, selected), [selectedQuote, selected?.code]);

  const atlasItems = useMemo(() => {
    const byCode = new Map();
    const add = (code, seed = {}) => {
      const key = String(code || '').trim();
      if (!key) return;
      byCode.set(key, { ...(byCode.get(key) || {}), ...seed, code: key });
    };
    watch.forEach((w, idx) => add(w.code, { watch: w, watched: true, watchIndex: idx }));
    quotes.forEach((q) => add(q.code, { q }));
    Object.keys(quoteCache || {}).forEach((code) => add(code, { q: quoteCache[code] }));
    Object.keys(companyNotes || {}).forEach((code) => add(code, { companyNote: companyNotes[code] }));
    Object.keys(creditNotes || {}).forEach((code) => add(code, { creditNote: creditNotes[code] }));
    return Array.from(byCode.values()).map((item, idx) => {
      const q = item.q || quoteCache[String(item.code)] || quotes.find((x) => String(x.code) === String(item.code)) || null;
      const w = item.watch || watch.find((x) => String(x.code) === String(item.code)) || null;
      const companyNote = item.companyNote || companyNotes[String(item.code)] || null;
      const creditNote = item.creditNote || creditNotes[String(item.code)] || null;
      const pref = atlasPrefs[String(item.code)] || {};
      const name = cleanName(item.code, pref.name || q?.name || q?.localName || w?.name || item.code);
      const fallbackFolder = atlasDefaultFolder({ companyNote, creditNote, q, watched: !!w });
      const folder = pref.folder || fallbackFolder;
      const progress = atlasProgress(companyNote, creditNote, q);
      const updatedMs = companyNote?.updatedAt ? new Date(companyNote.updatedAt).getTime() : creditNote?.updatedAt ? new Date(creditNote.updatedAt).getTime() : 0;
      return {
        code: String(item.code), name, q, w, watched: !!w, companyNote, creditNote,
        folder, pinned: !!pref.pinned, order: Number.isFinite(Number(pref.order)) ? Number(pref.order) : (w?.watchIndex ?? item.watchIndex ?? 10000 + idx),
        tags: pref.tags || q?.sector || w?.sector || '', progress, updatedMs,
        typeLabel: atlasTypeLabel(companyNote, q), snippet: atlasSnippet(companyNote),
      };
    });
  }, [watch, quotes, quoteCache, companyNotes, creditNotes, atlasPrefs]);

  const atlasFolders = useMemo(() => {
    const set = new Set(ATLAS_DEFAULT_FOLDERS);
    atlasItems.forEach((x) => set.add(x.folder || '未分類'));
    return ['all', ...Array.from(set).filter(Boolean)];
  }, [atlasItems]);

  const visibleAtlasItems = useMemo(() => {
    const kw = atlasSearch.trim().toLowerCase();
    return atlasItems.filter((x) => {
      if (atlasFolderFilter !== 'all' && x.folder !== atlasFolderFilter) return false;
      if (!kw) return true;
      return [x.code, x.name, x.folder, x.tags, x.typeLabel, x.snippet].join(' ').toLowerCase().includes(kw);
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order - b.order) || (b.updatedMs - a.updatedMs) || a.code.localeCompare(b.code, 'ja'));
  }, [atlasItems, atlasSearch, atlasFolderFilter]);

  function updateAtlasPref(code, patch) {
    if (!code) return;
    setAtlasPrefs((prev) => ({ ...prev, [String(code)]: { ...(prev[String(code)] || {}), ...patch } }));
  }

  function moveAtlasItem(code, dir) {
    const list = visibleAtlasItems;
    const i = list.findIndex((x) => String(x.code) === String(code));
    const j = Math.max(0, Math.min(list.length - 1, i + dir));
    if (i < 0 || i === j) return;
    const current = list[i];
    const target = list[j];
    setAtlasPrefs((prev) => ({
      ...prev,
      [current.code]: { ...(prev[current.code] || {}), order: target.order },
      [target.code]: { ...(prev[target.code] || {}), order: current.order },
    }));
  }

  function openAtlasItem(item) {
    const q = item.q || item.w || { code: item.code, name: item.name, sector: item.tags || '' };
    openDetail({ ...q, code: item.code, name: item.name, sector: q.sector || item.tags || '' }, 'company');
  }

  function openDetail(q, tab = 'summary') {
    if (!q) return;
    setSelected({ code: q.code, name: q.name, sector: q.sector });
    setDetailTab(tab);
    setDetailOpen(true);
    setMobileBackView((prev) => mobileView && mobileView !== 'detail' ? mobileView : (prev || 'scanner'));
    setMobileView('detail');
    requestAnimationFrame(() => {
      document.querySelector('.panel.detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  }

  function updateCompanyNote(code, patch) {
    if (!code) return;
    setCompanyNotes((prev) => {
      const current = normalizeResearchNote(prev[String(code)]);
      const history = Array.isArray(current.history) ? current.history.slice(-9) : [];
      const incomingRaw = patch && Object.prototype.hasOwnProperty.call(patch, 'raw') ? String(patch.raw || '') : String(current.raw || '');
      if (String(current.raw || '').trim() && incomingRaw.trim() && incomingRaw !== String(current.raw || '')) {
        history.push({ raw: current.raw, savedAt: current.updatedAt || new Date().toISOString(), source: current.source || 'self' });
      }
      const nextNote = { ...current, ...patch, history, source: patch?.source || current.source || 'self', updatedAt: new Date().toISOString() };
      const next = { ...prev, [String(code)]: nextNote };
      setTimeout(() => { setDataTransferMsg('図鑑メモを保存しました。必要なら上部の「保存」でJSONを書き出してください'); setTimeout(() => setDataTransferMsg(''), 4200); }, 0);
      return next;
    });
  }

  function deleteCompanyNote(code) {
    if (!code) return;
    setCompanyNotes((prev) => { const next = { ...prev }; delete next[String(code)]; return next; });
  }

  function updateCreditNote(code, patch) {
    if (!code) return;
    setCreditNotes((prev) => {
      const key = String(code);
      const current = prev[key] || {};
      const now = new Date().toISOString();
      const snapshot = {
        sourceDate: patch.sourceDate || current.sourceDate || '',
        buyBalance: patch.buyBalance || current.buyBalance || '',
        sellBalance: patch.sellBalance || current.sellBalance || '',
        buyChange: patch.buyChange || current.buyChange || '',
        sellChange: patch.sellChange || current.sellChange || '',
        ratio: patch.ratio || current.ratio || '',
        memo: patch.memo || current.memo || '',
        savedAt: now,
      };
      const history = Array.isArray(current.history) ? current.history.slice(-7) : [];
      const last = history[history.length - 1];
      if (last && String(last.sourceDate || '') === String(snapshot.sourceDate || '')) history[history.length - 1] = snapshot;
      else history.push(snapshot);
      const nextNote = { ...current, ...patch, history, updatedAt: now };
      const next = { ...prev, [key]: nextNote };
      setTimeout(() => { setDataTransferMsg('信用需給を保存しました。必要なら上部の「保存」でJSONを書き出してください'); setTimeout(() => setDataTransferMsg(''), 4200); }, 0);
      return next;
    });
  }

  function deleteCreditNote(code) {
    if (!code) return;
    setCreditNotes((prev) => { const next = { ...prev }; delete next[String(code)]; return next; });
  }

  async function refresh(sourceOverride = scannerSource, codesOverride = null) {
    if (refreshInFlightRef.current) return;
    const source = sourceOverride || 'watch';
    if (source === 'watch' && watch.length === 0 && !codesOverride) return;
    // v37: scanPreview は非同期で、直前の検索対象のガードが残ることがある。
    // ここで止めると「プライムを押しても前のガードで動かない」状態になるため、
    // クライアント側では止めず、サーバー側 /api/universe-scan の最新条件でガード判定する。
    refreshInFlightRef.current = true;
    setLoading(true); setError('');
    try {
      let data;
      if (source === 'nikkei225' || source === 'growth' || source === 'prime' || source === 'standard' || source === 'topix' || source === 'all') {
        const universe = source === 'nikkei225' ? 'nikkei225' : source;
        const qs = new URLSearchParams({
          universe,
          maxPrice: String(nikkeiMaxPrice || 0),
          minPrice: String(scannerMinPrice || 0),
          minVolume: String(scannerMinVolume || 0),
          sector: scannerSector || 'all',
          maxCandidates: String(scanMaxCandidatesFor(source, scannerSector, scannerMinVolume, nikkeiMaxPrice)),
        });
        const res = await fetch(`${API}/api/universe-scan?${qs.toString()}`);
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'スキャンに失敗');
        setMarketMeta({ source, universe, allCount: data.allCount, fetchedCount: data.fetchedCount, underCount: data.underCount, maxPrice: data.maxPrice, minPrice: data.minPrice, minVolume: data.minVolume, sector: data.sector, masterSource: data.masterSource, guard: data.guard });
      } else {
        const codeList = codesOverride ?? watch.map((w) => w.code);
        const codes = codeList.join(',');
        const res = await fetch(`${API}/api/market?codes=${encodeURIComponent(codes)}`);
        data = await res.json();
        if (!res.ok) throw new Error(data.error || '価格取得に失敗');
        setMarketMeta({ source: 'watch', allCount: codeList.length, underCount: data.items?.length || 0 });
      }
      const merged = (data.items || []).map((q) => {
        const meta = watch.find((w) => String(w.code) === String(q.code));
        const name = q.name && q.name !== q.code ? cleanName(q.code, q.name) : cleanName(q.code, meta?.name);
        return { ...q, name: name || q.code, localName: name || q.code, sector: q.sector || meta?.sector || '' };
      });
      const broadSource = ['nikkei225','growth','prime','standard','topix','all'].includes(String(source));
      const looksLikeBadEmpty = broadSource && merged.length === 0 && Number(data.allCount || 0) > 0;
      if (looksLikeBadEmpty) {
        setError('広域スキャンが0件で返りました。通信または一括取得の欠損の可能性があるため、前回表示を保持しました。もう一度更新してください。');
        return;
      }
      const singleCodeOverride = source === 'watch' && Array.isArray(codesOverride) && codesOverride.length === 1;
      if (singleCodeOverride) {
        setQuotes((prev) => {
          const code = String(codesOverride[0]);
          const item = merged.find((x) => String(x.code) === code);
          if (!item) return prev;
          return prev.some((q) => String(q.code) === code)
            ? prev.map((q) => String(q.code) === code ? { ...q, ...item } : q)
            : prev;
        });
      } else {
        setQuotes(merged);
      }
      setQuoteCache((prev) => {
        const next = { ...prev };
        for (const item of merged) next[String(item.code)] = item;
        return next;
      });
      if (source === 'watch') {
        setWatch((prev) => prev.map((w) => {
          const q = merged.find((x) => String(x.code) === String(w.code));
          return q?.name && q.name !== q.code ? { ...w, name: q.name, sector: w.sector || q.sector || '' } : w;
        }));
      }
      if (!selectedRef.current && merged[0]) setSelected({ code: merged[0].code, name: merged[0].name, sector: merged[0].sector || '' });
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
    }
  }



  async function fetchIr(code) {
    if (!code) return;
    if (irCache[code]) return;
    setIrLoading(true); setIrError('');
    try {
      const res = await fetch(`${API}/api/ir/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'IR取得に失敗');
      setIrCache((prev) => ({ ...prev, [code]: data }));
    } catch (e) { setIrError(e.message); }
    setIrLoading(false);
  }

  useEffect(() => {
    if (selected?.code) fetchIr(selected.code);
  }, [selected?.code]);

  useEffect(() => { refresh('watch'); }, []);

  useEffect(() => {
    if (!refreshInterval) return;
    if (isMobile && !['scanner', 'watch', 'detail'].includes(mobileView)) return;
    const timer = setInterval(() => {
      if (isMobile) {
        if (mobileView === 'watch') refresh('watch');
        else if (mobileView === 'detail' && selected?.code) refresh('watch', [selected.code]);
        else refresh(scannerSource);
      } else {
        refresh();
      }
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, isMobile, mobileView, selected?.code, watch, scannerSource, nikkeiMaxPrice, scannerMinPrice, scannerMinVolume, scannerSector]);

  const refreshOption = REFRESH_OPTIONS.find((o) => o.value === refreshInterval) || REFRESH_OPTIONS[1];
  const scanSize = scannerSource !== 'watch' ? (marketMeta?.underCount || 80) : watch.length;
  const intervalWarning = scannerSource !== 'watch' && refreshInterval <= 10_000
    ? '広域スキャンは取得数が多いので、通常は30秒か15秒推奨です。10秒以下は失敗しやすくなります。'
    : refreshInterval <= 5_000 && scanSize > 5
      ? '5秒更新は5銘柄以下推奨です。監視数が多い場合は失敗しやすくなります。'
      : refreshInterval <= 10_000 && scanSize > 10
        ? '10秒更新は10銘柄以下推奨です。重い場合は15秒以上にしてください。'
        : refreshOption.caution;

  async function addCode() {
    const query = newInput.trim();
    if (!query) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/api/resolve?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '銘柄を見つけられませんでした');
      const row = { code: data.code, name: cleanName(data.code, data.name || data.code), sector: data.sector || '' };
      const exists = watch.some((w) => String(w.code).toUpperCase() === String(row.code).toUpperCase());
      const newCodes = exists ? watch.map((w) => w.code) : [row.code, ...watch.map((w) => w.code)];
      setWatch((prev) => prev.some((w) => String(w.code).toUpperCase() === String(row.code).toUpperCase()) ? prev : [row, ...prev]);
      setSelected(row);
      setMobileBackView('search');
      setMobileView('detail');
      setNewInput('');
      setTimeout(() => refresh('watch', newCodes), 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }



  async function investigateDrop(query) {
    const target = String(query || dropInput || selected?.code || '').trim();
    if (!target) { setDropError('コードまたは銘柄名を入力してください'); return; }
    setDropLoading(true); setDropError('');
    try {
      const res = await fetch(`${API}/api/drop-reason?q=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '急落理由の取得に失敗');
      setDropReport(data);
      const row = { code: data.code, name: cleanName(data.code, data.name || data.code), sector: data.quote?.sector || '' };
      setSelected(row);
      setWatch((prev) => prev.some((w) => String(w.code) === String(row.code)) ? prev : [row, ...prev]);
      setQuotes((prev) => {
        const nextQuote = { ...(data.quote || {}), name: row.name };
        const exists = prev.some((q) => String(q.code) === String(row.code));
        return exists ? prev.map((q) => String(q.code) === String(row.code) ? { ...q, ...nextQuote } : q) : [nextQuote, ...prev];
      });
      setDropInput('');
    } catch (e) { setDropError(e.message); }
    setDropLoading(false);
  }

  function removeCode(code) {
    setWatch(watch.filter((w) => w.code !== code));
    setQuotes(quotes.filter((q) => q.code !== code));
    if (selected?.code === code) setSelected(null);
  }

  function moveWatchItem(fromCode, toCode) {
    if (!fromCode || !toCode || String(fromCode) === String(toCode)) return;
    setWatch((prev) => {
      const from = prev.findIndex((w) => String(w.code) === String(fromCode));
      const to = prev.findIndex((w) => String(w.code) === String(toCode));
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function toggleMiniChart(q, e) {
    e?.stopPropagation?.();
    const code = String(q?.code || '');
    if (!code) return;
    const current = miniChartMode[code] || 'day';
    const nextMode = current === '5m' ? 'day' : '5m';
    setMiniChartMode((prev) => ({ ...prev, [code]: nextMode }));
    if (nextMode !== '5m' || miniChartCache[code] || miniChartLoading[code]) return;
    setMiniChartLoading((prev) => ({ ...prev, [code]: true }));
    try {
      const res = await fetch(`${API}/api/chart/${encodeURIComponent(code)}?range=1d&interval=5m`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '5分足取得に失敗');
      setMiniChartCache((prev) => ({ ...prev, [code]: data }));
    } catch (err) {
      setError(`${code} 5分足: ${err.message}`);
      setMiniChartMode((prev) => ({ ...prev, [code]: 'day' }));
    } finally {
      setMiniChartLoading((prev) => ({ ...prev, [code]: false }));
    }
  }

  const rows = useMemo(() => {
    let list = [...quotes].filter((q) => !q.error);
    if (scannerMode === 'state') {
      if (filter === 'distortion') list = list.filter((q) => /歪み|期待値/.test([...(q.stateTags || []), q.statePrimary || ''].join(' ')) || (q.distortionScore || 0) >= 50);
      if (filter === 'overshoot') list = list.filter((q) => (q.overshootScore || 0) >= 50);
      if (filter === 'trial') list = list.filter((q) => /試し玉|反発|戻り/.test([...(q.stateActions || []), q.statePrimary || ''].join(' ')));
      if (filter === 'trend') list = list.filter((q) => /上昇|ブレイク|浅押し|反転初動|下降抜け/.test([...(q.stateTags || []), q.statePrimary || ''].join(' ')));
      if (filter === 'risk') list = list.filter((q) => /小ロット|材料確認|出来高投げ|待ち/.test((q.stateConstraints || []).join(' ')) || (q.materialSeverity || 0) >= 70);
      if (filter === 'avoid') list = list.filter((q) => /触らない/.test(q.statePrimary || ''));
    } else if (scannerMode === 'trend') {
      if (filter === 'oshime') list = list.filter((q) => /候補/.test(q.trendJudge || ''));
      if (filter === 'breakout') list = list.filter((q) => q.trendKind === 'breakout');
      if (filter === 'sustained') list = list.filter((q) => q.trendKind === 'sustained' || q.trendKind === 'sustained_extended');
      if (filter === 'down') list = list.filter((q) => (q.trendDangerScore || 0) >= 45 || /過熱|注意/.test(q.trendJudge || ''));
      if (filter === 'rr') list = list.filter((q) => (q.trendRR || 0) >= 1.5);
    } else if (scannerMode === 'bottom') {
      if (filter === 'trial') list = list.filter((q) => /試し玉|短期リバ/.test(q.bottomJudge || ''));
      if (filter === 'rebound') list = list.filter((q) => (q.reboundScore || 0) >= 35);
      if (filter === 'raise') list = list.filter((q) => /切り上げ|横ばい/.test(q.lowerBaseLabel || ''));
      if (filter === 'slow') list = list.filter((q) => /浅押し|緩やか/.test(q.bottomJudge || '') || (q.slowRiseScore || 0) >= 45);
      if (filter === 'danger') list = list.filter((q) => (q.bottomDangerScore || 0) >= 60 || /触らない/.test(q.bottomJudge || ''));
      if (filter === 'rr') list = list.filter((q) => (q.bottomRR || 0) >= 1.3);
    } else {
      if (filter === 'oshime') list = list.filter((q) => q.score >= 45);
      if (filter === 'down') list = list.filter((q) => q.changePct < 0);
      if (filter === 'rr') list = list.filter((q) => q.predictedRR >= 1.3);
    }
    const valueOf = (q, key) => {
      const map = {
        code: q.code,
        price: Number(q.price),
        changePct: Number(q.changePct),
        score: Number(q.score),
        danger: Number(q.dangerScore),
        rr: Number(q.predictedRR),
        trendScore: Number(q.trendScore),
        trendSafety: Number(q.trendSafetyScore),
        trendDanger: Number(q.trendDangerScore),
        trendRR: Number(q.trendRR),
        bottomScore: Number(q.bottomScore),
        reboundScore: Number(q.reboundScore),
        lowerBaseScore: Number(q.lowerBaseScore),
        bottomDanger: Number(q.bottomDangerScore),
        bottomRR: Number(q.bottomRR),
        slowRiseScore: Number(q.slowRiseScore),
        per: Number(q.per),
        pbr: Number(q.pbr),
        dividendYield: Number(q.dividendYield),
        stateScore: Number(q.stateScore),
        overshootScore: Number(q.overshootScore),
        distortionScore: Number(q.distortionScore),
        healthScore: Number(q.healthScore),
        materialSeverity: Number(q.materialSeverity),
      };
      return map[key];
    };
    if (!sortSpec || sortSpec.key === 'default') {
      if (scannerMode === 'state') return list.sort((a, b) => (b.stateScore || 0) - (a.stateScore || 0));
      if (scannerMode === 'trend') return list.sort((a, b) => ((b.trendScore || 0) - (b.trendDangerScore || 0) / 2) - ((a.trendScore || 0) - (a.trendDangerScore || 0) / 2));
      if (scannerMode === 'bottom') return list.sort((a, b) => ((b.bottomScore || 0) + (b.reboundScore || 0) * 0.25 + (b.slowRiseScore || 0) * 0.20 - (b.bottomDangerScore || 0) * 0.25) - ((a.bottomScore || 0) + (a.reboundScore || 0) * 0.25 + (a.slowRiseScore || 0) * 0.20 - (a.bottomDangerScore || 0) * 0.25));
      return list.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
    const dir = sortSpec.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const av = valueOf(a, sortSpec.key), bv = valueOf(b, sortSpec.key);
      const an = Number.isFinite(av), bn = Number.isFinite(bv);
      if (an && bn) return (av - bv) * dir;
      if (an) return -1;
      if (bn) return 1;
      return String(av ?? '').localeCompare(String(bv ?? ''), 'ja') * dir;
    });
  }, [quotes, filter, scannerMode, sortSpec]);


  function addToWatch(q) {
    if (!q?.code) return;
    const code = String(q.code);
    let added = false;
    setWatch((prev) => {
      if (prev.some((w) => String(w.code) === code)) return prev;
      added = true;
      return [{ code: q.code, name: q.name || q.localName || q.code, sector: q.sector || '' }, ...prev];
    });
    setDataTransferMsg(added ? `${code} を監視に追加しました` : `${code} はすでに監視中です`);
    setTimeout(() => setDataTransferMsg(''), 2500);
  }

  function removeFromWatch(q) {
    if (!q?.code) return;
    const code = String(q.code);
    setWatch((prev) => prev.filter((w) => String(w.code) !== code));
    setDataTransferMsg(`${code} を監視から削除しました`);
    setTimeout(() => setDataTransferMsg(''), 2500);
  }

  function toggleWatch(q) {
    if (!q?.code) return;
    const exists = watch.some((w) => String(w.code) === String(q.code));
    if (exists) removeFromWatch(q);
    else addToWatch(q);
  }

  function moveWatch(q, dir) {
    if (!q?.code) return;
    const code = String(q.code);
    setWatch((prev) => {
      const list = [...prev];
      const i = list.findIndex((w) => String(w.code) === code);
      if (i < 0) return prev;
      const j = Math.max(0, Math.min(list.length - 1, i + dir));
      if (i === j) return prev;
      const [item] = list.splice(i, 1);
      list.splice(j, 0, item);
      return list;
    });
    setDataTransferMsg(`${code} の監視順を${dir < 0 ? '上' : '下'}へ移動しました`);
    setTimeout(() => setDataTransferMsg(''), 1600);
  }



  function buildLocalPayload(overrides = {}) {
    const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1');
    return {
      app: 'soubayugami-kansokuki',
      version: APP_VERSION,
      savedAt: new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      watch,
      manual,
      scannerMode,
      refreshInterval,
      scannerSource,
      nikkeiMaxPrice,
      scannerMinPrice,
      scannerMinVolume,
      scannerSector,
      sortSpec,
      companyResearchNotes: companyNotes,
      creditBalanceNotes: creditNotes,
      atlasPrefs,
      ...(isDebug ? {
        _debugQuotes: quotes,
        _debugCapturedAt: new Date().toISOString(),
      } : {}),
      ...overrides,
    };
  }

  function applyLocalData(data, message = '保存データを反映しました') {
    if (!data || typeof data !== 'object') throw new Error('保存データの形式が不正です');
    if (Array.isArray(data.watch)) setWatch(data.watch);
    if (typeof data.manual === 'string') setManual(data.manual);
    if (data.scannerMode) setScannerMode(data.scannerMode);
    if ('refreshInterval' in data) setRefreshInterval(data.refreshInterval);
    if (data.scannerSource) setScannerSource(data.scannerSource);
    if ('nikkeiMaxPrice' in data) setNikkeiMaxPrice(Number(data.nikkeiMaxPrice) || 3000);
    if ('scannerMinPrice' in data) setScannerMinPrice(Number(data.scannerMinPrice) || 0);
    if ('scannerMinVolume' in data) setScannerMinVolume(Number(data.scannerMinVolume) || 0);
    if (data.scannerSector) setScannerSector(data.scannerSector);
    if (data.sortSpec && typeof data.sortSpec === 'object') setSortSpec(data.sortSpec);
    if (data.companyResearchNotes && typeof data.companyResearchNotes === 'object') setCompanyNotes(data.companyResearchNotes);
    if (data.creditBalanceNotes && typeof data.creditBalanceNotes === 'object') setCreditNotes(data.creditBalanceNotes);
    if (data.atlasPrefs && typeof data.atlasPrefs === 'object') setAtlasPrefs(data.atlasPrefs);
    setDataTransferMsg(message);
    setTimeout(() => setDataTransferMsg(''), 6000);
  }

  function saveCurrentStateLocal() {
    exportLocalData();
  }

  function restoreCurrentStateLocal() {
    importFileRef.current?.click();
  }

  function exportLocalData() {
    const payload = buildLocalPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    a.href = url;
    a.download = `soubayugami-atlas-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const now = new Date().toISOString();
    setLastExportAt(now);
    save('lastExportAt', now);
    setDataTransferMsg('図鑑JSONを保存しました');
    setTimeout(() => setDataTransferMsg(''), 4000);
  }

  async function importLocalDataFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      applyLocalData(data, '図鑑JSONを読み込みました。監視銘柄・会社調査・信用需給も上書き反映済みです。');
    } catch (e) {
      setDataTransferMsg(`読み込み失敗: ${e.message}`);
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  }

  function importManual() {
    const parsed = manual.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [code, name, sector] = line.split(/[\t,]/).map((x) => x?.trim());
      return code ? { code, name: name || code, sector: sector || '' } : null;
    }).filter(Boolean);
    if (parsed.length) setWatch(parsed);
  }

  const freshnessSec = lastUpdated ? Math.max(0, Math.floor((clockTick - lastUpdated.getTime()) / 1000)) : null;
  const freshnessText = freshnessSec == null ? '未更新' : freshnessSec < 60 ? `${freshnessSec}秒前` : `${Math.floor(freshnessSec/60)}分前`;
  const freshnessClass = freshnessSec == null ? 'stale' : freshnessSec > 180 ? 'stale' : freshnessSec > 60 ? 'warn' : 'fresh';
  const jsonSaveDays = lastExportAt ? Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000) : null;
  const jsonSaveText = jsonSaveDays == null ? 'JSON未保存' : jsonSaveDays === 0 ? 'JSON保存: 今日' : `JSON保存: ${jsonSaveDays}日前`;
  const jsonSaveClass = jsonSaveDays == null || jsonSaveDays >= 14 ? 'staleHard' : jsonSaveDays >= 7 ? 'staleSoft' : 'fresh';

  const scannerTitle = scannerMode === 'state' ? '状態タグ' : scannerMode === 'trend' ? '順張り' : scannerMode === 'bottom' ? '試し玉・戻り' : '押し目・歪み';
  const sourceSummary = scannerSource === 'watch'
    ? `監視リスト / ${watch.length}件`
    : `${sourceLabel(scannerSource)} / ${fmt(scannerMinPrice)}〜${fmt(nikkeiMaxPrice)}円 / 出来高${fmt(scannerMinVolume)}以上`;
  const activeMobileQuote = selectedQuote || (selected ? quoteCache[String(selected.code)] : null);
  const watchQuotes = watch.map((w) => quotes.find((q) => String(q.code) === String(w.code)) || quoteCache[String(w.code)] || w);
  const watchMovers = watchQuotes
    .map((q) => {
      const prev = Number(lastSeen?.prices?.[String(q.code)]);
      const price = Number(q.price);
      const deltaPct = Number.isFinite(prev) && prev > 0 && Number.isFinite(price) ? ((price - prev) / prev) * 100 : 0;
      return { q, deltaPct };
    })
    .filter((x) => Math.abs(x.deltaPct) >= 2)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 3);
  const todayCards = watchQuotes
    .map((q) => {
      const atlas = atlasProgress(companyNotes[String(q.code)], creditNotes[String(q.code)], q);
      const updated = companyNotes[String(q.code)]?.updatedAt ? new Date(companyNotes[String(q.code)].updatedAt).getTime() : 0;
      const staleDays = updated ? Math.floor((Date.now() - updated) / 86400000) : 999;
      const reason = atlas.level <= 2 ? `図鑑 ${atlas.stars}` : staleDays >= 30 ? `${staleDays}日未更新` : '';
      return { q, atlas, staleDays, reason };
    })
    .filter((x) => x.reason)
    .sort((a, b) => (a.atlas.level - b.atlas.level) || (b.staleDays - a.staleDays))
    .slice(0, 3);

  const markWatchSeen = () => {
    const prices = {};
    watchQuotes.forEach((q) => { if (Number.isFinite(Number(q.price))) prices[String(q.code)] = Number(q.price); });
    setLastSeen({ at: new Date().toISOString(), prices });
    setDataTransferMsg('監視銘柄の現在値を前回基準として保存しました');
    setTimeout(() => setDataTransferMsg(''), 2500);
  };
  const openMobileScanner = (source = 'all') => { setMobileView('scanner'); setScannerSource(source); refresh(source); };
  const mobileSourceButtons = [['watch','監視'],['all','全候補'],['growth','グロース'],['prime','プライム'],['nikkei225','日経225'],['standard','スタンダード'],['topix','TOPIX近似']];
  const mobileModeButtons = [['state','状態'],['oshime','押し目'],['bottom','試し玉'],['trend','順張り']];
  const mobileFilterButtons = scannerMode === 'state'
    ? [['all','全部'],['trend','上昇'],['trial','試し'],['distortion','歪み'],['overshoot','歪み度50+'],['avoid','回避']]
    : scannerMode === 'trend'
      ? [['all','全部'],['oshime','候補'],['breakout','ブレイク'],['sustained','持続'],['down','過熱'],['rr','RR']]
      : scannerMode === 'bottom'
        ? [['all','全部'],['trial','試し'],['rebound','戻り'],['raise','下値'],['danger','危険'],['rr','RR']]
        : [['all','全部'],['oshime','押し目'],['down','下落'],['rr','RR']];
  const mobileDetailList = mobileBackView === 'scanner' ? rows : watchQuotes;
  const mobileDetailIndex = selected ? mobileDetailList.findIndex((q) => String(q.code) === String(selected.code)) : -1;
  const prevMobileQuote = mobileDetailIndex > 0 ? mobileDetailList[mobileDetailIndex - 1] : null;
  const nextMobileQuote = mobileDetailIndex >= 0 && mobileDetailIndex < mobileDetailList.length - 1 ? mobileDetailList[mobileDetailIndex + 1] : null;
  const jumpMobileDetail = (q) => q && openDetail(q, detailTab || 'summary');

  return <>
    <input ref={importFileRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={(e) => importLocalDataFile(e.target.files?.[0])} />
    {isMobile && <div className="mobileApp">
      <div className="mobileShell">
        
        <div className="mobileBrand mobileBrandCompact"><span>{APP_VERSION}</span><em>動く銘柄図鑑 / {lastUpdated ? `最終更新 ${lastUpdated.toLocaleTimeString('ja-JP')}` : '未更新'}</em></div>

        {mobileView === 'scanner' && <section className="mobilePage">
          <div className="mobilePageHead noBack">
            <div><h1>探索</h1><p>{scannerTitle} / {sourceSummary}</p></div>
            <button className="smallAction" onClick={() => refresh(scannerSource)} disabled={loading}>{loading ? '取得中' : '更新'}</button>
          </div>
          <div className="mobileControlStrip">
            {mobileSourceButtons.map(([k,label]) => <button key={k} className={scannerSource===k?'active':''} onClick={() => { setScannerSource(k); refresh(k); }}>{label}</button>)}
          </div>
          <div className="mobileModeStrip">
            {mobileModeButtons.map(([k,label]) => <button key={k} className={scannerMode===k?'active':''} onClick={() => { setScannerMode(k); setFilter('all'); setSortSpec({ key: 'default', dir: 'desc' }); }}>{label}</button>)}
          </div>
          <div className="mobileSortStrip"><span>並び替え</span>{mobileSortOptions(scannerMode).map((opt) => <button key={`${opt.key}-${opt.dir}`} className={isSameSort(sortSpec, opt) ? 'active' : ''} onClick={() => setSortSpec({ key: opt.key, dir: opt.dir })}>{opt.label}</button>)}</div>
          <div className="mobileFilterSummary">
            <button onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}>{mobileFiltersOpen ? '条件を閉じる' : '条件変更'}</button>
            <span>{rows.length}件表示</span>
          </div>
          {mobileFiltersOpen && <div className="mobileFilters">
            <label>セクター<select value={scannerSector} onChange={(e) => setScannerSector(e.target.value)} disabled={scannerSource === 'watch'}>{SECTOR_OPTIONS.map(([k,label]) => <option key={k} value={k}>{label}</option>)}</select></label>
            <label>下限<input type="number" inputMode="numeric" pattern="[0-9]*" value={scannerMinPrice} onChange={(e) => setScannerMinPrice(Number(e.target.value) || 0)} /></label>
            <label>上限<input type="number" inputMode="numeric" pattern="[0-9]*" value={nikkeiMaxPrice} onChange={(e) => setNikkeiMaxPrice(Number(e.target.value) || 3000)} /></label>
            <label>出来高<input type="number" inputMode="numeric" pattern="[0-9]*" value={scannerMinVolume} onChange={(e) => setScannerMinVolume(Number(e.target.value) || 0)} /></label>
            <button className="fullAction" onClick={() => { refresh(scannerSource); setMobileFiltersOpen(false); }}>この条件で再スキャン</button>
          </div>}
          <div className="mobileFilterChips">
            {mobileFilterButtons.map(([k,label]) => <button key={k} className={filter===k?'active':''} onClick={() => setFilter(k)}>{label}</button>)}
            {scannerMode === 'state' && <button className="overshootPreset" onClick={() => { setFilter('overshoot'); setSortSpec({ key: 'overshootScore', dir: 'desc' }); setMobileFiltersOpen(false); }}>⚡ 歪み探索</button>}
          </div>
          {error && <div className="mobileError">{error}</div>}
          {dataTransferMsg && <div className="mobileToast">{dataTransferMsg}</div>}
          <div className="mobileCards">{rows.map((q) => <MobileQuoteCard key={q.code} q={q} mode={scannerMode} selected={selected} watched={watch.some(w => String(w.code) === String(q.code))} companyNote={companyNotes[String(q.code)]} creditNote={creditNotes[String(q.code)]} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={toggleMiniChart} onOpen={(tab='summary') => openDetail(q, tab)} onWatch={() => toggleWatch(q)} />)}</div>
          {!loading && rows.length === 0 && <div className="mobileEmpty">表示できる候補がありません。条件を変えるか更新してください。</div>}
        </section>}

        {mobileView === 'watch' && <section className="mobilePage">
          <div className="mobilePageHead noBack watchHead">
            <div><h1>図鑑</h1><p>{watch.length}件 <em className={`jsonFreshness ${jsonSaveClass}`}>{jsonSaveText}</em></p></div>
            <div className="mobileHeadActions">
              <button className="smallAction" onClick={() => refresh('watch')} disabled={loading}>{loading ? '取得中' : '更新'}</button>
              <button className="smallAction saveAction" title="監視銘柄・会社調査・信用需給・条件をJSONファイルに丸ごと保存" onClick={exportLocalData}>保存</button>
              <button className="smallAction loadAction" title="保存した図鑑JSONを読み込み" onClick={restoreCurrentStateLocal}>読込</button>
            </div>
          </div>
          {dataTransferMsg && <div className="mobileToast">{dataTransferMsg}</div>}
          <div className="mobileAtlasListWrap">
            <AtlasListPanel
              items={visibleAtlasItems}
              folders={atlasFolders}
              folderFilter={atlasFolderFilter}
              setFolderFilter={setAtlasFolderFilter}
              search={atlasSearch}
              setSearch={setAtlasSearch}
              open={atlasListOpen}
              setOpen={setAtlasListOpen}
              onOpenItem={openAtlasItem}
              onTogglePin={(item) => updateAtlasPref(item.code, { pinned: !item.pinned })}
              onMove={(item, dir) => moveAtlasItem(item.code, dir)}
              onFolderChange={(item, folder) => updateAtlasPref(item.code, { folder })}
              onAddWatch={(item) => addToWatch(item.q || item.w || { code: item.code, name: item.name, sector: item.tags || '' })}
            />
          </div>
          {!loading && visibleAtlasItems.length === 0 && <div className="mobileEmpty">図鑑一覧に表示できる銘柄がありません。検索やフォルダ条件を変えてください。</div>}
        </section>}

        {mobileView === 'search' && <section className="mobilePage">
          <div className="mobilePageHead noBack"><div><h1>調べる</h1><p>コードまたは銘柄名から図鑑カード作成</p></div></div>
          <div className="mobileSearchBox"><input placeholder="例: 3687 / フィックスターズ" value={newInput} onChange={(e) => setNewInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCode()} /><button onClick={addCode} disabled={loading}>{loading ? '検索中' : '追加'}</button></div>
          <p className="mobileHint">追加後は監視銘柄に入り、そのまま詳細画面を開きます。</p>
        </section>}

        {mobileView === 'detail' && <section className="mobilePage">
          <div className="mobilePageHead"><button className="backBtn" onClick={() => setMobileView(mobileBackView || 'watch')}>←</button><div><h1>{selected?.code || '銘柄'} {selected?.name || ''}</h1><p>{activeMobileQuote ? `${yen(activeMobileQuote.price)} / ${pct(activeMobileQuote.changePct)}` : '詳細'}</p></div><button className="smallAction" onClick={() => selected && refresh('watch', [selected.code])}>更新</button></div>
          {selected ? <div className="mobileDetailCard"><Detail mobile q={activeMobileQuote} selected={selected} activeTab={detailTab} setActiveTab={setDetailTab} research={research} ir={irCache[selected.code]} irLoading={irLoading} irError={irError} dropReport={dropReport?.code === selected.code ? dropReport : null} dropLoading={dropLoading} onInvestigate={() => investigateDrop(selected.code)} onReloadIr={() => { setIrCache((prev) => { const next = { ...prev }; delete next[selected.code]; return next; }); fetchIr(selected.code); }} companyNote={companyNotes[String(selected.code)]} onUpdateCompanyNote={updateCompanyNote} onDeleteCompanyNote={deleteCompanyNote} creditNote={creditNotes[String(selected.code)]} onUpdateCreditNote={updateCreditNote} onDeleteCreditNote={deleteCreditNote} onSaveAtlas={saveCurrentStateLocal} /></div> : <div className="mobileEmpty">銘柄が選択されていません。</div>}
        </section>}

        {mobileView === 'settings' && <section className="mobilePage">
          <div className="mobilePageHead noBack"><div><h1>設定</h1><p>図鑑データ・JSONバックアップ</p></div></div>
          <div className="mobileSettings"><h2>図鑑JSON</h2><p className="mobileHint">監視銘柄・会社調査・信用需給・条件を、JSONファイルとして丸ごと保存/読み込みします。Safariのキャッシュを消す前やバージョン更新前は保存してください。</p><button className="primary saveAtlasBig" onClick={saveCurrentStateLocal}>図鑑JSON保存</button><button onClick={restoreCurrentStateLocal}>図鑑JSON読込（上書き）</button>{dataTransferMsg && <p>{dataTransferMsg}</p>}<h2>自動更新</h2><div className="mobileFilterChips">{REFRESH_OPTIONS.map((opt) => <button key={opt.value} className={refreshInterval === opt.value ? 'active' : ''} onClick={() => setRefreshInterval(opt.value)}>{opt.label}</button>)}</div>{intervalWarning && <p className="mobileHint">{intervalWarning}</p>}</div>
        </section>}
        <nav className="mobileTabBar" aria-label="主要画面">
          <button className={mobileView === 'watch' ? 'active' : ''} onClick={() => { setMobileView('watch'); refresh('watch'); }}>図鑑</button>
          <button className={mobileView === 'scanner' ? 'active' : ''} onClick={() => { setMobileView('scanner'); openMobileScanner(scannerSource === 'watch' ? 'all' : scannerSource); }}>探索</button>
          <button className={mobileView === 'search' ? 'active' : ''} onClick={() => setMobileView('search')}>調べる</button>
          <button className={mobileView === 'settings' ? 'active' : ''} onClick={() => setMobileView('settings')}>設定</button>
        </nav>
      </div>
    </div>}

    {!isMobile && <div className="legacyApp"><div className="app">
    <header className="topbar compactTopbar">
      <div className="appVersion" title="現在のアプリ版">{APP_VERSION}</div>
      <div className="actions">
        <div className="mobileStatusBar">
          <div className="refreshStatus">
            <span>{refreshInterval ? `${refreshOption.label}自動更新 ON` : '自動更新 OFF'}</span>
            <em className={`freshness ${freshnessClass}`}>{lastUpdated ? `最終更新 ${lastUpdated.toLocaleTimeString('ja-JP')} / ${freshnessText}` : '未更新'}</em>
          </div>
          <div className="mobileQuickActions">
            <button className="refreshMiniBtn" onClick={refresh} disabled={loading}>{loading ? '取得中' : '更新'}</button>
            <button className={controlDrawerOpen ? 'drawerToggle activeToggle' : 'drawerToggle'} onClick={() => setControlDrawerOpen(!controlDrawerOpen)}>{controlDrawerOpen ? '操作を閉じる' : '操作'}</button>
          </div>
        </div>
        <div className={controlDrawerOpen ? 'controlDrawer open' : 'controlDrawer'}>
        <div className="topScanControls">
          <div className="sourceTabs compactSource">
            <button className={scannerSource === 'watch' ? 'active' : ''} onClick={() => { setScannerSource('watch'); refresh('watch'); }}>監視</button>
            <button className={scannerSource === 'all' ? 'active' : ''} onClick={() => { setScannerSource('all'); refresh('all'); }}>全候補</button>
            <button className={scannerSource === 'nikkei225' ? 'active' : ''} onClick={() => { setScannerSource('nikkei225'); refresh('nikkei225'); }}>日経225</button>
            <button className={scannerSource === 'growth' ? 'active' : ''} onClick={() => { setScannerSource('growth'); refresh('growth'); }}>グロース</button>
            <button className={scannerSource === 'prime' ? 'active' : ''} onClick={() => { setScannerSource('prime'); refresh('prime'); }}>プライム</button>
            <button className={scannerSource === 'standard' ? 'active' : ''} onClick={() => { setScannerSource('standard'); refresh('standard'); }}>スタンダード</button>
            <button className={scannerSource === 'topix' ? 'active' : ''} onClick={() => { setScannerSource('topix'); refresh('topix'); }}>TOPIX近似</button>
          </div>
          <label>セクター<select value={scannerSector} onChange={(e) => { setScannerSector(e.target.value); setTimeout(() => refresh(scannerSource), 0); }} disabled={scannerSource === 'watch'}>{SECTOR_OPTIONS.map(([k,label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label>下限<input type="number" inputMode="numeric" pattern="[0-9]*" value={scannerMinPrice} onChange={(e) => setScannerMinPrice(Number(e.target.value) || 0)} onKeyDown={(e) => e.key === 'Enter' && refresh(scannerSource)} /></label>
          <label>上限<input type="number" inputMode="numeric" pattern="[0-9]*" value={nikkeiMaxPrice} onChange={(e) => setNikkeiMaxPrice(Number(e.target.value) || 3000)} onKeyDown={(e) => e.key === 'Enter' && refresh(scannerSource)} /></label>
          <label>出来高<input type="number" inputMode="numeric" pattern="[0-9]*" value={scannerMinVolume} onChange={(e) => setScannerMinVolume(Number(e.target.value) || 0)} onKeyDown={(e) => e.key === 'Enter' && refresh(scannerSource)} /></label>
          {scannerSource !== 'watch' && <div className={`scanPreview ${scanPreview?.guard?.block ? 'block' : 'ok'}`}>
            {scanPreviewLoading ? '探索件数確認中…' : scanPreview?.error ? `探索確認失敗: ${scanPreview.error}` : scanPreview ? `候補${fmt(scanPreview.candidateCount)}件 / 推定${fmt(scanPreview.guard?.estimateSeconds)}秒${scanPreview.guard?.block ? ' / 条件を絞ってください' : ''}` : '探索件数 —'}
          </div>}
        </div>
        <div className="intervalButtons" title={intervalWarning}>
          {REFRESH_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={refreshInterval === opt.value ? 'activeToggle' : ''}
              onClick={() => setRefreshInterval(opt.value)}
            >{opt.label}</button>
          ))}
        </div>
        <div className="layoutButtons">
          {[['balanced','標準'],['scanner','一覧広め'],['detail','詳細広め']].map(([k,label]) => (
            <button key={k} className={layoutMode === k ? 'activeToggle' : ''} onClick={() => setLayoutMode(k)}>{label}</button>
          ))}
          <button className={!sidebarOpen ? 'activeToggle' : ''} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? '左格納' : '左表示'}</button>
          <button className={!detailOpen ? 'activeToggle' : ''} onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? '右格納' : '右表示'}</button>
        </div>
        <button className="refreshMainBtn" onClick={refresh} disabled={loading}>{loading ? '取得中…' : '価格更新'}</button>
        <div className="dataTools">
          <button className="sub" onClick={exportLocalData}>JSON保存</button>
          <button className="sub" onClick={restoreCurrentStateLocal}>JSON読込</button>
          {lastExportAt && <span className={`jsonFreshness ${jsonSaveClass}`}>{jsonSaveText}</span>}
          {dataTransferMsg && <span>{dataTransferMsg}</span>}
        </div>
        {intervalWarning && <div className="intervalWarning">{intervalWarning}</div>}
        </div>
      </div>
    </header>
    {error && <div className="error">{error}</div>}

    <main className={`layout ${!sidebarOpen ? 'sidebarClosed' : ''} ${!detailOpen ? 'detailClosed' : ''} mode-${layoutMode}`}>
      <aside className={`panel watch ${!sidebarOpen ? 'collapsed' : ''}`}>
        <button className="sideToggle" onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? '監視格納' : '監視'}</button>
        <div className="watchInner">
        <h2>監視リスト</h2>
        <div className="addrow single">
          <input placeholder="コードまたは銘柄名（例: 3687 / フィックスターズ / ソニー）" value={newInput} onChange={(e) => setNewInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCode()} />
          <button onClick={addCode} disabled={loading}>{loading ? '検索中…' : '追加'}</button>
        </div>
        <div className="dropQuickBox">
          <div className="quickTitle">急落理由クイック調査</div>
          <div className="addrow single">
            <input placeholder="気になる銘柄（例: 1332 / ニッスイ）" value={dropInput} onChange={(e) => setDropInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && investigateDrop()} />
            <button onClick={() => investigateDrop()} disabled={dropLoading}>{dropLoading ? '調査中…' : '調査'}</button>
          </div>
          <button className="sub smallBtn" onClick={() => investigateDrop(selected?.code)} disabled={!selected || dropLoading}>選択銘柄を調査</button>
          {dropError && <div className="miniError">{dropError}</div>}
          {dropReport && <div className={`dropMini ${dropReport.diagnosis?.className || 'wait'}`}>
            <b>{dropReport.code} {dropReport.name}</b>
            <span>{dropReport.diagnosis?.level}</span>
            <p>{dropReport.diagnosis?.summary}</p>
          </div>}
        </div>
        <AtlasListPanel
          items={visibleAtlasItems}
          folders={atlasFolders}
          folderFilter={atlasFolderFilter}
          setFolderFilter={setAtlasFolderFilter}
          search={atlasSearch}
          setSearch={setAtlasSearch}
          open={atlasListOpen}
          setOpen={setAtlasListOpen}
          onOpenItem={openAtlasItem}
          onTogglePin={(item) => updateAtlasPref(item.code, { pinned: !item.pinned })}
          onMove={(item, dir) => moveAtlasItem(item.code, dir)}
          onFolderChange={(item, folder) => updateAtlasPref(item.code, { folder })}
          onAddWatch={(item) => addToWatch(item.q || item.w || { code: item.code, name: item.name, sector: item.tags || '' })}
        />
        <div className="watchlist">{watch.map((w) => (
          <div
            key={w.code}
            draggable
            className={`watchitem ${selected?.code === w.code ? 'active' : ''} ${dragCode === w.code ? 'dragging' : ''}`}
            onClick={() => setSelected(w)}
            onDragStart={(e) => { setDragCode(w.code); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e) => { e.preventDefault(); moveWatchItem(dragCode, w.code); setDragCode(null); }}
            onDragEnd={() => setDragCode(null)}
            title="ドラッグして上下に並べ替え"
          >
            <div className="dragGrip">⋮⋮</div>
            <div className="watchLabel"><b>{w.code}</b><span>{w.name}</span>{companyNotes[String(w.code)] && <em className="researchedMini">調査済</em>}</div>
            <button onClick={(e) => { e.stopPropagation(); removeCode(w.code); }}>×</button>
          </div>
        ))}</div>
        </div>
      </aside>

      <section className="panel scanner">
        <div className="sectionHead">
          <div>
            <h2>{scannerMode === 'state' ? '状態タグ・主判定スキャナー' : scannerMode === 'trend' ? '順張りスキャナー' : scannerMode === 'bottom' ? '試し玉・戻り選別スキャナー' : '押し目・歪み観測'}</h2>
            <div className="scannerMeta">
              {scannerSource === 'watch'
                ? `監視リスト / ${watch.length}件`
                : `${sourceLabel(scannerSource)} / ${scannerSector === 'all' ? '全セクター' : (SECTOR_OPTIONS.find(([k]) => k === scannerSector)?.[1] || scannerSector)} / ${fmt(scannerMinPrice)}〜${fmt(nikkeiMaxPrice)}円 / 出来高${fmt(scannerMinVolume)}以上 / 表示${marketMeta?.underCount ?? '—'}件 / 取得${marketMeta?.fetchedCount ?? '—'}件 / 母集団${marketMeta?.allCount ?? scanPreview?.candidateCount ?? '—'}件${marketMeta?.masterSource ? ` / ${marketMeta.masterSource === 'JPX' ? 'JPX' : '内蔵'}` : ''}`}
            </div>
          </div>
          <div className="scannerControls">
            <div className="sourceTabs modeSwitch"><button className={scannerMode === 'state' ? 'active' : ''} onClick={() => { setScannerMode('state'); setFilter('all'); }}>状態タグ</button><button className={scannerMode === 'oshime' ? 'active' : ''} onClick={() => { setScannerMode('oshime'); setFilter('all'); }}>押し目</button><button className={scannerMode === 'bottom' ? 'active' : ''} onClick={() => { setScannerMode('bottom'); setFilter('all'); }}>試し玉/戻り</button><button className={scannerMode === 'trend' ? 'active' : ''} onClick={() => { setScannerMode('trend'); setFilter('all'); }}>順張り</button></div>
            <div className="tabs">{(scannerMode === 'state' ? [['all','全部'],['trend','上昇継続'],['trial','試し玉'],['distortion','歪み'],['overshoot','歪み度50+'],['watch','観察'],['avoid','回避']] : scannerMode === 'trend' ? [['all','全部'],['oshime','候補'],['breakout','ブレイク'],['sustained','持続上昇'],['down','過熱/危険'],['rr','RR良']] : scannerMode === 'bottom' ? [['all','全部'],['trial','試し玉'],['rebound','戻り'],['raise','下値'],['slow','緩上昇'],['danger','高リスク'],['rr','RR良']] : [['all','全部'],['oshime','押し目'],['down','下落'],['rr','RR良']]).map(([k,label]) => <button key={k} className={filter===k?'active':''} onClick={() => setFilter(k)}>{label}</button>)}</div>
          </div>
        </div>
        <div className="tableWrap">
          <ScannerTable mode={scannerMode} rows={rows} selected={selected} onOpenDetail={openDetail} sortSpec={sortSpec} setSortSpec={setSortSpec} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={toggleMiniChart} companyNotes={companyNotes} />
        </div>
      </section>

      <aside className={`panel detail ${!detailOpen ? 'collapsed' : ''}`}>
        <button className="detailToggle" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? '詳細格納' : '詳細'}</button>
        <div className="detailInner">
        <h2>銘柄詳細</h2>
        {!selected && <div className="empty">左の銘柄を選択してください</div>}
        {selected && <Detail q={selectedQuote} selected={selected} activeTab={detailTab} setActiveTab={setDetailTab} research={research} ir={irCache[selected.code]} irLoading={irLoading} irError={irError} dropReport={dropReport?.code === selected.code ? dropReport : null} dropLoading={dropLoading} onInvestigate={() => investigateDrop(selected.code)} onReloadIr={() => { setIrCache((prev) => { const next = { ...prev }; delete next[selected.code]; return next; }); fetchIr(selected.code); }} companyNote={companyNotes[String(selected.code)]} onUpdateCompanyNote={updateCompanyNote} onDeleteCompanyNote={deleteCompanyNote} creditNote={creditNotes[String(selected.code)]} onUpdateCreditNote={updateCreditNote} onDeleteCreditNote={deleteCreditNote} onSaveAtlas={saveCurrentStateLocal} />}
        </div>
      </aside>
    </main>

    <footer>投資助言ではありません。価格・ファンダは参考値です。</footer>
    </div></div>}
  </>;
}




function AtlasListPanel({ items, folders, folderFilter, setFolderFilter, search, setSearch, open, setOpen, onOpenItem, onTogglePin, onMove, onFolderChange, onAddWatch }) {
  const countText = `${items.length}件`;
  return <section className="atlasListPanel">
    <div className="atlasListHead">
      <button className="atlasListToggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
      <div><b>Company Atlas 一覧</b><span>{countText} / カード前の整理棚</span></div>
    </div>
    {open && <>
      <div className="atlasListControls">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="図鑑検索：コード / 銘柄 / タグ / メモ" />
        <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
          {folders.map((f) => <option key={f} value={f}>{f === 'all' ? '全フォルダ' : f}</option>)}
        </select>
      </div>
      <div className="atlasFolderChips">
        {folders.slice(0, 10).map((f) => <button key={f} className={folderFilter === f ? 'active' : ''} onClick={() => setFolderFilter(f)}>{f === 'all' ? '全件' : f}</button>)}
      </div>
      <div className="atlasListRows">
        {items.length === 0 && <div className="atlasEmpty">該当する図鑑メモはありません。</div>}
        {items.map((item, idx) => <div key={item.code} className={`atlasListRow ${item.pinned ? 'pinned' : ''}`}>
          <button className="pinBtn" title="一覧上部に固定" onClick={() => onTogglePin(item)}>{item.pinned ? '★' : '☆'}</button>
          <button className="atlasMainBtn" onClick={() => onOpenItem(item)}>
            <div className="atlasRowTitle"><b>{item.code}</b><span>{item.name}</span></div>
            {item.q && <div className="atlasRowMarket"><strong>{yen(item.q.price)}</strong><em className={clsBy(item.q.changePct)}>{pct(item.q.changePct)}</em></div>}
            <em className={`atlasFolderBadge ${atlasFolderClass(item.folder)}`}>{item.folder}</em>
            <small>{item.progress.stars} / {item.typeLabel}</small>
            <p>{item.snippet}</p>
          </button>
          <div className="atlasRowTools">
            <button onClick={() => onMove(item, -1)} disabled={idx === 0}>↑</button>
            <button onClick={() => onMove(item, 1)} disabled={idx === items.length - 1}>↓</button>
            <select value={item.folder} onChange={(e) => onFolderChange(item, e.target.value)}>
              {ATLAS_DEFAULT_FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            {!item.watched && <button onClick={() => onAddWatch(item)}>監視+</button>}
          </div>
        </div>)}
      </div>
    </>}
  </section>;
}

function MobileQuoteCard({ q, mode, selected, watched = false, companyNote, creditNote, miniChartMode = {}, miniChartCache = {}, miniChartLoading = {}, onToggleMiniChart, onOpen, onWatch, orderIndex = null, orderTotal = 0, onMoveUp, onMoveDown }) {
  const [open, setOpen] = useState(false);
  const quality = buildQuality(q);
  const score = mode === 'state' ? q.stateScore : mode === 'trend' ? q.trendScore : mode === 'bottom' ? q.bottomScore : q.score;
  const oshimeJudge = quality?.finalJudge || q.totalJudge || q.primaryDecision || q.oshimeLabel || '—';
  const yugamiJudge = q.statePrimary || q.stateKind || q.stateReason || q.distortionLabel || '—';
  const trendJudge = q.trendJudge || q.trendType || q.trendEntryLabel || '—';
  const bottomJudge = q.bottomJudge || q.lowerBaseLabel || q.bottomReason || '—';
  const judge = mode === 'state'
    ? yugamiJudge
    : mode === 'trend'
      ? trendJudge
      : mode === 'bottom'
        ? bottomJudge
        : oshimeJudge;
  const mainRR = q.bottomRR ?? q.trendRR ?? q.predictedRR;
  const entry = q.bottomEntryPrice || q.trendEntryPrice || q.oshimePrice;
  const danger = q.bottomDangerScore ?? q.trendDangerScore ?? quality?.dangerScore ?? q.dangerScore;
  const oshimeClass = modeVerdictClass('oshime', oshimeJudge, q.score, danger);
  const yugamiClass = modeVerdictClass('distortion', yugamiJudge, q.overshootScore || q.distortionScore, danger);
  const trendClassName = modeVerdictClass('trend', trendJudge, q.trendScore, q.trendDangerScore);
  const bottomClassName = modeVerdictClass('bottom', bottomJudge, q.bottomScore, q.bottomDangerScore);
  const dangerTone = dangerClass(danger);
  const atlas = useMemo(() => atlasProgress(companyNote, creditNote, q), [companyNote, creditNote, q?.code]);
  return <article className={`mobileQuoteCard mobileQuoteAccordion ${open ? 'open' : 'closed'} danger-${dangerTone} ${selected?.code === q.code ? 'selected' : ''}`}>
    <button className="mqFoldHead" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <div className="mqTop">
        <div><b>{q.code}</b><span>{q.name || q.localName || ''}</span></div>
        <div className="mqRightStack"><strong className={clsBy(q.changePct)}>{pct(q.changePct)}</strong><em className="mqStarRank">{atlas.stars}</em></div>
      </div>
      <div className="mqPrice"><span>{yen(q.price)}</span><small>出来高 {fmt(q.volume)} / {fmt(q.volumeRatio, '倍')}</small></div>
      <div className="mqSpark" onClick={(e) => e.stopPropagation()}><RowSpark q={q} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={onToggleMiniChart} /></div>
      <div className="mqFoldHint"><span>{open ? '閉じる' : '開く'}</span><em>{judge} / {rrText(mainRR)}</em></div>
    </button>
    {open && <div className="mqFoldBody">
      <div className="auxVerdictLabel">補助判定</div>
      <div className="mqVerdicts visualVerdicts auxiliaryVerdicts">
        <div className={`verdictMini ${oshimeClass}`}><label>押し目</label><b>{oshimeJudge}</b></div>
        <div className={`verdictMini ${yugamiClass}`}><label>歪み</label><b>{yugamiJudge}</b></div>
        <div className={`verdictMini ${trendClassName}`}><label>順張り</label><b>{trendJudge}</b></div>
        <div className={`verdictMini ${bottomClassName}`}><label>試し玉</label><b>{bottomJudge}</b></div>
      </div>
      <div className="mqMetrics compactMetrics fourMetrics">
        <div><label>観察価値</label><b>{q.stateScore ?? score ?? '—'}</b></div>
        <div><label>判定点</label><b>{score ?? '—'}</b></div>
        <div className={(q.overshootScore || 0) >= 45 ? 'hotMetric' : ''}><label>歪み度</label><b>{q.overshootScore ?? '—'}</b></div>
        <div className={`dangerMetric ${dangerTone}`}><label>危険度</label><b>{danger ?? '—'}</b></div>
      </div>
      <div className="mqSub">{entry ? `目安 ${yen(entry)}` : (q.stateReason || q.oshimeLabel || q.trendEntryLabel || '詳細で確認')}</div>
      <div className="mqAtlasLine compact"><span>図鑑</span><b>{atlas.stars}</b><em>{atlas.missing.length ? `未記録: ${atlas.missing.slice(0,2).join(' / ')}` : '記録充実'}</em></div>
      <div className="mqSubMetrics">
        <span>押し目 {yen(q.oshimePrice || q.bottomEntryPrice || q.trendEntryPrice || q.price)}</span>
        <span>撤退 {yen(q.rrStop || q.bottomStop)}</span>
      </div>
      <div className="mqActions" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onOpen('summary')}>図鑑</button>
        <button onClick={() => onOpen('chart')}>チャート</button>
        <button onClick={() => onOpen('credit')}>信用</button>
        <button className={watched ? 'removeWatch' : ''} onClick={onWatch}>{watched ? '監視削除' : '監視追加'}</button>
      </div>
      {Number.isInteger(orderIndex) && orderTotal > 1 && <div className="mqOrderControls" onClick={(e) => e.stopPropagation()}>
        <button disabled={orderIndex <= 0} onClick={onMoveUp}>↑ 上へ</button>
        <span>{orderIndex + 1} / {orderTotal}</span>
        <button disabled={orderIndex >= orderTotal - 1} onClick={onMoveDown}>↓ 下へ</button>
      </div>}
    </div>}
  </article>;
}

function SortTh({ id, label, sortSpec, setSortSpec }) {
  const active = sortSpec?.key === id;
  const arrow = active ? (sortSpec.dir === 'asc' ? '▲' : '▼') : '';
  return <th className={active ? 'sortable active' : 'sortable'} onClick={() => setSortSpec((prev) => ({ key: id, dir: prev?.key === id && prev?.dir === 'desc' ? 'asc' : 'desc' }))}>{label} <small>{arrow}</small></th>;
}

function calcMiniBands(values = []) {
  const nums = values.map(Number).filter(Number.isFinite).slice(-20);
  if (nums.length < 8) return [];
  const mid = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / nums.length;
  const sd = Math.sqrt(variance);
  return [mid + sd * 2, mid, mid - sd * 2];
}

function Sparkline({ values = [], bands = [], mode = 'day', loading = false }) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (loading) return <span className="spark emptySpark">取得中</span>;
  if (nums.length < 2) return <span className="spark emptySpark">—</span>;
  const W = 96, H = 30;
  const bandNums = bands.map(Number).filter(Number.isFinite);
  const scaleNums = [...nums, ...bandNums];
  const min = Math.min(...scaleNums), max = Math.max(...scaleNums);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (i) => (i / Math.max(nums.length - 1, 1)) * W;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const d = nums.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const bandLabels = ['upper', 'mid', 'lower'];
  return <svg className={`spark ${mode === '5m' ? 'spark5m' : 'sparkDay'}`} viewBox={`0 0 ${W} ${H}`}>
    {bandNums.map((b, i) => <line key={`${b}-${i}`} className={`sparkBand ${bandLabels[i] || ''}`} x1="0" x2={W} y1={y(b).toFixed(1)} y2={y(b).toFixed(1)} />)}
    <path d={d} />
    <circle cx={x(nums.length-1)} cy={y(nums.at(-1))} r="2" />
  </svg>;
}

function RowSpark({ q, miniChartMode = {}, miniChartCache = {}, miniChartLoading = {}, onToggleMiniChart }) {
  const code = String(q?.code || '');
  const mode = miniChartMode[code] || 'day';
  const loading = !!miniChartLoading[code];
  const intradayValues = (miniChartCache[code]?.points || []).map((p) => p.close).filter((v) => Number.isFinite(Number(v)));
  const values = mode === '5m' ? intradayValues : (q.closes60 || []);
  const bands = mode === '5m' ? calcMiniBands(values) : [q.bbUpper, q.bbMid, q.bbLower];
  return <button
    type="button"
    className={`sparkButton ${mode === '5m' ? 'active5m' : ''}`}
    title="クリックで日足/5分足を切替。薄線はボリンジャーバンド"
    onClick={(e) => onToggleMiniChart?.(q, e)}
  >
    <Sparkline values={values} bands={bands} mode={mode} loading={loading} />
    <span className="sparkMode">{loading ? '…' : mode === '5m' ? '5m' : '日'}</span>
  </button>;
}

function FundaMini({ q }) {
  const f = q.fundamental || {};
  return <div className="fundaMini"><span>PER {f.per ?? q.per ?? '—'}</span><span>PBR {f.pbr ?? q.pbr ?? '—'}</span><span>配当 {f.dividendYield ?? q.dividendYield ?? '—'}%</span></div>;
}
function TagList({ items = [], muted = false }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return <span className="muted">—</span>;
  return <div className={`tagList ${muted ? 'mutedTags' : ''}`}>{list.slice(0, 4).map((x) => <span key={x}>{x}</span>)}</div>;
}

function DetailJump({ q, onOpenDetail, tabs = [] }) {
  const items = tabs.length ? tabs : [['summary', '結論'], ['chart', 'チャート'], ['ir', 'IR']];
  return <div className="jumpLinks">{items.map(([tab, label]) => <button key={tab} onClick={(e) => { e.stopPropagation(); onOpenDetail(q, tab); }}>{label}</button>)}</div>;
}

function ScannerTable({ mode, rows, selected, onOpenDetail, sortSpec, setSortSpec, miniChartMode, miniChartCache, miniChartLoading, onToggleMiniChart, companyNotes = {} }) {
  if (mode === 'state') return <table className="scannerTable stateTable compactDecisionTable"><thead><tr>
    <SortTh id="code" label="銘柄" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>形</th><SortTh id="price" label="現在値" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="changePct" label="前日比" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="volume" label="出来高" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="stateScore" label="観察価値" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="overshootScore" label="歪み度" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>主判定</th><th>理由</th><th>注意</th><th>RR</th><th>移動</th>
  </tr></thead><tbody>{rows.map((q) => <tr key={q.code} className={selected?.code === q.code ? 'selected' : ''} onClick={() => onOpenDetail(q, 'summary')}><td><b>{q.code}</b><span>{q.name}</span>{companyNotes[String(q.code)] && <em className="researchedMini">調査済</em>}</td><td><RowSpark q={q} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={onToggleMiniChart} /></td><td>{fmt(q.price)}</td><td className={clsBy(q.changePct)}>{pct(q.changePct)}</td><td><b>{fmt(q.volume)}</b><span>{fmt(q.volumeRatio, '倍')}</span></td><td><span className={`score ${trendClass(q.stateScore)}`}>{q.stateScore ?? '—'}</span></td><td><span className={`score ${(q.overshootScore || 0) >= 45 ? 'hot' : trendClass(q.overshootScore)}`}>{q.overshootScore ?? '—'}</span></td><td><span className={`pill tiny ${stateKindClass(q.stateKind || q.statePrimary)}`}>{q.statePrimary || '—'}</span></td><td><span>{q.stateReason || '—'}</span></td><td><span className="muted">{q.stateCaution || '—'}</span></td><td className={rrClass(q.bottomRR ?? q.predictedRR)}>{rrText(q.bottomRR ?? q.predictedRR)}</td><td><DetailJump q={q} onOpenDetail={onOpenDetail} tabs={[["summary","結論"],["state","状態"],["chart","チャート"],["ir","IR"]]} /></td></tr>)}</tbody></table>;

  if (mode === 'bottom') return <table className="scannerTable"><thead><tr>
    <SortTh id="code" label="銘柄" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>形</th><SortTh id="price" label="現在値" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="changePct" label="前日比" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="volume" label="出来高" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>試し目安</th><SortTh id="bottomScore" label="観察" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="reboundScore" label="戻り" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="lowerBaseScore" label="下値" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="bottomDanger" label="制約" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="bottomRR" label="短期RR" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>判定</th><th>移動</th>
  </tr></thead><tbody>{rows.map((q) => <tr key={q.code} className={selected?.code === q.code ? 'selected' : ''} onClick={() => onOpenDetail(q, 'summary')}><td><b>{q.code}</b><span>{q.name}</span>{companyNotes[String(q.code)] && <em className="researchedMini">調査済</em>}</td><td><RowSpark q={q} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={onToggleMiniChart} /></td><td>{fmt(q.price)}</td><td className={clsBy(q.changePct)}>{pct(q.changePct)}</td><td><b>{fmt(q.volume)}</b><span>{fmt(q.volumeRatio, '倍')}</span></td><td><b>{yen(q.bottomEntryPrice || q.price)}</b><span>撤退 {yen(q.bottomStop)}</span></td><td><span className={`score ${trendClass(q.bottomScore)}`}>{q.bottomScore ?? '—'}</span></td><td><span className={`pill tiny ${trendClass(q.reboundScore)}`}>{q.reboundScore ?? '—'}</span></td><td><span className={`pill tiny ${trendClass(q.lowerBaseScore)}`}>{q.lowerBaseLabel || '—'}</span></td><td><span className={`pill tiny ${trendDangerClass(q.bottomDangerScore)}`}>{q.bottomDangerScore ?? '—'}</span></td><td className={rrClass(q.bottomRR)}>{rrText(q.bottomRR)}</td><td><span className={`pill tiny ${bottomJudgeClass(q.bottomJudge)}`}>{q.bottomJudge || '—'}</span></td><td><DetailJump q={q} onOpenDetail={onOpenDetail} tabs={[["summary","結論"],["bottom","試し"],["chart","チャート"],["drop","急落"]]} /></td></tr>)}</tbody></table>;
  if (mode === 'trend') return <table className="scannerTable"><thead><tr>
    <SortTh id="code" label="銘柄" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>形</th><SortTh id="price" label="現在値" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="changePct" label="前日比" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="volume" label="出来高" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>狙い目押し</th><SortTh id="trendScore" label="上昇強さ" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="trendSafety" label="安全度" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="trendDanger" label="危険度" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="trendRR" label="順張りRR" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>判定</th><th>移動</th>
  </tr></thead><tbody>{rows.map((q) => <tr key={q.code} className={selected?.code === q.code ? 'selected' : ''} onClick={() => onOpenDetail(q, 'summary')}><td><b>{q.code}</b><span>{q.name}</span>{companyNotes[String(q.code)] && <em className="researchedMini">調査済</em>}</td><td><RowSpark q={q} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={onToggleMiniChart} /></td><td>{fmt(q.price)}</td><td className={clsBy(q.changePct)}>{pct(q.changePct)}</td><td><b>{fmt(q.volume)}</b><span>{fmt(q.volumeRatio, '倍')}</span></td><td><b>{yen(q.trendEntryPrice)}</b><span>{q.trendEntryLabel || '—'}</span></td><td><span className={`score ${trendClass(q.trendScore)}`}>{q.trendScore ?? '—'}</span><span>{q.trendType || '—'}</span></td><td><span className={`pill tiny ${trendClass(q.trendSafetyScore)}`}>{q.trendSafetyScore ?? '—'}</span></td><td><span className={`pill tiny ${trendDangerClass(q.trendDangerScore)}`}>{q.trendDangerScore ?? '—'}</span></td><td className={rrClass(q.trendRR)}>{rrText(q.trendRR)}</td><td><span className={`pill tiny ${trendJudgeClass(q.trendJudge)}`}>{q.trendJudge || '—'}</span></td><td><DetailJump q={q} onOpenDetail={onOpenDetail} tabs={[["summary","結論"],["trend","順張"],["chart","チャート"],["company","会社"]]} /></td></tr>)}</tbody></table>;
  return <table className="scannerTable"><thead><tr>
    <SortTh id="code" label="銘柄" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>形</th><SortTh id="price" label="現在値" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="changePct" label="前日比" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="volume" label="出来高" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>押し目目安</th><SortTh id="rr" label="予測RR" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="score" label="押し目" sortSpec={sortSpec} setSortSpec={setSortSpec} /><SortTh id="danger" label="危険" sortSpec={sortSpec} setSortSpec={setSortSpec} /><th>下落型</th><th>総合</th><th>移動</th>
  </tr></thead><tbody>{rows.map((q) => { const quality = buildQuality(q); return <tr key={q.code} className={selected?.code === q.code ? 'selected' : ''} onClick={() => onOpenDetail(q, 'summary')}><td><b>{q.code}</b><span>{q.name}</span>{companyNotes[String(q.code)] && <em className="researchedMini">調査済</em>}</td><td><RowSpark q={q} miniChartMode={miniChartMode} miniChartCache={miniChartCache} miniChartLoading={miniChartLoading} onToggleMiniChart={onToggleMiniChart} /></td><td>{fmt(q.price)}</td><td className={clsBy(q.changePct)}>{pct(q.changePct)}</td><td><b>{fmt(q.volume)}</b><span>{fmt(q.volumeRatio, '倍')}</span></td><td><b>{fmt(q.oshimePrice)}</b><span>{q.oshimeLabel}</span></td><td className={rrClass(q.predictedRR)}>{rrText(q.predictedRR)}</td><td><span className={`score s${Math.floor((q.score || 0) / 25)}`}>{q.score}</span></td><td><span className={`pill tiny ${quality?.dangerClass || ''}`}>{quality?.dangerLabel || '—'}</span></td><td><span>{quality?.dropType || '—'}</span></td><td><span className={`pill tiny ${quality?.finalClass || ''}`}>{quality?.finalJudge || '—'}</span></td><td><DetailJump q={q} onOpenDetail={onOpenDetail} tabs={[["summary","結論"],["tech","数値"],["ir","IR"],["chart","チャート"]]} /></td></tr>; })}</tbody></table>;
}


function MobileAccordionGroup({ sections = [], intro = '', storageKey = '', initialOpenId = '', multi = true }) {
  const [openIds, setOpenIds] = useState(() => new Set(initialOpenId ? [initialOpenId] : []));
  useEffect(() => { setOpenIds(new Set(initialOpenId ? [initialOpenId] : [])); }, [storageKey, initialOpenId]);
  const toggle = (id) => setOpenIds((prev) => {
    const next = multi ? new Set(prev) : new Set();
    if (prev.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="mobileAccordionGroup">
    {intro && <p className="mobileAccordionIntro">{intro}</p>}
    {sections.map((sec) => {
      const open = openIds.has(sec.id);
      return <section key={sec.id} className={`mobileAccordionItem ${open ? 'open' : ''}`}>
        <button className="mobileAccordionHead" onClick={() => toggle(sec.id)}>
          <span><b>{sec.title}</b>{sec.hint && <em>{sec.hint}</em>}</span>
          <strong>{open ? '閉じる' : '開く'}</strong>
        </button>
        {open && <div className="mobileAccordionBody">
          {typeof sec.content === 'function' ? sec.content() : sec.content}
          <div className="accordionBottomActions">
            <button className="sub closeAccordionBottom" onClick={() => toggle(sec.id)}>この項目を閉じる</button>
          </div>
        </div>}
      </section>;
    })}
  </div>;
}


class PanelErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, message: '' }; }
  static getDerivedStateFromError(error) { return { hasError: true, message: error?.message || '表示エラー' }; }
  componentDidCatch(error) { console.error('PanelErrorBoundary', error); }
  render() {
    if (this.state.hasError) return <div className="panelErrorFallback"><b>このパネルの表示でエラーが出ました</b><p>{this.state.message}</p><button onClick={() => this.setState({ hasError: false, message: '' })}>再表示</button></div>;
    return this.props.children;
  }
}
function SafePanel({ children }) {
  return <PanelErrorBoundary>{children}</PanelErrorBoundary>;
}

function Detail({ q, selected, activeTab, setActiveTab, research, ir, irLoading, irError, dropReport, dropLoading, onInvestigate, onReloadIr, companyNote, onUpdateCompanyNote, onDeleteCompanyNote, creditNote, onUpdateCreditNote, onDeleteCreditNote, onSaveAtlas, mobile = false }) {
  const tab = activeTab || 'summary';
  const detailTopRef = useRef(null);
  const setTab = (next) => {
    setActiveTab(next);
    requestAnimationFrame(() => {
      detailTopRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    });
  };
  useEffect(() => { const h = () => setTab('note'); window.addEventListener('openCompanyNoteTab', h); return () => window.removeEventListener('openCompanyNoteTab', h); }, [setActiveTab]);
  useEffect(() => { if (mobile) requestAnimationFrame(() => detailTopRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })); }, [mobile, q?.code, activeTab]);
  useEffect(() => { if (dropReport?.code === selected?.code) setActiveTab('drop'); }, [dropReport?.code, selected?.code]);
  if (!q) return <div className="empty">この銘柄の価格データは現在の一覧にありません。監視リスト表示に戻すか、価格更新を押してください。選択状態は維持しています。</div>;
  if (q.error) return <div className="empty">{q.error}</div>;
  const yahoo = `https://finance.yahoo.co.jp/quote/${q.code}.T`;
  const kabutan = `https://kabutan.jp/stock/?code=${q.code}`;
  const tdnet = `https://www.release.tdnet.info/inbs/I_main_00.html`;
  const news = `https://www.google.com/search?q=${encodeURIComponent(`${q.code} ${q.name} 株 ニュース 決算`)}`;
  const minkabu = `https://minkabu.jp/stock/${q.code}`;
  const links = { kabutan, yahoo, minkabu, news, tdnet };
  const normalizedTab = mobile
    ? (['summary','chart','deep','confirm','links'].includes(tab) ? tab
      : ['company','state','bottom','trend'].includes(tab) ? 'deep'
      : ['note','credit','tech','ir','drop'].includes(tab) ? 'confirm'
      : 'summary')
    : tab;
  const deepInitialOpen = ['company','state','bottom','trend'].includes(tab) ? tab : '';
  const confirmInitialOpen = ['note','credit','tech','ir','drop'].includes(tab) ? tab : '';

  return <div ref={detailTopRef} className={mobile ? 'detailRoot mobileDetailRoot' : 'detailRoot'}>
    {!mobile && <>
      <div className="titleLine"><b>{q.code}</b><span>{q.name || selected.name}</span></div>
      <div className="priceLine"><span>{yen(q.price)}</span><em className={clsBy(q.changePct)}>{pct(q.changePct)}</em></div>
      <div className="badge">{scoreLabel(q.score)} / {q.score}点</div>
    </>}
    <div className={mobile ? "detailTabs mobileCompactTabs" : "detailTabs"}>
      {(mobile ? [
        ['summary', '図鑑'],
        ['deep', '判定'],
        ['chart', 'チャート'],
        ['confirm', '記録調査'],
        ['links', 'リンク'],
      ] : [
        ['summary', '結論'],
        ['chart', 'チャート'],
                ['note', '記録調査'],
        ['credit', '信用需給'],
        ['tech', '価格/指標'],
        ['state', '判定/歪み'],
        ['bottom', '試し玉'],
        ['trend', '順張り'],
        ['ir', 'IR/ニュース'],
        ['drop', '急落理由'],
        ['links', '外部リンク'],
      ]).map(([k, label]) => <button key={k} className={normalizedTab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
      {normalizedTab !== 'summary' && <button className="tabCloseInline" onClick={() => setTab('summary')}>結論へ戻る</button>}
    </div>

    {normalizedTab === 'summary' && <SummaryPanel q={q} research={research} ir={ir} companyNote={companyNote} creditNote={creditNote} onWrite={() => setTab('note')} onCredit={() => setTab('credit')} onDeep={() => setTab(mobile ? 'deep' : 'state')} />}
    {normalizedTab === 'chart' && <ChartPanel q={q} />}
    {normalizedTab === 'deep' && <MobileAccordionGroup storageKey={`deep-${q.code}-${deepInitialOpen}`} initialOpenId={deepInitialOpen} intro="項目を選ぶまで中身は開きません。必要な材料だけ開いて確認します。" sections={[
      { id: 'state', title: '判定/歪み', hint: '観察価値・危険度・歪み分類', content: () => <StatePanel q={q} companyNote={companyNote} ir={ir} /> },
      { id: 'bottom', title: '試し玉', hint: '下値・反発・危険度', content: () => <BottomPanel q={q} /> },
      { id: 'trend', title: '順張り', hint: '上昇継続・安全度・撤退', content: () => <TrendPanel q={q} /> },
    ]} />}
    {normalizedTab === 'confirm' && <MobileAccordionGroup storageKey={`confirm-${q.code}-${confirmInitialOpen}`} initialOpenId={confirmInitialOpen} intro="図鑑への書き込み・信用需給記録はここです。AIは下書き係、自分で確認して保存します。" sections={[
      { id: 'note', title: '会社調査', hint: '調査プロンプト・図鑑メモ保存を1画面で完結', content: () => <SafePanel><UnifiedCompanyResearchPanel q={q} ir={ir} dropReport={dropReport} research={research} note={companyNote} onSave={(patch) => onUpdateCompanyNote?.(q.code, patch)} onDelete={() => onDeleteCompanyNote?.(q.code)} onSaveAtlas={onSaveAtlas} /></SafePanel> },
      { id: 'credit', title: '信用需給を記録する', hint: '信用データ貼り付け・抽出・保存', content: () => <CreditBalancePanel q={q} note={creditNote} onSave={(patch) => onUpdateCreditNote?.(q.code, patch)} onDelete={() => onDeleteCreditNote?.(q.code)} onSaveAtlas={onSaveAtlas} /> },
      { id: 'tech', title: '価格/指標', hint: '価格帯・出来高・指標確認', content: () => <TechnicalPanel q={q} /> },
      { id: 'ir', title: 'IR/ニュース', hint: '直近材料と更新', content: () => <IrPanel ir={ir} loading={irLoading} error={irError} onReload={onReloadIr} q={q} /> },
      { id: 'drop', title: '急落理由', hint: '急落調査・悪材料確認', content: () => <DropReasonPanel report={dropReport} loading={dropLoading} onInvestigate={onInvestigate} q={q} /> },
    ]} />}
        {normalizedTab === 'note' && <SafePanel><UnifiedCompanyResearchPanel q={q} ir={ir} dropReport={dropReport} research={research} note={companyNote} onSave={(patch) => onUpdateCompanyNote?.(q.code, patch)} onDelete={() => onDeleteCompanyNote?.(q.code)} onSaveAtlas={onSaveAtlas} /></SafePanel>}
    {normalizedTab === 'credit' && <CreditBalancePanel q={q} note={creditNote} onSave={(patch) => onUpdateCreditNote?.(q.code, patch)} onDelete={() => onDeleteCreditNote?.(q.code)} onSaveAtlas={onSaveAtlas} />}
    {normalizedTab === 'tech' && <TechnicalPanel q={q} />}
    {normalizedTab === 'state' && <StatePanel q={q} companyNote={companyNote} ir={ir} />}
    {normalizedTab === 'bottom' && <BottomPanel q={q} />}
    {normalizedTab === 'trend' && <TrendPanel q={q} />}
    {normalizedTab === 'ir' && <IrPanel ir={ir} loading={irLoading} error={irError} onReload={onReloadIr} q={q} />}
    {normalizedTab === 'drop' && <DropReasonPanel report={dropReport} loading={dropLoading} onInvestigate={onInvestigate} q={q} />}
    {normalizedTab === 'links' && <LinksPanel links={links} q={q} />}
    {normalizedTab !== 'summary' && <div className="tabCloseFooter"><button className="sub" onClick={() => setTab('summary')}>タブを閉じる</button></div>}
  </div>;
}


function synthesizeVerdict(q = {}) {
  const stateJudge = q.statePrimary || q.stateKind || '—';
  const bottomJudge = q.bottomJudge || q.lowerBaseLabel || '—';
  const trendJudge = q.trendJudge || q.trendType || '—';
  const oshimeJudge = q.oshimeLabel || q.totalJudge || q.primaryDecision || '—';
  const overshootScore = Number(q.overshootScore || 0);
  const danger = Number(q.bottomDangerScore ?? q.trendDangerScore ?? q.dangerScore ?? 0);
  if (danger >= 80 && overshootScore >= 50) return { headline: '深押し・過剰反応兆候、反発確認後に小ロット余地', action: 'wait-reversal', confidence: '中', stateJudge, bottomJudge, trendJudge, oshimeJudge };
  if (danger >= 80) return { headline: '深押し中・崩れ警戒、見送り推奨', action: 'avoid', confidence: '高', stateJudge, bottomJudge, trendJudge, oshimeJudge };
  if (/試し玉候補|反発監視/.test(bottomJudge)) return { headline: `${bottomJudge}・サイズ厳守で試し玉余地`, action: 'trial', confidence: '中', stateJudge, bottomJudge, trendJudge, oshimeJudge };
  if (trendJudge === '強い順張り') return { headline: '上昇継続・押し目買い妙味', action: 'momentum', confidence: '高', stateJudge, bottomJudge, trendJudge, oshimeJudge };
  if (overshootScore >= 45) return { headline: '過剰反応の可能性、底打ち確認待ち', action: 'watch', confidence: '低', stateJudge, bottomJudge, trendJudge, oshimeJudge };
  return { headline: '見送り or 様子見', action: 'wait', confidence: '低', stateJudge, bottomJudge, trendJudge, oshimeJudge };
}
function extractSections(raw = '') {
  const sections = {};
  const headerRe = /【([^】]+)】([\s\S]*?)(?=【|$)/g;
  let m;
  while ((m = headerRe.exec(String(raw || ''))) !== null) {
    const key = m[1].trim();
    const body = m[2].trim();
    if (key && body) sections[key] = body;
  }
  return sections;
}

function inferSectionsFromLegacyMemo(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n');
  const lines = clean.split(/\n+/).map((x) => x.trim()).filter(Boolean);

  const pick = (patterns, limit = 4) => {
    const hits = [];
    for (const line of lines) {
      if (patterns.some((re) => re.test(line)) && !hits.includes(line)) hits.push(line);
      if (hits.length >= limit) break;
    }
    return hits;
  };

  const companyCore = pick([/事業|会社|主力|展開|運営|開発|製造|販売|サービス|セグメント|収益|稼ぐ|売上|利益/], 4);
  const growth = pick([/成長|拡大|新規|受注|提携|大型|需要|投資|中計|増収|増益|上方|改善|材料|期待/], 5);
  const funding = pick([/増資|希薄|ワラント|新株|CB|社債|資金調達|借入|公募|売出|第三者割当/], 4);
  const risks = pick([/リスク|悪材料|下方|減益|赤字|減配|減損|未達|競争|不調|鈍化|費用|金利|為替|在庫|訴訟|危険/], 5);
  const stock = pick([/株価|押し目|下落|急落|反発|出来高|信用|需給|PER|PBR|割安|割高|歪み|BB|ボリンジャー|支持|抵抗/], 5);
  const regime = pick([/レジーム|転換|構造|方針|中期|再編|買収|撤退|新領域|大型|決算|業績|見通し|説明会/], 4);

  const fallback = clean.length > 700 ? `${clean.slice(0, 700)}…` : clean;

  const section = (title, items, empty = '未確認') => {
    const body = items.length ? items.map((x) => `・${x}`).join('\n') : `・${empty}`;
    return `【${title}】\n${body}`;
  };

  return [
    section('会社の核', companyCore, '旧メモからは事業の核を機械抽出できませんでした。公式IRで確認。'),
    section('レジーム変化・大型材料', regime, '旧メモからは大型材料を機械抽出できませんでした。'),
    section('成長材料', growth, '旧メモからは成長材料を機械抽出できませんでした。'),
    section('資金調達・希薄化の評価', funding, '旧メモからは資金調達・希薄化材料は未確認。'),
    section('リスク', risks, '旧メモからは明確なリスクを機械抽出できませんでした。'),
    section('株価を見るポイント', stock, '旧メモからは株価判断ポイントを機械抽出できませんでした。'),
    `【押し目判断】\n・未確認。価格反応と会社材料を分けて確認。`,
    `【自分用の暫定判断】\n・旧メモを自動変換した暫定版。内容を確認して必要なら修正。`,
    `【元メモ】\n${fallback}`
  ].join('\n\n');
}

function sectionSnippet(sections = {}, keys = [], fallback = '未記録') {
  const key = keys.find((k) => sections[k]);
  const text = key ? sections[key] : '';
  if (!text) return fallback;
  const one = text.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 2).join(' ');
  return one.length > 140 ? `${one.slice(0, 140)}…` : one;
}
function companyMemoConfidence(raw = '', updatedAt = '') {
  const text = String(raw || '').trim();
  if (!text) return { label: '未調査', className: 'low', reason: '会社情報が未記録' };
  const sections = extractSections(text);
  const count = Object.keys(sections).length;
  const ageDays = updatedAt ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000) : null;
  if (count >= 4 && text.length >= 1000 && (ageDays == null || ageDays <= 30)) return { label: '高', className: 'high', reason: '章数・分量・更新時期が十分' };
  if (count >= 4 && ageDays != null && ageDays >= 90) return { label: '中（要更新）', className: 'mid', reason: '内容はあるが更新が古い' };
  if (count >= 3 && text.length >= 200) return { label: '中', className: 'mid', reason: '最低限の会社メモあり' };
  return { label: '低（情報少）', className: 'low', reason: '章数または分量が不足' };
}
function calcJudgementConfidence({ q = {}, companyNote = null, ir = null } = {}) {
  let level = 0;
  const reasons = [];
  if (q.price != null && q.changePct != null) { level++; reasons.push('価格・変化率取得'); }
  if (q.volume != null && q.volumeRatio != null) { level++; reasons.push('出来高取得'); }
  if (q.fundamental?.per != null || q.fundamental?.pbr != null || q.per != null || q.pbr != null) { level++; reasons.push('PER/PBR取得'); }
  const irItems = Array.isArray(ir) ? ir : (ir?.items || []);
  if (irItems.length > 0) { level++; reasons.push('IR取得'); }
  if (companyNote?.raw && companyNote.raw.length >= 500) { level++; reasons.push('会社メモあり'); }
  const label = level >= 4 ? '高' : level >= 2 ? '中' : '低';
  const missing = [];
  if (!q.fundamental?.per && !q.fundamental?.pbr && q.per == null && q.pbr == null) missing.push('PER/PBR');
  if (!irItems.length) missing.push('IR');
  if (!companyNote?.raw) missing.push('会社メモ');
  return { level, label, reasons, missing, className: level >= 4 ? 'high' : level >= 2 ? 'mid' : 'low' };
}
function compactMaterialKey(title = '') {
  return String(title || '').slice(0, 30).replace(/[、。\s　・:：,\.\-—_/]/g, '').toLowerCase();
}
function dedupeMaterials(items = []) {
  const seen = [];
  const out = [];
  (items || []).forEach((item) => {
    const key = compactMaterialKey(item?.title || '');
    if (!key) { out.push(item); return; }
    const near = seen.find((s) => s.includes(key) || key.includes(s));
    if (near) return;
    seen.push(key);
    out.push(item);
  });
  return out;
}
function rankMaterialsForToday(items = [], q = {}) {
  const urgentKw = /下落|急落|ストップ|下方修正|上方修正|決算|発表|サプライズ|失望|見通し|業績/;
  const moveSignificant = Math.abs(Number(q?.changePct) || 0) >= 2;
  const arr = dedupeMaterials(items);
  if (!moveSignificant) return arr;
  return [...arr].sort((a, b) => {
    const ah = urgentKw.test(a?.title || '') ? 1 : 0;
    const bh = urgentKw.test(b?.title || '') ? 1 : 0;
    if (ah !== bh) return bh - ah;
    return 0;
  });
}
function AtlasMemoCards({ raw = '', onEdit }) {
  const sections = extractSections(raw);
  const keys = Object.keys(sections);
  if (!keys.length) return <div className="savedMemoPreview"><p>{String(raw || '').slice(0, 900)}</p><button className="sub" onClick={onEdit}>編集する</button></div>;
  const priority = ['会社の核','主な稼ぎ方','レジーム変化・大型材料','成長材料','直近材料','資金調達・希薄化の評価','リスク','株価を見るポイント','押し目判断','歪み判定','自分用の暫定判断'];
  const ordered = [...priority.filter((k) => sections[k]), ...keys.filter((k) => !priority.includes(k))];
  return <div className="atlasMemoCards">
    {ordered.map((k) => <section className="atlasMemoCard" key={k}><h4>{k}</h4><p>{sections[k]}</p></section>)}
    <button className="sub" onClick={onEdit}>編集する</button>
  </div>;
}
function LinkTier({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className={`linkTier ${open ? 'open' : ''}`}>
    <button className="linkTierHead" onClick={() => setOpen((v) => !v)}><b>{title}</b><span>{open ? '閉じる' : '開く'}</span></button>
    {open && <div className="linkTierBody">{children}</div>}
  </section>;
}


function refineDistortionType(q = {}, ir = null, companyNote = null) {
  const items = ir?.items || [];
  const titleText = items.map((x) => x?.title || '').join(' / ');
  const supplyKw = /公募|売出|売り出し|立会外分売|ロックアップ|希薄化|第三者割当|指数除外|大株主|CB|新株予約権/;
  const fundaKw = /下方修正|赤字|減益|減配|無配|減損|未達|業績修正|営業損|経常損|通期予想.*下方/;
  const raw = String(companyNote?.raw || '');
  const noteDistortion = raw.match(/【歪み判定】([\s\S]*?)(?=【|$)/)?.[1] || raw;
  const noteTrue = /本物の歪み|過剰反応|業績影響なし|会社は変わっていない|一過性|割安/.test(noteDistortion);
  const noteDamage = /業績悪化|構造悪化|回復困難|ファンダ悪化|減配|下方修正/.test(noteDistortion);

  if (supplyKw.test(titleText)) return {
    type: 'supply_event', label: '需給・イベント型', confidence: '中',
    reasons: ['IR/ニュースに需給イベント候補'], action: '一過性か需給悪化継続か確認'
  };
  if (noteTrue) return {
    type: 'true_distortion', label: '本物の歪み（調査確認）', confidence: '高',
    reasons: ['会社メモで過剰反応を確認'], action: '反発確認後に小ロット'
  };
  if (noteDamage) return {
    type: 'fundamental_damage', label: 'ファンダ悪化型（調査確認）', confidence: '高',
    reasons: ['会社メモで業績・構造悪化を確認'], action: '見送り。回復確認まで触らない'
  };
  if (fundaKw.test(titleText)) return {
    type: 'needs_research', label: 'ファンダ悪化疑い（要調査）', confidence: '暫定',
    reasons: ['業績悪化系キーワード検出'], action: '会社を調べる。IR本文で影響度確認'
  };
  if (q.distortionType && q.distortionType !== 'unknown') return {
    type: q.distortionType, label: q.distortionTypeLabel || '歪み分類あり', confidence: q.distortionTypeConfidence === 'medium' ? '中' : q.distortionTypeConfidence === 'high' ? '高' : '暫定',
    reasons: q.distortionTypeReasons || [], action: q.distortionTypeAction || '分類根拠を確認'
  };
  if ((q.overshootScore || 0) >= 50) return {
    type: 'needs_research', label: '本物の歪み候補（暫定）', confidence: '暫定',
    reasons: ['売られすぎシグナル高め', '会社情報未確認'], action: '会社を調べて事業価値の毀損有無を確認'
  };
  return { type: 'unknown', label: '分類保留', confidence: '暫定', reasons: ['追加材料が必要'], action: 'IR・会社メモを確認' };
}


function isSuddenDropCandidate(q = {}) {
  return Number(q.changePct || 0) <= -2 || Number(q.overshootScore || 0) >= 45 || Number(q.dangerScore || q.bottomDangerScore || 0) >= 70;
}
function DropReasonCheckPanel({ q }) {
  if (!isSuddenDropCandidate(q)) return null;
  const code = q?.code || '';
  const name = q?.name || '';
  const enc = (s) => encodeURIComponent(s);
  const search = (word) => `https://www.google.com/search?q=${enc(`${code} ${name} ${word}`)}`;
  return <section className="dropReasonCheckPanel">
    <div className="dropReasonHead">
      <b>急落理由チェック</b>
      <span>歪みに見える下落でも、配当落ち・権利落ち・需給イベントは先に確認</span>
    </div>
    <div className="dropReasonGrid">
      <a target="_blank" rel="noreferrer" href={search('配当落ち 権利落ち 優待落ち')}>配当/権利落ち</a>
      <a target="_blank" rel="noreferrer" href="https://www.release.tdnet.info/inbs/I_main_00.html">TDnet</a>
      <a target="_blank" rel="noreferrer" href={`https://kabutan.jp/stock/news?code=${code}`}>株探ニュース</a>
      <a target="_blank" rel="noreferrer" href={`https://finance.yahoo.co.jp/quote/${code}.T`}>Yahoo掲示板/株価</a>
      <a target="_blank" rel="noreferrer" href={`https://minkabu.jp/stock/${code}/bbs`}>みんかぶ掲示板</a>
      <a target="_blank" rel="noreferrer" href={search('公募 売出 希薄化 分割 指数除外')}>需給イベント検索</a>
    </div>
    <p>掲示板は仮説収集用。公式IR・TDnetで確認してから歪み分類を見る。</p>
  </section>;
}


function NextActionCard({ q }) {
  const s = q?.pushimeStage;
  if (!s) return null;
  const colorClass = {
    band_walk: 'danger',
    fear_zone: 'caution',
    decelerating: 'caution',
    tentative_bottom: 'watch',
    shallow_dip: 'positive',
    confirmed: 'neutral',
    rising: 'neutral'
  }[s.stage] || 'neutral';

  return <section className={`nextActionCard ${colorClass}`}>
    <div className="naHeader">
      <b>次の一手</b>
      <strong>{s.action || '様子見'}</strong>
    </div>
    <div className="naStage">{s.label || '押し目ステージ未判定'}</div>
    <div className="naPrices">
      {s.watchPrice != null && <span>見る価格 {yen(s.watchPrice)}</span>}
      {s.exitPrice != null && <span>撤退警戒 {yen(s.exitPrice)}割れ</span>}
      {s.lotSize && <span>ロット {s.lotSize}</span>}
    </div>
    {!!s.conditions?.length && <ul className="naConditions">{s.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul>}
    {!!s.reasons?.length && <p className="naReasons">{s.reasons.join(' / ')}</p>}
    <p className="naDisclaimer">※ 価格・出来高パターンのみの判定。IR・業績は未考慮。</p>
  </section>;
}

function SummaryPanel({ q, research, ir, companyNote, creditNote, onWrite, onCredit, onDeep }) {
  const atlas = atlasProgress(companyNote, creditNote, q);
  const core = extractAtlasCore(companyNote, q?.sector ? `${q.sector}領域。図鑑メモを保存すると会社の核がここに出ます。` : '図鑑メモを保存すると会社の核がここに出ます。');
  const quality = buildQuality(q) || {};
  const action = research?.stance || quality.finalJudge || q.primaryDecision || '様子見・要確認';
  const actionClass = research?.stanceClass || quality.finalClass || '';
  const distortion = (q.reasons || []).slice(0, 2).join(' / ') || q.stateReason || q.oshimeLabel || '歪み理由は未検出。価格・出来高・材料を確認。';
  const verdict = synthesizeVerdict(q);
  const distortionType = refineDistortionType(q, ir, companyNote);
  const hasCompanyRaw = !!String(companyNote?.raw || '').trim();
  const ctaLabel = !hasCompanyRaw ? '🔍 この会社を調べる' : atlas.level <= 2 ? '📝 図鑑メモを追記する' : '📖 図鑑メモを開く';
  return <div className="summaryPanel atlasCardPanel">
    <section className="atlasHeroCard" style={{ borderTopColor: sectorColor(q.sector || q.market) }}>
      <div className="atlasHeroTop">
        <div>
          <span className="atlasSubTitle">動く銘柄図鑑カード</span>
          <h2>{q.code} {q.name}</h2>
          <p>{q.sector || q.market || 'テーマ未設定'}</p>
        </div>
        <div className="atlasStars" title="図鑑完成度">
          <b>{atlas.stars}</b>
          <span>{atlas.label}</span>
        </div>
      </div>
      <div className="atlasPriceRow">
        <strong>{yen(q.price)}</strong>
        <em className={clsBy(q.changePct)}>{pct(q.changePct)}</em>
        <span>出来高 {fmt(q.volume)} / {fmt(q.volumeRatio, '倍')}</span>
      </div>
      <NextActionCard q={q} />
      <div className={`verdictBox ${verdict.action}`}>
        <strong>{verdict.headline}</strong>
        <p>根拠: 押し目={verdict.oshimeJudge} / 歪み度 {q.overshootScore ?? '—'} / 試し玉={verdict.bottomJudge} / 信頼度 {verdict.confidence}</p>
        <div className={`distortionTypeLine ${distortionType.type}`}><b>歪み分類：{distortionType.label}</b><span>信頼度 {distortionType.confidence} / {distortionType.action}</span></div>
        <button className="sub" onClick={onDeep}>もっと深く判定を読む →</button>
      </div>
      <DropReasonCheckPanel q={q} />
      <button className="primary atlasCta" onClick={onWrite}>{ctaLabel}</button>
      <div className="atlasSpark"><RowSpark q={q} /></div>
      <div className="atlasDecision">
        <span className={`stance ${actionClass}`}>{action}</span>
        <p>{research?.main || quality.finalReason || distortion}</p>
      </div>
      <div className="atlasMetricStrip">
        <Metric label="RR" value={rrText(q.predictedRR ?? q.bottomRR ?? q.trendRR)} sub={`目標 ${yen(q.rrTarget)} / 撤退 ${yen(q.rrStop || q.bottomStop)}`} strong className={rrClass(q.predictedRR ?? q.bottomRR ?? q.trendRR)} />
        <Metric label="押し目" value={yen(q.oshimePrice || q.bottomEntryPrice || q.trendEntryPrice)} sub={q.oshimeLabel || q.bottomJudge || q.trendEntryLabel || '目安'} strong />
        <Metric label="危険度" value={q.dangerScore ?? q.bottomDangerScore ?? q.trendDangerScore ?? '—'} sub={quality.dangerLabel || q.stateCaution || '補助'} />
      </div>
    </section>

    <section className="atlasSection">
      <div className="atlasSectionHead"><b>会社の核</b><span>{companyNote ? '図鑑メモより' : '未記録'}</span></div>
      <p>{core}</p>
    </section>

    <section className="atlasSection">
      <div className="atlasSectionHead"><b>直近の歪み</b><span>{q.statePrimary || q.oshimeLabel || '観測中'}</span></div>
      <p>{distortion}</p>
      <TagList items={[...(q.stateTags || []), ...(q.stateActions || [])].slice(0, 6)} />
    </section>

    <section className="atlasSection atlasCompletion">
      <div className="atlasSectionHead"><b>図鑑完成度</b><span>{atlas.stars}</span></div>
      <div className="atlasCheckGrid">
        {atlas.checks.map((c) => <span key={c.key} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '・'} {c.label}</span>)}
      </div>
      {atlas.missing.length > 0 && <p className="atlasMissing">未記録：{atlas.missing.join(' / ')}</p>}
    </section>

    {ir?.summary && <div className={`materialSummary ${ir.summary.className}`}><b>直近材料</b><span>{ir.summary.level}</span><p>{ir.summary.text}</p></div>}

    <div className="atlasActions">
      <button onClick={onWrite}>図鑑に書き込む</button>
      <button onClick={onCredit}>信用需給を記録</button>
    </div>
  </div>;
}


function FundamentalCard({ q, compact = false }) {
  const f = q?.fundamental || {};
  const per = f.per ?? q?.per;
  const pbr = f.pbr ?? q?.pbr;
  const div = f.dividendYield ?? q?.dividendYield;
  const cap = f.marketCapLabel ?? q?.marketCapLabel;
  const hasAny = [per, pbr, div, cap].some((v) => v != null && v !== '' && v !== '—');

  // 簡易タブでは、取れていないファンダを大きな空カードで出さない。
  if (compact && !hasAny) return null;

  return <section className={`${compact ? 'fundamentalCard compact' : 'fundamentalCard'} ${!hasAny ? 'emptyFundamental' : ''}`}>
    <div className="cardMiniHead"><b>ファンダ参考値</b><span>{hasAny ? (f.source || 'Yahoo参考値') : '未取得'}</span></div>
    {hasAny ? <>
      <div className="fundaGrid">
        <Metric label="PER" value={per ?? '—'} sub={f.labels?.per || '参考'} />
        <Metric label="PBR" value={pbr ?? '—'} sub={f.labels?.pbr || '参考'} />
        <Metric label="配当利回り" value={div != null ? `${div}%` : '—'} sub={f.labels?.dividend || '参考'} />
        <Metric label="時価総額" value={cap ?? '—'} sub={f.beta ? `β ${f.beta}` : '参考'} />
      </div>
      {!compact && <p className="fundaNote">{f.note || '非公式データの参考値です。決算短信・会社IRで確認してください。'}</p>}
    </> : <p className="fundaNote">ファンダ値は未取得です。会社理解・材料/IR・確認リンクで一次情報を確認してください。</p>}
  </section>;
}

function ChartPanel({ q }) {
  const presets = [
    { key: '1d5m', label: '5分足', range: '1d', interval: '5m' },
    { key: '1mo1d', label: '1ヶ月', range: '1mo', interval: '1d' },
    { key: '3mo1d', label: '3ヶ月', range: '3mo', interval: '1d' },
    { key: '6mo1d', label: '6ヶ月', range: '6mo', interval: '1d' },
    { key: '1y1d', label: '1年', range: '1y', interval: '1d' },
  ];
  const [presetKey, setPresetKey] = useState('3mo1d');
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const preset = presets.find((x) => x.key === presetKey) || presets[2];

  useEffect(() => {
    if (!q?.code) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    fetch(`${API}/api/chart/${encodeURIComponent(q.code)}?range=${preset.range}&interval=${preset.interval}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) throw new Error(d.error || 'チャート取得に失敗');
        setSeries(d);
      })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q?.code, presetKey]);

  const points = (series?.points || []).filter((p) => Number.isFinite(Number(p.close)));
  const last = points.at(-1);
  const first = points[0];
  const rangePct = first?.close ? ((last?.close - first.close) / first.close) * 100 : null;
  const high = points.length ? Math.max(...points.map((p) => Number(p.high ?? p.close)).filter(Number.isFinite)) : null;
  const low = points.length ? Math.min(...points.map((p) => Number(p.low ?? p.close)).filter(Number.isFinite)) : null;

  return <div className="chartPanel precisionChartPanel">
    <div className="chartSwitch enhanced">
      {presets.map((p) => <button key={p.key} className={presetKey === p.key ? 'active' : ''} onClick={() => setPresetKey(p.key)}>{p.label}</button>)}
    </div>
    {loading && <div className="chartNote">チャートを取得中…</div>}
    {err && <div className="miniError">{err}</div>}
    <PrecisionSeriesChart q={q} points={points} interval={preset.interval} title={`${preset.label} ${preset.interval === '5m' ? '当日' : '日足'}`} />
    <div className="chartStatsGrid">
      <Metric label="期間騰落" value={pct(rangePct)} sub={`${points.length}本`} className={clsBy(rangePct)} />
      <Metric label="期間高値" value={yen(high)} sub="表示範囲" />
      <Metric label="期間安値" value={yen(low)} sub="表示範囲" />
      <Metric label="現在位置" value={yen(last?.close ?? q.price)} sub={preset.interval === '5m' ? '5分足終値' : '日足終値'} />
    </div>
    <div className="chartLegend precise">
      <span>ローソク足</span>
      <span>MA5</span>
      <span>MA20</span>
      <span>MA60</span>
      <span>BB±2σ</span>
      <span>出来高</span>
      <span>十字カーソル/拡大は未実装</span>
    </div>
    <div className="chartNote">精度向上版：終値線だけでなく、ローソク足・出来高・移動平均・ボリンジャーバンド・価格目盛りを同時表示します。短期は5分足、押し目/歪みは3ヶ月〜1年で確認します。</div>
  </div>;
}

function movingAverage(values, n) {
  return values.map((_, i) => {
    const start = Math.max(0, i - n + 1);
    const slice = values.slice(start, i + 1).filter(Number.isFinite);
    if (slice.length < Math.min(n, 3)) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function rollingBands(values, n = 20, k = 2) {
  return values.map((_, i) => {
    const start = Math.max(0, i - n + 1);
    const slice = values.slice(start, i + 1).filter(Number.isFinite);
    if (slice.length < Math.min(n, 8)) return null;
    const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / slice.length);
    return { upper: mid + sd * k, mid, lower: mid - sd * k };
  });
}

function linePath(values, x, y) {
  let started = false;
  const parts = [];
  values.forEach((v, i) => {
    if (!Number.isFinite(Number(v))) { started = false; return; }
    parts.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(v)).toFixed(1)}`);
    started = true;
  });
  return parts.join(' ');
}

function formatAxisPrice(v) {
  if (!Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString('ja-JP', { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 100) return n.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  return n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

function PrecisionSeriesChart({ q, points = [], interval = '1d', title = 'チャート' }) {
  const clean = points.filter((p) => Number.isFinite(Number(p.close)));
  if (clean.length < 2) return <div className="empty">{title}のデータが不足しています</div>;
  const closes = clean.map((p) => Number(p.close));
  const highs = clean.map((p) => Number(p.high ?? p.close));
  const lows = clean.map((p) => Number(p.low ?? p.close));
  const opens = clean.map((p) => Number(p.open ?? p.close));
  const volumes = clean.map((p) => Number(p.volume || 0));
  const ma5 = movingAverage(closes, 5);
  const ma20 = movingAverage(closes, 20);
  const ma60 = movingAverage(closes, 60);
  const bands = rollingBands(closes, 20, 2);
  const overlay = [q.oshimePrice, q.rrTarget, q.rrStop].map(Number).filter(Number.isFinite);
  const allPrice = highs.concat(lows, ma5, ma20, ma60, bands.flatMap((b) => b ? [b.upper, b.mid, b.lower] : []), overlay).filter(Number.isFinite);
  const min = Math.min(...allPrice);
  const max = Math.max(...allPrice);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const W = 720;
  const H = 360;
  const left = 42;
  const right = 58;
  const top = 22;
  const priceH = 240;
  const volTop = top + priceH + 18;
  const volH = 62;
  const innerW = W - left - right;
  const priceBottom = top + priceH;
  const plotBottom = volTop + volH;
  const x = (i) => left + (i / Math.max(clean.length - 1, 1)) * innerW;
  const y = (v) => top + (hi - v) / (hi - lo) * priceH;
  const clampY = (v) => Math.max(top, Math.min(priceBottom, y(v)));
  const maxVol = Math.max(...volumes, 1);
  const vy = (v) => volTop + volH - (Number(v || 0) / maxVol) * volH;
  const candleW = Math.max(2, Math.min(9, innerW / clean.length * 0.58));
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4).reverse();
  const timeTicks = [0, Math.floor((clean.length - 1) / 4), Math.floor((clean.length - 1) / 2), Math.floor((clean.length - 1) * 3 / 4), clean.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i);
  const labelFor = (p) => {
    const d = new Date(p.time || p.date || Date.now());
    if (Number.isNaN(d.getTime())) return '';
    return interval === '5m'
      ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  };
  const bandUpper = bands.map((b) => b?.upper ?? null);
  const bandMid = bands.map((b) => b?.mid ?? null);
  const bandLower = bands.map((b) => b?.lower ?? null);
  const last = clean.at(-1);
  const lastColor = Number(last.close) >= Number(last.open ?? last.close) ? 'up' : 'down';

  const clipBase = String(`${q?.code || 'chart'}-${title}-${interval}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const priceClipId = `priceClip-${clipBase}`;
  const plotClipId = `plotClip-${clipBase}`;

  const levelDefs = [];
  if (Number.isFinite(Number(q.oshimePrice))) {
    levelDefs.push({ key: 'oshime', cls: 'oshime', label: `押し目 ${formatAxisPrice(q.oshimePrice)}`, value: Number(q.oshimePrice), dy: -4 });
  }
  if (Number.isFinite(Number(q.rrStop))) {
    levelDefs.push({ key: 'stop', cls: 'stop', label: `撤退 ${formatAxisPrice(q.rrStop)}`, value: Number(q.rrStop), dy: 11 });
  }
  const renderedLevels = levelDefs
    .map((item) => ({ ...item, cy: clampY(item.value) }))
    .sort((a, b) => a.cy - b.cy)
    .map((item, idx, arr) => {
      const prev = arr[idx - 1];
      if (prev && Math.abs(item.cy - prev.cy) < 16) {
        prev.dy = -8;
        item.dy = 15;
      }
      return item;
    });

  return <svg className={`precisionChart ${interval === '5m' ? 'intraday' : 'swing'}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
    <defs>
      <clipPath id={priceClipId}><rect x={left} y={top} width={innerW} height={priceH} /></clipPath>
      <clipPath id={plotClipId}><rect x={left} y={top} width={innerW} height={plotBottom - top} /></clipPath>
    </defs>
    <rect className="chartBg" x="0" y="0" width={W} height={H} rx="14" />
    <text x="14" y="16" className="chartTitle">{title}</text>
    <text x={W - 12} y="16" className={`chartLast ${lastColor}`} textAnchor="end">終値 {formatAxisPrice(last.close)}</text>
    {ticks.map((t) => <g key={`tick-${t}`}>
      <line className="gridLine" x1={left} x2={W - right} y1={clampY(t)} y2={clampY(t)} />
      <text className="axisText" x={W - right + 6} y={clampY(t) + 3}>{formatAxisPrice(t)}</text>
    </g>)}
    <g clipPath={`url(#${plotClipId})`}>
      {timeTicks.map((i) => <line key={`time-${i}`} className="timeGrid" x1={x(i)} x2={x(i)} y1={top} y2={plotBottom} />)}
      {volumes.map((v, i) => <rect key={`vol-${i}`} className={`volBar ${closes[i] >= opens[i] ? 'up' : 'down'}`} x={x(i) - candleW / 2} y={vy(v)} width={Math.max(1, candleW)} height={Math.max(1, volTop + volH - vy(v))} />)}
      <line className="volBase" x1={left} x2={W - right} y1={plotBottom} y2={plotBottom} />
    </g>
    {timeTicks.map((i) => <text key={`time-label-${i}`} className="axisText" x={x(i)} y={H - 8} textAnchor="middle">{labelFor(clean[i])}</text>)}
    <g clipPath={`url(#${priceClipId})`}>
      <path className="bandLine upper" d={linePath(bandUpper, x, y)} />
      <path className="bandLine mid" d={linePath(bandMid, x, y)} />
      <path className="bandLine lower" d={linePath(bandLower, x, y)} />
      <path className="maLine ma5" d={linePath(ma5, x, y)} />
      <path className="maLine ma20" d={linePath(ma20, x, y)} />
      <path className="maLine ma60" d={linePath(ma60, x, y)} />
      {renderedLevels.map((item) => <line key={item.key} className={`levelLine ${item.cls}`} x1={left} x2={W - right} y1={item.cy} y2={item.cy} />)}
      {clean.map((p, i) => {
        const o = Number(p.open ?? p.close); const h = Number(p.high ?? p.close); const l = Number(p.low ?? p.close); const c = Number(p.close);
        const up = c >= o;
        const bodyY = Math.min(clampY(o), clampY(c));
        const bodyH = Math.max(1, Math.abs(clampY(c) - clampY(o)));
        return <g key={`c-${i}`} className={`candle ${up ? 'up' : 'down'}`}>
          <line x1={x(i)} x2={x(i)} y1={clampY(h)} y2={clampY(l)} />
          <rect x={x(i) - candleW / 2} y={bodyY} width={candleW} height={bodyH} rx="1" />
        </g>;
      })}
      <circle className={`lastDot ${lastColor}`} cx={x(clean.length - 1)} cy={clampY(Number(last.close))} r="4" />
    </g>
    {renderedLevels.map((item) => <text key={`${item.key}-label`} className={`levelText ${item.cls}`} x={left + 4} y={item.cy + item.dy}>{item.label}</text>)}
    <g className="legendSvg">
      <text x={left} y={H - 28}>MA5</text><text x={left + 40} y={H - 28}>MA20</text><text x={left + 90} y={H - 28}>MA60</text><text x={left + 142} y={H - 28}>BB</text><text x={left + 180} y={H - 28}>出来高</text>
    </g>
  </svg>;
}


function formatMaterialDate(item) {
  if (!item) return '日時不明';
  if (item.date || item.time) return [item.date, item.time].filter(Boolean).join(' ');
  if (item.publishedAt || item.pubDate) {
    const d = new Date(item.publishedAt || item.pubDate);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  return '日時不明';
}

function materialDetailHints(item, q) {
  const title = String(item?.title || '');
  const source = item?.source || 'IR/News';
  const tone = item?.tone || item?.kind || '確認材料';
  const cls = item?.className || 'wait';
  const checks = [];
  if (/決算|短信|四半期|通期|業績/.test(title)) checks.push('売上・営業利益・通期予想・進捗率・市場予想との差を見る');
  if (/上方|増配|自社株|取得|還元/.test(title)) checks.push('一過性ではなく、通期利益・キャッシュフロー・継続性を確認する');
  if (/下方|減配|赤字|減損|損失|ワラント|増資|CB|新株/.test(title)) checks.push('押し目ではなく材料売りの可能性。希薄化・損失額・再発性を確認する');
  if (/提携|契約|受注|採択|承認|上市|開発/.test(title)) checks.push('売上規模・利益貢献時期・相手先・継続性を確認する');
  if (!checks.length) checks.push('開示本文で、業績影響の有無・時期・金額・一過性/継続性を確認する');
  const impact = cls === 'danger'
    ? '悪材料候補です。BB下限付近でも、本文確認前の飛びつきは避け、下げ止まりと出来高沈静化を確認。'
    : cls === 'good'
      ? '好材料候補です。ただし発表後に売られている場合は、織り込み済み・期待未達・地合い売りの可能性を確認。'
      : '確認材料です。株価に効くかは金額・時期・市場期待との差で判断。';
  return { title, source, tone, cls, impact, checks };
}



function cleanExtractText(s = '') {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/^[#>\-・*\s]+/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
function clipText(s = '', max = 170) {
  const t = cleanExtractText(s).replace(/\n{2,}/g, '\n').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/[、。\s][^、。\s]*$/, '') + '…';
}
function splitLines(text = '') {
  return cleanExtractText(text).split('\n').map((x) => x.trim()).filter(Boolean);
}
function sectionText(raw, headingWords = [], stopWords = []) {
  const lines = splitLines(raw);
  const isHeading = (line) => {
    const l = line.replace(/[：:]+$/, '');
    return /^【.+】$/.test(l) || /^(会社概要|稼ぎ方|主な稼ぎ方|直近材料|株価反応|歪み|試し玉|確認すべき|結論|リスク|悪材料|成長|伸びる|次に見る|一次情報)/.test(l);
  };
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (headingWords.some((w) => line.includes(w))) { start = i + 1; break; }
  }
  if (start < 0) return '';
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (stopWords.some((w) => line.includes(w))) break;
    if (out.length && isHeading(line)) break;
    if (!headingWords.some((w) => line.includes(w))) out.push(line);
    if (out.join(' ').length > 260) break;
  }
  return clipText(out.join(' '), 230);
}
function keywordLines(raw, keywords = [], maxLines = 3, max = 220) {
  const lines = splitLines(raw);
  const picked = [];
  for (const line of lines) {
    if (keywords.some((w) => line.includes(w)) && !picked.includes(line)) picked.push(line);
    if (picked.length >= maxLines) break;
  }
  return clipText(picked.join(' / '), max);
}
function inferSelectsFromResearch(raw = '') {
  const t = cleanExtractText(raw);
  const has = (re) => re.test(t);
  let health = '未評価';
  if (has(/増収増益|黒字|健全|会社は壊れていない|事業は壊れていない|成長継続|好調|進捗.*良/)) health = '高';
  if (has(/減益|伸び悩み|期待未達|保守予想|鈍化/)) health = health === '高' ? '高' : '中';
  if (has(/赤字転落|下方修正|債務超過|継続疑義|事業悪化|大幅減益|主力.*苦戦/)) health = '低';

  let badSeverity = '未評価';
  if (has(/下方修正|赤字|減損|希薄化|ワラント|増資|CB|事業悪化|債務超過|継続疑義/)) badSeverity = '高';
  else if (has(/期待未達|コンセンサス未達|保守予想|出尽くし|需要鈍化|原料高|円安|金利|市況悪化/)) badSeverity = '中';
  else if (has(/期待値調整|過剰反応|地合い|需給投げ|一時的|利確/)) badSeverity = '低';

  let reasonType = '未評価';
  if (has(/期待値調整|コンセンサス未達|期待未達|保守予想|高PER修正/)) reasonType = '期待値調整';
  else if (has(/下方修正|赤字|減損|事業悪化|主力.*苦戦/)) reasonType = '事業悪化';
  else if (has(/需給投げ|投げ売り|信用|ロスカット|材料出尽くし/)) reasonType = '需給投げ';
  else if (has(/地合い|セクター|金利|為替|指数/)) reasonType = '地合い';
  else if (has(/好材料後|上方修正後|自社株買い後|増配後/)) reasonType = '好材料後調整';
  else if (has(/決算跨ぎ|決算前/)) reasonType = '決算跨ぎ';

  let trialFit = '未評価';
  if (has(/強試し玉|強い試し玉|歪み大|強く買いたい|反発候補|試し玉候補/)) trialFit = '高';
  else if (has(/試し玉|小ロット|戻り選別|反発確認/)) trialFit = '中';
  if (has(/短期のみ|短期リバのみ/)) trialFit = '短期のみ';
  if (has(/触らない|回避|入るべきではない|見送り/)) trialFit = '回避';
  if (trialFit === '高' && badSeverity === '高') trialFit = '中';
  return { health, badSeverity, reasonType, trialFit };
}
function extractResearchNote(raw = '', prev = {}) {
  const t = cleanExtractText(raw);
  if (!t) return normalizeResearchNote(prev);
  const selects = inferSelectsFromResearch(t);
  const business = sectionText(t, ['会社概要','何をしている','事業内容'], ['稼ぎ方','主な稼ぎ方','直近材料','株価反応','歪み','試し玉','確認'])
    || keywordLines(t, ['事業','会社','メーカー','プラットフォーム','開発','販売','運営','提供'], 3);
  const revenue = sectionText(t, ['稼ぎ方','主な稼ぎ方','収益源'], ['伸びる','成長','悪材料','直近材料','株価反応'])
    || keywordLines(t, ['稼ぎ','収益','売上','利益','主力','セグメント','事業'], 3);
  const growth = sectionText(t, ['伸びる','成長','好材料','材料'], ['悪材料','リスク','株価反応','歪み'])
    || keywordLines(t, ['成長','伸長','追い風','好材料','上方','自社株','増配','受注','価格転嫁','需要'], 3);
  const risks = sectionText(t, ['悪材料','リスク','逆風'], ['直近材料','株価反応','歪み','試し玉'])
    || keywordLines(t, ['リスク','悪材料','逆風','下方','赤字','減損','希薄化','鈍化','原料','為替','金利','競争'], 3);
  const dropReason = sectionText(t, ['株価反応','売られた','買われた','下落理由'], ['歪み','試し玉','確認'])
    || keywordLines(t, ['売られ','買われ','下落','急落','反応','期待','コンセンサス','出尽くし','地合い'], 3);
  const distortion = sectionText(t, ['歪み','過剰反応','会社は壊れて'], ['試し玉','確認','結論'])
    || keywordLines(t, ['歪み','過剰反応','壊れていない','期待値調整','事業悪化','会社は'], 3);
  const trial = sectionText(t, ['試し玉','売買','入る条件','撤退条件'], ['次に見る','確認すべき','一次情報','結論'])
    || keywordLines(t, ['試し玉','買い増し','撤退','反発確認','下値','安値','出来高','5分足'], 3);
  const nextChecks = sectionText(t, ['次に見る','確認すべき','一次情報'], ['結論'])
    || keywordLines(t, ['確認','見るべき','決算説明','有報','信用需給','通期','進捗','セクター'], 3);
  return normalizeResearchNote({
    ...prev,
    raw,
    business: business || prev.business || '',
    revenue: revenue || prev.revenue || '',
    growth: growth || prev.growth || '',
    risks: risks || prev.risks || '',
    dropReason: dropReason || prev.dropReason || '',
    distortion: distortion || prev.distortion || '',
    trial: trial || prev.trial || '',
    nextChecks: nextChecks || prev.nextChecks || '',
    ...selects,
  });
}


function SavedNoteSummary({ note, onOpen }) {
  const n = normalizeResearchNote(note);
  const raw = String(n.raw || '').trim();
  return <div className="savedNoteSummary">
    <div><b>保存済み調査メモ</b><span>{n.updatedAt ? new Date(n.updatedAt).toLocaleString('ja-JP') : '保存済み'}</span></div>
    <p>{noteShortLabel(n) || '貼り付けメモあり'}</p>
    {raw && <div className="savedRawPreview">{clipText(raw.replace(/\s+/g, ' '), 260)}</div>}
    <button onClick={onOpen}>貼り付けメモを開く</button>
  </div>;
}

function CompanyNotePanel({ q, note, onSave, onDelete, onSaveAtlas }) {
  const [raw, setRaw] = useState(() => normalizeResearchNote(note).raw || '');
  const [saved, setSaved] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiState, setAiState] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [copyState, setCopyState] = useState('');
  const [manualPrompt, setManualPrompt] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [extractState, setExtractState] = useState('');
  useEffect(() => { setRaw(normalizeResearchNote(note).raw || ''); setSaved(false); setAiState(''); setAiDraft(''); setCopyState(''); setManualPrompt(''); setEditMode(false); setExtractState(''); }, [q?.code, note?.updatedAt]);

  async function pasteRaw() {
    try {
      const txt = await navigator.clipboard?.readText?.();
      if (txt) setRaw(txt);
    } catch {
      alert('クリップボードから貼り付けできませんでした。通常の Ctrl+V で貼ってください。');
    }
  }

  async function autoResearchAI() {
    if (!q?.code) return;
    setAiLoading(true);
    setAiState('AI調査中…');
    try {
      const res = await fetch(`${API}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `${q.code} ${q.name || ''}`, quote: q })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI調査に失敗しました');
      setAiDraft(String(data.text || ''));
      setAiState('AI下書きを作成しました。採用/追記/破棄を選んでから記録保存してください。');
    } catch (e) {
      setAiState(`AI調査失敗：${e.message}`);
    } finally {
      setAiLoading(false);
      setTimeout(() => setAiState(''), 6000);
    }
  }

  function saveNow() {
    onSave?.({ raw, source: 'self' });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  function buildAtlasPrompt() {
    const source = String(raw || note?.raw || '').trim();
    return `以下の日本株について、私が貼り付けた調査ログをもとに、Company Atlas（会社図鑑）用の保存メモを作成してください。

【対象銘柄】
コード：${q.code}
銘柄名：${q.name}

【目的】
この回答は Company Atlas に保存し、今後の押し目スキャナーや自分の売買判断の参照に使います。
単なる会社説明ではなく、「会社の核」「レジーム変化」「成長材料」「資金調達・希薄化」「リスク」「押し目判断」を短く明確に整理してください。

【重要】
・以下の貼り付けメモに含まれる情報を優先してください。
・貼り付けメモにない情報を断定しないでください。
・未確認の情報は必ず「未確認」と明記してください。
・事実、推測、暫定判断を分けてください。
・銘柄名ではなく、今後も再利用できる型分類も入れてください。
・株価診断そのものは流動的なので、会社理解と材料の質を中心にしてください。

【貼り付け調査ログ】
${source || 'ここに調査ログはまだ貼り付けられていません。必要なら、先に記録調査タブへ貼り付けてください。'}

【出力形式】
最後に、必ず以下の固定見出しで「図鑑用編集版」を作ってください。

【会社の核】
【レジーム変化・大型材料】
【成長材料】
【資金調達・希薄化の評価】
【リスク】
【株価を見るポイント】
【押し目判断】
【自分用の暫定判断】

各項目は長すぎず、あとでアプリに貼り付けやすい密度で整理してください。`;
  }

  async function copyAtlasPrompt() {
    const prompt = buildAtlasPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      setManualPrompt('');
      setCopyState('copied');
      setTimeout(() => setCopyState(''), 1600);
    } catch {
      setManualPrompt(prompt);
      setCopyState('failed');
      setTimeout(() => setCopyState(''), 2500);
    }
  }

  const hasRaw = String(raw || '').trim().length > 0;
  return <div className="companyNotePanel simpleNotePanel recordResearchPanel">
    <div className="companyHeader noteHeader">
      <div><div className="smallTitle">記録調査</div><h3>{q.code} {q.name}</h3></div>
      <div className="companyActions compactActions">
        <button title="クリップボードから調査ログを貼り付け" onClick={pasteRaw}>貼付</button>
        <button title="AI下書きを作成" onClick={autoResearchAI} disabled={aiLoading}>{aiLoading ? 'AI中' : 'AI案'}</button>
        <button className="aiResearchBtn" title="この銘柄の記録を保存" onClick={saveNow}>{saved ? '済' : '保存'}</button>
        <button className="sub" title="Company Atlas用プロンプトをコピー" onClick={copyAtlasPrompt}>{copyState === 'copied' ? '図鑑P済' : '図鑑P'}</button>
        {onSaveAtlas && <button className="sub saveAtlasMini" title="図鑑JSONを保存" onClick={onSaveAtlas}>JSON保存</button>}
        {note && <button className="sub dangerMini" title="この銘柄の保存済み調査メモを削除" onClick={() => { if (window.confirm('この銘柄の保存済み調査メモを削除しますか？')) onDelete?.(); }}>削除</button>}
      </div>
    </div>

    <div className="promptInfoBox recordInfoBox">
      <b>記録調査の役割</b>
      <p>ここは、自分で調べたIR・決算・ニュース・ChatGPT回答・AI下書きを保存する場所です。AIが回収した情報と判定は「判定」タブ、保存・図鑑化はこの「記録調査」タブに分けます。</p>
    </div>

    {aiState && <p className="mobileHint">{aiState}</p>}
    {copyState === 'failed' && <div className="miniError aiError">自動コピーに失敗しました。下に表示されたプロンプトを手動でコピーしてください。</div>}
    {manualPrompt && <div className="manualPromptBox"><div className="smallTitle">手動コピー用：図鑑プロンプト</div><textarea rows={10} value={manualPrompt} readOnly onFocus={(e) => e.currentTarget.select()} /></div>}
    {aiDraft && <div className="aiDraftReview"><h4>AI下書き（採用前確認）</h4><textarea value={aiDraft} readOnly rows={10} /><div><button title="AI下書きで現在の貼付欄を置き換え" onClick={() => { setRaw(aiDraft); setAiDraft(''); setAiState('AI下書きを貼り付け欄に採用しました。内容確認後に保存してください。'); }}>採用</button><button title="AI下書きを現在メモの末尾に追加" onClick={() => { setRaw(`${raw}${raw.trim() ? '\n\n--- AI下書き ---\n' : ''}${aiDraft}`); setAiDraft(''); setAiState('AI下書きを現在メモに追記しました。'); }}>追記</button><button className="sub" title="AI下書きを破棄" onClick={() => { setAiDraft(''); setAiState('AI下書きを破棄しました。'); }}>破棄</button></div></div>}
    <label className="noteField raw onlyRaw"><span>調査ログ / ChatGPT回答 / IRメモ貼り付け欄</span><textarea rows={18} value={raw} placeholder="ここに自分で調べた内容、ChatGPT回答、IRメモ、決算メモ、AI下書きを貼り付け。保存すると図鑑カードに反映されます。" onChange={(e) => setRaw(e.target.value)} /></label>
    <div className="noteSimpleFooter">
      <span>{hasRaw ? `${raw.length.toLocaleString('ja-JP')}文字` : '未入力'}</span>
      <span>保存すると図鑑完成度に反映され、判定タブの会社調査プロンプトにも含まれます。</span>
    </div>
  </div>;
}

function parseCreditNumber(v) {
  if (v == null) return null;
  let raw = String(v).replace(/[,，\s]/g, '').trim();
  if (!raw) return null;
  const sign = /^[-−△▲]/.test(raw) ? -1 : 1;
  raw = raw.replace(/[+＋−△▲]/g, '').replace(/株|円|倍|日|千|百|万/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n * sign : null;
}
function fmtSigned(n) {
  const x = parseCreditNumber(n);
  if (x == null) return '—';
  return `${x > 0 ? '+' : ''}${fmt(x)}`;
}
function creditLabelClass(label) {
  if (/かなり重い|投げ残り|悪化|高リスク/.test(label || '')) return 'danger';
  if (/重い|過熱|人気化|注意/.test(label || '')) return 'warn';
  if (/軽い|整理|踏み上げ|良好/.test(label || '')) return 'good';
  return '';
}
function extractCreditData(text) {
  const original = String(text || '');
  const toHalf = (str) => String(str || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0)-0xFEE0))
    .replace(/[＋]/g, '+')
    .replace(/[－−]/g, '-')
    .replace(/[△▲]/g, '-');
  const normalized = toHalf(original)
    .replace(/\r/g, '\n')
    .replace(/\*\*/g, '')
    .replace(/[＊*`]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\[[^\]]*\]:\s*https?:\/\/[^\n]+/g, '')
    .replace(/\[[0-9]+\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[，]/g, ',');
  const lines = normalized.split('\n').map((x) => x.trim()).filter(Boolean);
  const numToken = /[+\-]?\d[\d,]*(?:\.\d+)?/g;
  const stripUnits = (v) => String(v || '')
    .replace(/株|円|倍|％|%|日分/g, '')
    .replace(/[\s　]/g, '')
    .trim();
  const cleanVal = (v) => {
    if (v == null) return '';
    let raw = stripUnits(v)
      .replace(/[−－–—]/g, '-')
      .replace(/[＋]/g, '+')
      .replace(/[△▲]/g, '-')
      .replace(/([+\-])\s+(?=\d)/g, '$1');
    const m = raw.match(/[+\-]?\d[\d,]*(?:\.\d+)?/);
    return m ? m[0] : '';
  };
  const extractNumsFromText = (work) => {
    const raw = String(work || '')
      .replace(/[−－–—]/g, '-')
      .replace(/[＋]/g, '+')
      .replace(/[△▲]/g, '-')
      .replace(/([+\-])\s+(?=\d)/g, '$1');
    return Array.from(raw.matchAll(/[+\-]?\d[\d,]*(?:\.\d+)?/g)).map((m) => cleanVal(m[0])).filter(Boolean);
  };
  const lineHas = (line, aliases) => aliases.some((a) => line.includes(a));
  const lineValues = (aliases) => {
    const candidates = [];
    for (const line of lines) {
      if (!lineHas(line, aliases)) continue;
      if (/^\|?\s*項目\s*\|/.test(line) || /^\|?\s*-+\s*\|/.test(line)) continue;
      let work = line;
      for (const a of aliases) work = work.replaceAll(a, ' ');
      // Markdown tables: keep all cells after the label cell.
      if (line.includes('|')) {
        const cells = line.split('|').map((x) => x.trim()).filter((x) => x && !/^[-:]+$/.test(x));
        const labelIndex = cells.findIndex((c) => lineHas(c, aliases));
        work = cells.slice(labelIndex >= 0 ? labelIndex + 1 : 1).join(' ');
      }
      const nums = extractNumsFromText(work);
      if (nums.length) candidates.push(nums);
    }
    return candidates[0] || [];
  };
  const first = (...arrays) => {
    for (const arr of arrays) if (arr && arr[0]) return arr[0];
    return '';
  };
  const second = (...arrays) => {
    for (const arr of arrays) if (arr && arr[1]) return arr[1];
    return '';
  };
  const reFind = (patterns) => {
    for (const p of patterns) {
      const m = normalized.match(p);
      if (m) return cleanVal(m[1]);
    }
    return '';
  };
  const dateMatch = normalized.match(/(\d{4})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/) || normalized.match(/基準日[^0-9]{0,10}(\d{4})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  const sourceDate = dateMatch ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2,'0')}-${String(dateMatch[3]).padStart(2,'0')}` : '';

  const sellRow = lineValues(['信用売残', '売残']);
  const buyRow = lineValues(['信用買残', '買残']);
  const buyBalance = first(buyRow) || reFind([
    /信用買残[^0-9+\-]{0,40}([+\-]?\d[\d,]*(?:\.\d+)?)/,
    /買残[^0-9+\-]{0,40}([+\-]?\d[\d,]*(?:\.\d+)?)/,
  ]);
  const sellBalance = first(sellRow) || reFind([
    /信用売残[^0-9+\-]{0,40}([+\-]?\d[\d,]*(?:\.\d+)?)/,
    /売残[^0-9+\-]{0,40}([+\-]?\d[\d,]*(?:\.\d+)?)/,
  ]);
  const buyChange = second(buyRow) || reFind([
    /買残前週比[^0-9+\-−－△▲]{0,24}([+＋\-−－△▲]?\s*\d[\d,]*(?:\.\d+)?)/,
    /信用買残[^\n]{0,120}前週比[^0-9+\-−－△▲]{0,24}([+＋\-−－△▲]?\s*\d[\d,]*(?:\.\d+)?)/,
  ]);
  const sellChange = second(sellRow) || reFind([
    /売残前週比[^0-9+\-−－△▲]{0,24}([+＋\-−－△▲]?\s*\d[\d,]*(?:\.\d+)?)/,
    /信用売残[^\n]{0,120}前週比[^0-9+\-−－△▲]{0,24}([+＋\-−－△▲]?\s*\d[\d,]*(?:\.\d+)?)/,
  ]);
  const ratioRow = lineValues(['貸借倍率', '信用倍率']);
  const ratio = first(ratioRow) || reFind([/貸借倍率[^0-9+\-]{0,24}([+\-]?\d[\d,]*(?:\.\d+)?)/, /信用倍率[^0-9+\-]{0,24}([+\-]?\d[\d,]*(?:\.\d+)?)/]);

  const loanStockRow = lineValues(['貸株']);
  const loanStockChgRow = lineValues(['貸株前日比']);
  const marginLoanRow = lineValues(['融資']);
  const marginLoanChgRow = lineValues(['融資前日比']);
  const diffRow = lineValues(['差引']);
  const reverseFeeRow = lineValues(['逆日歩']);
  const loanStock = first(loanStockRow);
  const loanStockChange = first(loanStockChgRow) || second(loanStockRow);
  const marginLoan = first(marginLoanRow);
  const marginLoanChange = first(marginLoanChgRow) || second(marginLoanRow);
  const diff = first(diffRow);
  const reverseFee = first(reverseFeeRow);
  const memoParts = [];
  if (loanStock || marginLoan || diff || reverseFee) {
    memoParts.push(`日証金/貸借: 貸株 ${loanStock || '—'} / 融資 ${marginLoan || '—'} / 差引 ${diff || '—'} / 逆日歩 ${reverseFee || '—'}`);
    if (loanStockChange || marginLoanChange) memoParts.push(`日証金前日比: 貸株 ${loanStockChange || '—'} / 融資 ${marginLoanChange || '—'}`);
  }
  if (/トレーダーズ|traders\.co\.jp/i.test(normalized)) memoParts.push('出典候補: トレーダーズ・ウェブ貼付データ');
  const found = { sourceDate, buyBalance, sellBalance, buyChange, sellChange, ratio, loanStock, loanStockChange, marginLoan, marginLoanChange, diff, reverseFee };
  return {
    ...found,
    memo: memoParts.join('\n'),
    sourceName: /トレーダーズ|traders\.co\.jp/i.test(normalized) ? 'トレーダーズ・ウェブ貼付' : '',
    extractionPreview: Object.entries(found).filter(([,v]) => v !== '' && v != null).map(([k,v]) => `${k}: ${v}`).join('\n'),
  };
}

function extractShortData(text) {
  const t = String(text || '').replace(/\r/g, '\n');
  const cleanNum = '([+＋\-−△▲]?[0-9０-９,，.]+)';
  const normalize = (v) => String(v || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  const find = (patterns) => {
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return normalize(m[1]);
    }
    return '';
  };
  const percent = find([/(?:空売り残高割合|残高割合|割合)[^0-9０-９.]{0,16}([0-9０-９.]+)\s*%/, /([0-9０-９.]+)\s*%\s*(?:空売り|残高)/]);
  const balance = find([
    new RegExp(`(?:空売り|売り残|残高数量|残高株数|空売残高)[^0-9０-９+＋\\-−△▲]{0,16}${cleanNum}`),
    new RegExp(`(?:株数|数量)[^0-9０-９+＋\\-−△▲]{0,16}${cleanNum}`),
  ]);
  const change = find([
    new RegExp(`(?:前回比|増減|差引|変更)[^0-9０-９+＋\\-−△▲]{0,16}${cleanNum}`),
    new RegExp(`(?:増加|減少)[^0-9０-９+＋\\-−△▲]{0,16}${cleanNum}`),
  ]);
  const date = find([/(\d{4}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2})/, /(\d{1,2}[\/\-.月]\s*\d{1,2})/]);
  const institutionLines = t.split('\n').map((x) => x.trim()).filter((x) => /(Nomura|モルガン|Morgan|UBS|Goldman|ゴールドマン|Merrill|メリル|Citigroup|JPモルガン|JPMorgan|Integrated Core|個人|機関|空売り機関|Credit Suisse|クレディ)/i.test(x)).slice(0, 5);
  return {
    shortDate: date,
    shortPercent: percent,
    shortBalance: balance,
    shortChange: change,
    shortInstitutions: institutionLines.join(' / '),
  };
}
function diagnoseShort(note, q) {
  const balance = parseCreditNumber(note?.shortBalance);
  const change = parseCreditNumber(note?.shortChange);
  const pct = parseCreditNumber(note?.shortPercent);
  const price = Number(q?.price);
  const todayVol = Number(q?.volume);
  const avgVol = Number(q?.volumeAvg20 || q?.volume);
  const changePct = Number(q?.changePct);
  const shortDays = balance && avgVol ? balance / avgVol : null;
  const shortValue = balance && price ? balance * price : null;
  let label = '未評価';
  let score = 50;
  const reasons = [];
  const notes = [];
  if (pct != null) {
    if (pct >= 5) { score += 18; label = '機関売り大'; reasons.push(`空売り残高割合 ${pct.toFixed(2)}%：機関売り圧力は大きい`); }
    else if (pct >= 1) { score += 8; label = '機関売りあり'; reasons.push(`空売り残高割合 ${pct.toFixed(2)}%`); }
  }
  if (shortDays != null) {
    if (shortDays >= 5) { score += 12; reasons.push(`空売り残高は20日出来高の${shortDays.toFixed(1)}日分`); }
    else if (shortDays <= 1) notes.push(`空売り残高は出来高の${shortDays.toFixed(1)}日分で消化は速い`);
  }
  if (change != null && change > 0 && Number.isFinite(changePct) && changePct < 0) {
    label = '機関売り増加';
    score += 14;
    reasons.push('株価下落中に空売り増加：売り圧力継続を警戒');
  }
  if (change != null && change < 0 && Number.isFinite(changePct) && changePct > 0) {
    label = '返済入り';
    score += 18;
    reasons.push('株価上昇中に空売り減少：買い戻しが入っている可能性');
  }
  if (change != null && change > 0 && Number.isFinite(changePct) && changePct > 0) {
    label = '踏み上げ候補';
    score += 16;
    reasons.push('株価上昇中に空売り増加：売り方が踏まれる余地');
  }
  if (change != null && change < 0 && Number.isFinite(changePct) && changePct < 0) {
    label = '売り解消中';
    score += 4;
    reasons.push('下落中でも空売りは減少：売り圧力は一部解消');
  }
  if (!balance && pct == null) reasons.push('機関空売りデータ未入力。空売りネット等で確認');
  if (note?.shortInstitutions) notes.push(`主な機関: ${String(note.shortInstitutions).slice(0, 120)}`);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { label, score, reasons, notes, shortDays, shortValue, pct, balance, change };
}
function shortLabelClass(label) {
  if (/売り増加|売り大|機関売り/.test(label || '')) return 'warn';
  if (/返済|踏み上げ|解消/.test(label || '')) return 'good';
  return '';
}

function diagnoseCredit(note, q) {
  const buy = parseCreditNumber(note?.buyBalance);
  const sell = parseCreditNumber(note?.sellBalance);
  const buyChg = parseCreditNumber(note?.buyChange);
  const sellChg = parseCreditNumber(note?.sellChange);
  const manualRatio = parseCreditNumber(note?.ratio);
  const price = Number(q?.price);
  const todayVol = Number(q?.volume);
  const avgVol = Number(q?.volumeAvg20 || q?.volume);
  const ratio = buy && sell ? buy / sell : manualRatio;
  const buyDays = buy && avgVol ? buy / avgVol : null;
  const todayBuyDays = buy && todayVol ? buy / todayVol : null;
  const sellDays = sell && avgVol ? sell / avgVol : null;
  const buyValue = buy && price ? buy * price : null;
  const sellValue = sell && price ? sell * price : null;
  const mcap = Number(q?.marketCap ?? q?.fundamental?.marketCap);
  const buyMcapPct = buyValue && Number.isFinite(mcap) && mcap > 0 ? buyValue / mcap * 100 : null;
  const lowPrice = Number.isFinite(price) && price <= 500;
  const changePct = Number(q?.changePct);
  let label = '未評価';
  let score = 50;
  const reasons = [];
  const notes = [];

  if (buyDays != null) {
    if (buyDays >= 20) { label = 'かなり重い'; score -= 34; reasons.push(`買残が20日出来高の${buyDays.toFixed(1)}日分でかなり重い`); }
    else if (buyDays >= 10) { label = '重い'; score -= 22; reasons.push(`買残が20日出来高の${buyDays.toFixed(1)}日分`); }
    else if (buyDays <= 2.5) { label = '軽い'; score += 18; reasons.push(`買残は20日出来高の${buyDays.toFixed(1)}日分で消化しやすい`); }
    else { label = '普通'; score += 4; reasons.push(`買残は20日出来高の${buyDays.toFixed(1)}日分`); }
  }
  if (todayBuyDays != null && todayBuyDays >= 8) notes.push(`今日の出来高基準では${todayBuyDays.toFixed(1)}日分。場中の消化力は要確認`);
  if (ratio != null) {
    if (ratio >= 20) { score -= 12; reasons.push(`信用倍率 ${ratio.toFixed(1)}倍：買い長が強い`); }
    else if (ratio >= 8) { score -= 7; reasons.push(`信用倍率 ${ratio.toFixed(1)}倍：買い残優勢`); }
    else if (ratio <= 1.2) { score += 10; reasons.push(`信用倍率 ${ratio.toFixed(1)}倍：売り残もあり踏み上げ余地`); }
    else if (ratio <= 3) { score += 5; reasons.push(`信用倍率 ${ratio.toFixed(1)}倍：需給は極端ではない`); }
  }
  if (buyMcapPct != null) {
    if (buyMcapPct >= 3) { score -= 14; reasons.push(`買残金額が時価総額の${buyMcapPct.toFixed(2)}%で重め`); }
    else if (buyMcapPct >= 1) { score -= 6; notes.push(`買残金額は時価総額の${buyMcapPct.toFixed(2)}%`); }
    else { score += 4; notes.push(`買残金額は時価総額の${buyMcapPct.toFixed(2)}%で大きくはない`); }
  }
  if (buyChg != null && buyChg > 0 && changePct < 0) {
    score -= 18;
    label = /軽い/.test(label) ? '普通' : '投げ残り注意';
    reasons.push('下落中に買残増加：戻り売りの供給が増えやすい');
  }
  if (buyChg != null && buyChg > 0 && changePct > 0) {
    score -= 4;
    reasons.push('上昇中に買残増加：人気化。ただし高値掴みも混ざる');
    if (!/重い|投げ/.test(label)) label = '人気化中';
  }
  if (buyChg != null && buyChg < 0) {
    score += 10;
    reasons.push('買残減少：信用整理が進む方向');
    if (!/重い|投げ/.test(label)) label = '整理進行';
  }
  if (sellChg != null && sellChg > 0 && changePct > 0) {
    score += 12;
    reasons.push('売残増＋株価上昇：踏み上げ余地');
    if (!/重い|投げ/.test(label)) label = '踏み上げ余地';
  }
  if (sellDays != null && sellDays >= 3) notes.push(`売残も20日出来高の${sellDays.toFixed(1)}日分あり、上昇時は買い戻し要因`);
  if (lowPrice && buy != null) notes.push('低位株補正：株数だけで多い少ないを判断せず、金額・出来高比を優先');
  if (!buy) reasons.push('買残未入力。株数ではなく出来高比・金額比で確認');
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { label, score, reasons, notes, buyDays, todayBuyDays, sellDays, buyValue, sellValue, ratio, buyMcapPct };
}
function CreditBalancePanel({ q, note, onSave, onDelete, onSaveAtlas }) {
  const [form, setForm] = useState(() => ({ buyBalance:'', sellBalance:'', buyChange:'', sellChange:'', ratio:'', loanStock:'', loanStockChange:'', marginLoan:'', marginLoanChange:'', diff:'', reverseFee:'', memo:'', raw:'', sourceDate:'', extractionPreview:'', ...(note || {}) }));
  const [saved, setSaved] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [parseState, setParseState] = useState('');
  const [jpxLoading, setJpxLoading] = useState(false);
  useEffect(() => { setForm({ buyBalance:'', sellBalance:'', buyChange:'', sellChange:'', ratio:'', loanStock:'', loanStockChange:'', marginLoan:'', marginLoanChange:'', diff:'', reverseFee:'', memo:'', raw:'', sourceDate:'', extractionPreview:'', ...(note || {}) }); setSaved(false); setCopyState(''); setParseState(''); setJpxLoading(false); }, [q?.code, note?.updatedAt]);
  function setField(k, v) { setForm((prev) => ({ ...prev, [k]: v })); }
  const d = diagnoseCredit(form, q);
  function parseRaw() {
    const parsed = extractCreditData(form.raw);
    setForm((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(parsed).filter(([_, v]) => v !== '' && v != null)), raw: prev.raw, memo: [prev.memo, parsed.memo].filter(Boolean).join('\n') }));
    const found = ['buyBalance','sellBalance','buyChange','sellChange','ratio','sourceDate','loanStock','loanStockChange','marginLoan','marginLoanChange','diff','reverseFee'].filter((k) => parsed[k]);
    setParseState(found.length ? `仮入力しました：${found.join(' / ')}` : '数値を自動抽出できませんでした。プロンプトでChatGPTに構造化させてから貼り直してください。');
    setTimeout(() => setParseState(''), 2500);
  }
  async function pasteRaw() {
    try {
      const text = await navigator.clipboard.readText();
      setForm((prev) => ({ ...prev, raw: text }));
      setTimeout(() => {
        const parsed = extractCreditData(text);
        setForm((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(parsed).filter(([_, v]) => v !== '' && v != null)), raw: text, memo: [prev.memo, parsed.memo].filter(Boolean).join('\n') }));
      }, 0);
      setParseState('クリップボードから貼り付けました。抽出値を確認してください。');
    } catch {
      setParseState('クリップボード読取に失敗しました。手動で貼り付けてください。');
    }
    setTimeout(() => setParseState(''), 2500);
  }
  async function fetchJpxAuto() {
    if (!q?.code) return;
    setJpxLoading(true);
    setParseState('JPX信用残を取得中…');
    try {
      const res = await fetch(`${API}/api/credit-jpx-history/${encodeURIComponent(q.code)}?weeks=8`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'JPX取得失敗');
      const latest = data.latest || (Array.isArray(data.history) ? data.history.at(-1) : null);
      if (!latest) throw new Error('信用残の抽出結果が空です');
      const preview = [
        `基準日: ${latest.sourceDate || ''}`,
        `信用売残: ${fmt(latest.sellBalance)} / 前週比 ${fmtSigned(latest.sellChange)}`,
        `信用買残: ${fmt(latest.buyBalance)} / 前週比 ${fmtSigned(latest.buyChange)}`,
        `倍率: ${latest.ratio ?? '—'}`,
        data.overhang?.reason ? `履歴判定: ${data.overhang.reason}` : '',
        latest.rowText ? `抽出行: ${latest.rowText}` : '',
      ].filter(Boolean).join('\n');
      setForm((prev) => ({
        ...prev,
        buyBalance: latest.buyBalance != null ? String(latest.buyBalance) : prev.buyBalance,
        sellBalance: latest.sellBalance != null ? String(latest.sellBalance) : prev.sellBalance,
        buyChange: latest.buyChange != null ? String(latest.buyChange) : prev.buyChange,
        sellChange: latest.sellChange != null ? String(latest.sellChange) : prev.sellChange,
        ratio: latest.ratio != null ? String(latest.ratio) : prev.ratio,
        sourceDate: latest.sourceDate || prev.sourceDate,
        raw: prev.raw || latest.rowText || '',
        extractionPreview: preview,
        memo: [prev.memo, data.overhang?.reason ? `JPX履歴判定：${data.overhang.reason}` : ''].filter(Boolean).join('\n'),
      }));
      setParseState(`JPX ${latest.sourceDate || ''} を取得しました。数値と抽出行を確認してください。`);
    } catch (e) {
      setParseState(`JPX自動取得失敗：${e.message}。信用需給調査プロンプトか貼り付け抽出を使ってください。`);
    } finally {
      setJpxLoading(false);
      setTimeout(() => setParseState(''), 4500);
    }
  }

  function buildCreditPrompt() {
    const qline = [
      `コード：${q.code}`,
      `銘柄名：${q.name}`,
      `現在値：${q.price ?? '未取得'}`,
      `前日比：${q.changePct ?? '未取得'}%`,
      `出来高：${fmt(q.volume)}`,
      `20日平均出来高：${fmt(q.volumeAvg20 || q.volume)}`,
      `時価総額：${q.marketCap ? yen(q.marketCap) : '未取得'}`,
      `状態判定：${q.statePrimary || q.stateKind || '未判定'}`,
      `歪みスコア：${q.distortionScore ?? '未取得'}`,
    ].join('\n');
    const savedCredit = [
      `信用買残：${form.buyBalance || '未保存'}`,
      `信用売残：${form.sellBalance || '未保存'}`,
      `買残前週比：${form.buyChange || '未保存'}`,
      `売残前週比：${form.sellChange || '未保存'}`,
      `信用倍率/貸借倍率：${form.ratio || '未保存'}`,
      `基準日：${form.sourceDate || '未保存'}`,
      `貸株：${form.loanStock || '未保存'}`,
      `貸株前日比：${form.loanStockChange || '未保存'}`,
      `融資：${form.marginLoan || '未保存'}`,
      `融資前日比：${form.marginLoanChange || '未保存'}`,
      `差引：${form.diff || '未保存'}`,
      `逆日歩：${form.reverseFee || '未保存'}`,
    ].join('\n');
    return `以下の日本株について、まず最新の信用需給データを調査し、そのうえで診断してください。\n\n重要：過去に保存した信用データや貼り付けメモは、現在値として扱わないでください。必ず最新に近い信用買残・信用売残・前週比・信用倍率/貸借倍率・基準日を確認し、取得できた数値を優先してください。取得できない項目は「未確認」と明記してください。\n\n【銘柄・株価情報】\n${qline}\n\n【アプリ内の前回保存データ（参考扱い。最新値としては使わない）】\n${savedCredit}\n\n【まず調査して取得してほしい信用需給データ】\n・信用買残\n・信用売残\n・買残前週比\n・売残前週比\n・信用倍率または貸借倍率\n・基準日\n・可能なら日証金データ：貸株、融資、差引、逆日歩\n・可能なら機関空売り/貸株残の概況\n\n確認元候補：トレーダーズ・ウェブ、Yahooファイナンス、株探、JPX銘柄別信用取引週末残高、日証金、証券会社の信用情報ページ。確認元と基準日を必ず書いてください。\n\n【診断してほしいこと】\n1. 買残株数だけで重い/軽いを判定せず、出来高に対する重さ、買残金額、時価総額比、株価位置を踏まえてください。\n2. 低位株の場合は株数が大きく見えやすいので、金額ベース・出来高比で補正してください。\n3. 株価下落中に買残が増えているのか、上昇中に買残が増えているのかを分けてください。\n4. 売残が多い場合は、単なる売り圧ではなく、踏み上げ余地・買い戻し余地も評価してください。\n5. 日証金データ（貸株・融資・差引・逆日歩）は、信用残とは別枠の短期貸借需給として読み解いてください。\n6. この銘柄を短期信用で触る場合、需給面で「試し玉可 / 小ロット限定 / 反発確認 / 戻り売り注意 / 信用では触らない」のどれに近いか整理してください。\n\n【出力形式】\n【取得した信用需給データ】\n信用買残：\n信用売残：\n買残前週比：\n売残前週比：\n信用倍率/貸借倍率：\n基準日：\n確認元：\n\n【日証金・貸借データ】\n貸株：\n融資：\n差引：\n逆日歩：\n読み方：\n\n【需給診断】\n軽い / 普通 / 重い / かなり重い / 人気化中 / 投げ残り注意 / 踏み上げ余地 / 整理進行 のどれか。\n\n【診断理由】\n出来高比、株価方向、買残増減、売残増減、低位株補正を使って説明してください。\n\n【売買への翻訳】\n試し玉可 / 小ロット限定 / 反発確認 / 戻り売り注意 / 信用では触らない のどれに近いか。\n\n【次に見るべき数字】\n次回信用残更新で何が減れば良いか、何が増えると悪いかを整理してください。`;
  }
  async function copyCreditPrompt() {
    const text = buildCreditPrompt();
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('信用需給調査プロンプトをコピーしました');
    } catch {
      setForm((prev) => ({ ...prev, raw: `${prev.raw || ''}\n\n--- 手動コピー用プロンプト ---\n${text}` }));
      setCopyState('コピーに失敗したため、貼付欄にプロンプトを追記しました');
    }
    setTimeout(() => setCopyState(''), 2200);
  }
  function saveNow() { onSave?.(form); setSaved(true); setTimeout(() => setSaved(false), 1400); }
  const history = Array.isArray(note?.history) ? note.history.slice(-5).reverse() : [];
  const buyChgNum = parseCreditNumber(form.buyChange);
  const sellChgNum = parseCreditNumber(form.sellChange);
  const action = (() => {
    if (!parseCreditNumber(form.buyBalance)) return { label: '未判定', tone: '', text: '信用データを貼り付けて抽出してください' };
    if (/かなり重い|投げ残り/.test(d.label)) return { label: '戻り売り注意', tone: 'bad', text: '反発しても信用買いのやれやれ売りを確認' };
    if (/重い/.test(d.label)) return { label: '小ロット限定', tone: 'warn', text: '入るなら撤退ラインを近く置く' };
    if (/踏み上げ/.test(d.label)) return { label: '反発加速余地', tone: 'good', text: '売残・買い戻しが上昇燃料になる可能性' };
    if (/整理/.test(d.label)) return { label: '整理進行', tone: 'good', text: '買残減少が続くか次回更新で確認' };
    if (/軽い/.test(d.label)) return { label: '需給軽め', tone: 'good', text: '信用需給は主因になりにくい' };
    if (/人気化/.test(d.label)) return { label: '人気化中', tone: 'warn', text: '短期資金流入。ただし高値掴み混入に注意' };
    return { label: '反発確認', tone: 'warn', text: '出来高と買残増減を次回更新で確認' };
  })();
  const toneForChange = (n, kind) => {
    const x = parseCreditNumber(n);
    if (x == null || x === 0) return '';
    if (kind === 'buy') return x > 0 ? 'bad' : 'good';
    if (kind === 'sell') return x > 0 ? 'good' : 'neutral';
    return '';
  };
  const keyReads = [
    { label: '信用買残', value: fmt(parseCreditNumber(form.buyBalance)), sub: d.buyDays == null ? '現在数量' : `20日出来高の${d.buyDays.toFixed(1)}日分`, cls: d.buyDays >= 10 ? 'bad' : d.buyDays <= 2.5 ? 'good' : '' },
    { label: '信用売残', value: fmt(parseCreditNumber(form.sellBalance)), sub: d.sellDays == null ? '現在数量' : `20日出来高の${d.sellDays.toFixed(1)}日分`, cls: d.sellDays >= 3 ? 'good' : '' },
    { label: '買残増減', value: fmtSigned(buyChgNum), sub: buyChgNum == null ? '未入力' : buyChgNum > 0 ? '買い残増：戻り売り注意' : buyChgNum < 0 ? '整理方向' : '横ばい', cls: toneForChange(buyChgNum, 'buy') },
    { label: '売残増減', value: fmtSigned(sellChgNum), sub: sellChgNum == null ? '未入力' : sellChgNum > 0 ? '踏み上げ燃料候補' : sellChgNum < 0 ? '売り解消' : '横ばい', cls: toneForChange(sellChgNum, 'sell') },
    { label: '消化日数', value: d.buyDays == null ? '—' : `${d.buyDays.toFixed(1)}日`, sub: d.buyDays == null ? '買残未入力' : d.buyDays >= 10 ? '重い' : d.buyDays <= 2.5 ? '軽い' : '普通', cls: d.buyDays >= 10 ? 'bad' : d.buyDays <= 2.5 ? 'good' : '' },
    { label: '信用倍率', value: d.ratio == null ? '—' : `${d.ratio.toFixed(2)}倍`, sub: d.ratio == null ? '売残未入力' : d.ratio <= 1.2 ? '売残多め' : d.ratio >= 8 ? '買い長' : '中立', cls: d.ratio >= 8 ? 'bad' : d.ratio <= 1.2 ? 'good' : '' },
  ];
  return <div className="creditPanel compactCredit">
    <div className="companyHeader noteHeader">
      <div><div className="smallTitle">信用需給</div><h3>{q.code} {q.name}</h3></div>
      <div className="companyActions compactActions">
        <button className="sub" title="信用需給調査プロンプトをコピー" onClick={copyCreditPrompt}>需給P</button>
        <button className="sub" title="JPXから信用データを自動取得" onClick={fetchJpxAuto} disabled={jpxLoading}>{jpxLoading ? 'JPX中' : 'JPXβ'}</button>
        <button title="この銘柄の信用需給を保存" onClick={saveNow}>{saved ? '済' : '保存'}</button>
        {note && <button className="sub dangerMini" title="この銘柄の信用需給メモを削除" onClick={() => { if (window.confirm('この銘柄の信用需給メモを削除しますか？')) onDelete?.(); }}>削除</button>}
      </div>
    </div>
    {(copyState || parseState) && <div className="notice good">{copyState || parseState}</div>}
    <div className="creditDecisionCard">
      <div className="creditDecisionMain">
        <span className={`pill ${creditLabelClass(d.label)}`}>{d.label}</span>
        <strong className={`creditAction ${action.tone}`}>{action.label}</strong>
        <span className="creditScore">需給点 {d.score}</span>
      </div>
      <p>{d.reasons[0] || action.text}</p>
      <small>{[action.text, ...d.reasons.slice(1), ...d.notes].filter(Boolean).slice(0, 3).join(' / ')}</small>
    </div>
    <div className="creditReadGrid">
      {keyReads.map((x) => <div className={`creditRead ${x.cls || ''}`} key={x.label}><span>{x.label}</span><b>{x.value}</b><em>{x.sub}</em></div>)}
    </div>
    <div className="creditPasteBox clean">
      <label className="noteField raw"><span>信用需給調査回答 / 信用データ貼り付け欄</span><textarea rows={10} value={form.raw || ''} onChange={(e) => setField('raw', e.target.value)} placeholder="ChatGPTの信用需給調査回答、またはトレーダーズ・ウェブ/Yahoo/株探/証券会社画面の信用データを貼り付け" /></label>
      <div className="inlineActions">
        <button className="sub" onClick={pasteRaw}>クリップボードから貼付</button>
        <button className="sub" onClick={parseRaw}>信用データを抽出</button>
      </div>
      <div className="creditPreview"><b>抽出プレビュー</b><pre>{form.extractionPreview || 'まだ抽出していません。貼り付け後に「信用データを抽出」を押してください。'}</pre></div>
    </div>
    <details className="creditDetails" open>
      <summary>抽出結果・手修正</summary>
      <div className="creditForm">
        <label><span>基準日</span><input value={form.sourceDate || ''} onChange={(e) => setField('sourceDate', e.target.value)} placeholder="例：2026/5/10" /></label>
        <label><span>信用買残 株</span><input value={form.buyBalance || ''} onChange={(e) => setField('buyBalance', e.target.value)} placeholder="例：1,200,000" /></label>
        <label><span>信用売残 株</span><input value={form.sellBalance || ''} onChange={(e) => setField('sellBalance', e.target.value)} placeholder="例：300,000" /></label>
        <label><span>買残 前週比 株</span><input value={form.buyChange || ''} onChange={(e) => setField('buyChange', e.target.value)} placeholder="例：+120,000" /></label>
        <label><span>売残 前週比 株</span><input value={form.sellChange || ''} onChange={(e) => setField('sellChange', e.target.value)} placeholder="例：-20,000" /></label>
        <label><span>信用倍率 / 貸借倍率</span><input value={form.ratio || ''} onChange={(e) => setField('ratio', e.target.value)} placeholder="例：2.55" /></label>
      </div>
    </details>
    <details className="creditDetails">
      <summary>日証金・貸借データ</summary>
      <div className="creditForm subCreditForm">
        <label><span>貸株</span><input value={form.loanStock || ''} onChange={(e) => setField('loanStock', e.target.value)} placeholder="例：1,108,200" /></label>
        <label><span>貸株 前日比</span><input value={form.loanStockChange || ''} onChange={(e) => setField('loanStockChange', e.target.value)} placeholder="例：+2,500" /></label>
        <label><span>融資</span><input value={form.marginLoan || ''} onChange={(e) => setField('marginLoan', e.target.value)} placeholder="例：191,900" /></label>
        <label><span>融資 前日比</span><input value={form.marginLoanChange || ''} onChange={(e) => setField('marginLoanChange', e.target.value)} placeholder="例：-84,000" /></label>
        <label><span>差引</span><input value={form.diff || ''} onChange={(e) => setField('diff', e.target.value)} placeholder="例：-450,400" /></label>
        <label><span>逆日歩</span><input value={form.reverseFee || ''} onChange={(e) => setField('reverseFee', e.target.value)} placeholder="例：0.05" /></label>
      </div>
    </details>
    <details className="creditDetails">
      <summary>詳細計算値</summary>
      <div className="summaryGrid creditMetrics detailOnly">
        <Metric label="買残金額" value={d.buyValue == null ? '—' : yen(d.buyValue)} sub={d.buyMcapPct == null ? '買残 × 現在値' : `時価総額比 ${d.buyMcapPct.toFixed(2)}%`} />
        <Metric label="今日出来高基準" value={d.todayBuyDays == null ? '—' : `${d.todayBuyDays.toFixed(1)}日`} sub="買残 ÷ 今日出来高" />
        <Metric label="売残日数" value={d.sellDays == null ? '—' : `${d.sellDays.toFixed(1)}日`} sub="売残 ÷ 20日出来高" />
        <Metric label="売残金額" value={d.sellValue == null ? '—' : yen(d.sellValue)} sub="売残 × 現在値" />
      </div>
    </details>
    <label className="noteField raw"><span>需給メモ</span><textarea rows={6} value={form.memo || ''} onChange={(e) => setField('memo', e.target.value)} placeholder="例：買残は重いが売残もあり、800円台回復で買い戻し余地。次回更新で買残減少を確認。" /></label>
    {!!history.length && <div className="creditHistory"><b>保存履歴</b>{history.map((h, i) => <div key={i} className="historyRow"><span>{h.sourceDate || h.savedAt?.slice(0,10) || '—'}</span><span>買 {fmt(parseCreditNumber(h.buyBalance))}</span><span>売 {fmt(parseCreditNumber(h.sellBalance))}</span><span>買増減 {fmtSigned(h.buyChange)}</span></div>)}</div>}
  </div>;
}



function ReferenceLinksPanel({ q, materials = [] }) {
  const code = q?.code || '';
  const name = q?.name || '';
  const enc = (s) => encodeURIComponent(s);
  const news = dedupeMaterials(materials).slice(0, 3);
  return <div className="referenceLinksPanel">
    <h4>参考リンク</h4>
    <LinkTier title="まず見る" defaultOpen>
      <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${enc(`${code} ${name} 公式 IR 決算説明資料 中期経営計画`)}`}>公式IR / 決算説明資料</a>
      <a target="_blank" rel="noreferrer" href="https://www.release.tdnet.info/inbs/I_main_00.html">TDnet 適時開示</a>
    </LinkTier>
    <LinkTier title="材料確認" defaultOpen>
      {news.length ? news.map((m, i) => m.url ? <a key={i} target="_blank" rel="noreferrer" href={m.url}>{m.title}</a> : <span key={i}>{m.title}</span>) : <span>直近ニュース候補は未取得</span>}
      <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${enc(`${code} ${name} 提携 受注 増資 決算 材料`)}`}>提携/受注/増資/決算検索</a>
    </LinkTier>
    <LinkTier title="急落時に見る" defaultOpen>
      <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${enc(`${code} ${name} 配当落ち 権利落ち 優待落ち`)}`}>配当落ち / 権利落ち / 優待落ち</a>
      <a target="_blank" rel="noreferrer" href={`https://finance.yahoo.co.jp/quote/${code}.T`}>Yahoo掲示板 / 株価</a>
      <a target="_blank" rel="noreferrer" href={`https://minkabu.jp/stock/${code}/bbs`}>みんかぶ掲示板</a>
      <a target="_blank" rel="noreferrer" href={`https://kabutan.jp/stock/news?code=${code}`}>Kabutanニュース</a>
    </LinkTier>
    <LinkTier title="株価補助">
      <a target="_blank" rel="noreferrer" href={`https://finance.yahoo.co.jp/quote/${code}.T`}>Yahoo Finance Japan</a>
      <a target="_blank" rel="noreferrer" href={`https://kabutan.jp/stock/?code=${code}`}>Kabutan</a>
      <a target="_blank" rel="noreferrer" href={`https://minkabu.jp/stock/${code}`}>みんかぶ</a>
    </LinkTier>
    <LinkTier title="最後に">
      <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${enc(`${code} ${name}`)}`}>Google検索</a>
    </LinkTier>
  </div>;
}

function UnifiedCompanyResearchPanel({ q, ir, dropReport, research, note, onSave, onDelete, onSaveAtlas }) {
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState(() => normalizeResearchNote(note).raw || '');
  const [saved, setSaved] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiState, setAiState] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [copyState, setCopyState] = useState('');
  const [manualPrompt, setManualPrompt] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [extractState, setExtractState] = useState('');

  useEffect(() => { setRaw(normalizeResearchNote(note).raw || ''); setSaved(false); setAiState(''); setAiDraft(''); setCopyState(''); setManualPrompt(''); setEditMode(false); setExtractState(''); }, [q?.code, note?.updatedAt]);

  async function loadResearch(force = false) {
    if (!q?.code) return;
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API}/api/company-research/${encodeURIComponent(q.code)}${force ? '?force=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '会社調査に失敗');
      setCompany(data);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  useEffect(() => { setCopyState(''); setManualPrompt(''); loadResearch(false); }, [q?.code]);

  const report = company;
  const summary = report?.summary;
  const business = report?.business || {};
  const growth = report?.growth || {};
  const risks = report?.risks || {};
  const materials = report?.materials || [];
  const chatty = report?.chatty;
  const goodMaterials = (growth.goodMaterials || []).length ? growth.goodMaterials : materials.filter((x) => x.className === 'good');
  const badMaterials = (risks.badMaterials || []).length ? risks.badMaterials : materials.filter((x) => x.className === 'danger');
  const atlas = atlasProgress(note, null, q);
  const hasRaw = !!String(raw || '').trim();
  const memoSections = extractSections(raw);
  const memoConfidence = companyMemoConfidence(raw, note?.updatedAt);

  function buildCompanyResearchPrompt() {
    const recentItems = [...(ir?.items || []).slice(0, 8), ...materials].slice(0, 12);
    const fmtLine = (x) => `- ${formatMaterialDate(x)} ${x.source || 'IR/News'}：${x.title || ''}${x.url ? `\n  URL: ${x.url}` : ''}`;
    const savedRaw = String(raw || note?.raw || '').trim();
    return `以下の日本株について、会社調査と株価反応の切り分けをしてください。

【銘柄】
${q.code} ${q.name}

【現在の株価・テクニカル】
現在値：${yen(q.price)}
前日比：${pct(q.changePct)}
出来高倍率：${fmt(q.volumeRatio, '倍')}
BB位置：${q.bbPos == null ? '—' : q.bbPos + 'σ'}
押し目目安：${yen(q.oshimePrice)} / ${q.oshimeLabel || '—'}
歪み度：${q.overshootScore ?? '—'} / ${((q.overshootReasons || []).join(' / ') || '—')}
状態判定：${q.statePrimary || q.totalJudge || q.primaryDecision || '—'}
理由：${q.stateReason || q.decisionReason || '—'}
注意：${q.stateCaution || q.decisionCaution || '—'}

【アプリが取得した会社情報】
取得精度：${report?.confidence || '—'}
取得元：${report?.source || '—'}
何をしている会社か：${business.profile || '未取得'}
主な稼ぎ方：${business.segments || '未取得'}
伸びる材料候補：${((growth.goodMaterials || []).map(x => x.title || x).slice(0,5)).join(' / ') || '—'}
悪材料候補：${((risks.badMaterials || []).map(x => x.title || x).slice(0,5)).join(' / ') || '—'}

【直近IR・ニュース候補】
${recentItems.length ? recentItems.map(fmtLine).join('\n') : '取得なし'}

【保存済み/自分のメモ】
${savedRaw || '未保存'}

【調査してほしいこと】
会社の核、直近12〜24か月のレジーム変化、成長材料、資金調達・希薄化、リスク、信用需給、株価反応の過剰/妥当を、未確認を明記して整理してください。`;
  }

  function buildAtlasPrompt() {
    const source = String(raw || note?.raw || '').trim();
    return `以下の日本株について、私が貼り付けた調査ログをもとに、Company Atlas（会社図鑑）用の保存メモを作成してください。

【対象銘柄】
コード：${q.code}
銘柄名：${q.name}

【貼り付け調査ログ】
${source || 'ここに調査ログはまだ貼り付けられていません。'}

【出力形式】
【会社の核】
【レジーム変化・大型材料】
【成長材料】
【資金調達・希薄化の評価】
【リスク】
【株価を見るポイント】
【押し目判断】
【自分用の暫定判断】

未確認の情報は必ず「未確認」と明記してください。`;
  }

  async function copyText(text, okLabel) {
    try {
      await navigator.clipboard.writeText(text);
      setManualPrompt('');
      setCopyState(okLabel);
      setTimeout(() => setCopyState(''), 1600);
    } catch {
      setManualPrompt(text);
      setCopyState('failed');
      setTimeout(() => setCopyState(''), 2500);
    }
  }

  async function autoResearchAI() {
    if (!q?.code) return;
    setAiLoading(true); setAiState('AI調査中…');
    try {
      const res = await fetch(`${API}/api/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `${q.code} ${q.name || ''}`, quote: q }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI調査に失敗しました');
      setAiDraft(String(data.text || ''));
      setAiState('AI下書きを作成しました。採用/追記/破棄を選んでから保存してください。');
    } catch (e) { setAiState(`AI調査失敗：${e.message}`); }
    finally { setAiLoading(false); setTimeout(() => setAiState(''), 6000); }
  }

  function saveNow() {
    onSave?.({ raw, source: 'self' });
    setSaved(true);
    setEditMode(false);
    setTimeout(() => setSaved(false), 1600);
  }
  function extractKeyInfoFromRaw() {
    if (!hasRaw) return;
    const sections = extractSections(raw);
    if (Object.keys(sections).length) {
      setEditMode(false);
      setExtractState('見出しを検出し、有益情報カードに整理しました。');
    } else {
      const converted = inferSectionsFromLegacyMemo(raw);
      setRaw(converted);
      setEditMode(false);
      setExtractState('古い自由文メモを暫定図鑑形式に変換しました。元メモも末尾に残しています。確認して保存してください。');
    }
    setTimeout(() => setExtractState(''), 5000);
  }
  function openChatGPT() { window.location.href = 'chatgpt://'; }

  return <div className="unifiedCompanyResearch companyNotePanel simpleNotePanel">
    <div className="companyHeader noteHeader">
      <div><div className="smallTitle">記録調査 / 会社調査</div><h3>{q.code} {q.name}</h3></div>
      <div className="companyActions compactActions">
        {loading && <span className="loadingPill">調査中…</span>}
        <button onClick={() => loadResearch(true)} disabled={loading}>{loading ? '再調査中' : '再調査'}</button>
        {onSaveAtlas && <button className="sub saveAtlasMini" onClick={onSaveAtlas}>JSON保存</button>}
      </div>
    </div>

    {err && <div className="miniError">{err}</div>}
    <section className={`companyQuickSummary ${memoConfidence.className}`}>
      <div className="smallTitle">まず見る結論</div>
      {hasRaw ? <>
        <p><b>稼ぎ方</b><span>{sectionSnippet(memoSections, ['主な稼ぎ方','会社の核'], business.profile || '未記録')}</span></p>
        <p><b>売買理由</b><span>{sectionSnippet(memoSections, ['直近材料','歪み判定','株価を見るポイント'], chatty?.headline || summary?.judgement || '未確認')}</span></p>
        <p><b>材料</b><span>{sectionSnippet(memoSections, ['成長材料','レジーム変化・大型材料'], '成長材料は未整理')}</span></p>
        <p><b>信頼度</b><span>{memoConfidence.label}：{memoConfidence.reason}</span></p>
      </> : <div className="emptyCompanyMemo"><b>まだ会社情報が記録されていません</b><span>まず会社を調べるか、AI下書きを取得してください。</span></div>}
    </section>
    <section className={`companyStance ${summary?.className || 'wait'}`}>
      <b>{chatty?.headline || summary?.judgement || '会社情報・直近材料を調査しています。'}</b>
      <p>取得情報と判定を確認し、そのまま下の図鑑メモへ保存できます。</p>
    </section>
    <div className="profileMeta">
      <span>取得精度: {report?.confidence || '—'}</span>
      <span>取得元: {report?.source || '—'}</span>
      <span>IR {summary?.dataCoverage?.irCount ?? '—'}件</span>
      <span>ニュース {summary?.dataCoverage?.newsCount ?? '—'}件</span>
      <span>完成度 {atlas.stars}</span>
    </div>

    <div className="researchBlock primaryResearch expandedProfile">
      <h4>会社の核</h4><p>{business.profile || '取得中、または取得不可です。公式IRで確認してください。'}</p>
      <h4>主な稼ぎ方</h4><p className="segmentText">{business.segments || 'セグメント別売上・利益を確認してください。'}</p>
      <h4>直近材料</h4><ul>{(goodMaterials.length ? goodMaterials : materials).slice(0, 5).map((x, i) => <li key={i}>{x.title || x}</li>)}</ul>
      <h4>リスク</h4><ul>{badMaterials.slice(0, 5).map((x, i) => <li key={i}>{x.title || x}</li>)}</ul>{!badMaterials.length && <p className="muted">強い悪材料候補は未検出です。</p>}
    </div>

    <div className="researchToolbar phaseToolbar">
      <div className="phaseHelp">
        <b>使い分け</b>
        <span>会社を調べる＝調査開始用プロンプト / 図鑑に整形＝ChatGPTで保存形式へ整える / 有益情報を抽出＝古いメモも暫定カード化</span>
      </div>
      <div className="phaseRow">
        <span className="phaseLabel">調べる</span>
        <button className={`sub researchMain ${!hasRaw ? 'activeTool' : ''}`} onClick={() => copyText(buildCompanyResearchPrompt(), 'company')}>📋 会社を調べる</button>
        <button className="sub" onClick={openChatGPT}>📱 ChatGPT</button>
      </div>
      {hasRaw && <div className="phaseRow formatPhase">
        <span className="phaseLabel">整える</span>
        <button className="sub activeTool" onClick={extractKeyInfoFromRaw}>✨ 有益情報を抽出</button>
        <button className="sub researchMain" onClick={() => copyText(buildAtlasPrompt(), 'atlas')}>📋 図鑑に整形</button>
      </div>}
      {copyState === 'company' && <span className="copyMini">会社調査プロンプトをコピー済み</span>}
      {copyState === 'atlas' && <span className="copyMini">図鑑整形プロンプトをコピー済み</span>}
      {extractState && <span className="copyMini">{extractState}</span>}
    </div>
    {copyState === 'failed' && <div className="miniError aiError">自動コピーに失敗しました。下に表示されたプロンプトを手動でコピーしてください。</div>}
    {manualPrompt && <div className="manualPromptBox"><div className="smallTitle">手動コピー用プロンプト</div><textarea rows={10} value={manualPrompt} readOnly onFocus={(e) => e.currentTarget.select()} /></div>}
    {aiState && <p className="mobileHint">{aiState}</p>}
    {aiDraft && <div className="aiDraftReview"><h4>AI下書き（採用前確認）</h4><textarea value={aiDraft} readOnly rows={10} /><div><button onClick={() => { setRaw(aiDraft); setAiDraft(''); }}>採用して上書き</button><button onClick={() => { setRaw(`${raw}${raw.trim() ? '\n\n--- AI下書き ---\n' : ''}${aiDraft}`); setAiDraft(''); }}>自分のメモに追記</button><button className="sub" onClick={() => setAiDraft('')}>破棄</button></div></div>}

    <div className="memoEditArea">
      {hasRaw && !editMode ? <AtlasMemoCards raw={raw} onEdit={() => setEditMode(true)} /> : <label className="noteField raw onlyRaw"><span>自分の図鑑メモ / 調査ログ</span><textarea rows={18} value={raw} placeholder="ここに自分で調べた内容、ChatGPT回答、IRメモ、決算メモ、AI下書きを貼り付け。" onChange={(e) => setRaw(e.target.value)} /></label>}
    </div>
    <ReferenceLinksPanel q={q} materials={rankMaterialsForToday([...(ir?.items || []), ...materials], q).slice(0, 8)} />
    <div className="noteSimpleFooter">
      <span>{hasRaw ? `${raw.length.toLocaleString('ja-JP')}文字` : '未入力'}</span>
      <span>完成度 {atlas.stars} / 最終更新 {note?.updatedAt ? new Date(note.updatedAt).toLocaleString('ja-JP') : '未保存'}</span>
      <button className="aiResearchBtn" onClick={saveNow}>{saved ? '保存済み' : '💾 図鑑に保存'}</button>
      {hasRaw && editMode && <button className="sub" onClick={() => setEditMode(false)}>閲覧に戻る</button>}
      {note && <button className="sub dangerMini" onClick={() => { if (window.confirm('この銘柄の保存済み調査メモを削除しますか？')) onDelete?.(); }}>削除</button>}
    </div>
  </div>;
}

function CompanyPanel({ q, ir, dropReport, research, companyNote }) {
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [deepOpen, setDeepOpen] = useState(true);
  const [copyState, setCopyState] = useState('');
  const [manualPrompt, setManualPrompt] = useState('');

  function buildCompanyResearchPrompt() {
    const report = company || {};
    const summary = report.summary || {};
    const business = report.business || {};
    const growth = report.growth || {};
    const risks = report.risks || {};
    const materials = report.materials || [];
    const irItems = (ir?.items || []).slice(0, 8);
    const newsItems = materials.filter((x) => /Yahoo|News|ニュース|Google/i.test(x.source || '')).slice(0, 8);
    const recentItems = [...irItems, ...materials].slice(0, 12);
    const fmtLine = (x) => `- ${formatMaterialDate(x)} ${x.source || 'IR/News'}：${x.title || ''}${x.url ? `\n  URL: ${x.url}` : ''}`;
    const savedRaw = String(companyNote?.raw || '').trim();
    const savedBlock = savedRaw ? `\n\n【過去の保存済み調査メモ】\n${savedRaw.slice(0, 5000)}${savedRaw.length > 5000 ? '\n（長いため一部省略）' : ''}` : '';
    return `以下の日本株について、会社調査と株価反応の切り分けをしてください。

【銘柄】
${q.code} ${q.name}

【現在の株価・テクニカル】
現在値：${yen(q.price)}
前日比：${pct(q.changePct)}
出来高倍率：${fmt(q.volumeRatio, '倍')}
BB位置：${q.bbPos == null ? '—' : q.bbPos + 'σ'}
BB上限：${yen(q.bbUpper)} / BB中心：${yen(q.bbMid)} / BB下限：${yen(q.bbLower)}
押し目目安：${yen(q.oshimePrice)} / ${q.oshimeLabel || '—'}
短期RR：${rrText(q.predictedRR)}
状態判定：${q.primaryDecision || q.totalJudge || q.statePrimary || '—'}
理由：${q.decisionReason || q.stateReason || '—'}
注意：${q.decisionCaution || q.stateCaution || '—'}
歪みスコア：${q.distortionScore ?? '—'}
期待値調整スコア：${q.expectationGapScore ?? '—'}
悪材料深刻度：${q.materialSeverity ?? '—'}
セクター相対：${q.sectorRelativeChange == null ? '—' : pct(q.sectorRelativeChange)}
価格行動型：${q.priceMode || '—'}
守備型上昇スコア：${q.enduranceScore ?? '—'} / 推力型上昇スコア：${q.thrustScore ?? '—'}

【アプリが取得した会社情報】
取得精度：${report.confidence || '—'}
取得元：${report.source || '—'}
何をしている会社か：${business.profile || '未取得'}
主な稼ぎ方：${business.segments || '未取得'}
見るべき項目：${(business.watchPoints || []).join(' / ') || '—'}
伸びる材料候補：${((growth.goodMaterials || []).map(x => x.title || x).slice(0,5)).join(' / ') || '—'}
悪材料候補：${((risks.badMaterials || []).map(x => x.title || x).slice(0,5)).join(' / ') || '—'}

【直近IR・ニュース候補】
${recentItems.length ? recentItems.map(fmtLine).join('\n') : '取得なし'}

【調査してほしいこと】
1. 会社の核
この会社は何をしている会社か。表面的な業種名ではなく、実際の主力事業・顧客・収益源を具体的に説明してください。

2. 主な稼ぎ方
売上・利益の源泉、主要事業、利益率の出方、景気・為替・金利・市況・政策の影響を整理してください。

3. 直近12〜24か月のレジーム変化
大型受注、提携、官公庁案件、大企業案件、上方修正、増配、自社株買い、資金調達、事業転換、量産化、黒字化、赤字拡大など、会社の見え方が変わった材料を確認してください。

4. 直近決算の読み方
売上、営業利益、経常利益、純利益、進捗率、通期予想、コンセンサスとの差を見て、
「本当に悪い決算」なのか、
「期待値未達」なのか、
「保守予想」なのか、
「出尽くし」なのかを切り分けてください。

5. 売られている/買われている理由
株価反応が、業績悪化、期待値調整、地合い、セクター売り、需給投げ、材料出尽くし、好材料再評価、決算ハードルのどれに近いか整理してください。

6. ポジティブ要因・上値材料
この銘柄が今後買われる可能性がある理由を整理してください。
以下を確認してください。
・業績成長、増収増益、利益率改善
・上方修正余地、コンセンサス上振れ余地
・大型受注、契約、提携、官公庁案件、大企業案件
・価格転嫁、原材料安、為替、金利、セクター環境の追い風
・増配、自社株買い、株主還元強化
・テーマ性、政策支援、資金流入、セクター見直し
・事業フェーズの変化、量産化、黒字化、売上化、利益化
・過去高値更新、レーティング、目標株価、信用売り残による踏み上げ余地
・株価が見直されるきっかけになりそうな材料
単なる希望ではなく、確認できる材料と、まだ未確認の期待を分けてください。

7. 悪材料・逆風
下方修正、赤字拡大、希薄化、資金調達、需要悪化、原材料高、為替、金利、競争環境、制度変更などを確認してください。

8. 歪み判定
会社の実態や材料の質に対して、株価反応が過剰かどうかを評価してください。
分類は以下から選んでください。
・大きな歪み候補
・期待値調整下落
・需給投げ候補
・地合い/セクター連動
・事業悪化下落
・材料確認中
・歪みなし

9. 試し玉として見るなら
短期で試す場合の条件を整理してください。
・入るなら何を確認するか
・撤退ラインはどこか
・買い増し条件は何か
・持ち越しに向くか
・現物中期に向くか
・信用短期に向くか

10. 中期・現物枠として見るなら
短期RRではなく、テーマ進捗、事業進捗、受注、成長材料、株価見直し余地を踏まえて評価してください。

11. 信用需給・需給構造
信用買い残、売り残、信用倍率、回転日数、貸借/非貸借、空売り・踏み上げ余地を確認してください。
特に、下落局面でも買い残が増え、上昇局面でも買い残が増えるような「将来の売り供給が積み上がる構造」かどうかを確認してください。
未確認なら未確認と明記し、確認すべきページ名・指標を示してください。

12. 型分類
銘柄名ではなく、以下の性質名で分類してください。複数該当可です。
・構造劣化下落型：実績悪化、下方修正、赤字拡大、主力事業悪化
・期待プレミアム剥落型：増収増益や事業継続はあるが、コンセンサス未達・高PER修正で売られた
・構造改善継続押し型：下降抜け、反転初動、下値切り上げ、事業改善が継続
・テーマ進捗反映型：受注、打ち上げ、量産化、黒字化、官公庁案件などテーマが実体化
・振れ幅のある下降型：下降中だが15〜20%級の戻りを取りにいける
・だらだら下げ型：戻りが弱く、買い残や失望で値を引き直している
・急落型：悪材料や需給投げによる断続的な急落
・底ばい型：売りは枯れつつあるが、まだ買い材料待ち
・事象主導型：TOB、MBO、経営統合、株式移転、買収などで値動きが条件に支配される
・守備型上昇：値幅は小さいが下げに強く、持続的に上がる
・推力型上昇：テーマ性・出来高・高値更新で上へ走る

【回答形式】
【会社の核】
【主な稼ぎ方】
【直近材料・レジーム変化】
【直近決算の読み方】
【売られた/買われた理由】
【ポジティブ要因・上値材料】
【悪材料・注意点】
【信用需給・需給構造】
【歪み判定】
【試し玉として見るなら】
【中期・現物枠として見るなら】
【次に見るべき確認点】
【暫定判断】

注意：
・買い推奨・売り推奨ではなく、事実・推測・確認点を分けてください。
・未確認の情報は「未確認」と明記してください。
・可能なら出典や確認すべき一次情報も示してください。
・単なる業種説明ではなく、「この株価反応をどう読むか」まで踏み込んでください。${savedBlock}`;
  }

  async function copyCompanyResearchPrompt() {
    const prompt = buildCompanyResearchPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      setManualPrompt('');
      setCopyState('copied');
      setTimeout(() => setCopyState(''), 1600);
    } catch (e) {
      setManualPrompt(prompt);
      setCopyState('failed');
      setTimeout(() => setCopyState(''), 2500);
    }
  }

  function openChatGPT() {
    // iPhoneでChatGPTアプリを開く用途。Web版は開かない。
    window.location.href = 'chatgpt://';
  }

  async function loadResearch(force = false) {
    if (!q?.code) return;
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API}/api/company-research/${encodeURIComponent(q.code)}${force ? '?force=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '会社調査に失敗');
      setCompany(data);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  useEffect(() => { setSelectedMaterial(null); setCopyState(''); setManualPrompt(''); loadResearch(false); }, [q?.code]);

  const badIr = (ir?.items || []).find((x) => /下方|減配|減損|特別損失|赤字|ワラント|増資|CB|新株|希薄化/.test(x.title));
  const report = company;
  const summary = report?.summary;
  const business = report?.business || {};
  const growth = report?.growth || {};
  const risks = report?.risks || {};
  const materials = report?.materials || [];
  const chatty = report?.chatty;
  const goodMaterials = (growth.goodMaterials || []).length ? growth.goodMaterials : materials.filter((x) => x.className === 'good');
  const badMaterials = (risks.badMaterials || []).length ? risks.badMaterials : materials.filter((x) => x.className === 'danger');
  const neutralMaterials = materials.filter((x) => x.className !== 'good' && x.className !== 'danger');
  const activeMat = selectedMaterial || goodMaterials[0] || badMaterials[0] || neutralMaterials[0] || null;
  const matDetail = activeMat ? materialDetailHints(activeMat, q) : null;

  return <section className="companyPanel researchMode">
    <div className="companyHeader">
      <div><div className="smallTitle">AI判定 / 取得情報</div><h3>{q.code} {q.name}</h3></div>
      <div className="companyActions">
        {loading && <span className="loadingPill">調査中…</span>}
        <button onClick={() => loadResearch(true)} disabled={loading}>{loading ? '調査中' : '再調査'}</button>
        <button className="aiResearchBtn promptMini" title="会社調査プロンプトをコピー" onClick={copyCompanyResearchPrompt}>{copyState === 'copied' ? 'P済' : '会社P'}</button>
        <button className="sub promptMini" title="ChatGPTアプリを開く（未インストール時は反応しません）" onClick={openChatGPT}>App</button>
      </div>
    </div>
    {err && <div className="miniError">{err}</div>}

    {copyState === 'failed' && <div className="miniError aiError">自動コピーに失敗しました。下に表示されたプロンプトを手動でコピーしてください。</div>}
    {manualPrompt && <div className="manualPromptBox"><div className="smallTitle">手動コピー用プロンプト</div><textarea rows={10} value={manualPrompt} readOnly onFocus={(e) => e.currentTarget.select()} /></div>}
    <div className="promptInfoBox">
      <b>AI判定の使い方</b>
      <p>アプリが取得した価格・IR・ニュース・会社情報をもとに、銘柄を見る論点を整理します。保存や図鑑化の起点は「記録調査」タブです。</p>
    </div>
    {companyNote && <div className="savedNoteRef"><div className="smallTitle">記録調査タブで保存されたメモ（参照）</div><SavedNoteSummary note={companyNote} onOpen={() => window.dispatchEvent(new CustomEvent('openCompanyNoteTab'))} /><p className="muted">編集・追記は「記録調査」タブで行います。</p></div>}

    <div className={`companyStance ${summary?.className || 'wait'}`}>
      <b>{chatty?.headline || summary?.judgement || '会社情報・直近材料を調査しています。'}</b>
      <p>ここではアプリが取得したIR・ニュース・事業情報と、その判定を表示します。自分で調べて貼る一次メモは「記録調査」タブに集約します。</p>
    </div>

    <div className="profileMeta">
      <span>取得精度: {report?.confidence || '—'}</span>
      <span>取得元: {report?.source || '—'}</span>
      <span>IR {summary?.dataCoverage?.irCount ?? '—'}件</span>
      <span>ニュース {summary?.dataCoverage?.newsCount ?? '—'}件</span>
      {report?.fetchedAt && <span>調査 {new Date(report.fetchedAt).toLocaleTimeString('ja-JP')}</span>}
    </div>

    {chatty?.sections?.length > 0 && <div className={`chattyReport ${chatty.lowConfidence ? 'lowConfidence' : ''}`}>
      <div className="chattyTitle">{chatty.lowConfidence ? '取得事実のみ / 低信頼' : '会社調査サマリー'}</div>
      {chatty.sections.map((sec) => <div className="chattySection" key={sec.title}>
        <h4>{sec.title}</h4>
        <p>{sec.body}</p>
      </div>)}
      <div className="chattyChecks">
        {(chatty.bullets?.checks || []).slice(0, 8).map((x) => <span key={x}>{x}</span>)}
      </div>
    </div>}

    <div className="researchBlock primaryResearch expandedProfile">
      <h4>何をしている会社か</h4>
      <p>{business.profile || '取得中、または取得不可です。右下の公式IR・決算説明資料リンクで確認してください。'}</p>
      <h4>主な稼ぎ方・事業構成</h4>
      <p className="segmentText">{business.segments || 'セグメント別売上・利益を確認してください。'}</p>
      <div className="miniChecklist">
        {(business.watchPoints || ['直近決算', '通期見通し', 'セグメント別売上・利益', '売られている理由', '信用需給']).slice(0, 6).map((x) => <span key={x}>{x}</span>)}
      </div>
    </div>

    <div className="deepGrid four companySignalGrid">
      <div className="deepCard"><b>確認すべき事業論点</b><ul>{(business.watchPoints || ['直近決算', '通期見通し', 'セグメント別売上・利益', '信用需給']).slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul></div>
      <div className="deepCard accent"><b>自動検出した好材料/確認材料</b><ul>{(goodMaterials.length ? goodMaterials : neutralMaterials).slice(0, 5).map((x, i) => <li key={`${x.title || x}-${i}`}>{x.title || x}</li>)}</ul>{!(goodMaterials.length || neutralMaterials.length) && <p className="muted">銘柄一致の好材料・確認材料は未検出です。</p>}</div>
      <div className="deepCard risk"><b>自動検出した悪材料候補</b><ul>{badMaterials.slice(0, 5).map((x, i) => <li key={`${x.title || x}-${i}`}>{x.title || x}</li>)}</ul>{!badMaterials.length && <p className="muted">銘柄一致の強い悪材料候補は未検出です。</p>}</div>
      <div className="deepCard"><b>押し目/歪み判断への使い方</b><p>{business.oshimeUse || '売られている理由が一時要因か構造要因か、ポジティブ材料が残っているかを分けて確認します。'}</p></div>
    </div>

    <div className="researchBlock materialDrill">
      <div className="materialHead">
        <h4>材料判定</h4>
        <span>好材料 {goodMaterials.length} / 悪材料 {badMaterials.length} / 確認 {neutralMaterials.length}</span>
      </div>
      <div className="materialDrillGrid">
        <div className="materialBuckets">
          <MaterialBucket title="好材料候補" items={goodMaterials} kind="good" onPick={setSelectedMaterial} active={activeMat} />
          <MaterialBucket title="悪材料・売られる理由候補" items={badMaterials} kind="danger" onPick={setSelectedMaterial} active={activeMat} />
          <MaterialBucket title="確認材料" items={neutralMaterials.slice(0, 6)} kind="wait" onPick={setSelectedMaterial} active={activeMat} />
        </div>
        <div className={`materialDetailCard ${matDetail?.cls || 'wait'}`}>
          {matDetail ? <>
            <div className="materialTone">{matDetail.tone} / {matDetail.source}</div>
            <h4>{matDetail.title}</h4>
            <p>{matDetail.impact}</p>
            <b>本文で見るポイント</b>
            <ul>{matDetail.checks.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="links inlineLinks">
              {(activeMat.url || activeMat.link) && <a href={activeMat.url || activeMat.link} target="_blank" rel="noreferrer">本文を開く</a>}
              <a href={`https://www.google.com/search?q=${encodeURIComponent(q.code + ' ' + q.name + ' ' + matDetail.title)}`} target="_blank" rel="noreferrer">この材料を検索</a>
            </div>
          </> : <p className="muted">銘柄一致の材料が少ないです。公式IRと決算予定を確認してください。</p>}
        </div>
      </div>
    </div>

    <div className="researchBlock compact">
      <button className="sectionToggle" onClick={() => setDeepOpen(!deepOpen)}>{deepOpen ? '詳細確認項目を閉じる' : '詳細確認項目を開く'}</button>
      {deepOpen && <div className="deepDetailList">
        <h4>この下落を見るポイント</h4><ul>
          {(summary?.technicalNotes || []).map((x) => <li key={x}>{x}</li>)}
          {(business.watchPoints || ['直近決算', '通期見通し', 'セグメント別売上・利益', '信用需給']).map((x) => <li key={x}>{x}</li>)}
          {dropReport?.diagnosis?.summary && <li>急落理由メモ: {dropReport.diagnosis.summary}</li>}
          {research?.main && <li>テクニカル判定: {research.main}</li>}
        </ul>
      </div>}
    </div>

    <div className="links bigLinks irLinks minimal">
      {report?.links?.officialIr && <a href={report.links.officialIr} target="_blank" rel="noreferrer">公式IR・決算説明資料</a>}
      {report?.links?.business && <a href={report.links.business} target="_blank" rel="noreferrer">事業/セグメントを調査</a>}
      {report?.links?.recent && <a href={report.links.recent} target="_blank" rel="noreferrer">フレッシュな取り組み</a>}
      {report?.links?.negative && <a href={report.links.negative} target="_blank" rel="noreferrer">悪材料・下落理由</a>}
      {report?.links?.credit && <a href={report.links.credit} target="_blank" rel="noreferrer">信用需給</a>}
    </div>
  </section>;
}

function MaterialBucket({ title, items, kind, onPick, active }) {
  return <div className={`materialBucket ${kind}`}>
    <b>{title}</b>
    {items.length === 0 && <p className="muted">該当なし</p>}
    {items.slice(0, 5).map((x, i) => <button key={`${x.title}-${i}`} className={active?.title === x.title ? 'active' : ''} onClick={() => onPick(x)}>
      <span>{x.tone || x.kind || '確認'}</span>
      <em>{x.title}</em><small>{formatMaterialDate(x)}</small>
    </button>)}
  </div>;
}

function TechnicalPanel({ q }) {
  return <>
    <div className="grid2">
      <Metric label="BB上限" value={yen(q.bbUpper)} sub="利確候補" />
      <Metric label="BB中心" value={yen(q.bbMid)} sub="浅い押し目" />
      <Metric label="BB下限" value={yen(q.bbLower)} sub="深い押し目" />
      <Metric label="BB位置" value={q.bbPos == null ? '—' : `${q.bbPos}σ`} sub="中心からの距離" />
      <Metric label="押し目価格" value={yen(q.oshimePrice)} sub={q.oshimeLabel} strong />
      <Metric label="予測RR" value={rrText(q.predictedRR)} sub={`目標 ${yen(q.rrTarget)} / 撤退 ${yen(q.rrStop)}`} strong className={rrClass(q.predictedRR)} />
      <Metric label="出来高倍率" value={fmt(q.volumeRatio, '倍')} sub="20日平均比" />
      <Metric label="20日高値比" value={pct(q.drawdown20)} sub={`高値 ${yen(q.high20)}`} />
    </div>
    <details className="detailBox" open>
      <summary>押し目ゾーン詳細</summary>
      <div className="zoneList">
        <div className="zone"><b>第1押し目</b><span>{yen(q.bbMid)}</span><em>BB中心。強い銘柄の浅い押し</em></div>
        <div className="zone"><b>第2押し目</b><span>{yen(q.bbMinus1)}</span><em>-1σ。通常の押し目候補</em></div>
        <div className="zone"><b>第3押し目</b><span>{yen(q.bbLower)}</span><em>BB下限。反発確認必須</em></div>
      </div>
    </details>
  </>;
}


function materialDetail(item) {
  const title = item?.title || '';
  const kind = item?.kind || 'IR';
  const riskWords = /下方|減配|減損|特別損失|訴訟|ワラント|増資|CB|新株|希薄化|赤字|中止|延期|不適切|不正/;
  const goodWords = /上方|増配|自社株|自己株|受注|契約|承認|採択|提携|TOB|公開買付|増益|最高益|分割/;
  const neutralWords = /決算|短信|説明資料|月次|進捗|中期経営|人事|定款|株主総会/;
  const tone = riskWords.test(title) ? '悪材料寄り' : goodWords.test(title) ? '好材料寄り' : neutralWords.test(title) ? '確認材料' : '材料';
  const className = tone === '悪材料寄り' ? 'danger' : tone === '好材料寄り' ? 'good' : 'wait';

  let impact = 'タイトルだけでは方向感を断定しにくい材料です。開示本文で数値・時期・市場反応を確認してください。';
  let checks = ['開示本文の数値', '通期予想への影響', '翌営業日の出来高と寄り付き反応'];

  if (/決算|短信/.test(title)) {
    impact = '決算系です。押し目に見える下落でも、進捗率・通期予想・来期見通しが悪い場合は下降継続になりやすいです。';
    checks = ['売上・営業利益の前年同期比', '通期進捗率', '会社予想の修正有無', '市場予想との差'];
  } else if (/上方|増益|最高益/.test(title)) {
    impact = '業績上振れ系の可能性があります。出尽くし売りか、再評価初動かを出来高と翌日以降の値持ちで確認します。';
    checks = ['修正幅', '一過性か継続性か', '寄り天か値持ちするか', 'BB中心を維持するか'];
  } else if (/下方|赤字|減損|特別損失/.test(title)) {
    impact = '悪材料で売られている可能性があります。単なる押し目ではなく、下値再評価に入っていないか警戒です。';
    checks = ['損失が一過性か', '営業利益への影響', '財務への影響', 'BB下限割れ後の戻りの弱さ'];
  } else if (/配当|増配|減配|優待/.test(title)) {
    impact = '株主還元系です。増配・優待改善なら下支え、減配ならバリュエーション再評価の可能性があります。';
    checks = ['利回りの変化', '配当性向', '業績との整合性', '権利日までの需給'];
  } else if (/自社株|自己株/.test(title)) {
    impact = '自社株買い系です。需給改善材料ですが、規模が小さい場合は短期反応で終わることがあります。';
    checks = ['取得上限金額', '発行株数比率', '取得期間', '出来高に対する規模'];
  } else if (/ワラント|増資|CB|新株/.test(title)) {
    impact = '希薄化系です。押し目ではなく需給悪化で下げている可能性が高く、反発確認なしの買いは危険です。';
    checks = ['希薄化率', '行使価額', '資金使途', '既存株主への影響'];
  } else if (/受注|契約|承認|採択|販売|開始/.test(title)) {
    impact = '事業材料です。業績寄与の時期と金額が見えれば好材料、金額不明ならテーマ反応に留まる可能性があります。';
    checks = ['金額の開示有無', '売上計上時期', '継続性', '同テーマ銘柄の反応'];
  } else if (/提携|資本業務提携|TOB|公開買付|合併|買収|譲渡/.test(title)) {
    impact = '再編・提携系です。株価への影響が大きい場合があります。条件・価格・相手先を優先確認します。';
    checks = ['相手先', '取引条件', '買付価格や交換比率', '業績・財務への影響'];
  }

  return { tone, className, impact, checks, kind };
}

function MaterialDetail({ item, q }) {
  if (!item) return <div className="empty">材料を選択すると、ここに要点と確認ポイントを表示します</div>;
  const d = materialDetail(item);
  return <div className={`materialDetail ${d.className}`}>
    <div className="detailTop">
      <span className="irKind">{d.kind}</span>
      <span className={`materialTone ${d.className}`}>{d.tone}</span>
      <small>{formatMaterialDate(item)} / {item.source}</small>
    </div>
    <h4>{item.title}</h4>
    <p>{d.impact}</p>
    <div className="researchBlock compact">
      <h4>見るポイント</h4>
      <ul>{d.checks.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
    <div className="detailActions">
      <a href={item.url} target="_blank" rel="noreferrer">開示・記事本文を開く</a>
      <a href={`https://www.google.com/search?q=${encodeURIComponent(`${q.code} ${q.name} ${item.title}`)}`} target="_blank" rel="noreferrer">この材料を検索</a>
    </div>
  </div>;
}

function IrPanel({ ir, loading, error, onReload, q }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const items = rankMaterialsForToday(ir?.items || [], q);
  const visibleItems = showAll ? items : items.slice(0, 5);
  const active = visibleItems[activeIdx] || visibleItems[0] || items[0];
  const important = items.filter((x) => x.important).length;
  const groups = items.reduce((acc, x) => { acc[x.kind] = (acc[x.kind] || 0) + 1; return acc; }, {});

  return <section className="irPanel">
    <div className="irHeader">
      <div>
        <div className="smallTitle">直近TDnet IR</div>
        <h3>{q.code} {q.name}</h3>
      </div>
      <button className="sub smallBtn" onClick={onReload} disabled={loading}>{loading ? '取得中…' : '再取得'}</button>
    </div>
    {error && <div className="error smallError">{error}</div>}
    {loading && !ir && <div className="empty">TDnetで銘柄コード一致のIRを取得中…</div>}
    {ir?.summary && <div className={`materialSummary ${ir.summary.className}`}><b>{ir.summary.level}</b><p>{ir.summary.text}</p></div>}

    <div className="materialDigest">
      <div><b>{items.length}</b><span>検出材料</span></div>
      <div><b>{important}</b><span>重要候補</span></div>
      <div><b>{Object.keys(groups).slice(0, 3).join(' / ') || '—'}</b><span>主な種別</span></div>
    </div>

    <div className="irNote">銘柄コードに一致したTDnet開示のみ表示します。材料を押すと要点・確認ポイントを表示します。</div>

    <div className="materialLayout">
      <div className="irList compactList">
        {items.length === 0 && !loading ? <div className="empty">直近TDnet IRは未検出です</div> : visibleItems.map((item, i) => <button className={`irItem ${item.important ? 'important' : ''} ${activeIdx === i ? 'active' : ''}`} key={`${item.source}-${i}-${item.title}`} onClick={() => setActiveIdx(i)}>
          <div><span className="irKind">{item.kind}</span>{item.important && <span className="importantBadge">重要</span>}<em>{item.source}</em></div>
          <b>{item.title}</b>
          <small>{formatMaterialDate(item)}</small>
        </button>)}
        {items.length > 5 && <button className="sub showMoreMaterials" onClick={() => setShowAll((v) => !v)}>{showAll ? '閉じる' : `もっと見る（残り${items.length - 5}件）`}</button>}
      </div>
      <MaterialDetail item={active} q={q} />
    </div>

    <div className="links bigLinks irLinks minimal">
      <a href={`https://www.release.tdnet.info/inbs/I_main_00.html`} target="_blank" rel="noreferrer">TDnet本体</a>
    </div>
  </section>;
}


function DropReasonPanel({ report, loading, onInvestigate, q }) {
  if (!report) return <section className="dropPanel">
    <div className="dropHeader"><div><div className="smallTitle">急落理由クイック調査</div><h3>{q.code} {q.name}</h3></div><button className="sub smallBtn" onClick={onInvestigate} disabled={loading}>{loading ? '調査中…' : '調査する'}</button></div>
    <div className="empty">この銘柄の価格・出来高・BB・TDnet・ニュース見出しをまとめて、急落理由候補を表示します。</div>
  </section>;
  const d = report.diagnosis || {};
  const quote = report.quote || q;
  const irItems = report.ir?.items || [];
  const news = report.news || [];
  return <section className="dropPanel">
    <div className="dropHeader">
      <div><div className="smallTitle">急落理由クイック調査</div><h3>{report.code} {report.name}</h3><small>{report.fetchedAt ? new Date(report.fetchedAt).toLocaleString('ja-JP') : ''}</small></div>
      <button className="sub smallBtn" onClick={onInvestigate} disabled={loading}>{loading ? '再調査中…' : '再調査'}</button>
    </div>
    <div className={`dropSummary ${d.className || 'wait'}`}><b>{d.level || '確認'}</b><p>{d.summary}</p></div>
    <div className="summaryGrid">
      <Metric label="現在値" value={yen(quote.price)} sub={`前日比 ${pct(quote.changePct)}`} className={clsBy(quote.changePct)} />
      <Metric label="出来高倍率" value={fmt(quote.volumeRatio, '倍')} sub="20日平均比" />
      <Metric label="BB位置" value={quote.bbPos == null ? '—' : `${quote.bbPos}σ`} sub={`下限 ${yen(quote.bbLower)}`} />
      <Metric label="20日高値比" value={pct(quote.drawdown20)} sub={`押し目 ${yen(quote.oshimePrice)}`} />
    </div>
    <div className="researchBlock compact"><h4>推定理由</h4><ul>{[...(d.alerts || []), ...(d.reasons || [])].slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    <div className="researchBlock compact"><h4>確認ポイント</h4><ul>{(d.checks || []).slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    <div className="dropMaterials">
      <div><h4>TDnet候補</h4>{irItems.length ? irItems.slice(0, 5).map((it, i) => <a key={i} href={it.url} target="_blank" rel="noreferrer"><span>{it.kind}</span>{it.title}<small>{formatMaterialDate(it)}</small></a>) : <p>直近TDnetでは銘柄コード一致IRなし</p>}</div>
      <div><h4>ニュース候補</h4>{news.length ? news.slice(0, 5).map((it, i) => <a key={i} href={it.url} target="_blank" rel="noreferrer"><span className={it.className}>{it.tone}</span>{it.title}<small>{formatMaterialDate(it)} / {it.source}</small></a>) : <p>関連ニュース見出しは未検出</p>}</div>
    </div>
    <div className="links bigLinks irLinks minimal">
      <a href={report.links?.reason} target="_blank" rel="noreferrer">急落理由検索</a>
      <a href={report.links?.credit} target="_blank" rel="noreferrer">信用需給検索</a>
      <a href={report.links?.kabutan} target="_blank" rel="noreferrer">株探</a>
      <a href={report.links?.yahoo} target="_blank" rel="noreferrer">Yahoo</a>
    </div>
  </section>;
}

function LinksPanel({ links, q }) {
  return <div className="linksPanel">
    <p className="linkLead">売られている理由は価格だけでは分からないので、決算・信用需給をここから確認します。</p>
    <div className="links bigLinks">
      <a href={links.kabutan} target="_blank" rel="noreferrer">株探：決算</a>
      <a href={links.yahoo} target="_blank" rel="noreferrer">Yahoo：板・掲示板</a>
      <a href={links.minkabu} target="_blank" rel="noreferrer">みんかぶ：目標株価</a>
      <a href={links.tdnet} target="_blank" rel="noreferrer">TDnet：適時開示</a>
      <a href={`https://www.google.com/search?q=${encodeURIComponent(`${q.code} ${q.name} 信用倍率 買い残 売り残`)}`} target="_blank" rel="noreferrer">信用需給検索</a>
    </div>
  </div>;
}






function DistortionBreakdown({ q }) {
  const p = q.distortionParts || {};
  const v = q.volatilityContext || {};
  const items = [
    { key: 'dd', label: '下落幅', pts: Number(p.ddPoints || 0), sub: `20日高値比 ${pct(q.drawdown20)}` },
    { key: 'cp', label: '当日反応', pts: Number(p.cpPoints || 0), sub: `前日比 ${pct(q.changePct)}` },
    { key: 'z60', label: '60日乖離', pts: Number(p.zPoints || 0), sub: `z60 ${v.z60 ?? q.z60 ?? '—'}σ` },
    { key: 'z250', label: '1年乖離', pts: Number(p.z250Points || 0), sub: `z250 ${v.z250 ?? q.z250 ?? '—'}σ` },
    { key: 'dd52', label: '52週下落', pts: Number(p.drawdown52Points || 0), sub: `52週高値比 ${pct(v.drawdown52 ?? q.drawdown52)}` },
    { key: 'atr', label: 'ATR比', pts: Number(p.atrPoints || 0), sub: `ATR ${fmt(v.atrPct ?? q.atrPct, '%')}` },
    { key: 'duration', label: '持続性', pts: Number(p.durationPoints || 0), sub: `5日内下落 ${fmt(v.downDays5 ?? q.downDays5, '日')}` },
    { key: 'sector', label: 'セクター相対', pts: Number(p.sectorPoints || 0), sub: `平均との差 ${pct(v.sectorRelativeChange ?? q.sectorRelativeChange)}${q.sectorMedianSource === 'cached-universe' ? ' / 広域中央値' : ''}` },
  ];
  const maxPts = Math.max(0, ...items.map((x) => x.pts));
  const row = (it) => <div key={it.key} data-zero={it.pts <= 0 ? 'true' : 'false'} data-primary={it.pts > 0 && it.pts === maxPts ? 'true' : 'false'}>
    <b>{it.label}</b><strong>{it.pts > 0 ? `+${fmt(it.pts)}` : '—'}</strong><span>{it.sub}</span>
  </div>;
  return <div className="distortionBreakdown">
    <h4>歪みスコア内訳</h4>
    <div className="breakdownGrid">{items.map(row)}</div>
    <p className="tinyNote">強調表示は今回の歪みスコアの主因です。スコアは買い推奨ではなく、株価反応が通常より大きい可能性を見るための内訳です。</p>
  </div>;
}

function StatePanel({ q, companyNote, ir }) {
  const confidence = calcJudgementConfidence({ q, companyNote, ir });
  const danger = q.bottomDangerScore ?? q.trendDangerScore ?? q.dangerScore ?? q.materialSeverity;
  const dangerReason = (q.bottomDangerReasons || q.trendDangerReasons || q.riskReasons || q.stateConstraints || [])[0] || q.stateCaution || '危険要因は詳細材料で確認';
  return <section className="qualityPanel statePanel">
    <div className="qualityGrid">
      <div className={`qualityBox ${stateKindClass(q.stateKind || q.statePrimary)}`}><b>主判定</b><strong>{q.statePrimary || '—'}</strong><span>一覧では「主判定・理由・注意」の3点に畳み、詳細で補助タグを確認します。</span></div>
      <div className={`qualityBox ${trendClass(q.stateScore)}`}><b>観察価値</b><strong>{q.stateScore ?? '—'}点</strong><span>上昇・反発・歪みを横断した観察優先度</span></div>
      <div className={`qualityBox dangerBox ${dangerClass(danger)}`}><b>危険度</b><strong>{danger ?? '—'}点</strong><span>{dangerReason}</span></div>
      <div className={`qualityBox ${trendClass(q.distortionScore)}`}><b>歪み</b><strong>{q.distortionScore ?? '—'}点</strong><span>価格反応に対して中身が壊れていない可能性</span></div>
      <div className={`qualityBox ${(q.overshootScore || 0) >= 45 ? 'warn' : trendClass(q.overshootScore)}`}><b>売られすぎ</b><strong>{q.overshootScore ?? '—'}点</strong><span>{(q.overshootReasons || [])[0] || '自己正規化の過剰反応シグナル'}</span></div>
      <div className={`qualityBox distortionTypeBox ${refineDistortionType(q, ir, companyNote).type}`}><b>歪み分類</b><strong>{refineDistortionType(q, ir, companyNote).label}</strong><span>{refineDistortionType(q, ir, companyNote).action}</span></div>
      <div className={`qualityBox confidenceBox ${confidence.className}`}><b>判定信頼度</b><strong>{confidence.label}</strong><span>取得済: {confidence.reasons.join(' / ') || '少ない'}</span>{confidence.missing.length > 0 && <em>未取得: {confidence.missing.join(' / ')}</em>}</div>
      <div className={`qualityBox ${trendDangerClass(q.materialSeverity)}`}><b>材料の重さ</b><strong>{q.materialSeverity ?? '—'}点</strong><span>高いほど小ロット・撤退厳守</span></div>
    </div>
    <DistortionBreakdown q={q} />
    <div className="decisionSummary">
      <div><b>理由</b><strong>{q.stateReason || '—'}</strong></div>
      <div><b>注意</b><strong>{q.stateCaution || '—'}</strong></div>
    </div>
    <div className="tagSections">
      <div><h4>補助タグ</h4><TagList items={q.stateTags} /></div>
      <div><h4>狙い方</h4><TagList items={q.stateActions} /></div>
      <div><h4>制約</h4><TagList items={q.stateConstraints} muted /></div>
    </div>
    {(q.stateReasons || []).length > 0 && <div className="reasonBox"><h4>判定理由</h4>{q.stateReasons.map((r) => <p key={r}>{r}</p>)}</div>}
    <div className="metricGrid">
      <Metric label="下げきり/試し玉" value={`${q.bottomScore ?? '—'}点`} sub={q.bottomJudge || '—'} />
      <Metric label="戻り" value={`${q.reboundScore ?? '—'}点`} sub={(q.reboundReasons || [])[0] || '—'} />
      <Metric label="下値" value={q.lowerBaseLabel || '—'} sub={`${q.lowerBaseScore ?? '—'}点`} />
      <Metric label="順張り" value={`${q.trendScore ?? '—'}点`} sub={q.trendType || '—'} />
      <Metric label="価格行動型" value={q.priceMode || '—'} sub={(q.priceModeReasons || [])[0] || '過去60日から判定'} />
      <Metric label="守備/推力" value={`${q.enduranceScore ?? '—'} / ${q.thrustScore ?? '—'}`} sub="持続型とテーマ推力型を分離" />
      <Metric label="短期RR" value={rrText(q.bottomRR)} sub={`撤退 ${yen(q.bottomStop)}`} className={rrClass(q.bottomRR)} />
      <Metric label="期待値調整" value={`${q.expectationGapScore ?? '—'}点`} sub="高PER成長株の過剰反応確認" />
      <Metric label="売られすぎ度" value={`${q.overshootScore ?? '—'}点`} sub={(q.overshootReasons || [])[0] || 'Z/BB/ATR/20日DD'} />
    </div>
  </section>;
}

function BottomPanel({ q }) {
  const reasons = q.bottomReasons || [];
  const rebounds = q.reboundReasons || [];
  const slow = q.slowRiseReasons || [];
  const risks = q.bottomDangerReasons || [];
  return <section className="qualityPanel trendPanel">
    <div className="qualityHero">
      <div className={`qualityBox ${bottomJudgeClass(q.bottomJudge)}`}><b>下げきり判定</b><strong>{q.bottomJudge || '—'}</strong><span>買い推奨ではなく、試し玉・反発確認・撤退条件の整理です。</span></div>
      <div className={`qualityBox ${trendClass(q.bottomScore)}`}><b>下げきり</b><strong>{q.bottomScore ?? '—'}点</strong><span>売られ切り度とBB位置</span></div>
      <div className={`qualityBox ${trendClass(q.reboundScore)}`}><b>戻りの強さ</b><strong>{q.reboundScore ?? '—'}点</strong><span>陽転・短期線回復・出来高</span></div>
      <div className={`qualityBox ${trendClass(q.lowerBaseScore)}`}><b>下値</b><strong>{q.lowerBaseLabel || '—'}</strong><span>{q.lowerBaseScore ?? '—'}点</span></div>
      <div className="qualityBox neutral"><b>形状</b><strong>{q.bottomShapeType || '—'}</strong><span>{q.bottomShapeLabel || 'チャート形状と材料を分けて確認'}</span></div>
    </div>
    <div className="summaryGrid">
      <Metric label="試し玉目安" value={yen(q.bottomEntryPrice || q.price)} sub="現在値基準。小ロット前提" strong />
      <Metric label="短期RR" value={rrText(q.bottomRR)} sub={`目標 ${yen(q.bottomTarget)} / 撤退 ${yen(q.bottomStop)}`} strong className={rrClass(q.bottomRR)} />
      <Metric label="制約/危険" value={`${q.bottomDangerScore ?? '—'}点`} sub="投げ売り・安値更新・材料確認" className={trendDangerClass(q.bottomDangerScore)} />
      <Metric label="緩やか上昇" value={`${q.slowRiseScore ?? '—'}点`} sub="下値切り上げ・浅押し待ち" />
    </div>
    <div className="deepGrid two">
      <div className="deepCard good"><b>下げきり候補の理由</b><ul>{reasons.length ? reasons.map((x) => <li key={x}>{x}</li>) : <li>下げきり材料は限定的</li>}</ul></div>
      <div className="deepCard"><b>戻りの強さ</b><ul>{rebounds.length ? rebounds.map((x) => <li key={x}>{x}</li>) : <li>戻りの強さはまだ確認不足</li>}</ul></div>
      <div className="deepCard accent"><b>緩やか上昇・浅押し待ち</b><ul>{slow.length ? slow.map((x) => <li key={x}>{x}</li>) : <li>緩やか上昇シグナルは限定的</li>}</ul></div>
      <div className="deepCard danger"><b>触る時の危険</b><ul>{risks.length ? risks.map((x) => <li key={x}>{x}</li>) : <li>目立つ危険シグナルは限定的</li>}</ul></div>
    </div>
    <div className="deepCard accent"><b>使い方</b><p>このモードは「安全な買い」を探すものではなく、下げきった可能性のある銘柄を小さく試し、戻りの強さと下値切り上げで残すか切るかを判断するための補助です。高リスクでもRRや形状が良ければ「材料確認監視」「反発確認待ち」として残します。前日安値・直近安値割れを撤退条件にしてください。</p></div>
  </section>;
}

function TrendPanel({ q }) {
  const reasons = q.trendReasons || [];
  const risks = q.trendDangerReasons || [];
  return <section className="qualityPanel trendPanel">
    <div className="qualityHero">
      <div className={`qualityBox ${trendJudgeClass(q.trendJudge)}`}><b>順張り判定</b><strong>{q.trendJudge || '—'}</strong><span>{q.trendType || '—'}</span></div>
      <div className={`qualityBox ${trendClass(q.trendScore)}`}><b>上昇の強さ</b><strong>{q.trendScore ?? '—'}点</strong><span>移動平均・高値圏・出来高で判定</span></div>
      <div className={`qualityBox ${trendClass(q.trendSafetyScore)}`}><b>安全度</b><strong>{q.trendSafetyScore ?? '—'}点</strong><span>強さから過熱/危険を差し引き</span></div>
      <div className={`qualityBox ${trendDangerClass(q.trendDangerScore)}`}><b>危険度</b><strong>{q.trendDangerScore ?? '—'}点</strong><span>過熱・急騰後・線割れを警戒</span></div>
    </div>
    <div className="summaryGrid">
      <Metric label="狙い目押し" value={yen(q.trendEntryPrice)} sub={q.trendEntryLabel || '—'} strong />
      <Metric label="順張りRR" value={rrText(q.trendRR)} sub={`目標 ${yen(q.trendTarget)} / 撤退 ${yen(q.trendStop)}`} strong className={rrClass(q.trendRR)} />
      <Metric label="5日線" value={yen(q.ma5)} sub={`傾き ${pct(q.ma5Slope)}`} />
      <Metric label="20日線" value={yen(q.ma20)} sub={`傾き ${pct(q.ma20Slope)}`} />
      <Metric label="守備型" value={`${q.enduranceScore ?? '—'}点`} sub="振れ幅小・線維持・過熱小" />
      <Metric label="推力型" value={`${q.thrustScore ?? '—'}点`} sub="高値圏・出来高・ブレイク" />
    </div>
    <div className="deepGrid two">
      <div className="deepCard good"><b>上昇が強い理由</b><ul>{reasons.length ? reasons.map((x) => <li key={x}>{x}</li>) : <li>明確な上昇理由は限定的</li>}</ul></div>
      <div className="deepCard danger"><b>順張りの危険理由</b><ul>{risks.length ? risks.map((x) => <li key={x}>{x}</li>) : <li>過熱・危険シグナルは限定的</li>}</ul></div>
    </div>
    <div className="deepCard accent"><b>使い方</b><p>順張りは「強い銘柄を追う」のではなく、強さが残ったまま5日線・20日線・BB中心へ浅く押したところを狙います。危険度が高い場合は、高値掴みや急騰後の反落に注意してください。</p></div>
  </section>;
}

function QualityPanel({ q, ir, dropReport, research }) {
  const company = null;
  const quality = buildQuality(q, company);
  const irItems = ir?.items || [];
  const badIr = irItems.filter((x) => /下方|減配|減損|特別損失|赤字|不正|不適切|ワラント|増資|CB|新株|希薄化|延期|中止/.test(x.title || '')).slice(0, 4);
  const goodIr = irItems.filter((x) => /上方|増配|自社株|受注|提携|業務提携|資本提携|取得|承認|月次/.test(x.title || '')).slice(0, 4);
  return <section className="qualityPanel">
    <div className="qualityHero">
      <div className={`qualityBox ${quality?.finalClass}`}><b>総合</b><strong>{quality?.finalJudge || '—'}</strong><span>押し目スコアだけでなく、危険度・材料・下落型で切り分けます。</span></div>
      <div className="qualityBox"><b>押し目</b><strong>{q.score ?? '—'}点</strong><span>{scoreLabel(q.score)}</span></div>
      <div className={`qualityBox ${quality?.dangerClass}`}><b>危険度</b><strong>{quality?.dangerLabel || '—'}</strong><span>{quality?.dangerScore ?? '—'}点</span></div>
      <div className="qualityBox"><b>下落型</b><strong>{quality?.dropType || '—'}</strong><span>{quality?.materialLabel || '材料未確認'}</span></div>
    </div>
    <div className="deepGrid three">
      <div className="deepCard"><b>拾える下落の条件</b><ul><li>明確な悪材料IRがない</li><li>5分足で下げ止まり・陽線反転</li><li>出来高急増後に売り圧が弱まる</li><li>予測RRが1.5〜2倍以上</li></ul></div>
      <div className="deepCard risk"><b>避ける下落の条件</b><ul><li>下方修正・赤字・希薄化・不正</li><li>出来高急増を伴う陰線継続</li><li>BB下限割れから戻せない</li><li>会社調査で成長鈍化/構造悪化</li></ul></div>
      <div className="deepCard accent"><b>信用需給</b><p>{quality?.supplyLabel || '未取得'}。現状は外部検索で確認してください。信用倍率、買い残増減、回転日数が重い場合は反発が鈍くなります。</p></div>
    </div>
    <div className="researchBlock">
      <h4>危険理由・確認理由</h4>
      <ul>{(quality?.reasons || ['明確な危険理由は限定的']).map((x) => <li key={x}>{x}</li>)}</ul>
      {research?.main && <p className="muted">テクニカル補足：{research.main}</p>}
    </div>
    <div className="deepGrid two">
      <div className="deepCard accent"><b>好材料IR候補</b>{goodIr.length ? <ul>{goodIr.map((x) => <li key={x.title}>{x.title}</li>)}</ul> : <p className="muted">直近IRでは強い好材料候補は限定的</p>}</div>
      <div className="deepCard risk"><b>悪材料IR候補</b>{badIr.length ? <ul>{badIr.map((x) => <li key={x.title}>{x.title}</li>)}</ul> : <p className="muted">直近IRでは強い悪材料候補は限定的</p>}</div>
    </div>
    {dropReport?.diagnosis?.summary && <div className="researchBlock"><h4>急落理由メモ</h4><p>{dropReport.diagnosis.summary}</p></div>}
  </section>;
}

function AutoResearch({ research, q }) {
  return <section className="autoResearch">
    <div className="researchHeader">
      <div>
        <div className="smallTitle">自動リサーチ結果</div>
        <h3>{research.name}</h3>
      </div>
      <span className={`stance ${research.stanceClass}`}>{research.stance}</span>
    </div>
    <p className="researchMain">{research.main}</p>

    <div className="subGrid">
      <div className="miniCard"><b>押し目判定</b><span>{q.oshimeLabel || '—'}</span></div>
      <div className="miniCard"><b>買い候補</b><span>{yen(q.oshimePrice)}</span></div>
      <div className="miniCard"><b>上値候補</b><span>{yen(q.rrTarget)}</span></div>
      <div className="miniCard"><b>撤退候補</b><span>{yen(q.rrStop)}</span></div>
    </div>

    <div className="researchBlock">
      <h4>押し目ゾーン</h4>
      <div className="zoneList">{research.zones.map((z) => <div className="zone" key={z.label}><b>{z.label}</b><span>{yen(z.price)}</span><em>{z.note}</em></div>)}</div>
    </div>

    <div className="researchBlock">
      <h4>確認ポイント</h4>
      <ul>{research.checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>

    <div className="researchBlock">
      <h4>検出理由</h4>
      <div className="chips">{research.reasons.length ? research.reasons.map((r) => <span key={r}>{r}</span>) : <span>特になし</span>}</div>
    </div>
  </section>;
}

function Metric({ label, value, sub, strong, className = '' }) {
  return <div className={`metric ${strong ? 'strong' : ''} ${className}`}><div>{label}</div><b>{value}</b><span>{sub}</span></div>;
}

createRoot(document.getElementById('root')).render(<App />);
