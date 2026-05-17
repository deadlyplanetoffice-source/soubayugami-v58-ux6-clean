import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const PORT = process.env.PORT || 8787;
const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173') {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.json({ limit: '2mb' }));

class SimpleLRU {
  constructor(max = 500, ttl = 60_000) { this.max = max; this.ttl = ttl; this.map = new Map(); }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttl) { this.map.delete(key); return null; }
    this.map.delete(key); this.map.set(key, hit);
    return hit.value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { at: Date.now(), value });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  stats() { return { size: this.map.size, max: this.max, ttl: this.ttl }; }
}

const quoteCacheV11 = new SimpleLRU(600, 4_000);       // 5秒更新時の重複取得を抑制
const fundamentalCache = new SimpleLRU(800, 30 * 60_000); // ファンダは30分キャッシュ
const jsonCache = new SimpleLRU(1200, 10_000);
const jpxMasterCache = new SimpleLRU(2, 6 * 60 * 60 * 1000); // JPX上場銘柄マスターは6時間キャッシュ
const sectorMedianCache = new SimpleLRU(160, 30 * 60_000); // 広域スキャンで得たセクター中央値を監視リストでも再利用

function humanMarketCap(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_0000_0000_0000) return `${Math.round(n / 1_0000_0000_0000 * 10) / 10}兆円`;
  if (n >= 1_0000_0000) return `${Math.round(n / 1_0000_0000)}億円`;
  return `${Math.round(n / 100_0000)}百万円`;
}
function ratioLabel(value, kind) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '未取得';
  if (kind === 'per') {
    if (n < 10) return '低め';
    if (n < 20) return '普通';
    if (n < 35) return '高め';
    return 'かなり高い';
  }
  if (kind === 'pbr') {
    if (n < 1) return '1倍割れ';
    if (n < 2) return '普通';
    if (n < 5) return '高め';
    return 'かなり高い';
  }
  if (kind === 'yield') {
    if (n >= 4) return '高配当';
    if (n >= 2) return '配当あり';
    if (n > 0) return '低配当';
    return '無配/未取得';
  }
  return '参考値';
}
async function fetchJsonSmart(url, timeoutMs = 8000, retries = 1, cacheTtl = 0) {
  const cached = cacheTtl ? jsonCache.get(url) : null;
  if (cached) return cached;
  let lastErr;
  for (let i=0; i<=retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 oshime-dashboard', 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.4' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (cacheTtl) jsonCache.set(url, data);
      return data;
    } catch(e) {
      lastErr=e;
      if (i<retries) await new Promise(r=>setTimeout(r, 400 * (i+1)));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}

async function fetchBufferSmart(url, timeoutMs = 12000, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 oshime-dashboard',
          'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.4'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}


const LOCAL_SYMBOLS = [
  { code: '1332', name: 'ニッスイ', sector: '水産/食品' },
  { code: '1605', name: 'INPEX', sector: '資源' },
  { code: '1802', name: '大林組', sector: '建設' },
  { code: '1925', name: '大和ハウス工業', sector: '住宅' },
  { code: '218A', name: 'リベラウェア', sector: 'ドローン' },
  { code: '2413', name: 'エムスリー', sector: '医療DX/製薬支援' },
  { code: '2801', name: 'キッコーマン', sector: '食品' },
  { code: '290A', name: 'シンスペクティブ', sector: '宇宙/SAR' },
  { code: '2914', name: '日本たばこ産業', sector: '食品/たばこ' },
  { code: '3382', name: 'セブン＆アイ・ホールディングス', sector: '小売' },
  { code: '3541', name: '農業総合研究所', sector: '農業DX' },
  { code: '3687', name: 'フィックスターズ', sector: 'AI/量子' },
  { code: '4063', name: '信越化学工業', sector: '化学/半導体材料' },
  { code: '4502', name: '武田薬品工業', sector: '医薬品' },
  { code: '4568', name: '第一三共', sector: '医薬品' },
  { code: '4755', name: '楽天グループ', sector: 'ネット/金融' },
  { code: '5020', name: 'ENEOSホールディングス', sector: '石油' },
  { code: '5074', name: 'テスホールディングス', sector: '再エネ/インフラ' },
  { code: '464A', name: 'QPSホールディングス', sector: '宇宙/SAR' },
  { code: '5401', name: '日本製鉄', sector: '鉄鋼' },
  { code: '5803', name: 'フジクラ', sector: '電線/データセンター' },
  { code: '6301', name: 'コマツ', sector: '機械' },
  { code: '6501', name: '日立製作所', sector: '総合電機' },
  { code: '6703', name: '沖電気工業', sector: '防衛/通信' },
  { code: '6758', name: 'ソニーグループ', sector: '電機/エンタメ' },
  { code: '6857', name: 'アドバンテスト', sector: '半導体製造装置' },
  { code: '6920', name: 'レーザーテック', sector: '半導体製造装置' },
  { code: '7011', name: '三菱重工業', sector: '防衛/重工' },
  { code: '7203', name: 'トヨタ自動車', sector: '自動車' },
  { code: '7267', name: 'ホンダ', sector: '自動車' },
  { code: '7751', name: 'キヤノン', sector: '精密機器' },
  { code: '7974', name: '任天堂', sector: 'ゲーム' },
  { code: '8001', name: '伊藤忠商事', sector: '商社' },
  { code: '8031', name: '三井物産', sector: '商社' },
  { code: '8035', name: '東京エレクトロン', sector: '半導体製造装置' },
  { code: '8058', name: '三菱商事', sector: '商社' },
  { code: '8306', name: '三菱UFJフィナンシャル・グループ', sector: '銀行' },
  { code: '8316', name: '三井住友フィナンシャルグループ', sector: '銀行' },
  { code: '8411', name: 'みずほフィナンシャルグループ', sector: '銀行' },
  { code: '8591', name: 'オリックス', sector: '金融' },
  { code: '8766', name: '東京海上ホールディングス', sector: '保険' },
  { code: '9432', name: 'NTT', sector: '通信' },
  { code: '9433', name: 'KDDI', sector: '通信' },
  { code: '9434', name: 'ソフトバンク', sector: '通信' },
  { code: '9348', name: 'アイスペース', sector: '宇宙' },
  { code: '9983', name: 'ファーストリテイリング', sector: '小売' },
  { code: '9984', name: 'ソフトバンクグループ', sector: '投資/AI' }
];


const COMPANY_PROFILES = {

  '1429': {
    profile: '建築断熱用の硬質ウレタンフォームを開発・製造・販売・施工する断熱材・省エネ建材企業。主力は住宅・非住宅向けの吹付断熱材で、断熱材を売るだけでなく施工まで担う点が特徴。',
    segments: '主な稼ぎ方は、新築住宅・非住宅建築向けの吹付断熱材・省エネ関連部材の販売施工。住宅省エネ基準、断熱性能向上、電気代上昇、建築物の高断熱化が需要面の追い風。',
    businessHints: ['断熱・省エネ建材テーマ。住宅/非住宅の着工、断熱基準強化、価格転嫁が評価材料。', '原料はウレタン系のため、ナフサ・為替・原料価格・物流費が利益率に効きやすい。', '決算では売上だけでなく、粗利率、施工能力、上期/通期進捗、原料単価、住宅着工を確認する。'],
    watchPoints: ['上期進捗率', '通期予想の据え置き/修正', '原料単価', '価格転嫁', '住宅/非住宅着工', '粗利率', '施工体制'],
    freshThemes: ['省エネ住宅・断熱基準強化', '電気代上昇による断熱需要', '非住宅建築の断熱化', '価格転嫁'],
    riskPoints: ['ナフサ/原料高', '円安', '住宅着工減', '価格転嫁遅れ', '施工人員/外注費', '通期据え置きによる出尽くし'],
    oshimeUse: '進捗率が高く事業テーマが崩れていない下落なら歪み候補。ただし原料高・住宅着工悪化・通期据え置き出尽くしで売られている場合は反発確認を優先。',
    source: '内蔵会社DB+断熱材テーマ観点'
  },

  '5074': {
    profile: '再生可能エネルギー・省エネ関連のエンジニアリング、発電事業、電力小売・需給管理などを手がけるエネルギーソリューション企業。太陽光、バイオマス、省エネ設備、電力販売などが論点になりやすい。',
    segments: '主な稼ぎ方は、再エネ・省エネ設備の設計/施工/保守、発電所の開発・運営、電力販売・需給管理など。案件の進捗、売電単価、燃料費、金利、補助金/制度変更が利益に影響する。',
    businessHints: ['案件型ビジネスなので、売上計上時期と受注/在庫案件の進捗を見る。', '再エネ・省エネテーマは追い風だが、金利上昇や燃料費、制度変更で利益がぶれやすい。', '決算では売上よりも、営業利益率、発電事業の稼働、電力調達コスト、通期進捗を確認する。'],
    watchPoints: ['受注/案件進捗', '発電所稼働', '電力調達コスト', '燃料費', '金利', '通期進捗', '制度変更'],
    freshThemes: ['再生可能エネルギー', '省エネ投資', '脱炭素', '発電所運営', '電力需給管理'],
    riskPoints: ['金利上昇', '燃料費/電力調達コスト', '案件遅延', '制度変更', 'FIT/FIP単価', '資金調達負担'],
    oshimeUse: '単なる地合い・再エネテーマ売りなら歪み候補になり得るが、案件遅延・利益率悪化・資金調達負担が理由なら反発確認を優先。',
    source: '内蔵会社DB'
  },
  '2413': {
    profile: '医師向け情報サイト「m3.com」を基盤に、製薬会社向けマーケティング支援、治験支援、医療人材、病院・医療機関向けDXなどを展開する医療インターネット企業。',
    segments: '主な稼ぎ方は、医師会員基盤を活用した製薬会社向け営業・マーケティング支援、治験・臨床開発支援、医療人材紹介、医療機関向けサービス。成長率と市場期待の差で株価が大きく動きやすい。',
    businessHints: [
      '医師会員基盤と製薬会社向け支援が収益の核。製薬マーケティング、治験、医療人材の成長鈍化に注意。',
      '高成長株として評価されやすいため、増益でも会社計画・市場予想未達なら売られやすい。',
      '押し目判断では、決算説明資料で成長率、受注、製薬向け需要、利益率、海外・新規事業の寄与を確認する。'
    ],
    watchPoints: ['今期計画と市場コンセンサスの差', '製薬会社向け支援の成長率', '治験・人材・海外事業の伸び', '自社株買いなど還元策の有無'],
    source: '内蔵会社DB'
  },
  '3687': {
    profile: 'ソフトウェア高速化技術を強みに、マルチコア/GPU向け高速化、組込みソフト、量子コンピューティング関連ソフトウェアなどを手掛ける技術系企業。',
    segments: '主な稼ぎ方は、顧客システムや研究開発向けの高速化・最適化支援、ソフトウェア開発、AI・量子関連の技術サービス。テーマ性が強く、受注・研究開発・AI投資の見方で動きやすい。',
    businessHints: ['AI・半導体・量子テーマの資金流入に反応しやすい。', '決算では売上成長、営業利益率、受注・人員増、量子関連の実需を確認。'],
    watchPoints: ['AI/量子関連の実需', '利益率', '受注・人員増', 'テーマ相場の継続性'],
    source: '内蔵会社DB'
  },
  '290A': {
    profile: '小型SAR衛星を開発・運用し、衛星データ販売や解析サービスを提供する宇宙・地球観測関連企業。',
    segments: '収益化の中心は衛星データ、解析サービス、政府・防衛・民間向け契約。赤字・資金調達・打ち上げ進捗で株価が大きく動きやすい。',
    businessHints: ['打ち上げ成功、受注、政府需要、防衛需要が材料。', '一方で赤字継続、資金調達、希薄化、打ち上げ遅延には注意。'],
    watchPoints: ['打ち上げ計画', '受注残', '資金調達', '赤字幅', '政府・防衛契約'],
    source: '内蔵会社DB'
  },
  '9348': {
    profile: '月面輸送・月面探査サービスを目指す宇宙ベンチャー。ミッション進捗、資金調達、提携、打ち上げスケジュールが主要材料。',
    segments: '短期的にはミッション関連収入や提携・開発案件が中心。赤字と資金調達リスクが大きく、材料株として値動きが荒くなりやすい。',
    businessHints: ['ミッション成功/失敗で大きく動く。', '資金調達と希薄化リスクを必ず確認。'],
    watchPoints: ['ミッション進捗', '資金繰り', '希薄化', '提携', '受注'],
    source: '内蔵会社DB'
  },
  '1332': {
    profile: '水産、食品、ファインケミカルなどを展開する水産食品大手。養殖、加工食品、海外事業、機能性素材が注目点。',
    segments: '水産・食品を中心に、原材料価格、為替、養殖事業、値上げ浸透、海外需要が収益に影響する。',
    businessHints: ['原材料価格と値上げ浸透を確認。', '養殖・高付加価値食品の成長性を見る。'],
    watchPoints: ['養殖事業', '原材料価格', '値上げ', '海外需要', '利益率'],
    source: '内蔵会社DB'
  },
  '2801': {
    profile: 'しょうゆを中心に、調味料、食品、酒類、海外食品事業を展開する食品大手。海外成長と価格改定が重要。',
    segments: '国内外の調味料・食品が中心。海外売上、原材料費、為替、値上げ、ブランド力が利益を左右する。',
    businessHints: ['海外成長と値上げ浸透を確認。', '円高/円安、原材料費が利益率に影響。'],
    watchPoints: ['海外売上', '原材料費', '値上げ', '利益率', '為替'],
    source: '内蔵会社DB'
  },
  '5401': {
    profile: '国内最大級の鉄鋼メーカー。鋼材市況、原料価格、国内外需要、為替、配当政策が株価材料。',
    segments: '鉄鋼を中心に、製鉄、エンジニアリング、素材関連を展開。市況株のため、業績見通しと配当姿勢が重要。',
    businessHints: ['市況・中国需要・原料価格を確認。', '高配当・還元期待で下支えされる一方、景気敏感株。'],
    watchPoints: ['鋼材市況', '原料価格', '配当', '中国需要', '為替'],
    source: '内蔵会社DB'
  },
  '9432': {
    profile: '国内通信インフラ最大手。固定・移動通信、データセンター、法人DX、グローバル事業を展開。',
    segments: '通信収入、法人向けICT、データセンター、設備投資、株主還元が主な確認点。成長株というより安定・還元株として見られやすい。',
    businessHints: ['料金政策、設備投資、データセンター投資、還元策を確認。'],
    watchPoints: ['配当', '自社株買い', '通信料金', '設備投資', 'データセンター'],
    source: '内蔵会社DB'
  }
};



Object.assign(COMPANY_PROFILES, {
  '7532': {
    profile: '「ドン・キホーテ」「MEGAドン・キホーテ」「アピタ」「ピアゴ」などを展開する総合ディスカウント小売グループ。食品・日用品・家電・衣料・雑貨・化粧品などを幅広く扱い、深夜営業・圧縮陳列・低価格・インバウンド需要への対応が特徴。',
    segments: '主な稼ぎ方は国内ディスカウントストア、総合スーパー/ユニー系店舗、海外店舗、PB/高粗利商品の販売。売上成長だけでなく、既存店売上、客数、客単価、粗利率、在庫回転、店舗改装、海外展開を確認する。',
    businessHints: ['ドンキ業態は値上げ局面でも低価格訴求で集客しやすい。既存店売上と粗利率の両立が重要。', 'インバウンド・免税売上、食品・日用品の生活防衛需要、PB/高粗利商品の伸びが評価材料。', 'ユニー系店舗の改装効果、海外店舗の採算、在庫増減、販管費増を確認する。'],
    watchPoints: ['既存店売上', '客数/客単価', '粗利率', '免税/インバウンド', 'ユニー改装効果', '海外店舗', '在庫水準', '販管費'],
    freshThemes: ['インバウンド/免税需要', '生活防衛型消費', 'PB・高粗利商品の拡大', 'ユニー店舗の業態転換/改装', '海外ドンキ展開'],
    riskPoints: ['消費鈍化', '円高によるインバウンド鈍化', '人件費/物流費増', '在庫増', '粗利率悪化', '海外店舗の採算悪化'],
    oshimeUse: '短期急落時は、既存店売上や月次が崩れたのか、単なる小売セクター売りかを分ける。既存店・粗利・免税が維持されている下落なら押し目候補。月次悪化、在庫増、粗利率低下が重なるなら反発確認待ち。',
    source: '内蔵会社DB'
  },
  '7453': {
    profile: '「無印良品」を国内外で展開する専門小売企業。衣服・生活雑貨・食品・家具などを扱い、ブランド力と店舗/EC運営が収益の核。',
    segments: '国内無印、海外無印、EC、商品開発が柱。既存店売上、粗利率、中国・アジア事業、在庫、値下げ率を確認する。',
    businessHints: ['国内回復と海外成長、特に中国・アジアの採算が評価材料。', '在庫過多や値下げ率上昇は利益率悪化要因。'],
    watchPoints: ['既存店売上', '粗利率', '中国事業', '在庫', '値下げ率', 'EC比率'],
    freshThemes: ['生活雑貨需要', '海外再成長', '商品力改善', '店舗改装'],
    riskPoints: ['中国消費低迷', '在庫増', '粗利率悪化', '円安コスト'],
    oshimeUse: '月次・粗利・在庫が崩れていない下落なら押し目候補。中国/在庫悪化なら慎重。',
    source: '内蔵会社DB'
  },
  '8267': {
    profile: '総合スーパー、食品スーパー、ドラッグ、金融、ディベロッパー事業を持つ大手小売グループ。',
    segments: 'GMS、SM、ヘルス&ウェルネス、金融、モールなどが柱。構造改革、食品スーパー、金融、モール稼働を確認する。',
    businessHints: ['生活必需品需要と値上げ対応は追い風。', 'GMS改革の進捗と人件費・物流費が焦点。'],
    watchPoints: ['GMS利益', '食品スーパー', '金融事業', 'モール稼働', '人件費/物流費'],
    freshThemes: ['構造改革', '食品スーパー再編', '金融/カード', 'モール収益'],
    riskPoints: ['GMS不振', 'コスト増', '消費鈍化', '競争激化'],
    oshimeUse: '小売全体の調整なら押し目候補。GMS赤字拡大や改革遅れなら様子見。',
    source: '内蔵会社DB'
  },
  '9843': {
    profile: '家具・インテリア小売最大手級。家具、ホームファッション、EC、物流網を強みに展開。',
    segments: '国内店舗、EC、物流、海外が柱。為替、原材料、物流費、既存店売上、粗利率を確認する。',
    businessHints: ['円高は輸入コスト面で追い風になりやすい。', '住宅需要・消費マインド・値下げ施策が売上に影響。'],
    watchPoints: ['既存店売上', '粗利率', '為替', '物流費', '海外展開'],
    freshThemes: ['円高メリット', 'EC/物流効率化', '海外展開', 'ホームファッション'],
    riskPoints: ['円安', '住宅需要鈍化', '値下げによる粗利悪化', '人件費増'],
    oshimeUse: '為替と既存店の方向を確認。円高・粗利改善局面の下落なら拾いやすい。',
    source: '内蔵会社DB'
  },
  '3099': {
    profile: '三越伊勢丹を中心とする百貨店大手。高額品、外商、インバウンド、都市大型店が収益の核。',
    segments: '百貨店、クレジット/金融、不動産、海外など。免税売上、高額品、外商、粗利率、店舗改装を確認する。',
    businessHints: ['インバウンドと富裕層消費が追い風。', '円高や訪日客減速、高額品鈍化に注意。'],
    watchPoints: ['免税売上', '高額品', '外商', '既存店売上', '粗利率'],
    freshThemes: ['インバウンド', '富裕層消費', '都市大型店再評価', '還元策'],
    riskPoints: ['円高/訪日鈍化', '高額品不振', '消費鈍化', '人件費増'],
    oshimeUse: '免税・高額品が維持されている下落なら押し目候補。月次悪化なら反発確認待ち。',
    source: '内蔵会社DB'
  },
  '3086': {
    profile: '大丸・松坂屋、パルコ、不動産などを展開する百貨店/商業施設グループ。',
    segments: '百貨店、SC、デベロッパー、決済/カードが柱。インバウンド、都市店舗、パルコ、再開発を確認する。',
    businessHints: ['百貨店と不動産/SCの複合評価。', '免税・高額品と都市再開発が材料。'],
    watchPoints: ['免税売上', '百貨店月次', 'パルコ', '不動産', '還元策'],
    freshThemes: ['インバウンド', '都市再開発', '高額品', 'SC回復'],
    riskPoints: ['消費鈍化', '訪日客鈍化', '高額品不振', 'コスト増'],
    oshimeUse: '月次と免税が強い中での地合い売りなら押し目候補。',
    source: '内蔵会社DB'
  },
  '3092': {
    profile: 'ファッションEC「ZOZOTOWN」運営。ECモール、広告、決済、計測技術などを展開。',
    segments: '商品取扱高、手数料、広告、PayPay/LINEヤフー連携、ブランド出店が収益の核。',
    businessHints: ['取扱高成長率と広告収益を確認。', 'ファッション消費、競合EC、販促費が影響。'],
    watchPoints: ['取扱高', '手数料率', '広告収益', '会員数', '販促費'],
    freshThemes: ['ファッションEC', '広告収益', '計測/サイズ技術', 'グループ連携'],
    riskPoints: ['EC成長鈍化', '競争激化', '販促費増', '手数料率低下'],
    oshimeUse: '取扱高や広告が維持されていれば押し目候補。成長鈍化ならPER調整に注意。',
    source: '内蔵会社DB'
  }
});

Object.assign(COMPANY_PROFILES, {
  '1332': {
    profile: '水産・食品大手。漁業・養殖・水産加工・家庭用/業務用食品・ファインケミカルを展開。単なる魚の卸ではなく、資源調達から養殖、加工、販売まで持つ水産バリューチェーン企業。',
    segments: '主な稼ぎ方は水産事業、食品事業、ファインケミカル。水産は市況・漁獲・養殖成績、食品は値上げと商品力、ファインは医薬品原料・EPA等の需要を見る。',
    businessHints: ['養殖はブリ・サーモン等の種苗生産機能、養殖効率、海外/国内の生産拡大が重要。', '中計では水産・食品・ファインのポートフォリオ強化が焦点。養殖とファインが評価されると単なる市況株から見直されやすい。', '北米加工や南米漁業など苦戦事業の改善が進むかも確認。'],
    watchPoints: ['養殖の生産規模・収益性', '原材料/飼料価格', 'サーモン・ブリ市況', '食品の値上げ浸透', 'ファインケミカルの再成長'],
    freshThemes: ['養殖高度化：国内外でサケ・マス、ブリ、カンパチ、マグロ、ギンザケ、バナメイエビ等を展開', '中計GOOD FOODS Recipe2：養殖事業高度化、海外展開、ファインケミカル再成長', '養殖環境モニタリングや種苗生産強化など、技術・データ活用で安定生産を狙う'],
    riskPoints: ['魚病・海水温・飼料価格など養殖コスト', 'サーモンなど市況悪化', '北米加工・南米漁業の改善遅れ', '円高/原材料価格/物流費'],
    oshimeUse: '養殖やファインの成長ストーリーが崩れていない下落なら押し目候補。逆に魚病・市況悪化・加工事業悪化が続く下落なら、テクニカル100点でも反発確認待ち。',
    source: '内蔵会社DB+公開IR確認観点'
  },

  '5074': {
    profile: '再生可能エネルギー・省エネ関連のエンジニアリング、発電事業、電力小売・需給管理などを手がけるエネルギーソリューション企業。太陽光、バイオマス、省エネ設備、電力販売などが論点になりやすい。',
    segments: '主な稼ぎ方は、再エネ・省エネ設備の設計/施工/保守、発電所の開発・運営、電力販売・需給管理など。案件の進捗、売電単価、燃料費、金利、補助金/制度変更が利益に影響する。',
    businessHints: ['案件型ビジネスなので、売上計上時期と受注/在庫案件の進捗を見る。', '再エネ・省エネテーマは追い風だが、金利上昇や燃料費、制度変更で利益がぶれやすい。', '決算では売上よりも、営業利益率、発電事業の稼働、電力調達コスト、通期進捗を確認する。'],
    watchPoints: ['受注/案件進捗', '発電所稼働', '電力調達コスト', '燃料費', '金利', '通期進捗', '制度変更'],
    freshThemes: ['再生可能エネルギー', '省エネ投資', '脱炭素', '発電所運営', '電力需給管理'],
    riskPoints: ['金利上昇', '燃料費/電力調達コスト', '案件遅延', '制度変更', 'FIT/FIP単価', '資金調達負担'],
    oshimeUse: '単なる地合い・再エネテーマ売りなら歪み候補になり得るが、案件遅延・利益率悪化・資金調達負担が理由なら反発確認を優先。',
    source: '内蔵会社DB'
  },
  '2413': {
    profile: '医師向けプラットフォーム「m3.com」を核に、製薬会社向けマーケティング支援、治験支援、医療人材、病院DX、海外医療関連事業を展開する医療DX企業。',
    segments: '主な収益源は医師会員基盤を活用した製薬会社向け営業・マーケ支援、治験/臨床開発支援、人材、病院・医療機関向けDX。成長率と市場期待の差で株価が大きく動く。',
    businessHints: ['高PERグロースとして評価されやすく、増益でも市場予想や会社計画が期待未達なら売られやすい。', '製薬マーケティング、治験、人材、海外の成長率鈍化がないかを見る。'],
    watchPoints: ['市場予想との差', '製薬向け支援の成長率', '治験/人材/海外の伸び', '営業利益率', '自社株買い'],
    freshThemes: ['医療DX・製薬営業DX', '治験効率化/臨床開発支援', '医師会員基盤を使ったデータ/マーケティング'],
    riskPoints: ['成長鈍化', '市場期待未達', 'PER調整', '製薬会社の販促費抑制'],
    oshimeUse: 'テクニカル押し目でも、期待値修正型の下落か事業悪化かを分ける。決算後に売られている場合、BB下限だけで買わず、5分足反発と会社計画/市場予想差を確認。',
    source: '内蔵会社DB'
  },
  '8604': {
    profile: '国内最大級の証券・投資銀行グループ。リテール、ホールセール、アセットマネジメント、投資銀行、トレーディングを展開。',
    segments: '稼ぎ方は個人向け証券販売・資産管理、法人向け引受/アドバイザリー、債券・株式トレーディング、運用ビジネス。相場環境と金利・ボラティリティに収益が左右される。',
    businessHints: ['株高・売買代金増・新NISAの資産流入は追い風。', '一方で海外ホールセールやトレーディング損失、マーケット急変には弱い。'],
    watchPoints: ['日本株売買代金', 'リテール資産流入', 'ホールセール収益', '自己株買い/配当', '海外部門の損益'],
    freshThemes: ['新NISAによる個人資産運用拡大', '日本株活況', '資産管理型ビジネスへの転換'],
    riskPoints: ['相場急落', 'トレーディング損失', '海外部門の不安定さ', '金利・為替急変'],
    oshimeUse: '相場全体の一時調整で売られているなら押し目候補。野村固有の損失・海外部門悪化・市場ボラ低下が理由なら慎重。',
    source: '内蔵会社DB'
  },
  '5019': { profile: '石油元売り大手。燃料油、基礎化学品、高機能材、電力・再エネなどを展開。', segments: '精製マージン、在庫影響、原油価格、石化市況、燃料需要、株主還元が収益の主な変動要因。', businessHints: ['原油高そのものより、精製マージン・在庫評価・為替・政府補助の影響を見る。', '還元姿勢が強い局面では下値を支えやすい。'], watchPoints: ['精製マージン', '原油価格', '在庫影響', '配当/自社株買い', '石化市況'], freshThemes: ['燃料油再編', '高機能材', '脱炭素/再エネ投資'], riskPoints: ['原油急落による在庫損', '石化市況悪化', '有事収束による資源株売り'], oshimeUse: '原油・地政学で短期的に売られた場合は押し目になりやすいが、在庫損や石化悪化なら回復に時間がかかる。', source: '内蔵会社DB' },
  '5020': { profile: '石油元売り最大手級。燃料油、石油化学、金属、電力、再エネ、水素などを展開。', segments: '燃料油・石化・金属が柱。原油、銅、為替、精製マージン、在庫影響、還元策で株価が動く。', businessHints: ['資源・市況株として、事業価値よりも地合い・原油・銅価格で短期変動しやすい。'], watchPoints: ['原油/銅価格', '精製マージン', '在庫評価', '配当', '政策・補助金'], freshThemes: ['水素/SAF/脱炭素', '金属リサイクル', '株主還元'], riskPoints: ['原油急落', '石化市況悪化', '在庫損', '有事剥落'], oshimeUse: '有事プレミアム剥落の下落か、業績悪化の下落かを分ける。還元が強いなら下値は拾われやすい。', source: '内蔵会社DB' },
  '464A': { profile: 'QPS研究所の持株会社。小型SAR衛星の開発・運用、衛星画像データ提供を狙う宇宙・防衛関連企業。', segments: '衛星打ち上げ、画像販売、政府/防衛/民間契約が成長ドライバー。まだ材料株色が強く、資金調達・希薄化・打ち上げ進捗が重要。', businessHints: ['打ち上げ成功・受注・政府/防衛需要で急騰しやすい。', '赤字/資金調達/希薄化で急落もしやすい。'], watchPoints: ['打ち上げ予定', '受注', '資金調達', '赤字幅', '希薄化'], freshThemes: ['SAR衛星コンステレーション', '防衛・災害監視需要', '政府契約'], riskPoints: ['打ち上げ遅延/失敗', '増資/ワラント', '赤字継続', '期待先行の剥落'], oshimeUse: '押し目スコアより材料日程・資金調達リスクが重要。BB下限でも悪材料IRがあればナイフ。', source: '内蔵会社DB' },
  '8801': { profile: '大手総合不動産。オフィス、商業施設、住宅、ホテル、物流、海外開発を展開。', segments: '賃貸、分譲、マネジメント、施設運営、海外が柱。金利、不動産市況、含み益、インバウンド、都市再開発が材料。', businessHints: ['金利上昇は逆風、インフレによる賃料上昇・資産価値は追い風。', '事故・施設トラブルは短期心理に影響しうるが、連結業績への実額影響を確認。'], watchPoints: ['金利', 'オフィス空室率', '賃料', '分譲利益', '含み益/還元'], freshThemes: ['東京再開発', 'ホテル/インバウンド', '物流/商業施設'], riskPoints: ['金利上昇', '不動産市況悪化', '事故/施設リスク', '海外不動産評価損'], oshimeUse: '地合い・金利連動の下落なら押し目候補。個別事故や評価損なら影響額を確認してから。', source: '内蔵会社DB' },
  '9201': { profile: '国内大手航空会社。国内線・国際線旅客、貨物、マイレージ/旅行関連を展開。', segments: '旅客需要、燃油費、為替、インバウンド、ビジネス需要が収益を左右。', businessHints: ['インバウンド・国際線回復は追い風。燃油高と円安はコスト増。'], watchPoints: ['旅客数', '燃油費', '為替', '国際線単価', '配当'], freshThemes: ['インバウンド', '国際線回復', 'マイル経済圏'], riskPoints: ['燃油高', '円安', '事故/運航トラブル', '感染症/地政学'], oshimeUse: '燃油・地政学で売られた時は反発余地があるが、需要鈍化や事故系は慎重。', source: '内蔵会社DB' },
  '6902': { profile: '自動車部品大手。パワトレ、熱マネジメント、電子、ADAS、電動化部品などを展開。', segments: 'トヨタグループ向け比率が高く、自動車生産、為替、EV/HEV投資、半導体/電子部品需要の影響を受ける。', businessHints: ['EVだけでなくHEV・熱管理・車載半導体が重要。'], watchPoints: ['トヨタ生産', '為替', '電動化投資', '利益率', '中国競争'], freshThemes: ['電動化', 'ADAS', '熱マネジメント', '車載半導体'], riskPoints: ['自動車減産', '円高', '中国競争', 'EV投資負担'], oshimeUse: '自動車セクター連れ安なら押し目候補。個別の利益率悪化なら反発確認待ち。', source: '内蔵会社DB' },
  '7733': { profile: '内視鏡を中心とする医療機器大手。消化器内視鏡、治療機器、外科関連を展開。', segments: '内視鏡のグローバルシェアと医療機器の利益率が核。規制・品質問題・中国需要・為替が材料。', businessHints: ['医療機器の構造成長は強いが、品質/規制/中国需要で売られやすい。'], watchPoints: ['内視鏡成長率', '中国需要', '品質/規制対応', '利益率', '為替'], freshThemes: ['低侵襲医療', '内視鏡更新需要', 'AI診断支援'], riskPoints: ['規制/品質問題', '中国需要鈍化', '円高', '訴訟'], oshimeUse: '医療機器需要が崩れていない一時売りなら押し目。品質問題や規制なら危険度を上げる。', source: '内蔵会社DB' }
});

function companySeed(code) { return COMPANY_PROFILES[bareCode(code)] || null; }

const nameCache = new Map();
const nikkeiCache = { at: 0, items: [] };
const NIKKEI_COMPONENT_URL = 'https://indexes.nikkei.co.jp/nkave/index/component';

function normalizeCode(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (/^[0-9]{4}[A-Z]?$/.test(s)) return `${s}.T`;
  return s.includes('.') ? s : `${s}.T`;
}
function bareCode(raw) { return String(raw || '').replace(/\.T$/i, '').toUpperCase(); }
function localSymbol(code) {
  const c = bareCode(code).toUpperCase();
  return LOCAL_SYMBOLS.find((x) => x.code.toUpperCase() === c) || NIKKEI225_STATIC.find((x) => x.code.toUpperCase() === c) || null;
}
function compactText(s) { return String(s || '').toLowerCase().replace(/[\s　・･・()（）\[\]【】株式会社㈱ホールディングスhdＨＤ]/g, ''); }
function yen(n) { return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }
function pct(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : null; }
function avg(values) { return values.reduce((a,b)=>a+b,0)/values.length; }
function sma(values, n) { const nums = values.filter(Number.isFinite); return nums.length >= n ? avg(nums.slice(-n)) : null; }
function std(values) { if (!values.length) return null; const m = avg(values); return Math.sqrt(avg(values.map(v => (v - m) ** 2))); }


function decodeHtmlEntity(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanJapaneseName(raw, code = '') {
  let name = decodeHtmlEntity(raw)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const c = bareCode(code);
  const patterns = [
    new RegExp(`^(.+?)[【\\[]${c}(?:\\.T)?[】\\]]`),
    new RegExp(`^(.+?)[（\\(]${c}(?:\\.T)?[）\\)]`),
    /^(.+?)：株価/,
    /^(.+?)の株価/,
    /^(.+?) 株価/,
    /^(.+?) \|/,
    /^(.+?) -/,
    /^(.+?) :/,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (m?.[1]) { name = m[1].trim(); break; }
  }

  name = name
    .replace(/【.*$/, '')
    .replace(/\(.*?\)$/, '')
    .replace(/（.*?）$/, '')
    .replace(/株価.*$/, '')
    .replace(/の株価.*$/, '')
    .replace(/\s*\|.*$/, '')
    .replace(/\s*-\s*(Yahoo|株探|みんかぶ|MINKABU|Kabutan).*$/i, '')
    .replace(/^(株式會社|株式会社|㈱)\s*/, '')
    .trim();

  if (!name) return '';
  if (name === c || name === `${c}.T`) return '';
  if (/Yahoo|ファイナンス|株探|Kabutan|みんかぶ|MINKABU|日本株|株価情報/i.test(name)) return '';
  if (/^[A-Z0-9 .,&'-]+$/.test(name) && !/[ぁ-んァ-ヶ一-龠]/.test(name)) return '';
  return name;
}

async function fetchTextSmart(url, timeoutMs = 8000, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 oshime-dashboard',
          'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.4'
        }
      });
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      const sjis = new TextDecoder('shift_jis', { fatal: false }).decode(buf);
      const badUtf = (utf.match(/�/g) || []).length;
      const badSjis = (sjis.match(/�/g) || []).length;
      return badSjis < badUtf ? sjis : utf;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}


// === JPX 銘柄別信用取引週末残高 自動取得 ===
const creditJpxCache = new SimpleLRU(800, 6 * 60 * 60 * 1000);
const JPX_WEEKLY_MARGIN_URL = 'https://www.jpx.co.jp/markets/statistics-equities/margin/05.html';

function normalizeCreditText(s) {
  return String(s || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/△/g, '-')
    .replace(/▲/g, '-')
    .replace(/−/g, '-')
    .replace(/＋/g, '+');
}
function parseCreditInt(v) {
  if (v == null) return null;
  let raw = normalizeCreditText(v).replace(/[,，\s]/g, '').replace(/株|口|円/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function marginSourceDateFromText(text, fallbackLabel = '') {
  const t = normalizeCreditText(text);
  const m = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*申込分/)
    || normalizeCreditText(fallbackLabel).match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return fallbackLabel || '';
  return `${m[1]}/${String(m[2]).padStart(2,'0')}/${String(m[3]).padStart(2,'0')}`;
}
function stripHtmlText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
async function fetchJpxWeeklyMarginLinks() {
  const html = await fetchTextSmart(JPX_WEEKLY_MARGIN_URL, 12000, 1);
  const links = [];

  // JPXのページは「日付ラベル」とPDFリンクが別セルになることがあるため、
  // 周辺テキストではなく URL の syumatsuYYYYMMDD...pdf から基準日を読む。
  const syumatsuRe = /<a[^>]+href=["']([^"']*syumatsu(\d{4})(\d{2})(\d{2})\d*\.pdf[^"']*)["'][^>]*>/gi;
  let m;
  while ((m = syumatsuRe.exec(html))) {
    const href = m[1];
    const url = href.startsWith('http') ? href : new URL(href, JPX_WEEKLY_MARGIN_URL).href;
    const sourceDate = `${m[2]}/${m[3]}/${m[4]}`;
    links.push({ url, label: `${m[2]}年${m[3]}月${m[4]}日申込分`, sourceDate });
  }

  // 念のため、syumatsu 以外の信用週末残高PDFにもフォールバック。
  if (!links.length) {
    const aRe = /<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = aRe.exec(html))) {
      const href = m[1];
      const before = html.slice(Math.max(0, m.index - 320), m.index);
      const after = html.slice(m.index, Math.min(html.length, m.index + 360));
      const label = stripHtmlText(before + ' ' + m[2] + ' ' + after);
      if (!/申込分|銘柄別信用取引週末残高|信用取引/.test(label)) continue;
      const url = href.startsWith('http') ? href : new URL(href, JPX_WEEKLY_MARGIN_URL).href;
      links.push({ url, label, sourceDate: marginSourceDateFromText(label, label) });
    }
  }

  const uniq = [...new Map(links.map((x) => [x.url, x])).values()];
  return uniq.sort((a,b) => String(b.sourceDate || b.label).localeCompare(String(a.sourceDate || a.label))).slice(0, 12);
}
async function parsePdfText(buffer) {
  // pdf-parse の package root は ESM 環境で test PDF を読みに行く事故があるため、
  // 安定版 v1 系の実体ファイルを先に直接読む。
  const candidates = [];
  try { candidates.push(await import('pdf-parse/lib/pdf-parse.js')); } catch (e) {}
  try { candidates.push(await import('pdf-parse')); } catch (e) {
    if (!candidates.length) throw e;
  }

  for (const mod of candidates) {
    const funcs = [mod.default, mod.pdfParse, mod.parse, mod];
    for (const fn of funcs) {
      if (typeof fn === 'function') {
        try {
          const data = await fn(buffer);
          if (data?.text) return data.text;
        } catch (e) {}
      }
    }
    const PDFParse = mod.PDFParse || mod.default?.PDFParse;
    if (typeof PDFParse === 'function') {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        if (typeof result === 'string') return result;
        if (result?.text) return result.text;
      } finally {
        if (typeof parser.destroy === 'function') await parser.destroy();
      }
    }
  }

  throw new Error('pdf-parse の形式を解釈できませんでした');
}
function pickMarginRowText(text, code) {
  const c = String(code).replace(/\.T$/i, '').trim();
  const lines = normalizeCreditText(text).split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`(^|\\s)${c}($|\\s)`).test(lines[i])) {
      return lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 8)).join(' ');
    }
  }
  const flat = lines.join(' ');
  const idx = flat.search(new RegExp(`(^|\\s)${c}($|\\s)`));
  return idx >= 0 ? flat.slice(Math.max(0, idx - 80), idx + 420) : '';
}
function extractJpxMarginFromText(text, code, source = {}) {
  const row = pickMarginRowText(text, code);
  if (!row) return null;
  const c = String(code).replace(/\.T$/i, '').trim();
  const after = row.slice(Math.max(0, row.search(new RegExp(`(^|\\s)${c}($|\\s)`))));
  const nums = [...after.matchAll(/[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?/g)]
    .map((m) => m[0])
    .filter((x) => x !== c && !/^20\d{2}$/.test(x))
    .map(parseCreditInt)
    .filter((n) => Number.isFinite(n));
  // JPX週末残高PDFは通常「売残高 前週比 買残高 前週比」の順で出る。
  // PDF抽出の列ズレに備え、4つ以上取れた場合のみ自動入力する。
  if (nums.length < 4) return null;
  const sellBalance = nums[0];
  const sellChange = nums[1];
  const buyBalance = nums[2];
  const buyChange = nums[3];
  const ratio = sellBalance ? buyBalance / sellBalance : null;
  return {
    code: c,
    source: 'JPX 銘柄別信用取引週末残高',
    sourceDate: marginSourceDateFromText(text, source.sourceDate || source.label || ''),
    sourceUrl: source.url || JPX_WEEKLY_MARGIN_URL,
    sellBalance, sellChange, buyBalance, buyChange,
    ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
    rowText: row.slice(0, 800),
    note: 'JPX公式PDFから自動抽出。PDFの列ズレがある場合は、元PDFで売残/買残の順序を確認してください。'
  };
}
function creditOverhangFromHistory(history) {
  const h = Array.isArray(history) ? history.filter((x) => Number.isFinite(Number(x.buyBalance))) : [];
  if (h.length < 4) return { overhang: false, pathological: false, heavy: false, reason: '履歴不足' };

  let buyIncreaseWeeks = 0;
  let buyDecreaseWeeks = 0;
  let sellIncreaseWeeks = 0;
  let buyUpInDownWeek = 0;
  let buyUpInUpWeek = 0;
  let priceTaggedWeeks = 0;

  for (let i = 1; i < h.length; i++) {
    const prevBuy = Number(h[i - 1].buyBalance);
    const currBuy = Number(h[i].buyBalance);
    const prevSell = Number(h[i - 1].sellBalance);
    const currSell = Number(h[i].sellBalance);
    if (currBuy > prevBuy) {
      buyIncreaseWeeks++;
      const w = Number(h[i].weekPriceChange);
      if (Number.isFinite(w)) {
        priceTaggedWeeks++;
        if (w < 0) buyUpInDownWeek++;
        else if (w > 0) buyUpInUpWeek++;
      }
    }
    if (currBuy < prevBuy) buyDecreaseWeeks++;
    if (Number.isFinite(prevSell) && Number.isFinite(currSell) && currSell > prevSell) sellIncreaseWeeks++;
  }

  const latest = h.at(-1);
  const prev = h.at(-2);
  const latestBuyChange = latest && prev ? Number(latest.buyBalance) - Number(prev.buyBalance) : null;
  const latestBuy = Number(latest?.buyBalance);
  const avgBuy = h.reduce((sum, x) => sum + Number(x.buyBalance || 0), 0) / h.length;
  const heavy = Number.isFinite(latestBuy) && Number.isFinite(avgBuy) && avgBuy > 0 ? latestBuy > avgBuy * 1.1 : false;
  const pathological = buyUpInDownWeek >= 1 && buyUpInUpWeek >= 1;

  // 価格方向付き履歴がある場合は「下げでも上げでも買残増」を病的overhangとして優先。
  // 価格方向が未付与の場合は、旧来の単調な買残積み上がりをフォールバックにする。
  const monotonicOverhang = buyIncreaseWeeks >= 2 && buyDecreaseWeeks === 0;
  const overhang = (pathological && heavy) || (!priceTaggedWeeks && monotonicOverhang);
  const clearing = buyDecreaseWeeks >= 2;
  const shortBuild = sellIncreaseWeeks >= 2;

  return {
    overhang,
    pathological,
    heavy,
    clearing,
    shortBuild,
    buyIncreaseWeeks,
    buyDecreaseWeeks,
    sellIncreaseWeeks,
    buyUpInDownWeek,
    buyUpInUpWeek,
    latestBuyChange,
    reason: overhang
      ? (pathological
        ? `下げ週で買残増 ${buyUpInDownWeek} 回、上げ週で買残増 ${buyUpInUpWeek} 回。買残水準も高め。両方向で売り供給が積み上がる構造。`
        : '複数週で買残が積み上がり：将来の戻り売り圧力に注意')
      : pathological
        ? '株価方向と無関係に買残が増えているが、絶対水準はまだ重くない'
        : clearing
          ? '複数週で買残減少：信用整理が進行'
          : shortBuild
            ? '売残増加が続く：上昇時は買い戻し余地'
            : '履歴上の偏りは限定的'
  };
}

function attachWeekPriceChangesToCreditHistory(history, timestamps = [], closes = []) {
  const h = Array.isArray(history) ? history : [];
  if (!h.length || !Array.isArray(timestamps) || !Array.isArray(closes) || !timestamps.length || !closes.length) return h;
  const days = timestamps.map((t, i) => ({
    date: new Date(Number(t) * 1000).toISOString().slice(0, 10),
    close: Number(closes[i])
  })).filter((x) => Number.isFinite(x.close));
  if (days.length < 8) return h;
  function closeOnOrBefore(dateStr) {
    const key = String(dateStr || '').replace(/\//g, '-');
    let best = null;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].date <= key) { best = { ...days[i], index: i }; break; }
    }
    return best;
  }
  return h.map((row) => {
    const cur = closeOnOrBefore(row.sourceDate);
    if (!cur || cur.index < 5) return row;
    const prev = days[Math.max(0, cur.index - 5)];
    const weekPriceChange = (prev?.close && cur.close) ? Math.round(((cur.close - prev.close) / prev.close) * 10000) / 100 : null;
    return { ...row, weekPriceChange };
  });
}

async function loadLocalCreditHistory(code) {
  const c = bareCode(code);
  const file = path.join(__dirname, 'data', `credit-history-${c}.json`);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
}
async function saveLocalCreditHistory(code, history) {
  const c = bareCode(code);
  const dir = path.join(__dirname, 'data');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `credit-history-${c}.json`);
  await fs.writeFile(file, JSON.stringify(history.slice(-12), null, 2));
}
async function appendLocalCreditHistory(code, rows) {
  const current = await loadLocalCreditHistory(code);
  const map = new Map(current.map((x) => [x.sourceDate || x.label || x.fetchedAt, x]));
  for (const row of rows || []) {
    const key = row.sourceDate || row.label || row.fetchedAt;
    if (key) map.set(key, row);
  }
  const next = [...map.values()].sort((a,b) => String(a.sourceDate || '').localeCompare(String(b.sourceDate || ''))).slice(-12);
  await saveLocalCreditHistory(code, next);
  return next;
}

async function fetchJpxWeeklyMarginHistoryForCode(code, maxWeeks = 8) {
  const c = bareCode(code);
  const links = await fetchJpxWeeklyMarginLinks();
  if (!links.length) throw new Error('JPXの信用週末残高PDFリンクを取得できませんでした');
  const hits = [];
  const errors = [];
  for (const link of links.slice(0, maxWeeks)) {
    try {
      const buf = await fetchBufferSmart(link.url, 20000, 1);
      const text = await parsePdfText(buf);
      const hit = extractJpxMarginFromText(text, c, link);
      if (hit) hits.push(hit);
    } catch (e) {
      errors.push(`${link.sourceDate || link.label}: ${e.message}`);
    }
  }
  hits.sort((a,b) => String(a.sourceDate || '').localeCompare(String(b.sourceDate || '')));
  if (!hits.length) {
    const err = errors.slice(0,2).join(' / ');
    throw new Error(`JPX信用残で ${c} が見つかりませんでした。PDF抽出失敗の可能性があります。${err}`);
  }
  const localHistory = await appendLocalCreditHistory(c, hits).catch(() => hits);
  const history = localHistory.length ? localHistory : hits;
  const overhang = creditOverhangFromHistory(history);
  return { latest: hits.at(-1), history, overhang, availableDates: links.map((x) => x.sourceDate || x.label).filter(Boolean).slice(0, 8), errors };
}

async function fetchJpxWeeklyMarginForCode(code) {
  const c = bareCode(code);
  const cached = creditJpxCache.get(c);
  if (cached) return cached;
  const result = await fetchJpxWeeklyMarginHistoryForCode(c, 8);
  const latest = { ...result.latest, history: result.history, overhang: result.overhang, availableDates: result.availableDates };
  creditJpxCache.set(c, latest);
  return latest;
}

async function fetchYahooJapanName(code) {
  const c = bareCode(code);
  try {
    const html = await fetchTextSmart(`https://finance.yahoo.co.jp/quote/${encodeURIComponent(c)}.T`);
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
    return cleanJapaneseName(h1, c) || cleanJapaneseName(title, c);
  } catch { return ''; }
}

async function fetchKabutanName(code) {
  const c = bareCode(code);
  try {
    const html = await fetchTextSmart(`https://kabutan.jp/stock/?code=${encodeURIComponent(c)}`);
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
    const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '';
    const name = cleanJapaneseName(h2, c) || cleanJapaneseName(title, c);
    if (name) return name;
  } catch {}
  return '';
}

async function fetchMinkabuName(code) {
  const c = bareCode(code);
  try {
    const html = await fetchTextSmart(`https://minkabu.jp/stock/${encodeURIComponent(c)}`);
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
    return cleanJapaneseName(h1, c) || cleanJapaneseName(title, c);
  } catch { return ''; }
}

async function fetchYahooSearchName(code) {
  const c = bareCode(code);
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(c + '.T')}&quotesCount=8&newsCount=0&enableFuzzyQuery=true&region=JP&lang=ja-JP`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 oshime-dashboard', 'Accept-Language': 'ja-JP,ja;q=0.9' } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const hit = (data?.quotes || []).find((x) => bareCode(x.symbol) === c);
    return cleanJapaneseName(hit?.shortname || hit?.longname || '', c);
  } catch { return ''; }
}

async function getJapaneseName(code, fallback = '') {
  const c = bareCode(code);
  const local = localSymbol(c);
  if (local?.name) return local.name;
  if (nameCache.has(c)) return nameCache.get(c);

  const sources = [
    () => fetchYahooJapanName(c),
    () => fetchKabutanName(c),
    () => fetchMinkabuName(c),
    () => fetchYahooSearchName(c),
  ];
  for (const fn of sources) {
    const name = await fn();
    if (name) {
      nameCache.set(c, name);
      return name;
    }
  }

  const cleanFallback = cleanJapaneseName(fallback, c);
  const finalName = cleanFallback || fallback || c;
  nameCache.set(c, finalName);
  return finalName;
}

function calcBollinger(closes, highs, lows, price) {
  const last20 = closes.filter(Number.isFinite).slice(-20);
  if (last20.length < 20) return {};
  const mid = avg(last20);
  const sigma = std(last20);
  const upper = mid + 2 * sigma;
  const lower = mid - 2 * sigma;
  const minus1 = mid - sigma;
  const plus1 = mid + sigma;
  const high20 = highs.filter(Number.isFinite).slice(-20).reduce((a,b)=>Math.max(a,b), -Infinity);
  const low20 = lows.filter(Number.isFinite).slice(-20).reduce((a,b)=>Math.min(a,b), Infinity);

  let oshimePrice;
  let oshimeLabel;
  if (price > mid) { oshimePrice = mid; oshimeLabel = '中心線待ち'; }
  else if (price > minus1) { oshimePrice = minus1; oshimeLabel = '-1σ押し'; }
  else if (price > lower) { oshimePrice = lower; oshimeLabel = '下限接近'; }
  else { oshimePrice = price; oshimeLabel = '下限割れ'; }

  const stop = Math.min(lower - sigma * 0.5, Number.isFinite(low20) ? low20 : lower - sigma * 0.5);
  const target = upper;
  const risk = oshimePrice - stop;
  const reward = target - oshimePrice;
  const rr = risk > 0 && reward > 0 ? reward / risk : null;

  return {
    bbMid: yen(mid), bbUpper: yen(upper), bbLower: yen(lower),
    bbPlus1: yen(plus1), bbMinus1: yen(minus1), sigma: yen(sigma),
    bbPos: sigma ? Math.round(((price - mid) / sigma) * 100) / 100 : null,
    high20: Number.isFinite(high20) ? yen(high20) : null,
    low20: Number.isFinite(low20) ? yen(low20) : null,
    drawdown20: Number.isFinite(high20) ? Math.round(pct(price, high20) * 100) / 100 : null,
    oshimePrice: yen(oshimePrice), oshimeLabel,
    rrTarget: yen(target), rrStop: yen(stop), predictedRR: rr ? Math.round(rr * 100) / 100 : null,
  };
}


function classifyTrendKind({ price, ma5, ma10, ma20, ma60, high20, low20, ma20Slope, volumeRatio, closes, highs }) {
  const finite = (x) => Number.isFinite(x);
  if (!finite(ma5) || !finite(ma20) || !finite(ma60) || !finite(price)) {
    return { kind: 'unknown', label: '判定情報不足' };
  }
  const stacked = ma5 > ma20 && ma20 > ma60;
  const allRising = (ma20Slope ?? 0) > 0;
  const last3High = Math.max(...(highs.slice(-3).filter(finite)));
  const breakoutFresh = finite(last3High) && finite(high20) && last3High >= high20 * 0.998;
  const range20Pct = finite(high20) && finite(low20) && low20 > 0 ? (high20 - low20) / low20 : 1;
  const tightRange = range20Pct < 0.18;
  const volConfirmed = (volumeRatio ?? 0) >= 1.3;
  const recentCloses = closes.slice(-10).filter(finite);
  const recentHighs = highs.slice(-10).filter(finite);
  const priorCloses = closes.slice(-20, -10).filter(finite);
  const priorHighs = highs.slice(-20, -10).filter(finite);
  const recent10Range = recentHighs.length >= 8 && recentCloses.length >= 8 ? Math.max(...recentHighs) - Math.min(...recentCloses) : Infinity;
  const prior10Range = priorHighs.length >= 8 && priorCloses.length >= 8 ? Math.max(...priorHighs) - Math.min(...priorCloses) : 0;
  const consolidationBefore = prior10Range > 0 && recent10Range < prior10Range * 0.9;

  if (breakoutFresh && (tightRange || volConfirmed || consolidationBefore)) {
    return { kind: 'breakout', label: 'ブレイクアウト初動', stacked, allRising, breakoutFresh };
  }
  if (stacked && allRising) {
    const ma5Distance = Math.abs((price - ma5) / ma5);
    if (ma5Distance < 0.04) return { kind: 'sustained', label: '持続上昇（MA5付近）', stacked, allRising };
    return { kind: 'sustained_extended', label: '持続上昇（乖離拡大・押し目待ち）', stacked, allRising };
  }
  if (price > ma20 && (ma20Slope ?? 0) >= 0) {
    return { kind: 'recovering', label: '回復途上', stacked: false, allRising };
  }
  return { kind: 'weak', label: '上昇シグナル弱い', stacked: false, allRising: false };
}

function calcTrendMetrics(closes, highs, lows, volumes, price, prev, boll) {
  const nums = closes.filter(Number.isFinite);
  if (nums.length < 25 || !Number.isFinite(price)) return {};
  const ma5 = sma(nums, 5);
  const ma10 = sma(nums, 10);
  const ma20 = sma(nums, 20);
  const ma60 = sma(nums, 60);
  const prevMa5 = nums.length >= 10 ? avg(nums.slice(-10, -5)) : null;
  const prevMa20 = nums.length >= 40 ? avg(nums.slice(-40, -20)) : null;
  const validHighs20 = highs.filter(Number.isFinite).slice(-20);
  const validLows20 = lows.filter(Number.isFinite).slice(-20);
  const high20 = validHighs20.reduce((a, b) => Math.max(a, b), -Infinity);
  const low20 = validLows20.reduce((a, b) => Math.min(a, b), Infinity);
  const high60 = highs.filter(Number.isFinite).slice(-60).reduce((a, b) => Math.max(a, b), -Infinity);
  const low60 = lows.filter(Number.isFinite).slice(-60).reduce((a, b) => Math.min(a, b), Infinity);
  const volume = volumes.at(-1);
  const vol20 = sma(volumes, 20);
  const volumeRatio = vol20 ? volume / vol20 : null;
  const changePct = pct(price, prev);
  const ma5Slope = prevMa5 ? pct(ma5, prevMa5) : null;
  const ma20Slope = prevMa20 ? pct(ma20, prevMa20) : null;
  const bbPos = boll?.bbPos;

  const kindResult = classifyTrendKind({ price, ma5, ma10, ma20, ma60, high20, low20, ma20Slope, volumeRatio, closes: nums, highs });
  let strength = 0;
  const reasons = [];
  let danger = 0;
  const dangers = [];

  if (kindResult.kind === 'breakout') {
    if (price > ma5) { strength += 14; reasons.push('5日線上'); }
    if (price > ma20) { strength += 14; reasons.push('20日線上'); }
    if (kindResult.stacked) { strength += 10; reasons.push('MA並び良好'); }
    if (volumeRatio >= 1.5 && changePct > 0) { strength += 22; reasons.push('ブレイク時の出来高増'); }
    else if (volumeRatio >= 1.2) { strength += 12; reasons.push('出来高伴う'); }
    if (Number.isFinite(high20) && pct(price, high20) >= -1) { strength += 16; reasons.push('20日高値圏'); }
    if (changePct > 0) { strength += 8; reasons.push('当日プラス'); }
    if (changePct >= 6) { danger += 26; dangers.push('ブレイク日に急騰しすぎ'); }
    if (volumeRatio >= 3 && changePct >= 4) { danger += 18; dangers.push('出来高急増の急騰'); }
    if (bbPos != null && bbPos > 2.2) { danger += 22; dangers.push('BB+2.2σ超で短期過熱'); }
  } else if (kindResult.kind === 'sustained' || kindResult.kind === 'sustained_extended') {
    if (price > ma5) { strength += 12; reasons.push('5日線上'); }
    if (price > ma20) { strength += 16; reasons.push('20日線上'); }
    if (price > ma60) { strength += 10; reasons.push('60日線上'); }
    if (kindResult.stacked) { strength += 14; reasons.push('短期>中期>長期の並び'); }
    if (ma20Slope != null && ma20Slope > 0.4) { strength += 16; reasons.push('20日線しっかり上向き'); }
    else if (ma20Slope != null && ma20Slope > 0) { strength += 8; reasons.push('20日線上向き'); }
    if (kindResult.kind === 'sustained') { strength += 10; reasons.push('MA5乖離が小さい'); }
    if (kindResult.kind === 'sustained_extended') { danger += 14; dangers.push('MA5から乖離拡大'); }
    if (Number.isFinite(high20) && pct(price, high20) > -5) { strength += 8; reasons.push('20日高値圏を維持'); }
    if (bbPos != null && bbPos > 1.8) { danger += 18; dangers.push('+1.8σ超で過熱'); }
    if (changePct >= 5) { danger += 20; dangers.push('当日急騰後'); }
  } else if (kindResult.kind === 'recovering') {
    if (price > ma20) { strength += 12; reasons.push('20日線回復'); }
    if (ma20Slope != null && ma20Slope > 0) { strength += 8; reasons.push('20日線が上向きに転換'); }
    if (changePct > 0 && (volumeRatio ?? 0) >= 1.3) { strength += 12; reasons.push('反発+出来高増'); }
    danger += 8; dangers.push('回復途上：MA並びが完全ではない');
    if (price < ma60) { danger += 16; dangers.push('60日線下'); }
  } else {
    danger += 20; dangers.push('上昇シグナル弱い');
    if (price < ma20) { danger += 18; dangers.push('20日線下'); }
    if (ma20Slope != null && ma20Slope < -0.4) { danger += 14; dangers.push('20日線下向き'); }
  }

  if (Number.isFinite(high20) && pct(price, high20) < -10) { danger += 16; dangers.push('20日高値から離れすぎ'); }

  let entry = null, entryLabel = '—';
  if (kindResult.kind === 'breakout') { entry = ma5 ?? boll?.bbMid; entryLabel = 'ブレイク後の5日線押し'; }
  else if (kindResult.kind === 'sustained') { entry = ma5; entryLabel = 'MA5押し'; }
  else if (kindResult.kind === 'sustained_extended') { entry = ma20; entryLabel = 'MA20押し（乖離調整待ち）'; }
  else if (kindResult.kind === 'recovering' && price > ma20) { entry = ma20; entryLabel = '20日線回復押し'; }
  else { entry = null; entryLabel = '順張り対象外'; }

  const target = Number.isFinite(high20) ? Math.max(high20, boll?.bbUpper || high20) : boll?.bbUpper;
  const stop = entry && Number.isFinite(low20) ? Math.min(ma20 ?? entry * 0.97, entry * 0.97, low20) : null;
  const risk = entry && stop ? entry - stop : null;
  const reward = entry && target ? target - entry : null;
  const trendRR = risk > 0 && reward > 0 ? reward / risk : null;

  if (trendRR != null && trendRR < 1) { danger += 14; dangers.push('順張りRR不足'); }
  if (trendRR != null && trendRR >= 2) { strength += 8; reasons.push('順張りRR 2倍以上'); }

  // v40: 上昇継続を「守備型」と「推力型」に分ける。
  // 守備型: 振れ幅が小さく、線を維持し、過熱が小さい上昇。
  // 推力型: 出来高・高値更新・ブレイクで上へ走る上昇。
  const range20Pct = Number.isFinite(high20) && Number.isFinite(low20) && low20 > 0 ? ((high20 - low20) / low20) * 100 : null;
  const maStackScore = kindResult.stacked ? 24 : (price > ma20 && price > ma60 ? 12 : 0);
  const enduranceScore = Math.max(0, Math.min(100, Math.round(
    maStackScore +
    ((ma20Slope ?? 0) > 0 ? 18 : 0) +
    (price > ma20 ? 16 : 0) +
    (range20Pct != null && range20Pct < 14 ? 16 : range20Pct != null && range20Pct < 22 ? 8 : 0) +
    (bbPos != null && bbPos < 1.5 ? 10 : 0) -
    (danger * 0.35)
  )));
  const thrustScore = Math.max(0, Math.min(100, Math.round(
    (kindResult.kind === 'breakout' ? 28 : 0) +
    (Number.isFinite(high20) && pct(price, high20) >= -2 ? 18 : 0) +
    ((volumeRatio ?? 0) >= 1.5 ? 18 : (volumeRatio ?? 0) >= 1.2 ? 10 : 0) +
    ((changePct ?? 0) > 0 ? 8 : 0) +
    ((ma20Slope ?? 0) > 0.5 ? 12 : 0) -
    (bbPos != null && bbPos > 2.2 ? 12 : 0)
  )));

  strength = Math.max(0, Math.min(100, Math.round(strength)));
  danger = Math.max(0, Math.min(100, Math.round(danger)));
  const safety = Math.max(0, Math.min(100, Math.round(strength - danger + 45)));

  let judge = '対象外';
  if (kindResult.kind === 'breakout' && strength >= 60 && danger < 50) judge = 'ブレイク順張り候補';
  else if (kindResult.kind === 'sustained' && strength >= 65 && danger < 40 && (trendRR ?? 0) >= 1.3) judge = '持続上昇候補';
  else if (kindResult.kind === 'sustained_extended' && strength >= 55) judge = '押し目待ち（持続上昇）';
  else if (kindResult.kind === 'recovering' && strength >= 50) judge = '回復順張り監視';
  else if (strength >= 55 && danger >= 55) judge = '強いが過熱注意';
  else if (strength >= 40 && price > ma20) judge = '監視';

  return {
    ma5: yen(ma5), ma10: yen(ma10), ma20: yen(ma20), ma60: yen(ma60),
    ma5Slope: ma5Slope == null ? null : Math.round(ma5Slope * 100) / 100,
    ma20Slope: ma20Slope == null ? null : Math.round(ma20Slope * 100) / 100,
    high60: Number.isFinite(high60) ? yen(high60) : null,
    low60: Number.isFinite(low60) ? yen(low60) : null,
    trendScore: strength,
    trendDangerScore: danger,
    trendSafetyScore: safety,
    enduranceScore,
    thrustScore,
    trendKind: kindResult.kind,
    trendKindLabel: kindResult.label,
    trendType: kindResult.label,
    trendJudge: judge,
    trendEntryPrice: entry ? yen(entry) : null,
    trendEntryLabel: entryLabel,
    trendTarget: target ? yen(target) : null,
    trendStop: stop ? yen(stop) : null,
    trendRR: trendRR ? Math.round(trendRR * 100) / 100 : null,
    trendReasons: [...new Set(reasons)].slice(0, 6),
    trendDangerReasons: [...new Set(dangers)].slice(0, 6),
  };
}




function classifyHistoricalPriceMode(closes = [], highs = [], lows = [], volumes = []) {
  const nums = (closes || []).filter(Number.isFinite);
  const hs = (highs || []).filter(Number.isFinite);
  const ls = (lows || []).filter(Number.isFinite);
  const vs = (volumes || []).filter(Number.isFinite);
  const n = Math.min(nums.length, hs.length, ls.length, vs.length);
  if (n < 25) return { priceMode: '判定不足', priceModeScore: 0, priceModeReasons: ['日足データ不足'] };
  const c = nums.slice(-60);
  const h = hs.slice(-60);
  const l = ls.slice(-60);
  const v = vs.slice(-60);
  const drift = pct(c.at(-1), c[0]);
  const maxHigh = Math.max(...h);
  const minLow = Math.min(...l);
  const rangePct = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : null;
  const worstDay = Math.min(...c.slice(1).map((x, i) => pct(x, c[i])).filter(Number.isFinite));
  let maxBounce = 0;
  let rollingLow = c[0];
  for (const x of c) {
    if (x < rollingLow) rollingLow = x;
    if (rollingLow > 0) maxBounce = Math.max(maxBounce, pct(x, rollingLow));
  }
  const last20 = c.slice(-20);
  const vol20 = sma(v, 20);
  const recentVol = sma(v.slice(-10), Math.min(10, v.slice(-10).length));
  const volTrend = vol20 ? recentVol / vol20 : null;
  let lowerLowCount = 0;
  for (let i = 10; i <= Math.min(50, c.length - 10); i += 10) {
    const prevLow = Math.min(...c.slice(i - 10, i));
    const nextLow = Math.min(...c.slice(i, i + 10));
    if (Number.isFinite(prevLow) && Number.isFinite(nextLow) && nextLow < prevLow) lowerLowCount++;
  }
  let mode = '通常推移';
  const reasons = [];
  let score = 0;
  if (worstDay <= -7 || (drift <= -12 && Math.abs(worstDay) >= 5)) {
    mode = '急落型'; score = 72; reasons.push('短期急落を含む');
  }
  if (drift <= -12 && maxBounce >= 12) {
    mode = '振れ幅のある下降型'; score = Math.max(score, 68); reasons.push('下降中でも反発幅がある');
  }
  if (drift <= -10 && maxBounce <= 7 && lowerLowCount >= 2) {
    mode = 'だらだら下げ型'; score = Math.max(score, 74); reasons.push('戻りが弱く安値を切り下げ');
  }
  if (Math.abs(drift) <= 6 && rangePct != null && rangePct <= 14 && (volTrend == null || volTrend <= 1.05)) {
    mode = '底ばい型'; score = Math.max(score, 58); reasons.push('値幅と出来高が細り横ばい');
  }
  if (!reasons.length) reasons.push('明確な下落型は限定的');
  return {
    priceMode: mode,
    priceModeScore: Math.max(0, Math.min(100, Math.round(score))),
    priceModeReasons: reasons.slice(0, 3),
    priceModeStats: {
      drift60: Math.round((drift ?? 0) * 100) / 100,
      maxBounce60: Math.round(maxBounce * 100) / 100,
      worstDay60: Math.round((worstDay ?? 0) * 100) / 100,
      range60: rangePct == null ? null : Math.round(rangePct * 100) / 100,
      lowerLowCount,
    },
  };
}

function classifyBottomShape({ drawdown20, bbPos, changePct, reboundScore, lowerBaseLabel, slowRiseScore, danger, bottomRR, selloffScore }) {
  const dd = Number(drawdown20);
  const rr = Number(bottomRR);
  if ((dd <= -12 || bbPos <= -1.5) && reboundScore >= 18 && danger < 88) return { type: '急落後リバ型', label: '売られた後の反発確認' };
  if ((dd <= -12 || bbPos <= -1.5) && rr >= 2 && selloffScore >= 35) return { type: '高リスク反発型', label: '形は良いが材料確認必須' };
  if (slowRiseScore >= 45) return { type: '緩やか上昇型', label: '浅押し・下値確認' };
  if (lowerBaseLabel === '切り上げ') return { type: '下値切り上げ型', label: '下値維持を確認' };
  if (lowerBaseLabel === '安値更新中' && danger >= 78 && reboundScore < 12 && rr < 1.3) return { type: '構造悪化警戒型', label: '安値更新継続・触らない寄り' };
  if (lowerBaseLabel === '安値更新中') return { type: '安値更新型', label: '反発確認まで待ち' };
  return { type: '通常調整型', label: '材料と5分足確認' };
}

function calcBottomMetrics(closes, highs, lows, volumes, price, prev, boll, trend = {}) {
  const nums = closes.filter(Number.isFinite);
  const hs = highs.filter(Number.isFinite);
  const ls = lows.filter(Number.isFinite);
  const vs = volumes.filter(Number.isFinite);
  if (nums.length < 20 || !Number.isFinite(price)) return {};

  const ma5 = sma(nums, 5);
  const ma20 = sma(nums, 20);
  const ma60 = sma(nums, 60);
  const prevMa20 = nums.length >= 40 ? avg(nums.slice(-40, -20)) : null;
  const ma20Slope = prevMa20 ? pct(ma20, prevMa20) : null;
  const high20 = hs.slice(-20).reduce((a,b)=>Math.max(a,b), -Infinity);
  const low20 = ls.slice(-20).reduce((a,b)=>Math.min(a,b), Infinity);
  const low10 = ls.slice(-10).reduce((a,b)=>Math.min(a,b), Infinity);
  const low5 = ls.slice(-5).reduce((a,b)=>Math.min(a,b), Infinity);
  const prevLow5 = ls.slice(-10,-5).reduce((a,b)=>Math.min(a,b), Infinity);
  const low3 = ls.slice(-3).reduce((a,b)=>Math.min(a,b), Infinity);
  const prevLow3 = ls.slice(-6,-3).reduce((a,b)=>Math.min(a,b), Infinity);
  const vol20 = sma(vs, 20);
  const volume = vs.at(-1);
  const volumeRatio = vol20 ? volume / vol20 : null;
  const changePct = pct(price, prev);
  const drawdown20 = Number.isFinite(high20) ? pct(price, high20) : null;
  const bounceFromLow5 = Number.isFinite(low5) && low5 > 0 ? pct(price, low5) : null;
  const bbPos = boll?.bbPos;
  const priceModeInfo = classifyHistoricalPriceMode(nums, hs, ls, vs);

  // v15: 「買える/危険」ではなく、ユーザーの運用に合わせて
  // 下げきり候補 → 試し玉 → 戻りの強さ → 下値切り上げで選別、という軸に分ける。
  let selloffScore = 0;     // 売られ切り/試し玉余地
  let reboundScore = 0;     // 戻りの強さ
  let lowerBaseScore = 0;   // 下値切り上げ/安値更新停止
  let slowRiseScore = 0;    // 緩やか上昇/浅押し待ち
  let danger = 0;           // 触るなら条件を厳しくする要因

  const reasons = [];
  const reboundReasons = [];
  const dangerReasons = [];
  const slowRiseReasons = [];

  // 1. 売られ切り度。大きく売られているだけでは買いではないが、試し玉の入口にはなる。
  if (drawdown20 != null) {
    if (drawdown20 <= -25) { selloffScore += 34; danger += 10; reasons.push('20日高値から25%以上下落：大幅売られ'); }
    else if (drawdown20 <= -18) { selloffScore += 30; reasons.push('20日高値から18%以上下落'); }
    else if (drawdown20 <= -12) { selloffScore += 24; reasons.push('20日高値から12%以上下落'); }
    else if (drawdown20 <= -7) { selloffScore += 16; reasons.push('20日高値から7%以上下落'); }
    else if (drawdown20 <= -3) { selloffScore += 8; reasons.push('軽い調整'); }
  }

  if (bbPos != null) {
    if (bbPos <= -2.6) { selloffScore += 20; danger += 22; reasons.push('BB-2.6σ以下：投げ売り圏・反発確認必須'); }
    else if (bbPos <= -2.0) { selloffScore += 26; danger += 10; reasons.push('BB下限割れ：試し玉なら撤退厳守'); }
    else if (bbPos <= -1.5) { selloffScore += 26; reasons.push('-1.5σ付近：下げきり監視'); }
    else if (bbPos <= -1.0) { selloffScore += 18; reasons.push('-1σ付近：押し/下げ止まり確認'); }
    else if (bbPos <= -0.2) { selloffScore += 8; reasons.push('BB中心線下'); }
  }

  // 2. 戻りの強さ。買った後に残すか切るかを見る軸。
  if (changePct != null) {
    if (changePct > 5) { reboundScore += 32; reboundReasons.push('当日かなり強い反発'); }
    else if (changePct > 3) { reboundScore += 26; reboundReasons.push('当日強い反発'); }
    else if (changePct > 1) { reboundScore += 18; reboundReasons.push('当日プラスで反発'); }
    else if (changePct > 0) { reboundScore += 10; reboundReasons.push('小幅反発'); }
    else if (changePct <= -5) { danger += 24; dangerReasons.push('当日も5%以上下落'); }
    else if (changePct <= -3) { danger += 14; dangerReasons.push('当日も大きく下落'); }
  }
  if (bounceFromLow5 != null) {
    if (bounceFromLow5 >= 5) { reboundScore += 22; reboundReasons.push('直近安値から5%以上戻り'); }
    else if (bounceFromLow5 >= 3) { reboundScore += 14; reboundReasons.push('直近安値から戻り始め'); }
  }
  if (Number.isFinite(ma5) && price > ma5) { reboundScore += 12; reboundReasons.push('5日線を回復'); }
  if (Number.isFinite(ma20) && price > ma20) { reboundScore += 10; reboundReasons.push('20日線を回復'); }
  if (volumeRatio != null && changePct != null) {
    if (changePct > 0 && volumeRatio >= 1.2) { reboundScore += 14; reboundReasons.push('反発日に出来高増'); }
    if (changePct < -1 && volumeRatio >= 2.0) { danger += 20; dangerReasons.push('下落日に出来高急増：投げ/悪材料確認'); }
    else if (changePct < 0 && volumeRatio <= 0.85) { selloffScore += 8; reasons.push('薄商いの下落：売り枯れ候補'); }
  }

  // 3. 下値切り上げ。ユーザーの運用では最重要。
  let lowBaseLabel = '未判定';
  if (Number.isFinite(low5) && Number.isFinite(prevLow5) && prevLow5 > 0) {
    const lift = pct(low5, prevLow5);
    if (lift >= 1.0) { lowerBaseScore += 38; lowBaseLabel = '切り上げ'; reasons.push('直近安値が切り上げ'); }
    else if (lift >= -0.7) { lowerBaseScore += 24; lowBaseLabel = '横ばい'; reasons.push('安値更新が止まりつつある'); }
    else if (lift >= -2.0) { lowerBaseScore += 10; lowBaseLabel = '小幅更新'; danger += 8; dangerReasons.push('安値を小幅更新'); }
    else { lowBaseLabel = '安値更新中'; danger += 24; dangerReasons.push('直近安値を更新中'); }
  }
  if (Number.isFinite(low3) && Number.isFinite(prevLow3) && low3 > prevLow3) {
    lowerBaseScore += 10;
    reasons.push('短期安値も切り上げ');
  }
  if (lowBaseLabel === '安値更新中' && reboundScore >= 35) {
    danger = Math.max(0, danger - 8);
    dangerReasons.push('安値更新中だが反発あり：短期限定で監視');
  }

  // 4. 緩やか上昇/浅押し待ち。フィックスターズのような「安全押し目でも急騰でもない」形を拾う。
  if (Number.isFinite(ma20) && Number.isFinite(ma60) && ma20 > 0) {
    const nearMa20 = Math.abs((price - ma20) / ma20) < 0.06;
    const maOk = ma20 >= ma60 * 0.97;
    const notExtended = bbPos == null || bbPos < 1.6;
    if (lowBaseLabel === '切り上げ') { slowRiseScore += 24; slowRiseReasons.push('下値切り上げ'); }
    if (lowBaseLabel === '横ばい') { slowRiseScore += 12; slowRiseReasons.push('下値横ばい化'); }
    if (maOk) { slowRiseScore += 18; slowRiseReasons.push('中期線が崩れていない'); }
    if (nearMa20) { slowRiseScore += 18; slowRiseReasons.push('20日線近辺で浅押し'); }
    if (ma20Slope != null && ma20Slope >= -0.25) { slowRiseScore += 10; slowRiseReasons.push('20日線が急低下していない'); }
    if (changePct != null && changePct > -1.8 && changePct < 4.5) { slowRiseScore += 10; slowRiseReasons.push('急騰ではなく穏やかな値動き'); }
    if (volumeRatio != null && volumeRatio < 2.2) { slowRiseScore += 8; slowRiseReasons.push('過熱出来高ではない'); }
    if (!notExtended) { slowRiseScore -= 12; danger += 8; dangerReasons.push('BB上側に伸びすぎ：浅押し待ち'); }
  }

  // 5. 危険。否定ではなく、触るなら条件を厳しくするための表示。
  const trendKind = trend?.trendKind;
  if (trendKind === 'weak' && lowBaseLabel === '安値更新中') { danger += 16; dangerReasons.push('上昇シグナル弱く安値更新中'); }
  if (bbPos != null && bbPos <= -2.6) { danger += 10; dangerReasons.push('BB-2.6σ以下：ナイフ警戒'); }
  if (drawdown20 != null && drawdown20 <= -25 && reboundScore < 20) { danger += 16; dangerReasons.push('大幅下落後の戻りが弱い'); }
  if (trendKind === 'breakout' || trendKind === 'sustained') {
    danger = Math.max(0, danger - 10);
    slowRiseScore += 8;
    slowRiseReasons.push('順張りシグナルあり');
  }

  const rrEntry = price;
  const rrStop = Number.isFinite(low5) ? Math.min(low5, price * 0.985) : price * 0.97;
  const rrTarget = Number.isFinite(ma20) && ma20 > price ? ma20 : (boll?.bbMid && boll.bbMid > price ? boll.bbMid : (Number.isFinite(high20) ? high20 : price * 1.04));
  const risk = rrEntry - rrStop;
  const reward = rrTarget - rrEntry;
  const bottomRR = risk > 0 && reward > 0 ? reward / risk : null;
  let rrBonus = 0;
  if (bottomRR != null) {
    if (bottomRR >= 3) rrBonus = 14;
    else if (bottomRR >= 1.8) rrBonus = 8;
    else if (bottomRR < 0.8) rrBonus = -10;
  }

  selloffScore = Math.max(0, Math.min(100, Math.round(selloffScore)));
  reboundScore = Math.max(0, Math.min(100, Math.round(reboundScore)));
  lowerBaseScore = Math.max(0, Math.min(100, Math.round(lowerBaseScore)));
  slowRiseScore = Math.max(0, Math.min(100, Math.round(slowRiseScore)));
  danger = Math.max(0, Math.min(100, Math.round(danger)));

  // v15: bottomScore は「下落幅」ではなく、観察価値/試し玉価値に変更。
  // これにより、アルプスの反発初動・フィックスターズの緩やか上昇を対象外で捨てにくくする。
  const watchScore = Math.max(0, Math.min(100, Math.round(
    selloffScore * 0.35 + reboundScore * 0.45 + lowerBaseScore * 0.45 + slowRiseScore * 0.35 + rrBonus - danger * 0.30
  )));

  const shape = classifyBottomShape({ drawdown20, bbPos, changePct, reboundScore, lowerBaseLabel: lowBaseLabel, slowRiseScore, danger, bottomRR, selloffScore });

  // v16: 「危険=触るな」ではなく、下げきり運用向けに
  // 形状・短期RR・戻りの有無で、試し玉/反発確認/材料確認に分ける。
  let judge = '観察外';
  if (danger >= 92 && reboundScore < 12 && lowerBaseScore < 10 && slowRiseScore < 25 && (bottomRR == null || bottomRR < 1.3)) {
    judge = '触らない下落';
  } else if (danger >= 78 && bottomRR != null && bottomRR >= 2.0 && selloffScore >= 30) {
    judge = '高リスク反発監視';
  } else if (danger >= 70 && reboundScore >= 18 && bottomRR != null && bottomRR >= 1.2) {
    judge = '反発確認待ち';
  } else if (reboundScore >= 45 && danger < 82) judge = '戻り選別';
  else if (selloffScore >= 55 && reboundScore >= 15 && danger < 85) judge = '試し玉候補';
  else if (lowerBaseScore >= 34 && reboundScore >= 12 && danger < 82) judge = '下値切り上げ確認';
  else if (slowRiseScore >= 55 && danger < 78) judge = '浅押し待ち';
  else if (reboundScore >= 32 && danger < 85) judge = '短期リバ監視';
  else if (selloffScore >= 42 && lowBaseLabel !== '安値更新中') judge = '下げ止まり監視';
  else if (bottomRR != null && bottomRR >= 2.0 && (reboundScore >= 8 || lowerBaseScore >= 8 || slowRiseScore >= 25 || selloffScore >= 30)) judge = '材料確認監視';
  else if (slowRiseScore >= 38) judge = '緩やか上昇監視';
  else if (bottomRR != null && bottomRR >= 1.5 && selloffScore >= 22) judge = '条件付き観察';

  return {
    bottomScore: watchScore,
    selloffScore,
    reboundScore,
    lowerBaseScore,
    lowerBaseLabel: lowBaseLabel,
    slowRiseScore,
    bottomDangerScore: danger,
    bottomJudge: judge,
    bottomShapeType: shape.type,
    bottomShapeLabel: shape.label,
    ...priceModeInfo,
    bottomEntryPrice: yen(rrEntry),
    bottomStop: yen(rrStop),
    bottomTarget: yen(rrTarget),
    bottomRR: bottomRR ? Math.round(bottomRR * 100) / 100 : null,
    bottomReasons: [...new Set(reasons)].slice(0, 7),
    reboundReasons: [...new Set(reboundReasons)].slice(0, 5),
    slowRiseReasons: [...new Set(slowRiseReasons)].slice(0, 5),
    bottomDangerReasons: [...new Set(dangerReasons)].slice(0, 7),
  };
}


function assessQuoteQuality(q) {
  let danger = 0;
  const dangerReasons = [];
  let dropType = '通常調整';
  let materialSignal = '未確認';
  let supplySignal = '未取得';

  if (q.bbPos != null) {
    if (q.bbPos <= -2.5) {
      danger += 28;
      dangerReasons.push('BB-2.5σ以下：暴落圏・反発確認必須');
      dropType = '暴落/下限大幅割れ';
    } else if (q.bbPos <= -2) {
      danger += 18;
      dangerReasons.push('BB下限割れ：下落継続リスク');
      dropType = '急落/下限割れ';
    } else if (q.bbPos <= -1.5) {
      danger += 6;
      dangerReasons.push('-1.5σ近辺（標準押し目位置だが反発確認推奨）');
    }
  }

  if (q.changePct != null && q.changePct <= -5) { danger += 26; dangerReasons.push('当日5%以上下落'); dropType = '急落'; }
  else if (q.changePct != null && q.changePct <= -3) { danger += 16; dangerReasons.push('当日3%以上下落'); dropType = '大きめ下落'; }

  if (q.volumeRatio != null && q.changePct != null) {
    if (q.volumeRatio >= 2.5 && q.changePct <= -2) {
      danger += 32;
      dangerReasons.push('出来高2.5倍超の下落：機関売り/悪材料反応の強疑い');
      materialSignal = '材料/投げ売り強疑い';
    } else if (q.volumeRatio >= 2 && q.changePct < 0) {
      danger += 24;
      dangerReasons.push('出来高急増を伴う下落');
      materialSignal = '材料/投げ売り確認';
    } else if (q.volumeRatio >= 1.5 && q.changePct < 0) {
      danger += 14;
      dangerReasons.push('下落日に出来高増');
      materialSignal = '要確認';
    }
    if (q.changePct > 1 && q.volumeRatio >= 1.5) {
      danger = Math.max(0, danger - 10);
      materialSignal = '反発初動の出来高増';
    }
  }

  if (q.drawdown20 != null && q.drawdown20 <= -15) { danger += 18; dangerReasons.push('20日高値から15%以上下落'); dropType = 'トレンド悪化候補'; }
  else if (q.drawdown20 != null && q.drawdown20 <= -10) { danger += 10; dangerReasons.push('20日高値から10%以上下落'); }

  if (q.regime === 'downtrend') { danger += 28; dangerReasons.push('下降トレンド内：落ちるナイフ警戒'); dropType = '下降トレンド下落'; }
  else if (q.regime === 'transition') { danger += 18; dangerReasons.push('トレンド転換期：戻り売り警戒'); }
  else if (q.regime === 'uptrend_weak') { danger += 6; dangerReasons.push('上昇トレンド弱含み'); }

  if (q.predictedRR != null && q.predictedRR >= 2) danger = Math.max(0, danger - 8);
  if (q.predictedRR != null && q.predictedRR < 1) { danger += 10; dangerReasons.push('RR不足'); }

  const dangerScore = Math.max(0, Math.min(100, Math.round(danger)));
  let dangerLabel = '低';
  if (dangerScore >= 70) dangerLabel = '高';
  else if (dangerScore >= 45) dangerLabel = '中高';
  else if (dangerScore >= 25) dangerLabel = '中';

  let totalJudge = '様子見';
  if ((q.score || 0) >= 70 && dangerScore < 35 && q.predictedRR >= 1.5) totalJudge = '候補';
  else if ((q.score || 0) >= 70 && dangerScore >= 35) totalJudge = '反発確認';
  else if (dangerScore >= 70) totalJudge = '危険';
  else if ((q.score || 0) >= 45) totalJudge = '監視';
  else totalJudge = '対象外寄り';

  if (dangerReasons.length === 0) dangerReasons.push('明確な危険シグナルは限定的');
  return { dangerScore, dangerLabel, dangerReasons, dropType, materialSignal, supplySignal, totalJudge };
}

function assessTrendRegime(q) {
  const { price, ma20, ma60, ma20Slope } = q;
  if (!Number.isFinite(ma20) || !Number.isFinite(ma60) || !Number.isFinite(price)) {
    return { regime: 'unknown', multiplier: 0.6, label: 'トレンド情報不足' };
  }
  const above60 = price > ma60;
  const stacked = ma20 > ma60;
  const slope = Number.isFinite(ma20Slope) ? ma20Slope : 0;
  if (above60 && stacked && slope > 0) return { regime: 'uptrend', multiplier: 1.0, label: '上昇トレンド内（押し目候補対象）' };
  if (above60 && (stacked || slope > 0)) return { regime: 'uptrend_weak', multiplier: 0.75, label: '上昇トレンド弱含み（押し目候補だが慎重）' };
  if (!above60 && stacked) return { regime: 'transition', multiplier: 0.45, label: 'トレンド転換期（押し目対象外寄り）' };
  if (!above60 && !stacked && slope <= 0) return { regime: 'downtrend', multiplier: 0.15, label: '下降トレンド内（落ちるナイフ警戒）' };
  return { regime: 'sideways', multiplier: 0.6, label: 'レンジ（押し目妥当性は弱い）' };
}

function scoreQuote(q) {
  const regime = assessTrendRegime(q);
  let score = 0;
  const reasons = [];

  if (q.bbPos != null) {
    if (q.bbPos <= -2.5) { score += 6; reasons.push('BB-2.5σ以下：暴落圏・反発確認必須'); }
    else if (q.bbPos <= -2) { score += 10; reasons.push('BB下限割れ：押し目即買い不可・反発確認'); }
    else if (q.bbPos <= -1.5) { score += 30; reasons.push('-1.5σ前後：理想的な押し目位置'); }
    else if (q.bbPos <= -1) { score += 26; reasons.push('-1σ押し：標準押し目'); }
    else if (q.bbPos <= -0.3) { score += 14; reasons.push('中心線下の浅い押し'); }
    else if (q.bbPos <= 0) { score += 8; reasons.push('中心線付近'); }
  }

  if (q.drawdown20 != null) {
    if (q.drawdown20 <= -18) { score -= 12; reasons.push('20日高値から18%以上下落（崩れの疑い）'); }
    else if (q.drawdown20 <= -10) { score += 18; reasons.push('20日高値から10%以上下落'); }
    else if (q.drawdown20 <= -5) { score += 12; reasons.push('20日高値から5%以上下落'); }
    else if (q.drawdown20 <= -2) { score += 6; reasons.push('20日高値から2%以上下落'); }
  }

  if (q.volumeRatio != null && q.changePct != null) {
    if (q.volumeRatio >= 1.8 && q.changePct <= -1) {
      score -= 20;
      reasons.push('下落＋出来高急増：投げ売り/悪材料反応の可能性');
    } else if (q.volumeRatio <= 0.85 && q.changePct < 0 && q.changePct > -3) {
      score += 14;
      reasons.push('薄商いの下落：売り枯れ候補');
    }
    if (q.changePct > 0.5 && q.volumeRatio >= 1.3) {
      score += 18;
      reasons.push('反発＋出来高増：買い戻し初動');
    }
  }

  if (q.predictedRR != null) {
    if (q.predictedRR >= 2) { score += 18; reasons.push('予測RR 2倍以上'); }
    else if (q.predictedRR >= 1.3) { score += 10; reasons.push('予測RR 1.3倍以上'); }
    else if (q.predictedRR < 0.8) { score -= 10; reasons.push('RRが薄い'); }
  }

  if (q.changePct != null && q.changePct <= -3 && q.changePct > -7) { score += 6; reasons.push('当日大きめの下落'); }
  else if (q.changePct != null && q.changePct <= -7) { score -= 8; reasons.push('当日7%以上下落（崩れ警戒）'); }

  const rawScore = score;
  score = Math.round(score * regime.multiplier);
  reasons.unshift(`【トレンド】${regime.label}（係数 ${regime.multiplier}）`);

  return {
    score: Math.max(0, Math.min(100, score)),
    rawScore: Math.max(0, Math.min(100, Math.round(rawScore))),
    reasons,
    regime: regime.regime,
    regimeLabel: regime.label,
  };
}


async function fetchFundamentals(code) {
  const symbol = normalizeCode(code);
  const c = bareCode(symbol);
  const cacheKey = c;
  const cached = fundamentalCache.get(cacheKey);
  if (cached) return cached;
  const empty = { code: c, source: '未取得', status: 'unavailable', per: null, pbr: null, dividendYield: null, marketCap: null, marketCapLabel: null, beta: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, labels: { per: '未取得', pbr: '未取得', dividend: '未取得' }, note: 'ファンダ参考値を取得できませんでした' };
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const data = await fetchJsonSmart(url, 7000, 1, 8000);
    const q = data?.quoteResponse?.result?.[0] || {};
    const per = Number.isFinite(Number(q.trailingPE)) ? Math.round(Number(q.trailingPE) * 10) / 10 : null;
    const pbr = Number.isFinite(Number(q.priceToBook)) ? Math.round(Number(q.priceToBook) * 100) / 100 : null;
    const divRaw = Number(q.trailingAnnualDividendYield ?? q.dividendYield);
    const dividendYield = Number.isFinite(divRaw) ? Math.round((divRaw > 1 ? divRaw : divRaw * 100) * 100) / 100 : null;
    const marketCap = Number.isFinite(Number(q.marketCap)) ? Number(q.marketCap) : null;
    const beta = Number.isFinite(Number(q.beta)) ? Math.round(Number(q.beta) * 100) / 100 : null;
    const result = {
      code: c,
      source: 'Yahoo quote参考値',
      status: (per || pbr || dividendYield || marketCap) ? 'ok' : 'partial',
      per, pbr, dividendYield, marketCap,
      marketCapLabel: humanMarketCap(marketCap),
      beta,
      fiftyTwoWeekHigh: Number.isFinite(Number(q.fiftyTwoWeekHigh)) ? yen(q.fiftyTwoWeekHigh) : null,
      fiftyTwoWeekLow: Number.isFinite(Number(q.fiftyTwoWeekLow)) ? yen(q.fiftyTwoWeekLow) : null,
      labels: { per: ratioLabel(per, 'per'), pbr: ratioLabel(pbr, 'pbr'), dividend: ratioLabel(dividendYield, 'yield') },
      note: '非公式Yahooデータの参考値。更新遅延・欠損あり。最終判断は決算短信/会社IRで確認。',
      fetchedAt: new Date().toISOString(),
    };
    fundamentalCache.set(cacheKey, result);
    return result;
  } catch(e) {
    const result = { ...empty, error: e.message, fetchedAt: new Date().toISOString() };
    fundamentalCache.set(cacheKey, result);
    return result;
  }
}


function nval(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function addUnique(arr, item) { if (item && !arr.includes(item)) arr.push(item); }
function clamp100(x) { return Math.max(0, Math.min(100, Math.round(x || 0))); }
function scaleRange(value, start, end, maxPoints) {
  const v = Math.abs(Number(value) || 0);
  if (v <= start) return 0;
  if (v >= end) return maxPoints;
  return Math.round(((v - start) / (end - start)) * maxPoints);
}
function countRecentDownDays(closes, lookback = 5) {
  const nums = (closes || []).filter(Number.isFinite).slice(-(lookback + 1));
  if (nums.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) count++;
  return count;
}
function calcAtrPct(highs = [], lows = [], closes = [], n = 14) {
  const len = Math.min(highs.length, lows.length, closes.length);
  const trs = [];
  for (let i = Math.max(1, len - n - 1); i < len; i++) {
    const h = Number(highs[i]), l = Number(lows[i]), pc = Number(closes[i - 1]);
    if ([h, l, pc].every(Number.isFinite) && pc > 0) {
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
  }
  const last = Number(closes[len - 1]);
  if (!trs.length || !Number.isFinite(last) || last <= 0) return null;
  return (avg(trs) / last) * 100;
}
function calcVolatilityContext(closes = [], highs = [], lows = [], price = null) {
  const nums = (closes || []).filter(Number.isFinite);
  const hs = (highs || []).filter(Number.isFinite);
  const last = Number(price ?? nums.at(-1));
  const last60 = nums.slice(-60);
  const ma60 = last60.length >= 20 ? avg(last60) : null;
  const sd60 = last60.length >= 20 ? std(last60) : null;
  const z60 = (Number.isFinite(last) && Number.isFinite(ma60) && Number.isFinite(sd60) && sd60 > 0) ? Math.round(((last - ma60) / sd60) * 100) / 100 : null;

  // v34: エムスリー型の「じりじり長期調整」は60日平均との差だけでは弱く見えるため、
  // 1年平均との差・52週高値からの下落率も持たせる。
  const last250 = nums.slice(-250);
  const ma250 = last250.length >= 80 ? avg(last250) : null;
  const sd250 = last250.length >= 80 ? std(last250) : null;
  const z250 = (Number.isFinite(last) && Number.isFinite(ma250) && Number.isFinite(sd250) && sd250 > 0) ? Math.round(((last - ma250) / sd250) * 100) / 100 : null;
  const high52 = hs.slice(-252).reduce((a, b) => Math.max(a, b), -Infinity);
  const drawdown52 = Number.isFinite(high52) && high52 > 0 && Number.isFinite(last) ? Math.round(pct(last, high52) * 100) / 100 : null;

  const atrPct = calcAtrPct(highs, lows, closes, 14);
  return {
    z60,
    z250,
    drawdown52,
    atrPct: atrPct == null ? null : Math.round(atrPct * 100) / 100,
    downDays5: countRecentDownDays(closes, 5)
  };
}

function buildStateTags(q) {
  const tags = [];
  const actionTags = [];
  const constraintTags = [];
  const reasons = [];

  const trendScore = nval(q.trendScore) || 0;
  const trendDanger = nval(q.trendDangerScore) || 0;
  const bottomScore = nval(q.bottomScore) || 0;
  const reboundScore = nval(q.reboundScore) || 0;
  const lowerBaseScore = nval(q.lowerBaseScore) || 0;
  const slowRiseScore = nval(q.slowRiseScore) || 0;
  const danger = nval(q.bottomDangerScore) || nval(q.dangerScore) || 0;
  const dd = nval(q.drawdown20);
  const cp = nval(q.changePct);
  const bb = nval(q.bbPos);
  const rr = nval(q.bottomRR) ?? nval(q.predictedRR);
  const per = nval(q.per ?? q?.fundamental?.per);
  const div = nval(q.dividendYield ?? q?.fundamental?.dividendYield);
  const marketCap = nval(q.marketCap ?? q?.fundamental?.marketCap);
  const volRatio = nval(q.volumeRatio);
  const regime = q.regime;
  const trendKind = q.trendKind;
  const bottomShape = q.bottomShapeType || '';
  const lowerLabel = q.lowerBaseLabel || '';
  const code = String(q.code || '');

  // --- 補助タグ：詳細確認用。一覧では主判定/理由/注意に畳む ---
  if (trendKind === 'breakout') addUnique(tags, 'ブレイク初動');
  if (trendKind === 'sustained') addUnique(tags, '持続上昇');
  if (trendKind === 'sustained_extended') addUnique(tags, '上昇中の乖離拡大');
  if (trendKind === 'recovering') addUnique(tags, '反転初動');
  if (regime === 'uptrend' && dd != null && dd <= -7) addUnique(tags, '上昇中の深押し');
  if ((regime === 'transition' || trendKind === 'recovering') && slowRiseScore >= 35) addUnique(tags, '下降抜け候補');
  if (slowRiseScore >= 45) addUnique(tags, '緩やか上昇');
  if (lowerLabel === '切り上げ') addUnique(tags, '下値切り上げ');
  if (lowerLabel === '横ばい') addUnique(tags, '下値横ばい');
  if (lowerLabel === '安値更新中') addUnique(tags, '安値更新中');
  if (q.priceMode && q.priceMode !== '通常推移' && q.priceMode !== '判定不足') addUnique(tags, q.priceMode);
  if (dd != null && dd <= -18) addUnique(tags, '大幅売られ');
  else if (dd != null && dd <= -10) addUnique(tags, '深押し');
  else if (dd != null && dd <= -5) addUnique(tags, '通常押し');
  if (bb != null && bb <= -2) addUnique(tags, 'BB下限割れ');
  else if (bb != null && bb <= -1.2) addUnique(tags, 'BB下側');
  if (cp != null && cp <= -5) addUnique(tags, '急落');
  if (volRatio != null && cp != null && cp < 0 && volRatio >= 1.8) addUnique(tags, '投げ売り候補');
  if (reboundScore >= 35) addUnique(tags, '戻り確認');
  else if (reboundScore >= 18) addUnique(tags, '戻り始め');

  // --- 悪材料深刻度・健全度・歪み仮説 ---
  let healthScore = 50;
  let materialSeverity = 38;
  let expectationGapScore = 0;
  if (div != null && div >= 2.5) healthScore += 8;
  if (q.marketCapLabel) healthScore += 4;
  if (/触らない|構造悪化/.test(q.bottomJudge || '') || /構造悪化/.test(bottomShape)) materialSeverity += 30;
  if (/材料確認|高リスク/.test(q.bottomJudge || '')) materialSeverity += 14;
  if (volRatio != null && cp != null && cp < 0 && volRatio >= 2.5) materialSeverity += 12;
  if (reboundScore >= 30) materialSeverity -= 8;
  if (lowerLabel === '切り上げ') materialSeverity -= 8;

  // 期待値調整の仮説：ハードコードではなく、
  // 高PER/大型/急落/悪材料深刻度が低め、という組み合わせで一般化する。
  if (per != null && per >= 25 && dd != null && dd <= -7) expectationGapScore += 22;
  if (per != null && per >= 40 && dd != null && dd <= -5) expectationGapScore += 10;
  if (marketCap != null && marketCap >= 1000000000000 && dd != null && dd <= -7 && materialSeverity < 75) expectationGapScore += 18; // 時価総額1兆円以上
  else if (marketCap != null && marketCap >= 300000000000 && dd != null && dd <= -7 && materialSeverity < 75) expectationGapScore += 10; // 3000億円以上
  if (dd != null && dd <= -12 && materialSeverity < 75) expectationGapScore += 12;

  materialSeverity = clamp100(materialSeverity);
  healthScore = clamp100(healthScore);
  expectationGapScore = clamp100(expectationGapScore);

  // 信用需給の履歴が渡ってきた場合は、材料深刻度・制約タグに反映する。
  const creditOverhang = q.creditOverhang || q.creditSupply?.overhang || null;
  if (creditOverhang?.overhang) {
    materialSeverity = clamp100(materialSeverity + 12);
    addUnique(constraintTags, '信用需給重い');
    reasons.push(creditOverhang.reason || '買残が複数週で積み上がり：戻り売り注意');
  }
  if (creditOverhang?.clearing) {
    materialSeverity = clamp100(materialSeverity - 6);
    addUnique(actionTags, '信用整理進行');
  }
  if (creditOverhang?.shortBuild) addUnique(actionTags, '売残増加');

  // v33: 歪みは閾値の単純加点ではなく、下落規模・銘柄固有ボラ・持続性・セクター相対を連続評価する。
  const z60 = nval(q.z60);
  const z250 = nval(q.z250);
  const drawdown52 = nval(q.drawdown52);
  const atrPct = nval(q.atrPct);
  const sectorRel = nval(q.sectorRelativeChange);
  const downDays5 = nval(q.downDays5) || 0;
  const ddPoints = dd != null && dd < 0 ? scaleRange(dd, 5, 30, 28) : 0;
  const cpPoints = cp != null && cp < 0 ? scaleRange(cp, 1.5, 10, 12) : 0;
  const zPoints = z60 != null && z60 < 0 ? scaleRange(z60, 1.2, 3.2, 18) : 0;
  const z250Points = z250 != null && z250 < 0 ? scaleRange(z250, 1.0, 3.5, 16) : 0;
  const drawdown52Points = drawdown52 != null && drawdown52 < 0 ? scaleRange(drawdown52, 12, 45, 18) : 0;
  const atrPoints = (atrPct != null && cp != null && cp < 0) ? scaleRange(Math.abs(cp) / Math.max(atrPct, 0.4), 1.2, 3.2, 12) : 0;
  const durationPoints = downDays5 > 0 ? scaleRange(downDays5, 1, 5, 12) : 0;
  const sectorPoints = sectorRel != null && sectorRel < 0 ? scaleRange(sectorRel, 2, 18, 16) : 0;
  let distortionScore = ddPoints + cpPoints + zPoints + z250Points + drawdown52Points + atrPoints + durationPoints + sectorPoints;
  if (bb != null && bb <= -1.5) distortionScore += 8;
  if (rr != null && rr >= 1.8) distortionScore += 10;
  if (reboundScore >= 18) distortionScore += 8;
  if (lowerLabel === '切り上げ' || lowerLabel === '横ばい') distortionScore += 8;
  if (expectationGapScore >= 25) distortionScore += 14;
  if (materialSeverity >= 75) distortionScore -= 18;
  distortionScore = clamp100(distortionScore);
  const distortionParts = { ddPoints, cpPoints, zPoints, z250Points, drawdown52Points, atrPoints, durationPoints, sectorPoints };

  if (expectationGapScore >= 25) {
    addUnique(tags, '期待値調整疑い');
    reasons.push('業績悪化ではなく、期待値・コンセンサス差で売られた可能性を確認');
  }
  if (distortionScore >= 55 && materialSeverity < 75) addUnique(tags, '歪み大候補');
  else if (distortionScore >= 38) addUnique(tags, '歪み中候補');

  // --- 4分類別スコア ---
  const upScore = clamp100(
    trendScore * 0.85 +
    slowRiseScore * 0.35 +
    (trendKind === 'breakout' ? 18 : 0) +
    (trendKind === 'sustained' ? 18 : 0) +
    (trendKind === 'recovering' ? 12 : 0) -
    trendDanger * 0.45
  );

  const trialScore = clamp100(
    bottomScore * 0.75 +
    reboundScore * 0.45 +
    lowerBaseScore * 0.25 +
    (rr != null && rr >= 1.5 ? 14 : 0) -
    Math.max(0, materialSeverity - 62) * 0.45
  );

  const distortionClassScore = clamp100(
    distortionScore * 0.85 +
    healthScore * 0.25 +
    expectationGapScore * 0.35 -
    Math.max(0, materialSeverity - 65) * 0.45
  );

  const avoidScore = clamp100(
    materialSeverity * 0.9 +
    (regime === 'downtrend' && reboundScore < 18 ? 18 : 0) +
    (lowerLabel === '安値更新中' ? 12 : 0) -
    (rr != null && rr >= 1.8 ? 8 : 0)
  );

  // 価格行動型の補正：だらだら下げは試し玉・歪みを弱め、振れ幅下降/底ばいは観察に残しやすくする。
  const priceMode = q.priceMode || '';
  if (priceMode === 'だらだら下げ型') {
    materialSeverity = clamp100(materialSeverity + 8);
  }
  if (priceMode === '振れ幅のある下降型' && reboundScore >= 12) {
    addUnique(actionTags, '反発幅あり');
  }
  if (priceMode === '底ばい型') {
    addUnique(actionTags, '売り枯れ確認');
  }

  // --- 主判定は4分類に畳む ---
  let stateKind = 'watch';
  let statePrimary = '観察';
  let stateReason = '材料確認';
  let stateCaution = '小ロット/条件確認';

  // 回避は本当に悪材料深刻かつ戻り・RRが弱い場合に限定。危険だけでは除外しない。
  const trueAvoid = avoidScore >= 78 && reboundScore < 18 && (rr == null || rr < 1.4) && materialSeverity >= 78;
  const distortionGuard = distortionScore >= 50 && expectationGapScore >= 25;
  if (trueAvoid && !distortionGuard) {
    stateKind = 'avoid'; statePrimary = '回避';
    stateReason = /構造悪化/.test(bottomShape) ? '事業悪化' : '悪材料深刻';
    stateCaution = '反発しても短期のみ';
  } else if (trueAvoid && distortionGuard) {
    stateKind = 'distortion'; statePrimary = '歪み';
    stateReason = '回避基準だが期待値調整';
    stateCaution = '小ロット/反発確認';
  } else if (distortionClassScore >= Math.max(upScore, trialScore) && distortionClassScore >= 42) {
    stateKind = 'distortion'; statePrimary = '歪み';
    if (expectationGapScore >= 25) stateReason = '期待値調整';
    else if (dd != null && dd <= -10) stateReason = '過剰反応';
    else stateReason = '材料確認';
    stateCaution = materialSeverity >= 65 ? '反発確認' : (code === '8801' ? '決算跨ぎ' : '戻り売り');
  } else if (trialScore >= upScore && trialScore >= 35) {
    stateKind = 'trial'; statePrimary = '試し玉';
    if (cp != null && cp <= -5) stateReason = '急落後反発';
    else if (reboundScore >= 30) stateReason = '戻り確認';
    else if (lowerLabel === '切り上げ' || lowerLabel === '横ばい') stateReason = '下げ止まり';
    else stateReason = '売られすぎ';
    stateCaution = q.bottomStop ? `撤退 ${q.bottomStop}` : '前日安値割れ';
  } else if (upScore >= 35) {
    stateKind = 'trend'; statePrimary = '上昇継続';
    if (trendKind === 'breakout') stateReason = 'ブレイク初動';
    else if (trendKind === 'recovering') stateReason = '反転初動';
    else if (trendKind === 'sustained_extended') stateReason = '浅押し待ち';
    else if (slowRiseScore >= 45) stateReason = '緩やか上昇';
    else stateReason = '持続上昇';
    stateCaution = trendDanger >= 55 ? '高値掴み' : '押し目待ち';
  } else {
    stateKind = 'watch'; statePrimary = '観察';
    stateReason = rr != null && rr >= 1.5 ? 'RR確認' : '材料確認';
    stateCaution = '条件不足';
  }

  // 詳細用の補助タグは残すが、一覧では出しすぎない。
  if (stateKind === 'trend') {
    addUnique(actionTags, stateReason);
    if (stateCaution) addUnique(constraintTags, stateCaution);
  } else if (stateKind === 'trial') {
    addUnique(actionTags, '試し玉候補');
    if (stateReason !== '売られすぎ') addUnique(actionTags, stateReason);
    addUnique(constraintTags, stateCaution);
  } else if (stateKind === 'distortion') {
    addUnique(actionTags, '歪み確認');
    addUnique(actionTags, stateReason);
    addUnique(constraintTags, stateCaution);
  } else if (stateKind === 'avoid') {
    addUnique(constraintTags, '触らない');
  }
  if (volRatio != null && cp != null && cp < 0 && volRatio >= 1.8) addUnique(constraintTags, '出来高投げ確認');
  if (materialSeverity >= 70) addUnique(constraintTags, '材料確認必須');

  const stateScore = clamp100(
    Math.max(upScore, trialScore, distortionClassScore) - (stateKind === 'avoid' ? 20 : 0)
  );

  return {
    stateScore,
    statePrimary,
    stateKind,
    stateReason,
    stateCaution,
    stateTags: tags.slice(0, 6),
    stateActions: actionTags.slice(0, 4),
    stateConstraints: constraintTags.slice(0, 4),
    distortionScore,
    healthScore,
    materialSeverity,
    expectationGapScore,
    distortionParts,
    volatilityContext: { z60, z250, drawdown52, atrPct, downDays5, sectorRelativeChange: q.sectorRelativeChange ?? null, sectorChangeMedian: q.sectorChangeMedian ?? null },
    classScores: { trend: upScore, trial: trialScore, distortion: distortionClassScore, avoid: avoidScore },
    stateReasons: reasons.slice(0, 5),
  };
}

async function fetchYahooQuote(code, options = {}) {
  const symbol = normalizeCode(code);
  const c = bareCode(symbol);
  const withFundamental = options.withFundamental !== false;
  const cacheKey = withFundamental ? c : `${c}:scan-fast`;
  const cached = quoteCacheV11.get(cacheKey);
  if (cached) return cached;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`;
  const data = await fetchJsonSmart(url, 8000, 1, 0);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('価格データを取得できませんでした');

  const meta = result.meta || {};
  const q = result.indicators?.quote?.[0] || {};
  const closes = (q.close || []).filter(Number.isFinite);
  const volumes = (q.volume || []).filter(Number.isFinite);
  const highs = (q.high || []).filter(Number.isFinite);
  const lows = (q.low || []).filter(Number.isFinite);
  const price = closes.at(-1) ?? meta.regularMarketPrice;
  const prev = closes.at(-2) ?? meta.chartPreviousClose;
  const vol20 = sma(volumes, 20);
  const volume = volumes.at(-1) ?? meta.regularMarketVolume;
  const changePct = pct(price, prev);
  const jp = withFundamental ? await getJapaneseName(c, meta.shortName || meta.longName || symbol) : cleanJapaneseName(meta.shortName || meta.longName || symbol, c);
  const boll = calcBollinger(closes, highs, lows, price);
  const trend = calcTrendMetrics(closes, highs, lows, volumes, price, prev, boll);
  const bottom = calcBottomMetrics(closes, highs, lows, volumes, price, prev, boll, trend);
  const fundamental = withFundamental ? await fetchFundamentals(c) : null;
  const volatility = calcVolatilityContext(closes, highs, lows, price);
  const quote = {
    code: c, symbol,
    name: jp,
    fundamental,
    per: fundamental?.per ?? null, pbr: fundamental?.pbr ?? null, dividendYield: fundamental?.dividendYield ?? null, marketCap: fundamental?.marketCap ?? null, marketCapLabel: fundamental?.marketCapLabel ?? null,
    price: yen(price), prevClose: yen(prev), change: yen(price - prev),
    changePct: changePct == null ? null : Math.round(changePct * 100) / 100,
    volume, volumeAvg20: vol20 ? Math.round(vol20) : null,
    volumeRatio: vol20 ? Math.round((volume / vol20) * 100) / 100 : null,
    closes60: closes.slice(-60).map((v) => yen(v)),
    ...volatility,
    ...boll,
    ...trend,
    ...bottom,
    fetchedAt: new Date().toISOString(),
  };
  let creditSupply = null;
  let creditOverhang = null;
  try {
    const localHistory = await loadLocalCreditHistory(c);
    if (localHistory?.length) {
      const historyWithPrice = attachWeekPriceChangesToCreditHistory(localHistory, result.timestamp || [], q.close || []);
      creditOverhang = creditOverhangFromHistory(historyWithPrice);
      creditSupply = { latest: historyWithPrice.at(-1), history: historyWithPrice.slice(-8), overhang: creditOverhang, source: 'local-credit-history' };
    }
  } catch {}
  if (creditSupply) quote.creditSupply = creditSupply;
  if (creditOverhang) quote.creditOverhang = creditOverhang;

  const scored = { ...quote, ...scoreQuote(quote) };
  const quality = { ...scored, ...assessQuoteQuality(scored) };
  const finalQuote = { ...quality, ...buildStateTags(quality) };
  quoteCacheV11.set(cacheKey, finalQuote);
  return finalQuote;
}

async function resolveInput(raw) {
  const q = String(raw || '').trim();
  if (!q) throw new Error('コードまたは銘柄名を入力してください');
  const codeLike = bareCode(q);
  const localByCode = localSymbol(codeLike);
  if (/^[0-9]{4}[A-Z]?$/.test(codeLike)) {
    try {
      const quote = await fetchYahooQuote(codeLike);
      return { code: quote.code, name: await getJapaneseName(quote.code, quote.name || localByCode?.name || codeLike), sector: localByCode?.sector || '' };
    } catch {
      return { code: codeLike, name: await getJapaneseName(codeLike, localByCode?.name || codeLike), sector: localByCode?.sector || '' };
    }
  }
  const key = compactText(q);
  const localByName = LOCAL_SYMBOLS.find((x) => compactText(x.name).includes(key) || key.includes(compactText(x.name)));
  if (localByName) return localByName;

  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true&region=JP&lang=ja-JP`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 oshime-dashboard' } });
  if (!res.ok) throw new Error(`銘柄検索に失敗しました Yahoo ${res.status}`);
  const data = await res.json();
  const candidates = (data?.quotes || []).filter((x) => String(x.symbol || '').endsWith('.T'));
  if (!candidates.length) throw new Error(`「${q}」に一致する日本株が見つかりませんでした。コードで入力してください。`);
  const best = candidates[0];
  const code = bareCode(best.symbol);
  const local = localSymbol(code);
  return { code, name: await getJapaneseName(code, local?.name || best.shortname || best.longname || code), sector: local?.sector || best.sector || '' };
}


function stripTags(raw) {
  return decodeHtmlEntity(String(raw || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

const NIKKEI225_STATIC = [
  { code: '4151', name: '協和キリン', sector: '日経225' },
  { code: '4502', name: '武田', sector: '日経225' },
  { code: '4503', name: 'アステラス', sector: '日経225' },
  { code: '4506', name: '住友ファーマ', sector: '日経225' },
  { code: '4507', name: '塩野義', sector: '日経225' },
  { code: '4519', name: '中外薬', sector: '日経225' },
  { code: '4523', name: 'エーザイ', sector: '日経225' },
  { code: '4568', name: '第一三共', sector: '日経225' },
  { code: '4578', name: '大塚HD', sector: '日経225' },
  { code: '285A', name: 'キオクシア', sector: '日経225' },
  { code: '4062', name: 'イビデン', sector: '日経225' },
  { code: '6479', name: 'ミネベア', sector: '日経225' },
  { code: '6501', name: '日立', sector: '日経225' },
  { code: '6503', name: '三菱電', sector: '日経225' },
  { code: '6504', name: '富士電機', sector: '日経225' },
  { code: '6506', name: '安川電', sector: '日経225' },
  { code: '6526', name: 'ソシオネクスト', sector: '日経225' },
  { code: '6645', name: 'オムロン', sector: '日経225' },
  { code: '6701', name: 'NEC', sector: '日経225' },
  { code: '6702', name: '富士通', sector: '日経225' },
  { code: '6723', name: 'ルネサス', sector: '日経225' },
  { code: '6724', name: 'エプソン', sector: '日経225' },
  { code: '6752', name: 'パナHD', sector: '日経225' },
  { code: '6753', name: 'シャープ', sector: '日経225' },
  { code: '6758', name: 'ソニーG', sector: '日経225' },
  { code: '6762', name: 'TDK', sector: '日経225' },
  { code: '6770', name: 'アルプスアル', sector: '日経225' },
  { code: '6841', name: '横河電', sector: '日経225' },
  { code: '6857', name: 'アドテスト', sector: '日経225' },
  { code: '6861', name: 'キーエンス', sector: '日経225' },
  { code: '6902', name: 'デンソー', sector: '日経225' },
  { code: '6920', name: 'レーザーテク', sector: '日経225' },
  { code: '6954', name: 'ファナック', sector: '日経225' },
  { code: '6963', name: 'ローム', sector: '日経225' },
  { code: '6971', name: '京セラ', sector: '日経225' },
  { code: '6976', name: '太陽誘電', sector: '日経225' },
  { code: '6981', name: '村田製', sector: '日経225' },
  { code: '7735', name: 'スクリン', sector: '日経225' },
  { code: '7751', name: 'キヤノン', sector: '日経225' },
  { code: '7752', name: 'リコー', sector: '日経225' },
  { code: '8035', name: '東エレク', sector: '日経225' },
  { code: '543A', name: 'ARCHIO', sector: '日経225' },
  { code: '7201', name: '日産自', sector: '日経225' },
  { code: '7202', name: 'いすゞ', sector: '日経225' },
  { code: '7203', name: 'トヨタ', sector: '日経225' },
  { code: '7211', name: '三菱自', sector: '日経225' },
  { code: '7261', name: 'マツダ', sector: '日経225' },
  { code: '7267', name: 'ホンダ', sector: '日経225' },
  { code: '7269', name: 'スズキ', sector: '日経225' },
  { code: '7270', name: 'SUBARU', sector: '日経225' },
  { code: '7272', name: 'ヤマハ発', sector: '日経225' },
  { code: '4543', name: 'テルモ', sector: '日経225' },
  { code: '4902', name: 'コニカミノルタ', sector: '日経225' },
  { code: '6146', name: 'ディスコ', sector: '日経225' },
  { code: '7731', name: 'ニコン', sector: '日経225' },
  { code: '7733', name: 'オリンパス', sector: '日経225' },
  { code: '7741', name: 'HOYA', sector: '日経225' },
  { code: '9432', name: 'NTT', sector: '日経225' },
  { code: '9433', name: 'KDDI', sector: '日経225' },
  { code: '9434', name: 'SB', sector: '日経225' },
  { code: '9984', name: 'SBG', sector: '日経225' },
  { code: '5831', name: 'しずおかFG', sector: '日経225' },
  { code: '7186', name: '横浜FG', sector: '日経225' },
  { code: '8304', name: 'あおぞら銀', sector: '日経225' },
  { code: '8306', name: '三菱UFJ', sector: '日経225' },
  { code: '8308', name: 'りそなHD', sector: '日経225' },
  { code: '8309', name: '三井住友トラ', sector: '日経225' },
  { code: '8316', name: '三井住友FG', sector: '日経225' },
  { code: '8331', name: '千葉銀', sector: '日経225' },
  { code: '8354', name: 'ふくおかFG', sector: '日経225' },
  { code: '8411', name: 'みずほFG', sector: '日経225' },
  { code: '8253', name: 'クレセゾン', sector: '日経225' },
  { code: '8591', name: 'オリックス', sector: '日経225' },
  { code: '8697', name: '日本取引所', sector: '日経225' },
  { code: '8601', name: '大和', sector: '日経225' },
  { code: '8604', name: '野村', sector: '日経225' },
  { code: '8630', name: 'SOMPO', sector: '日経225' },
  { code: '8725', name: 'MS&AD', sector: '日経225' },
  { code: '8750', name: '第一ライフ', sector: '日経225' },
  { code: '8766', name: '東京海上', sector: '日経225' },
  { code: '8795', name: 'T&D', sector: '日経225' },
  { code: '1332', name: 'ニッスイ', sector: '日経225' },
  { code: '2002', name: '日清粉G', sector: '日経225' },
  { code: '2269', name: '明治HD', sector: '日経225' },
  { code: '2282', name: '日ハム', sector: '日経225' },
  { code: '2501', name: 'サッポロHD', sector: '日経225' },
  { code: '2502', name: 'アサヒ', sector: '日経225' },
  { code: '2503', name: 'キリンHD', sector: '日経225' },
  { code: '2801', name: 'キッコマン', sector: '日経225' },
  { code: '2802', name: '味の素', sector: '日経225' },
  { code: '2871', name: 'ニチレイ', sector: '日経225' },
  { code: '2914', name: 'JT', sector: '日経225' },
  { code: '3086', name: 'Jフロント', sector: '日経225' },
  { code: '3092', name: 'ZOZO', sector: '日経225' },
  { code: '3099', name: '三越伊勢丹', sector: '日経225' },
  { code: '3382', name: 'セブン＆アイ', sector: '日経225' },
  { code: '7453', name: '良品計画', sector: '日経225' },
  { code: '7532', name: 'パンパシHD', sector: '日経225' },
  { code: '8233', name: '高島屋', sector: '日経225' },
  { code: '8252', name: '丸井G', sector: '日経225' },
  { code: '8267', name: 'イオン', sector: '日経225' },
  { code: '9843', name: 'ニトリHD', sector: '日経225' },
  { code: '9983', name: 'ファストリ', sector: '日経225' },
  { code: '2413', name: 'エムスリー', sector: '日経225' },
  { code: '2432', name: 'ディーエヌエ', sector: '日経225' },
  { code: '3659', name: 'ネクソン', sector: '日経225' },
  { code: '3697', name: 'SHIFT', sector: '日経225' },
  { code: '4307', name: '野村総研', sector: '日経225' },
  { code: '4324', name: '電通グループ', sector: '日経225' },
  { code: '4385', name: 'メルカリ', sector: '日経225' },
  { code: '4661', name: 'OLC', sector: '日経225' },
  { code: '4689', name: 'ラインヤフー', sector: '日経225' },
  { code: '4704', name: 'トレンド', sector: '日経225' },
  { code: '4751', name: 'サイバー', sector: '日経225' },
  { code: '4755', name: '楽天グループ', sector: '日経225' },
  { code: '6098', name: 'リクルート', sector: '日経225' },
  { code: '6178', name: '日本郵政', sector: '日経225' },
  { code: '6532', name: 'ベイカレント', sector: '日経225' },
  { code: '7974', name: '任天堂', sector: '日経225' },
  { code: '9602', name: '東宝', sector: '日経225' },
  { code: '9735', name: 'セコム', sector: '日経225' },
  { code: '9766', name: 'コナミG', sector: '日経225' },
  { code: '1605', name: 'INPEX', sector: '日経225' },
  { code: '3401', name: '帝人', sector: '日経225' },
  { code: '3402', name: '東レ', sector: '日経225' },
  { code: '3861', name: '王子HD', sector: '日経225' },
  { code: '3405', name: 'クラレ', sector: '日経225' },
  { code: '3407', name: '旭化成', sector: '日経225' },
  { code: '4004', name: 'レゾナック', sector: '日経225' },
  { code: '4005', name: '住友化', sector: '日経225' },
  { code: '4021', name: '日産化', sector: '日経225' },
  { code: '4042', name: '東ソー', sector: '日経225' },
  { code: '4043', name: 'トクヤマ', sector: '日経225' },
  { code: '4061', name: 'デンカ', sector: '日経225' },
  { code: '4063', name: '信越化', sector: '日経225' },
  { code: '4183', name: '三井化学', sector: '日経225' },
  { code: '4188', name: '三菱ケミG', sector: '日経225' },
  { code: '4208', name: 'UBE', sector: '日経225' },
  { code: '4452', name: '花王', sector: '日経225' },
  { code: '4901', name: '富士フイルム', sector: '日経225' },
  { code: '4911', name: '資生堂', sector: '日経225' },
  { code: '6988', name: '日東電', sector: '日経225' },
  { code: '5019', name: '出光興産', sector: '日経225' },
  { code: '5020', name: 'ENEOS', sector: '日経225' },
  { code: '5101', name: '浜ゴム', sector: '日経225' },
  { code: '5108', name: 'ブリヂストン', sector: '日経225' },
  { code: '5201', name: 'AGC', sector: '日経225' },
  { code: '5214', name: '日電硝', sector: '日経225' },
  { code: '5233', name: '太平洋セメ', sector: '日経225' },
  { code: '5301', name: '東海カーボン', sector: '日経225' },
  { code: '5332', name: 'TOTO', sector: '日経225' },
  { code: '5333', name: 'NGK', sector: '日経225' },
  { code: '5401', name: '日本製鉄', sector: '日経225' },
  { code: '5406', name: '神戸鋼', sector: '日経225' },
  { code: '5411', name: 'JFE', sector: '日経225' },
  { code: '3436', name: 'SUMCO', sector: '日経225' },
  { code: '5706', name: '三井金属', sector: '日経225' },
  { code: '5711', name: '三菱マ', sector: '日経225' },
  { code: '5713', name: '住友鉱', sector: '日経225' },
  { code: '5714', name: 'DOWA', sector: '日経225' },
  { code: '5801', name: '古河電', sector: '日経225' },
  { code: '5802', name: '住友電', sector: '日経225' },
  { code: '5803', name: 'フジクラ', sector: '日経225' },
  { code: '2768', name: '双日', sector: '日経225' },
  { code: '8001', name: '伊藤忠', sector: '日経225' },
  { code: '8002', name: '丸紅', sector: '日経225' },
  { code: '8015', name: '豊田通商', sector: '日経225' },
  { code: '8031', name: '三井物', sector: '日経225' },
  { code: '8053', name: '住友商', sector: '日経225' },
  { code: '8058', name: '三菱商', sector: '日経225' },
  { code: '1721', name: 'コムシスHD', sector: '日経225' },
  { code: '1801', name: '大成建', sector: '日経225' },
  { code: '1802', name: '大林組', sector: '日経225' },
  { code: '1803', name: '清水建', sector: '日経225' },
  { code: '1808', name: '長谷工', sector: '日経225' },
  { code: '1812', name: '鹿島', sector: '日経225' },
  { code: '1925', name: 'ハウス', sector: '日経225' },
  { code: '1928', name: '積ハウス', sector: '日経225' },
  { code: '1963', name: '日揮HD', sector: '日経225' },
  { code: '5631', name: '日製鋼', sector: '日経225' },
  { code: '6103', name: 'オークマ', sector: '日経225' },
  { code: '6113', name: 'アマダ', sector: '日経225' },
  { code: '6273', name: 'SMC', sector: '日経225' },
  { code: '6301', name: 'コマツ', sector: '日経225' },
  { code: '6302', name: '住友重', sector: '日経225' },
  { code: '6305', name: '日立建機', sector: '日経225' },
  { code: '6326', name: 'クボタ', sector: '日経225' },
  { code: '6361', name: '荏原', sector: '日経225' },
  { code: '6367', name: 'ダイキン', sector: '日経225' },
  { code: '6471', name: '日精工', sector: '日経225' },
  { code: '6472', name: 'NTN', sector: '日経225' },
  { code: '6473', name: 'ジェイテクト', sector: '日経225' },
  { code: '7004', name: 'カナデビア', sector: '日経225' },
  { code: '7011', name: '三菱重', sector: '日経225' },
  { code: '7013', name: 'IHI', sector: '日経225' },
  { code: '7012', name: '川重', sector: '日経225' },
  { code: '7832', name: 'バンナムHD', sector: '日経225' },
  { code: '7911', name: 'TOPPAN', sector: '日経225' },
  { code: '7912', name: '大日印', sector: '日経225' },
  { code: '7951', name: 'ヤマハ', sector: '日経225' },
  { code: '3289', name: '東急不HD', sector: '日経225' },
  { code: '8801', name: '三井不', sector: '日経225' },
  { code: '8802', name: '菱地所', sector: '日経225' },
  { code: '8804', name: '東建物', sector: '日経225' },
  { code: '8830', name: '住友不', sector: '日経225' },
  { code: '9001', name: '東武', sector: '日経225' },
  { code: '9005', name: '東急', sector: '日経225' },
  { code: '9007', name: '小田急', sector: '日経225' },
  { code: '9008', name: '京王', sector: '日経225' },
  { code: '9009', name: '京成', sector: '日経225' },
  { code: '9020', name: 'JR東日本', sector: '日経225' },
  { code: '9021', name: 'JR西日本', sector: '日経225' },
  { code: '9022', name: 'JR東海', sector: '日経225' },
  { code: '9064', name: 'ヤマトHD', sector: '日経225' },
  { code: '9147', name: 'NXHD', sector: '日経225' },
  { code: '9101', name: '郵船', sector: '日経225' },
  { code: '9104', name: '商船三井', sector: '日経225' },
  { code: '9107', name: '川崎汽', sector: '日経225' },
  { code: '9201', name: 'JAL', sector: '日経225' },
  { code: '9202', name: 'ANAHD', sector: '日経225' },
  { code: '9501', name: '東電HD', sector: '日経225' },
  { code: '9502', name: '中部電', sector: '日経225' },
  { code: '9503', name: '関西電', sector: '日経225' },
  { code: '9531', name: '東ガス', sector: '日経225' },
  { code: '9532', name: '大ガス', sector: '日経225' }
];

// v13: 追加スクリーニング対象。完全網羅ではなく、実務で触りやすい候補群を内蔵。
// 価格・出来高で実際にフィルタするため、古い/対象外の銘柄が混じってもスキャン結果から自然に落ちます。
const GROWTH_STATIC = [
  { code:'290A', name:'シンスペクティブ', sector:'グロース/宇宙' },
  { code:'5595', name:'QPS研究所', sector:'グロース/宇宙' },
  { code:'9348', name:'アイスペース', sector:'グロース/宇宙' },
  { code:'218A', name:'リベラウェア', sector:'グロース/ドローン' },
  { code:'5574', name:'ABEJA', sector:'グロース/AI' },
  { code:'5586', name:'Laboro.AI', sector:'グロース/AI' },
  { code:'5572', name:'Ridge-i', sector:'グロース/AI' },
  { code:'4011', name:'ヘッドウォータース', sector:'グロース/AI' },
  { code:'5132', name:'pluszero', sector:'グロース/AI' },
  { code:'5246', name:'ELEMENTS', sector:'グロース/AI' },
  { code:'5243', name:'note', sector:'グロース/SaaS' },
  { code:'5032', name:'ANYCOLOR', sector:'グロース/コンテンツ' },
  { code:'5253', name:'カバー', sector:'グロース/コンテンツ' },
  { code:'4478', name:'フリー', sector:'グロース/SaaS' },
  { code:'4477', name:'BASE', sector:'グロース/EC' },
  { code:'4165', name:'プレイド', sector:'グロース/SaaS' },
  { code:'4375', name:'セーフィー', sector:'グロース/クラウド' },
  { code:'4418', name:'JDSC', sector:'グロース/AI' },
  { code:'4419', name:'Finatext', sector:'グロース/金融DX' },
  { code:'4192', name:'スパイダープラス', sector:'グロース/建設DX' },
  { code:'4259', name:'エクサウィザーズ', sector:'グロース/AI' },
  { code:'4448', name:'kubell', sector:'グロース/SaaS' },
  { code:'3993', name:'PKSHA', sector:'グロース/AI' },
  { code:'4480', name:'メドレー', sector:'グロース/医療DX' },
  { code:'4894', name:'クオリプス', sector:'グロース/バイオ' },
  { code:'4882', name:'ペルセウス', sector:'グロース/バイオ' },
  { code:'4883', name:'モダリス', sector:'グロース/バイオ' },
  { code:'4888', name:'ステラファーマ', sector:'グロース/バイオ' },
  { code:'4891', name:'ティムス', sector:'グロース/バイオ' },
  { code:'4892', name:'サイフューズ', sector:'グロース/バイオ' },
  { code:'4893', name:'ノイルイミューン', sector:'グロース/バイオ' },
  { code:'4575', name:'キャンバス', sector:'グロース/バイオ' },
  { code:'4592', name:'サンバイオ', sector:'グロース/バイオ' },
  { code:'4563', name:'アンジェス', sector:'グロース/バイオ' },
  { code:'4565', name:'ネクセラファーマ', sector:'グロース/バイオ' },
  { code:'7776', name:'セルシード', sector:'グロース/バイオ' },
  { code:'4263', name:'サスメド', sector:'グロース/医療DX' },
  { code:'9560', name:'プログリット', sector:'グロース/教育' },
  { code:'5136', name:'tripla', sector:'グロース/旅行DX' },
  { code:'215A', name:'タイミー', sector:'グロース/人材' },
  { code:'9158', name:'シーユーシー', sector:'グロース/医療支援' },
  { code:'9166', name:'GENDA', sector:'グロース/エンタメ' },
  { code:'3491', name:'GA technologies', sector:'グロース/不動産DX' },
  { code:'6030', name:'アドベンチャー', sector:'グロース/旅行' },
  { code:'7048', name:'ベルトラ', sector:'グロース/旅行' },
  { code:'7157', name:'ライフネット生命', sector:'グロース/保険' },
  { code:'7095', name:'Macbee Planet', sector:'グロース/マーケ' },
  { code:'4051', name:'GMOフィナンシャルゲート', sector:'グロース/決済' },
  { code:'3133', name:'海帆', sector:'グロース/外食' },
  { code:'2160', name:'ジーエヌアイ', sector:'グロース/バイオ' },
  { code:'4576', name:'DWTI', sector:'グロース/バイオ' }
];

const TOPIX_EXTRA_STATIC = [
  { code:'1332', name:'ニッスイ', sector:'TOPIX/水産' }, { code:'2801', name:'キッコーマン', sector:'TOPIX/食品' },
  { code:'2413', name:'エムスリー', sector:'TOPIX/医療DX' }, { code:'7532', name:'パンパシHD', sector:'TOPIX/小売' },
  { code:'7453', name:'良品計画', sector:'TOPIX/小売' }, { code:'8267', name:'イオン', sector:'TOPIX/小売' },
  { code:'3099', name:'三越伊勢丹', sector:'TOPIX/小売' }, { code:'3086', name:'Jフロント', sector:'TOPIX/小売' },
  { code:'9843', name:'ニトリHD', sector:'TOPIX/小売' }, { code:'3092', name:'ZOZO', sector:'TOPIX/小売' },
  { code:'5019', name:'出光興産', sector:'TOPIX/石油' }, { code:'5020', name:'ENEOS', sector:'TOPIX/石油' },
  { code:'464A', name:'QPSホールディングス', sector:'TOPIX候補/宇宙' },
  { code:'8604', name:'野村HD', sector:'TOPIX/証券' }, { code:'8306', name:'三菱UFJ', sector:'TOPIX/銀行' },
  { code:'8316', name:'三井住友FG', sector:'TOPIX/銀行' }, { code:'8411', name:'みずほFG', sector:'TOPIX/銀行' },
  { code:'3402', name:'東レ', sector:'TOPIX/素材' }, { code:'3407', name:'旭化成', sector:'TOPIX/化学' },
  { code:'5803', name:'フジクラ', sector:'TOPIX/電線' }, { code:'6703', name:'沖電気', sector:'TOPIX/通信機器' },
  { code:'3687', name:'フィックスターズ', sector:'TOPIX/AI' }, { code:'3541', name:'農業総合研究所', sector:'TOPIX候補/農業DX' }
];


// v21: セクター探索用の追加候補群。全市場網羅ではなく「価格・出来高で実際に引っかけるための探索母集団」。
const SECTOR_EXTRA_STATIC = [
  // 半導体・AI・データセンター
  { code:'6315', name:'TOWA', sector:'半導体製造装置' }, { code:'6254', name:'野村マイクロ', sector:'半導体製造装置' },
  { code:'6525', name:'KOKUSAI ELECTRIC', sector:'半導体製造装置' }, { code:'3436', name:'SUMCO', sector:'半導体材料' },
  { code:'6967', name:'新光電気工業', sector:'半導体部材' }, { code:'4062', name:'イビデン', sector:'半導体部材' },
  { code:'3655', name:'ブレインパッド', sector:'AI' }, { code:'3905', name:'データセクション', sector:'AI' },
  { code:'3853', name:'アステリア', sector:'AI/ソフトウェア' },
  // 宇宙・防衛・ドローン
  { code:'5595', name:'QPS研究所', sector:'宇宙/SAR' }, { code:'464A', name:'QPSホールディングス', sector:'宇宙/SAR' },
  { code:'6208', name:'石川製作所', sector:'防衛' }, { code:'4274', name:'細谷火工', sector:'防衛' }, { code:'7012', name:'川崎重工業', sector:'防衛/重工' },
  { code:'7013', name:'IHI', sector:'防衛/重工' }, { code:'7721', name:'東京計器', sector:'防衛/計測' },
  // 不動産・建設・住宅
  { code:'8801', name:'三井不動産', sector:'不動産' }, { code:'8802', name:'三菱地所', sector:'不動産' },
  { code:'8804', name:'東京建物', sector:'不動産' }, { code:'8830', name:'住友不動産', sector:'不動産' },
  { code:'3289', name:'東急不動産HD', sector:'不動産' }, { code:'3231', name:'野村不動産HD', sector:'不動産' },
  { code:'1911', name:'住友林業', sector:'住宅' }, { code:'1928', name:'積水ハウス', sector:'住宅' },
  { code:'8803', name:'平和不動産', sector:'不動産' }, { code:'8848', name:'レオパレス21', sector:'不動産/住宅' },
  { code:'8897', name:'MIRARTHホールディングス', sector:'不動産/住宅' }, { code:'8905', name:'イオンモール', sector:'不動産/商業施設' },
  { code:'8951', name:'日本ビルファンド投資法人', sector:'REIT/不動産' },
  // 機械・自動車・部品
  { code:'6471', name:'日本精工', sector:'機械/軸受' }, { code:'6472', name:'NTN', sector:'機械/軸受' },
  { code:'6473', name:'ジェイテクト', sector:'機械/自動車部品' }, { code:'6770', name:'アルプスアルパイン', sector:'電子部品/自動車' },
  { code:'6762', name:'TDK', sector:'電子部品' }, { code:'6981', name:'村田製作所', sector:'電子部品' },
  { code:'7270', name:'SUBARU', sector:'自動車' }, { code:'7261', name:'マツダ', sector:'自動車' },
  // 素材・化学・鉄鋼・資源
  { code:'3401', name:'帝人', sector:'素材' }, { code:'3402', name:'東レ', sector:'素材' }, { code:'3407', name:'旭化成', sector:'化学' },
  { code:'4005', name:'住友化学', sector:'化学' }, { code:'4188', name:'三菱ケミカルグループ', sector:'化学' },
  { code:'5406', name:'神戸製鋼所', sector:'鉄鋼' }, { code:'5411', name:'JFEホールディングス', sector:'鉄鋼' },
  { code:'5706', name:'三井金属', sector:'非鉄' }, { code:'5713', name:'住友金属鉱山', sector:'非鉄/資源' },
  // 食品・水産・小売
  { code:'2269', name:'明治HD', sector:'食品' }, { code:'2502', name:'アサヒグループHD', sector:'食品/飲料' },
  { code:'2503', name:'キリンHD', sector:'食品/飲料' }, { code:'2871', name:'ニチレイ', sector:'食品/冷凍' },
  { code:'8036', name:'日立ハイテク', sector:'商社/半導体' },
  { code:'7532', name:'パン・パシフィックHD', sector:'小売' }, { code:'7453', name:'良品計画', sector:'小売' },
  { code:'8227', name:'しまむら', sector:'小売' }, { code:'3141', name:'ウエルシアHD', sector:'小売/ドラッグ' },
  // 金融・商社・通信
  { code:'8593', name:'三菱HCキャピタル', sector:'金融/リース' }, { code:'8473', name:'SBIホールディングス', sector:'証券/金融' },
  { code:'8601', name:'大和証券G', sector:'証券' }, { code:'8604', name:'野村HD', sector:'証券' },
  { code:'8002', name:'丸紅', sector:'商社' }, { code:'8053', name:'住友商事', sector:'商社' },
  { code:'9434', name:'ソフトバンク', sector:'通信' }, { code:'9613', name:'NTTデータグループ', sector:'IT/通信' },
  // 医療・医薬・バイオ
  { code:'2413', name:'エムスリー', sector:'医療DX/製薬支援' }, { code:'4519', name:'中外製薬', sector:'医薬品' },
  { code:'4523', name:'エーザイ', sector:'医薬品' }, { code:'4887', name:'サワイグループHD', sector:'医薬品' },
  { code:'2160', name:'ジーエヌアイ', sector:'バイオ' }, { code:'4894', name:'クオリプス', sector:'バイオ' }
];

const SECTOR_FILTERS = {
  all: [],
  semiconductor: ['半導体','電子部品','電線','データセンター','電気機器','精密機器','ガラス・土石製品','非鉄金属'],
  ai: ['AI','ソフトウェア','量子','DX','SaaS','クラウド','情報・通信業','サービス業'],
  space_defense: ['宇宙','防衛','ドローン','SAR','重工','輸送用機器','機械'],
  realestate: ['不動産','住宅','建設','建設業','不動産業','REIT'],
  finance: ['銀行','証券','金融','保険','リース','銀行業','証券、商品先物取引業','保険業','その他金融業'],
  resources: ['資源','石油','鉄鋼','非鉄','素材','化学','鉱業','石油・石炭製品','鉄鋼','非鉄金属','化学','繊維製品','パルプ・紙','ゴム製品'],
  consumer: ['食品','水産','小売','飲料','ドラッグ','外食','水産・農林業','食料品','小売業','卸売業'],
  auto_machinery: ['自動車','機械','軸受','部品','精密','機械','輸送用機器','精密機器','金属製品'],
  pharma_medical: ['医療','医薬','バイオ','製薬','医薬品','サービス業'],
  infra: ['通信','鉄道','電力','ガス','運輸','情報・通信業','陸運業','海運業','空運業','倉庫・運輸関連業','電気・ガス業'],
  trading: ['商社','卸売業']
};

function sectorMatches(item, sector = 'all') {
  const keys = SECTOR_FILTERS[sector] || [];
  if (!keys.length) return true;
  const hay = `${item.sector || ''} ${item.name || ''}`;
  return keys.some((k) => hay.includes(k));
}

function uniqueComponents(list) {
  // v22: 同一コードが NIKKEI225_STATIC と SECTOR_EXTRA_STATIC の両方にある場合、
  // 先に出た「日経225」だけで確定してしまうと、セクター検索で落ちる。
  // 例: 8802 三菱地所 = NIKKEI225(日経225) + SECTOR_EXTRA(不動産)
  // そのため、同一コードは除外ではなく sector/name をマージする。
  const map = new Map();
  for (const raw of list) {
    const c = bareCode(raw.code);
    if (!c) continue;
    const item = { ...raw, code: c };
    const prev = map.get(c);
    if (!prev) {
      map.set(c, item);
      continue;
    }
    const sectors = [prev.sector, item.sector]
      .flatMap((v) => String(v || '').split(/[\s,、/]+/))
      .map((v) => v.trim())
      .filter(Boolean);
    const mergedSector = [...new Set(sectors)].join('/');
    const genericName = !prev.name || prev.name === c || /^(SB|JAL|JR|NTT|JT|OLC|HD)$/i.test(prev.name);
    map.set(c, {
      ...prev,
      ...item,
      name: genericName ? (item.name || prev.name) : prev.name,
      sector: mergedSector || item.sector || prev.sector || '',
    });
  }
  return [...map.values()];
}

const JPX_MASTER_URL = 'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

function normalizeJpxMarket(raw = '') {
  const s = String(raw || '');
  if (s.includes('プライム')) return 'prime';
  if (s.includes('スタンダード')) return 'standard';
  if (s.includes('グロース')) return 'growth';
  if (s.includes('REIT')) return 'reit';
  if (s.includes('ETF') || s.includes('ETN')) return 'etf';
  return 'other';
}

function isCommonJpxStock(row) {
  const market = String(row['市場・商品区分'] || row['市場・商品区分（英）'] || row.marketRaw || '');
  const type = normalizeJpxMarket(market);
  if (!['prime','standard','growth'].includes(type)) return false;
  if (/ETF|ETN|REIT|インフラ|ベンチャーファンド|優先|出資証券/i.test(market)) return false;
  return true;
}

function jpxRowToComponent(row) {
  const code = bareCode(row['コード'] ?? row['Code'] ?? row.code ?? '');
  const name = String(row['銘柄名'] ?? row['Name'] ?? row.name ?? code).trim();
  const marketRaw = String(row['市場・商品区分'] ?? row['Market Segment'] ?? row.marketRaw ?? '').trim();
  const industry33 = String(row['33業種区分'] ?? row['33 Sector(name)'] ?? row.industry33 ?? '').trim();
  const industry17 = String(row['17業種区分'] ?? row['17 Sector(name)'] ?? row.industry17 ?? '').trim();
  const size = String(row['規模区分'] ?? row['Size Code (New Index Series)'] ?? row.size ?? '').trim();
  const marketType = normalizeJpxMarket(marketRaw);
  if (!code || !name || !isCommonJpxStock({ ...row, marketRaw })) return null;
  const marketLabel = marketType === 'prime' ? 'プライム' : marketType === 'standard' ? 'スタンダード' : marketType === 'growth' ? 'グロース' : marketRaw;
  return {
    code,
    name,
    sector: [marketLabel, industry33, industry17].filter(Boolean).join('/'),
    market: marketType,
    marketRaw,
    industry33,
    industry17,
    size,
    source: 'JPX'
  };
}

function withStaticMarket(items = [], market = 'other', marketRaw = '') {
  const label = marketRaw || (market === 'prime' ? 'プライム' : market === 'standard' ? 'スタンダード' : market === 'growth' ? 'グロース' : '');
  return (items || []).map((x) => ({
    ...x,
    market: x.market || market,
    marketRaw: x.marketRaw || label,
    sector: x.sector || label,
    source: x.source || `static-${market}`,
  }));
}

function buildFallbackListedMaster(errorMessage = '') {
  const growthCodes = new Set(GROWTH_STATIC.map((x) => bareCode(x.code)));
  const primeLikeCodes = new Set([...NIKKEI225_STATIC, ...TOPIX_EXTRA_STATIC].map((x) => bareCode(x.code)));
  const localMarked = LOCAL_SYMBOLS.map((x) => {
    const c = bareCode(x.code);
    const market = growthCodes.has(c) ? 'growth' : primeLikeCodes.has(c) ? 'prime' : 'other';
    const marketRaw = market === 'growth' ? 'グロース' : market === 'prime' ? 'プライム' : '';
    return { ...x, market, marketRaw, source: `static-${market}` };
  });
  const sectorMarked = SECTOR_EXTRA_STATIC.map((x) => {
    const c = bareCode(x.code);
    const market = growthCodes.has(c) ? 'growth' : primeLikeCodes.has(c) ? 'prime' : 'other';
    const marketRaw = market === 'growth' ? 'グロース' : market === 'prime' ? 'プライム' : '';
    return { ...x, market, marketRaw, source: `static-${market}` };
  });
  const fallback = uniqueComponents([
    ...withStaticMarket(NIKKEI225_STATIC, 'prime', 'プライム'),
    ...withStaticMarket(TOPIX_EXTRA_STATIC, 'prime', 'プライム'),
    ...withStaticMarket(GROWTH_STATIC, 'growth', 'グロース'),
    ...sectorMarked,
    ...localMarked,
  ]);
  return { items: fallback, source: 'fallback-static', error: errorMessage, fetchedAt: new Date().toISOString(), count: fallback.length };
}

async function fetchJpxListedMaster(force = false) {
  const cached = force ? null : jpxMasterCache.get('jpx-master');
  if (cached?.items?.length) return cached;
  try {
    const buffer = await fetchBufferSmart(JPX_MASTER_URL, 15000, 1);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const items = uniqueComponents(rows.map(jpxRowToComponent).filter(Boolean));
    if (!items.length) throw new Error('JPXマスターが空です');
    const data = { items, source: 'JPX', fetchedAt: new Date().toISOString(), count: items.length };
    jpxMasterCache.set('jpx-master', data);
    return data;
  } catch (e) {
    const data = buildFallbackListedMaster(e.message);
    jpxMasterCache.set('jpx-master', data);
    return data;
  }
}

async function getUniverseComponents(universe = 'nikkei225', sector = 'all') {
  let base;
  let source = 'static';
  if (universe === 'nikkei225') {
    // v36: 日経225の静的リストは sector='日経225' だけだと、セクター相対が市場平均になってしまう。
    // JPX上場銘柄マスターの33業種/17業種をマージして、
    // 例: 2413 エムスリー → プライム/サービス業/情報通信・サービスその他
    // のように実業種で sectorKey を作れるようにする。
    const master = await fetchJpxListedMaster(false).catch(() => ({ items: [] }));
    source = master.source ? `static-nikkei225+jpx-${master.source}` : 'static-nikkei225';
    const byCode = new Map((master.items || []).map((x) => [String(x.code).toUpperCase(), x]));
    base = NIKKEI225_STATIC.map((x) => {
      const jpx = byCode.get(String(x.code).toUpperCase());
      return {
        ...x,
        name: x.name || jpx?.name,
        market: 'nikkei225',
        source: 'static-nikkei225',
        sector: jpx?.sector || x.sector,
        industry33: jpx?.industry33 || x.industry33 || '',
        industry17: jpx?.industry17 || x.industry17 || '',
        marketRaw: jpx?.marketRaw || x.marketRaw || '',
        size: jpx?.size || x.size || '',
      };
    });
  } else {
    const master = await fetchJpxListedMaster(false);
    source = master.source;
    const items = master.items || [];
    if (universe === 'growth') base = items.filter((x) => x.market === 'growth');
    else if (universe === 'prime') base = items.filter((x) => x.market === 'prime');
    else if (universe === 'standard') base = items.filter((x) => x.market === 'standard');
    else if (universe === 'topix') base = items.filter((x) => x.market === 'prime'); // TOPIX近似: プライム中心の広域探索
    else if (universe === 'all') base = items;
    else base = items;
    // v58-confirm-fix: ここで LOCAL_SYMBOLS / SECTOR_EXTRA_STATIC を無条件に足すと、
    // グロース選択時にもプライム銘柄が混ざり、スキャン結果がセンサーへ正しく反映されない。
    // JPX取得失敗時は buildFallbackListedMaster 側で市場ラベル付きの静的候補を作る。
    base = uniqueComponents(base);
  }
  const filtered = uniqueComponents(base).filter((x) => sectorMatches(x, sector));
  filtered.metaSource = source;
  return filtered;
}


function chunkArray(items, size = 50) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function quoteLitePassesFilters(q = {}, { maxPrice = 0, minPrice = 0, minVolume = 0 } = {}) {
  const price = Number(q.price);
  const volume = Number(q.volume);
  if (Number.isFinite(Number(maxPrice)) && Number(maxPrice) > 0 && Number.isFinite(price) && price > Number(maxPrice)) return false;
  if (Number.isFinite(Number(minPrice)) && Number(minPrice) > 0 && Number.isFinite(price) && price < Number(minPrice)) return false;
  if (Number.isFinite(Number(minVolume)) && Number(minVolume) > 0 && Number.isFinite(volume) && volume < Number(minVolume)) return false;
  // 価格または出来高が欠損しているものは、広域スキャンでは詳細取得しても失敗しやすいので落とす。
  if (!Number.isFinite(price)) return false;
  if (Number.isFinite(Number(minVolume)) && Number(minVolume) > 0 && !Number.isFinite(volume)) return false;
  return true;
}

function yahooQuoteLiteFromRaw(raw = {}, component = {}) {
  const code = bareCode(raw.symbol || component.code || '');
  const price = nval(raw.regularMarketPrice ?? raw.postMarketPrice ?? raw.preMarketPrice);
  const prev = nval(raw.regularMarketPreviousClose ?? raw.regularMarketOpen);
  const volume = nval(raw.regularMarketVolume ?? raw.averageDailyVolume10Day ?? raw.averageDailyVolume3Month);
  return {
    code,
    symbol: normalizeCode(code),
    name: component.name || cleanJapaneseName(raw.shortName || raw.longName || raw.displayName || code, code),
    sector: component.sector || '',
    market: component.market || '',
    price,
    prevClose: prev,
    changePct: Number.isFinite(price) && Number.isFinite(prev) && prev !== 0 ? Math.round(((price - prev) / prev) * 10000) / 100 : null,
    volume,
    source: 'Yahoo quote prefilter',
  };
}

async function fetchYahooQuoteLiteBatch(components = []) {
  const chunks = chunkArray(components, 50);
  const rows = [];
  const settled = await mapLimit(chunks, 4, async (chunk) => {
    const symbols = chunk.map((x) => normalizeCode(x.code)).filter(Boolean).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
    const data = await fetchJsonSmart(url, 7000, 1, 5000);
    const byCode = new Map((data?.quoteResponse?.result || []).map((q) => [bareCode(q.symbol), q]));
    return chunk.map((component) => {
      const raw = byCode.get(bareCode(component.code));
      return raw ? yahooQuoteLiteFromRaw(raw, component) : { code: bareCode(component.code), name: component.name, sector: component.sector, error: '軽量価格未取得' };
    });
  });
  for (const r of settled) {
    if (r.status === 'fulfilled') rows.push(...r.value);
    else rows.push({ error: r.reason?.message || '軽量価格一括取得失敗' });
  }
  return rows;
}

const WIDE_SCAN_DEFAULT_LIMIT = 600;

function buildScanGuard({ universe = 'nikkei225', sector = 'all', candidateCount = 0, maxCandidates = WIDE_SCAN_DEFAULT_LIMIT, minVolume = 0, maxPrice = 0 } = {}) {
  const broadUniverse = ['all', 'prime', 'topix', 'standard', 'growth'].includes(String(universe));
  const noSector = !sector || sector === 'all';
  const volumeOk = Number.isFinite(Number(minVolume)) && Number(minVolume) >= 100000;
  const priceOk = Number.isFinite(Number(maxPrice)) && Number(maxPrice) > 0 && Number(maxPrice) <= 5000;
  const strongFilter = volumeOk && priceOk;
  const missingVolume = !volumeOk;
  const missingPrice = !priceOk;
  // v38: プライム/全セクターでも、価格帯・出来高で十分絞っている場合は検索を許可する。
  // ただし完全無制限の広域探索は止める。
  const tooMany = Number(candidateCount) > Number(maxCandidates || WIDE_SCAN_DEFAULT_LIMIT) && !strongFilter;
  const reasons = [];
  if (broadUniverse && noSector && !strongFilter) reasons.push('セクター未指定');
  if (broadUniverse && missingVolume) reasons.push('出来高下限10万未満');
  if (broadUniverse && missingPrice) reasons.push('価格上限が広すぎる');
  if (tooMany) reasons.push(`候補${candidateCount}件 > 上限${maxCandidates}件`);
  const block = universe !== 'watch' && universe !== 'nikkei225' && (
    tooMany ||
    (noSector && candidateCount > 400 && !strongFilter) ||
    (missingVolume && candidateCount > 800)
  );
  const estimateBase = strongFilter ? Math.min(candidateCount, Number(maxCandidates || WIDE_SCAN_DEFAULT_LIMIT)) : candidateCount;
  const estimateSeconds = Math.max(3, Math.ceil(estimateBase / 8) * 2);
  return { block, reasons, candidateCount, maxCandidates, estimateSeconds, strongFilter };
}

async function previewUniverseScan({ universe = 'nikkei225', sector = 'all', maxCandidates = WIDE_SCAN_DEFAULT_LIMIT, minVolume = 0, maxPrice = 3000 } = {}) {
  const components = await getUniverseComponents(universe, sector);
  const guard = buildScanGuard({ universe, sector, candidateCount: components.length, maxCandidates, minVolume, maxPrice });
  return {
    universe, sector, candidateCount: components.length, masterSource: components.metaSource || 'static',
    maxCandidates, minVolume, maxPrice, guard, sample: components.slice(0, 8),
  };
}


function median(values) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function sectorKeyOf(q) {
  const raw = String(q.sector || '').trim();
  if (!raw) return '未分類';
  const generic = new Set(['日経225','TOPIX','TOPIX近似','プライム','スタンダード','グロース','全候補','watch','nikkei225','prime','standard','growth','all']);
  const parts = raw.split(/[\/・,、｜|]/).map((x) => x.trim()).filter(Boolean);
  return parts.find((x) => !generic.has(x)) || parts[0] || '未分類';
}
function rememberSectorMedians(items) {
  const groups = new Map();
  for (const q of items || []) {
    const key = sectorKeyOf(q);
    const cp = Number(q.changePct);
    if (!Number.isFinite(cp)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cp);
  }
  for (const [key, vals] of groups) {
    // 1〜2件のセクター中央値はノイズが大きいので、広域スキャン由来の最低5件だけ共有キャッシュ化
    if (vals.length >= 5) sectorMedianCache.set(key, Math.round(median(vals) * 100) / 100);
  }
}
function applySectorRelative(items, { useCachedMedian = false, remember = false } = {}) {
  const groups = new Map();
  for (const q of items || []) {
    const key = sectorKeyOf(q);
    const cp = Number(q.changePct);
    if (!Number.isFinite(cp)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cp);
  }
  const localMedians = new Map();
  for (const [key, vals] of groups) {
    localMedians.set(key, { value: Math.round(median(vals) * 100) / 100, count: vals.length });
  }
  if (remember) rememberSectorMedians(items);
  return (items || []).map((q) => {
    const key = sectorKeyOf(q);
    const local = localMedians.get(key);
    // 監視リストはセクター1銘柄になりやすいので、5件未満なら広域スキャンの中央値を優先利用
    let med = local?.value;
    let source = local ? 'local' : null;
    if (useCachedMedian && (!local || local.count < 5)) {
      const cached = sectorMedianCache.get(key);
      if (Number.isFinite(cached)) { med = cached; source = 'cached-universe'; }
    }
    const rel = Number.isFinite(Number(q.changePct)) && Number.isFinite(med) ? Math.round((Number(q.changePct) - med) * 100) / 100 : null;
    const enriched = {
      ...q,
      sectorKey: key,
      sectorChangeMedian: med == null ? null : Math.round(med * 100) / 100,
      sectorMedianSource: source,
      sectorRelativeChange: rel,
    };
    return { ...enriched, ...buildStateTags(enriched) };
  });
}

async function fetchUniverseScan({ universe = 'nikkei225', maxPrice = 3000, minPrice = 0, minVolume = 0, sector = 'all', maxCandidates = WIDE_SCAN_DEFAULT_LIMIT, force = false } = {}) {
  const components = await getUniverseComponents(universe, sector);
  const guard = buildScanGuard({ universe, sector, candidateCount: components.length, maxCandidates, minVolume, maxPrice });
  if (!force && guard.block) {
    const msg = `探索対象が広すぎます（${components.length}件）。セクター指定・価格上限・出来高10万以上などで絞ってください。`;
    const err = new Error(msg);
    err.statusCode = 400; err.payload = { error: msg, needNarrow: true, guard, allCount: components.length, universe, sector, maxPrice, minPrice, minVolume, masterSource: components.metaSource || 'static' };
    throw err;
  }
  const usePrefilter = components.length > 30 && (
    (Number.isFinite(Number(maxPrice)) && Number(maxPrice) > 0) ||
    (Number.isFinite(Number(minPrice)) && Number(minPrice) > 0) ||
    (Number.isFinite(Number(minVolume)) && Number(minVolume) > 0)
  );
  let scanBase = components;
  let prefilter = null;
  if (usePrefilter) {
    const liteRows = await fetchYahooQuoteLiteBatch(components);
    const passCodes = new Set(liteRows
      .filter((q) => !q.error && quoteLitePassesFilters(q, { maxPrice, minPrice, minVolume }))
      .map((q) => bareCode(q.code)));
    const filteredBase = components.filter((x) => passCodes.has(bareCode(x.code)));
    const failureLike = liteRows.length === 0 || filteredBase.length === 0;
    // v58-fix: Yahoo一括quoteは時間帯・通信状態で0件/欠損を返すことがある。
    // その0件を正として採用すると、プライム/グロースのセンサー一覧が一定時間後に空になる。
    // 0件時は高速フィルタを捨て、通常の詳細取得にフォールバックする。
    if (!failureLike) scanBase = filteredBase;
    prefilter = {
      enabled: !failureLike,
      fallback: failureLike,
      before: components.length,
      after: failureLike ? components.length : scanBase.length,
      dropped: failureLike ? 0 : components.length - scanBase.length,
      liteRows: liteRows.length,
      source: failureLike ? 'Yahoo quote batch fallback' : 'Yahoo quote batch',
    };
  }
  const limited = scanBase.slice(0, Number(maxCandidates || WIDE_SCAN_DEFAULT_LIMIT));
  const settled = await mapLimit(limited, universe === 'growth' ? 8 : 10, async (component) => {
    const q = await fetchYahooQuote(component.code, { withFundamental: false });
    const localName = component.name && component.name !== component.code ? component.name : q.name;
    return { ...q, name: localName || q.name, sector: component.sector || q.sector || universe };
  });
  const all = settled.map((r, i) => r.status === 'fulfilled' ? r.value : { code: limited[i].code, name: limited[i].name, sector: limited[i].sector, error: r.reason?.message || '取得失敗' });
  const scanUniverseItems = all.filter((q) => !q.error && Number.isFinite(Number(q.price)));
  rememberSectorMedians(scanUniverseItems);
  const baseItems = all
    .filter((q) => !q.error && Number.isFinite(Number(q.price)))
    .filter((q) => !Number.isFinite(maxPrice) || Number(maxPrice) <= 0 || Number(q.price) <= Number(maxPrice))
    .filter((q) => !Number.isFinite(minPrice) || Number(minPrice) <= 0 || Number(q.price) >= Number(minPrice))
    .filter((q) => !Number.isFinite(minVolume) || Number(minVolume) <= 0 || Number(q.volume) >= Number(minVolume));
  const items = applySectorRelative(baseItems, { useCachedMedian: true, remember: false })
    .sort((a, b) => (b.stateScore || b.score || 0) - (a.stateScore || a.score || 0) || (b.volume || 0) - (a.volume || 0));
  return { items, allCount: components.length, fetchedCount: all.length, underCount: items.length, fetchedAt: new Date().toISOString(), maxPrice, minPrice, minVolume, universe, sector, guard, prefilter, masterSource: components.metaSource || 'static' };
}


async function fetchNikkei225Components(force = false) {
  // 日経公式ページはブラウザ以外から403になることがあるため、
  // 2026-05-08時点の日経公式構成銘柄を内蔵リストとして使う。
  // これでネットワーク403でも押し目スキャナーは止まらない。
  const now = Date.now();
  if (!force && nikkeiCache.items.length && now - nikkeiCache.at < 6 * 60 * 60 * 1000) return nikkeiCache.items;

  nikkeiCache.at = now;
  nikkeiCache.items = NIKKEI225_STATIC.slice(0, 225);
  return nikkeiCache.items;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try { results[i] = { status: 'fulfilled', value: await mapper(items[i], i) }; }
      catch (e) { results[i] = { status: 'rejected', reason: e }; }
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchNikkei225Under(maxPrice = 3000) {
  const components = await fetchNikkei225Components();
  const settled = await mapLimit(components, 10, async (component) => {
    const q = await fetchYahooQuote(component.code);
    const localName = component.name && component.name !== component.code ? component.name : q.name;
    return { ...q, name: localName || q.name, sector: '日経225' };
  });
  const all = settled.map((r, i) => r.status === 'fulfilled' ? r.value : { code: components[i].code, name: components[i].name, sector: '日経225', error: r.reason?.message || '取得失敗' });
  const items = all
    .filter((q) => !q.error && Number.isFinite(Number(q.price)) && Number(q.price) <= maxPrice)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (a.changePct || 0) - (b.changePct || 0));
  return { items, allCount: all.length, underCount: items.length, fetchedAt: new Date().toISOString(), maxPrice };
}



function stripIrHtml(html) {
  return decodeHtmlEntity(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function isImportantMaterial(title = '') {
  const t = String(title);
  return /決算|業績|修正|上方|下方|配当|増配|減配|自社株|自己株|TOB|公開買付|分割|併合|優待|資本業務提携|提携|受注|契約|承認|訴訟|特別利益|特別損失|月次|説明資料|中期経営|ワラント|増資|CB|新株|株式交換|合併|買収|譲渡|減損|進捗|売上/.test(t);
}

function materialKind(title = '') {
  const t = String(title);
  if (/決算|短信|説明資料/.test(t)) return '決算';
  if (/業績|修正|上方|下方|進捗/.test(t)) return '業績';
  if (/配当|増配|減配|優待/.test(t)) return '還元';
  if (/自社株|自己株|分割|併合/.test(t)) return '株式';
  if (/TOB|公開買付|合併|買収|譲渡|資本業務提携|提携/.test(t)) return '再編/提携';
  if (/受注|契約|承認|販売|開始|採択/.test(t)) return '材料';
  if (/ワラント|増資|CB|新株/.test(t)) return '希薄化';
  if (/減損|特別損失|訴訟/.test(t)) return 'リスク';
  return 'IR';
}

function jstDateParts(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  // JSTに寄せる
  const j = new Date(d.getTime() + 9 * 3600000);
  const y = j.getUTCFullYear();
  const m = String(j.getUTCMonth() + 1).padStart(2, '0');
  const day = String(j.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// === TDnet キャッシュ ===
const tdnetPageCache = new Map();
const tdnetCodeCache = new Map();
const TDNET_PAGE_TTL = 10 * 60_000;
const TDNET_CODE_TTL = 5 * 60_000;
const TDNET_PAGE_MAX = 800;
const TDNET_CODE_MAX = 500;

function evictIfFull(map, max) {
  if (map.size <= max) return;
  const drop = Math.ceil(max * 0.1);
  const sorted = [...map.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (let i = 0; i < drop && i < sorted.length; i++) map.delete(sorted[i][0]);
}

async function fetchTdnetPage(ymd, page) {
  const p = String(page).padStart(3, '0');
  const key = `${ymd}-${p}`;
  const hit = tdnetPageCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TDNET_PAGE_TTL) return hit.notFound ? null : hit.html;
  const url = `https://www.release.tdnet.info/inbs/I_list_${p}_${ymd}.html`;
  try {
    const html = await fetchTextSmart(url);
    tdnetPageCache.set(key, { at: now, html });
    evictIfFull(tdnetPageCache, TDNET_PAGE_MAX);
    return html;
  } catch (e) {
    tdnetPageCache.set(key, { at: now, html: '', notFound: true });
    evictIfFull(tdnetPageCache, TDNET_PAGE_MAX);
    return null;
  }
}

async function fetchTdnetForDate(code, ymd) {
  const c = bareCode(code);
  const hits = [];
  for (let page = 1; page <= 8; page++) {
    const html = await fetchTdnetPage(ymd, page);
    if (html === null) break;
    if (!html.includes(c)) continue;
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      if (!row.includes(c)) continue;
      const text = stripIrHtml(row);
      if (!text.includes(c)) continue;
      const time = text.match(/([0-2]?\d:[0-5]\d)/)?.[1] || '';
      let title = '';
      const linkMatch = row.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      let link = '';
      if (linkMatch) {
        link = linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.release.tdnet.info/inbs/${linkMatch[1].replace(/^\.\//, '')}`;
        title = stripIrHtml(linkMatch[2]);
      }
      if (!title) title = text.replace(time, '').replace(new RegExp(`\b${c}\b`), '').trim();
      if (!title || title.length < 3) continue;
      hits.push({
        source: 'TDnet',
        date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
        time,
        title,
        url: link || `https://www.release.tdnet.info/inbs/I_list_${String(page).padStart(3, '0')}_${ymd}.html`,
        kind: materialKind(title),
        important: isImportantMaterial(title),
      });
    }
  }
  return hits;
}

async function fetchRecentTdnet(code, days = 7) {
  const all = [];
  for (let i = 0; i < days; i++) {
    const ymd = jstDateParts(i);
    const hits = await fetchTdnetForDate(code, ymd);
    all.push(...hits);
    if (all.length >= 12) break;
  }
  const seen = new Set();
  return all.filter((x) => {
    const key = `${x.date}-${x.time}-${x.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

async function fetchKabutanMaterials(code) {
  // 関係ない株探ニュースが混ざりやすいため、材料タブでは使わない。
  // 個別材料はTDnetで銘柄コード一致した開示だけを表示する。
  return [];
}

function summarizeMaterials(items) {
  if (!items.length) return { level: '材料なし', className: 'neutral', text: '直近TDnetで銘柄コード一致の重要IRは未検出。テクニカルだけで判断せず、決算予定・地合い・セクター材料を確認。' };
  const important = items.filter((x) => x.important);
  const dilution = items.some((x) => /希薄化|リスク/.test(x.kind));
  const earnings = items.some((x) => /決算|業績/.test(x.kind));
  if (dilution) return { level: '悪材料注意', className: 'danger', text: '希薄化・損失・訴訟など下落要因になりやすいIRが含まれます。押し目ではなく構造的な下落の可能性を確認。' };
  if (important.length >= 2) return { level: '材料多め', className: 'good', text: '重要IR/材料が複数あります。上昇・下落どちらの材料か、開示本文と市場反応を確認。' };
  if (earnings) return { level: '決算/業績あり', className: 'wait', text: '決算・業績系の開示があります。進捗率、通期予想、コンセンサス差を確認。' };
  return { level: '材料あり', className: 'wait', text: '直近材料があります。テクニカルの押し目と材料の方向が一致しているか確認。' };
}

async function fetchIrMaterials(code) {
  const c = bareCode(code);
  const now = Date.now();
  const hit = tdnetCodeCache.get(c);
  if (hit && now - hit.at < TDNET_CODE_TTL) return hit.data;
  const tdnet = await fetchRecentTdnet(c, 14);
  const all = [...tdnet];
  const seen = new Set();
  const items = all.filter((x) => {
    const key = `${x.source}-${x.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Number(b.important) - Number(a.important)).slice(0, 8);
  const data = { code: c, items, summary: summarizeMaterials(items), fetchedAt: new Date().toISOString() };
  tdnetCodeCache.set(c, { at: now, data });
  evictIfFull(tdnetCodeCache, TDNET_CODE_MAX);
  return data;
}


function stripXmlText(s) {
  return decodeHtmlEntity(String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function newsTone(title = '') {
  const t = String(title);
  const bad = /急落|大幅安|下落|反落|続落|売られ|下方|減益|赤字|減損|減配|希薄化|増資|ワラント|CB|新株|訴訟|不正|延期|中止|目標株価.*下げ|格下げ|レーティング.*下げ|コンセンサス.*下回/;
  const good = /急騰|大幅高|上昇|反発|上方|増益|最高益|増配|自社株|自己株|受注|契約|承認|採択|提携|TOB|公開買付|目標株価.*上げ|格上げ/;
  if (bad.test(t)) return { tone: '悪材料寄り', className: 'danger' };
  if (good.test(t)) return { tone: '好材料寄り', className: 'good' };
  return { tone: '確認材料', className: 'wait' };
}

function materialToneFromTitle(title = '') {
  const t = String(title || '');
  if (/下方|減益|赤字|減損|特別損失|減配|訴訟|不正|ワラント|増資|CB|新株|希薄化|中止|延期/.test(t)) return { tone: '悪材料寄り', className: 'danger' };
  if (/上方|増益|最高益|増配|自社株|自己株|受注|契約|承認|採択|提携|TOB|公開買付|分割/.test(t)) return { tone: '好材料寄り', className: 'good' };
  return { tone: '確認材料', className: 'wait' };
}

function relevantToStock(item, code, name) {
  const c = bareCode(code);
  const text = compactText(`${item.title || ''} ${item.source || ''}`);
  const nameKey = compactText(name || '');
  if (text.includes(compactText(c))) return true;
  if (nameKey && nameKey.length >= 2 && text.includes(nameKey)) return true;
  const shortName = nameKey.replace(/ホールディングス|グループ|工業|株式会社/g, '');
  return shortName.length >= 3 && text.includes(shortName);
}

async function fetchGoogleNewsForStock(code, name) {
  const c = bareCode(code);
  const q = `${c} ${name || ''} 株 急落 OR 下落 OR 決算 OR 材料 OR IR`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;
  try {
    const xml = await fetchTextSmart(url);
    const items = (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).map((raw) => {
      const title = stripXmlText(raw.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
      const link = stripXmlText(raw.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '');
      const pubDate = stripXmlText(raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '');
      const source = stripXmlText(raw.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || 'Google News');
      const tone = newsTone(title);
      const publishedAt = pubDate ? new Date(pubDate).toISOString() : '';
      const date = publishedAt ? new Date(publishedAt).toLocaleDateString('ja-JP') : '';
      const time = publishedAt ? new Date(publishedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
      return { source, title, url: link, pubDate, publishedAt, date, time, kind: 'ニュース', ...tone };
    }).filter((x) => x.title && relevantToStock(x, c, name));
    const seen = new Set();
    return items.filter((x) => {
      const key = compactText(x.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  } catch {
    return [];
  }
}

function buildDropDiagnosis({ quote, ir, news, name }) {
  const reasons = [];
  const alerts = [];
  const checks = [];
  const cp = Number(quote.changePct);
  const vr = Number(quote.volumeRatio);
  const bb = Number(quote.bbPos);
  const dd = Number(quote.drawdown20);

  if (Number.isFinite(cp)) {
    if (cp <= -5) reasons.push('当日5%以上の急落。通常の押し目より、材料・決算・地合い要因の確認を優先。');
    else if (cp <= -3) reasons.push('当日3%以上の下落。短期資金の売り、決算反応、セクター安の可能性。');
    else if (cp < 0) reasons.push('当日は下落。ただし急落というより通常調整の範囲の可能性。');
    else reasons.push('当日は上昇または横ばい。直近急落の理由を見る場合は数日チャートとニュースを確認。');
  }
  if (Number.isFinite(vr)) {
    if (vr >= 2.0 && cp < 0) alerts.push('下落日に出来高が2倍以上。悪材料反応・投げ売り・機関売りの可能性を警戒。');
    else if (vr >= 1.3 && cp < 0) alerts.push('下落日に出来高増。単なる薄商い下落ではなく、材料反応の可能性。');
    else if (vr < 0.8 && cp < 0) alerts.push('出来高を伴わない下落。閑散・地合い連動なら戻りやすいが、買いも弱い。');
  }
  if (Number.isFinite(bb)) {
    if (bb <= -2) alerts.push('BB下限割れ。値ごろ感だけでなく、下降トレンド入りか反発確認が必要。');
    else if (bb <= -1) reasons.push('BB -1σ以下。テクニカル上は押し目候補だが、下落理由の確認が必要。');
  }
  if (Number.isFinite(dd) && dd <= -10) alerts.push('20日高値から10%以上下落。材料悪化・需給悪化・セクター調整のいずれかを疑う。');

  const badIr = (ir.items || []).filter((x) => materialToneFromTitle(x.title).className === 'danger');
  const goodIr = (ir.items || []).filter((x) => materialToneFromTitle(x.title).className === 'good');
  const badNews = news.filter((x) => x.className === 'danger');
  if (badIr.length) alerts.unshift(`TDnetに悪材料寄りIR候補あり：${badIr[0].title}`);
  if (badNews.length) alerts.unshift(`ニュースに下落要因候補あり：${badNews[0].title}`);
  if (!badIr.length && !badNews.length && cp <= -3) checks.push('明確な悪材料が自動検出できない急落。地合い・セクター安・需給要因の可能性。');
  if (goodIr.length && cp < 0) checks.push('好材料IR後の下落なら、出尽くし売り・期待先行の剥落を確認。');

  checks.push('直近決算の進捗率と会社予想の修正有無');
  checks.push('信用買い残の増加、信用倍率、回転日数');
  checks.push('同業・同テーマも同時に売られているか');
  checks.push('寄り付きだけの売りか、大引けまで売られているか');

  let level = '通常確認';
  let className = 'wait';
  if (alerts.some((x) => /悪材料|下限割れ|出来高が2倍|10%以上/.test(x)) || cp <= -5) { level = '急落注意'; className = 'danger'; }
  else if (reasons.some((x) => /押し目候補/.test(x)) && !alerts.length) { level = '押し目候補'; className = 'good'; }

  const summary = alerts[0] || reasons[0] || `${name}の急落理由は自動判定では限定的。材料・需給・地合いを確認。`;
  return { level, className, summary, reasons, alerts, checks };
}

async function investigateDrop(raw) {
  const resolved = await resolveInput(raw);
  const quote = await fetchYahooQuote(resolved.code);
  const name = await getJapaneseName(quote.code, resolved.name || quote.name);
  quote.name = name;
  const ir = await fetchIrMaterials(quote.code);
  const news = await fetchGoogleNewsForStock(quote.code, name);
  const diagnosis = buildDropDiagnosis({ quote, ir, news, name });
  return {
    code: quote.code,
    name,
    fetchedAt: new Date().toISOString(),
    quote,
    ir,
    news,
    diagnosis,
    links: {
      yahoo: `https://finance.yahoo.co.jp/quote/${quote.code}.T`,
      kabutan: `https://kabutan.jp/stock/?code=${quote.code}`,
      tdnet: 'https://www.release.tdnet.info/inbs/I_main_00.html',
      credit: `https://www.google.com/search?q=${encodeURIComponent(`${quote.code} ${name} 信用倍率 買い残 売り残`)}`,
      reason: `https://www.google.com/search?q=${encodeURIComponent(`${quote.code} ${name} 急落 理由 決算 下落`)}`,
    }
  };
}

async function fetchChartSeries(code, range = '1d', interval = '5m') {
  const symbol = normalizeCode(code);
  const c = bareCode(symbol);
  const allowedRanges = new Set(['1d','5d','1mo','3mo','6mo','1y']);
  const allowedIntervals = new Set(['5m','15m','30m','60m','1d']);
  const safeRange = allowedRanges.has(String(range)) ? String(range) : '1d';
  const safeInterval = allowedIntervals.has(String(interval)) ? String(interval) : (safeRange === '1d' ? '5m' : '1d');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${safeRange}&interval=${safeInterval}&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 oshime-dashboard' } });
  if (!res.ok) throw new Error(`Yahoo Finance chart ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('チャートデータを取得できませんでした');
  const q = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const closes = q.close || [];
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const volumes = q.volume || [];
  const points = timestamps.map((t, i) => ({
    time: new Date(Number(t) * 1000).toISOString(),
    close: Number.isFinite(closes[i]) ? yen(closes[i]) : null,
    open: Number.isFinite(opens[i]) ? yen(opens[i]) : null,
    high: Number.isFinite(highs[i]) ? yen(highs[i]) : null,
    low: Number.isFinite(lows[i]) ? yen(lows[i]) : null,
    volume: Number.isFinite(volumes[i]) ? volumes[i] : null,
  })).filter((p) => Number.isFinite(p.close));
  return { code: c, range: safeRange, interval: safeInterval, points, fetchedAt: new Date().toISOString() };
}

function businessHintsFromText({ name, sector, text }) {
  const hay = `${name || ''} ${sector || ''} ${text || ''}`;
  const hints = [];
  if (/医療|製薬|病院|治験|メディカル|ヘルス|m3|エムスリー/i.test(hay)) hints.push('医療・製薬・病院向けサービス。成長鈍化や市場期待未達で売られやすいタイプ。');
  if (/半導体|製造装置|材料|シリコン|露光|検査/i.test(hay)) hints.push('半導体サイクル、設備投資、米中規制、AI投資の影響を受けやすい。');
  if (/宇宙|衛星|SAR|打上|ロケット/i.test(hay)) hints.push('宇宙・衛星テーマ。材料で動きやすいが、赤字・資金調達・打上げ進捗に注意。');
  if (/銀行|保険|金融|証券/i.test(hay)) hints.push('金利・信用コスト・政策保有株・自己株買いが株価材料になりやすい。');
  if (/鉄鋼|化学|石油|資源|商社/i.test(hay)) hints.push('市況・為替・原材料価格・中国需要・配当政策の影響が大きい。');
  if (/通信|携帯|ネットワーク/i.test(hay)) hints.push('通信・インフラ系。成長率より配当・還元・料金政策・設備投資を確認。');
  if (/小売|食品|外食|消費/i.test(hay)) hints.push('月次、値上げ、原材料費、インバウンド、既存店売上が重要。');
  if (/自動車|部品|EV|電池/i.test(hay)) hints.push('為替、米国販売、中国競争、EV投資、部品市況の影響を受けやすい。');
  if (!hints.length) hints.push('事業内容、決算説明資料、直近IRを確認して、下落が一時要因か構造要因かを切り分ける。');
  return hints;
}


function inferBusinessType(code, name = '', sector = '') {
  const c = bareCode(code);
  const t = `${name} ${sector}`;
  if (['7532','7453','8267','9843','3099','3086','8233','8252','9983','3092','3382'].includes(c) || /小売|百貨店|スーパー|ドンキ|ニトリ|イオン|無印|高島屋|三越|伊勢丹|ファストリ|ZOZO/.test(t)) return 'retail';
  if (/食品|水産|飲料|たばこ|キッコ|ニッスイ|味の素|明治|キリン|アサヒ|JT/.test(t)) return 'food';
  if (/医療|薬|製薬|病院|ヘルス|エムスリー|武田|第一三共|中外|アステラス|エーザイ/.test(t)) return 'healthcare';
  if (/半導体|電機|電子|精密|AI|ソフト|ゲーム|ネット|通信|データ|システム|リクルート|ヤフー|楽天|NRI/.test(t)) return 'tech';
  if (/銀行|保険|証券|金融|リース|オリックス|MUFG|野村|大和/.test(t)) return 'finance';
  if (/石油|鉄鋼|化学|商社|資源|素材|金属|ガラス/.test(t)) return 'cyclical';
  if (/自動車|部品|機械|重工|造船|建機|ロボット/.test(t)) return 'industrial';
  if (/不動産|建設|住宅/.test(t)) return 'realestate';
  if (/鉄道|航空|海運|陸運/.test(t)) return 'transport';
  return 'general';
}

function templateCompanyProfile({ code, name, sector }) {
  const type = inferBusinessType(code, name, sector);
  const base = { source: '業種テンプレート+銘柄名推定', confidence: '中〜低' };
  const common = {
    general: {
      profile: `${name}は上場企業です。自動取得できる会社説明が限定的なため、事業内容は公式IR・決算説明資料・有価証券報告書で確認してください。`,
      segments: '主な稼ぎ方は、決算説明資料のセグメント別売上・利益で確認してください。売上だけでなく、営業利益、利益率、通期見通し、受注/在庫/単価などを見ます。',
      freshThemes: ['直近IR', '決算説明資料', '中期経営計画', 'セクター材料'],
      riskPoints: ['下方修正', '赤字転落', '希薄化', '信用需給悪化'],
      watchPoints: ['直近決算', '通期見通し', 'セグメント別売上・利益', '売られている理由', '信用需給'],
      oshimeUse: 'テクニカルだけでなく、売られている理由が一時要因か構造要因かを確認します。'
    },
    retail: {
      profile: `${name}は小売・消費関連の企業として見ます。店舗/ECで商品を販売し、既存店売上・客数・客単価・粗利率・在庫・販管費が株価判断の中心になります。`,
      segments: '主な稼ぎ方は店舗販売、EC、PB/高粗利商品、カード/金融・不動産など周辺事業です。月次、既存店売上、粗利率、在庫回転、インバウンド/免税、店舗改装の進捗を確認します。',
      freshThemes: ['既存店売上', 'インバウンド/免税', 'PB・高粗利商品', '店舗改装/出店', 'EC/アプリ会員'],
      riskPoints: ['消費鈍化', '人件費/物流費増', '在庫増', '粗利率悪化', '円高/円安影響'],
      watchPoints: ['月次既存店', '客数/客単価', '粗利率', '在庫', '免税売上', '販管費'],
      oshimeUse: '月次や粗利が崩れていない下落なら押し目候補。月次悪化・在庫増・粗利率低下が同時に出ているなら反発確認待ち。'
    },
    food: {
      profile: `${name}は食品・水産・飲料など生活必需品系の企業として見ます。ブランド、値上げ、原材料価格、海外展開、機能性/高付加価値商品が重要です。`,
      segments: '主な稼ぎ方は食品・飲料・水産/加工・海外・機能性素材などです。値上げ浸透、原材料/飼料/物流費、為替、海外売上、利益率を確認します。',
      freshThemes: ['値上げ浸透', '海外展開', '高付加価値商品', '機能性素材', '原材料コスト改善'],
      riskPoints: ['原材料高', '為替', '消費鈍化', '値上げ不発', '市況悪化'],
      watchPoints: ['売上成長', '営業利益率', '原材料価格', '海外売上', '値上げ効果'],
      oshimeUse: '生活必需品系は地合い売りなら戻りやすい一方、原材料高や値上げ不発なら利益率悪化に注意。'
    },
    healthcare: {
      profile: `${name}は医薬品・医療DX・ヘルスケア関連として見ます。製品/サービスの成長率、研究開発、薬価、治験、顧客基盤、市場期待との差が重要です。`,
      segments: '主な稼ぎ方は医薬品販売、医療サービス、製薬支援、治験/人材/病院向けサービスなどです。市場予想との差、研究開発費、成長率、海外展開を確認します。',
      freshThemes: ['医療DX', '治験/臨床開発', '新薬/承認', '海外展開', '市場予想との差'],
      riskPoints: ['成長鈍化', '承認失敗', '薬価/規制', '市場期待未達', 'PER調整'],
      watchPoints: ['通期計画', 'コンセンサス差', '成長率', '研究開発', '利益率'],
      oshimeUse: '期待値で売られることが多いため、増益でも予想未達なら反発確認が必要。'
    },
    tech: {
      profile: `${name}はテック・電子・通信・ネット関連として見ます。需要サイクル、受注、ユーザー数、AI/半導体投資、利益率、成長期待が重要です。`,
      segments: '主な稼ぎ方は製品販売、ソフト/サービス、広告、通信/データ、装置/部材などです。受注・ARR/会員数・利益率・設備投資サイクルを確認します。',
      freshThemes: ['AI投資', '半導体サイクル', '受注回復', 'クラウド/データ', 'ユーザー成長'],
      riskPoints: ['高PER調整', '受注鈍化', '在庫調整', '競争激化', '規制'],
      watchPoints: ['受注', '売上成長', '利益率', '通期計画', '投資サイクル'],
      oshimeUse: 'テーマ売りか業績鈍化かを分ける。高PER銘柄はBB下限でも期待剥落なら下げが続きやすい。'
    },
    finance: {
      profile: `${name}は金融・証券・保険関連として見ます。金利、市場売買代金、信用コスト、運用収益、還元策が重要です。`,
      segments: '主な稼ぎ方は金利収益、手数料、トレーディング、保険料/運用、資産管理などです。金利動向、相場環境、自己株買い/配当を確認します。',
      freshThemes: ['金利上昇', '日本株活況', '新NISA/資産運用', '政策保有株売却', '還元策'],
      riskPoints: ['相場急落', '信用コスト', 'トレーディング損失', '金利急変', '海外損失'],
      watchPoints: ['金利', '還元策', '与信費用', '売買代金', '自己株買い'],
      oshimeUse: '地合い調整なら押し目候補。個別損失や信用コスト増なら慎重。'
    },
    cyclical: {
      profile: `${name}は市況・素材・資源関連として見ます。商品市況、原材料、為替、中国需要、配当/還元が重要です。`,
      segments: '主な稼ぎ方は素材・資源・エネルギー・商社取引などです。市況、在庫評価、スプレッド、原材料価格、為替を確認します。',
      freshThemes: ['商品市況', '高配当/還元', '地政学', '中国需要', '脱炭素/再編'],
      riskPoints: ['市況悪化', '在庫損', '中国需要減', '原材料高', '為替急変'],
      watchPoints: ['市況', '配当', '在庫影響', '為替', '中国需要'],
      oshimeUse: '市況連動の一時下落か、業績悪化の下落かを分ける。'
    },
    industrial: {
      profile: `${name}は機械・自動車・重工など製造業関連として見ます。受注、設備投資、為替、原材料、人件費、海外需要が重要です。`,
      segments: '主な稼ぎ方は製品販売、保守、部品、海外売上などです。受注残、設備投資サイクル、為替感応度、利益率を確認します。',
      freshThemes: ['設備投資', '防衛/インフラ', '円安メリット', '受注残', '省人化'],
      riskPoints: ['受注減', '原材料高', '円高', '中国/米国需要鈍化', '在庫調整'],
      watchPoints: ['受注', '受注残', '為替', '利益率', '通期計画'],
      oshimeUse: '受注が維持されている地合い売りなら押し目候補。受注鈍化なら慎重。'
    },
    realestate: {
      profile: `${name}は不動産・建設・住宅関連として見ます。金利、賃料、空室率、分譲利益、再開発、含み益が重要です。`,
      segments: '主な稼ぎ方は賃貸、分譲、管理、ホテル/商業施設、開発利益などです。金利と物件市況を確認します。',
      freshThemes: ['都市再開発', '賃料上昇', 'インバウンド/ホテル', '含み益/還元'],
      riskPoints: ['金利上昇', '空室率', '評価損', '工事費増', '事故/施設トラブル'],
      watchPoints: ['金利', '賃料', '空室率', '分譲利益', '還元策'],
      oshimeUse: '金利連動の下落か個別悪材料かを分ける。'
    },
    transport: {
      profile: `${name}は交通・運輸関連として見ます。旅客/貨物需要、燃料費、為替、インバウンド、設備投資が重要です。`,
      segments: '主な稼ぎ方は旅客輸送、貨物、関連施設、不動産/流通などです。利用者数、単価、燃料費、設備投資を確認します。',
      freshThemes: ['インバウンド', '旅客回復', '運賃改定', '物流需要', '不動産活用'],
      riskPoints: ['燃油高', '災害/事故', '需要鈍化', '人件費増', '円安コスト'],
      watchPoints: ['旅客数', '単価', '燃油費', '設備投資', '不動産収益'],
      oshimeUse: '一時的な地合い売りか、事故/燃料費/需要悪化かを切り分ける。'
    }
  };
  return { ...base, ...(common[type] || common.general) };
}

function extractThemesFromMaterials(materials = []) {
  const titles = materials.map((x) => x.title || '').filter(Boolean);
  const good = [];
  const bad = [];
  for (const title of titles) {
    if (/上方|増益|増配|自社株|受注|提携|承認|採択|月次.*増|最高/.test(title)) good.push(title);
    if (/下方|減益|赤字|減損|減配|急落|大幅安|売られ|格下げ|目標株価.*下げ|ワラント|増資|延期|中止/.test(title)) bad.push(title);
  }
  return { good: good.slice(0, 5), bad: bad.slice(0, 5), all: titles.slice(0, 8) };
}

async function fetchCompanyProfile(code) {
  const c = bareCode(code);
  const local = localSymbol(c);
  const seed = companySeed(c);
  const name = await getJapaneseName(c, local?.name || c);
  const sector = local?.sector || '';

  let profile = seed?.profile || '';
  let segments = seed?.segments || '';
  let source = seed?.source || '';
  let fetchStatus = seed ? '内蔵DBから取得' : '外部取得を試行';
  const attemptedSources = [];

  if (!profile || !segments) {
    try {
      attemptedSources.push('株探');
      const html = await fetchTextSmart(`https://kabutan.jp/stock/?code=${encodeURIComponent(c)}`);
      const text = stripTags(html).replace(/\s+/g, ' ');
      const tokushoku = text.match(/特色\s*([^【\[]{18,320})/);
      const jigyo = text.match(/連結事業\s*([^【\[]{18,360})/);
      if (!profile && tokushoku?.[1]) { profile = tokushoku[1].replace(/決算|業績|株価.*$/,'').trim(); source = '株探'; }
      if (!segments && jigyo?.[1]) segments = jigyo[1].replace(/海外|比較会社.*$/,'').trim();
    } catch {}
  }

  if (!profile) {
    try {
      attemptedSources.push('Yahooファイナンス');
      const html = await fetchTextSmart(`https://finance.yahoo.co.jp/quote/${encodeURIComponent(c)}.T`);
      const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1]
        || '';
      const cleaned = decodeHtmlEntity(desc).replace(/株価|掲示板|ニュース|Yahoo.*$/g, '').trim();
      if (cleaned && !/株価|掲示板|チャート/.test(cleaned)) { profile = cleaned.slice(0, 280); source = 'Yahooファイナンス'; }
    } catch {}
  }

  const hints = seed?.businessHints || businessHintsFromText({ name, sector, text: `${profile} ${segments}` });
  const watchPoints = seed?.watchPoints || defaultWatchPoints({ name, sector, text: `${profile} ${segments}` });
  const confidence = seed ? '高' : profile ? '中' : '低';
  if (!source) source = profile ? '外部取得' : '未取得';
  const template = (!profile || !segments) ? templateCompanyProfile({ code: c, name, sector }) : null;
  if (!profile && template) { profile = template.profile; source = template.source; fetchStatus = '外部会社説明が弱いため、業種テンプレートで補完'; }
  if (!segments && template) segments = template.segments;
  const mergedFreshThemes = seed?.freshThemes || template?.freshThemes || inferFreshThemes({ name, sector, text: `${profile} ${segments}` });
  const mergedRiskPoints = seed?.riskPoints || template?.riskPoints || inferRiskPoints({ name, sector, text: `${profile} ${segments}` });
  const mergedWatchPoints = seed?.watchPoints || template?.watchPoints || watchPoints;
  const mergedOshimeUse = seed?.oshimeUse || template?.oshimeUse || '会社の稼ぎ方・直近IR・セクター材料を確認し、売られている理由が一時要因か構造要因かを切り分ける。';
  const finalConfidence = seed ? '高' : profile ? (template ? '中〜低' : '中') : '低';

  return {
    code: c,
    name,
    sector,
    profile,
    segments,
    businessHints: seed?.businessHints || template?.businessHints || hints,
    watchPoints: mergedWatchPoints,
    freshThemes: mergedFreshThemes,
    riskPoints: mergedRiskPoints,
    oshimeUse: mergedOshimeUse,
    confidence: finalConfidence,
    fetchStatus,
    attemptedSources,
    source,
    links: {
      kabutan: `https://kabutan.jp/stock/?code=${c}`,
      yahoo: `https://finance.yahoo.co.jp/quote/${c}.T`,
      minkabu: `https://minkabu.jp/stock/${c}`,
      irSearch: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + name + ' IR 決算説明資料 事業内容 セグメント')}`,
      profileSearch: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + name + ' 何をしている会社 事業内容')}`,
      reasonSearch: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + name + ' 急落 理由 決算 下落')}`,
      creditSearch: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + name + ' 信用倍率 買い残 売り残')}`,
    },
    fetchedAt: new Date().toISOString(),
  };
}


function inferFreshThemes({ name, sector, text }) {
  const hay = `${name || ''} ${sector || ''} ${text || ''}`;
  if (/水産|食品|養殖|サーモン|ブリ/i.test(hay)) return ['養殖・高付加価値食品', '値上げ浸透', '海外展開', '原材料/飼料コスト改善'];
  if (/医療|製薬|病院|治験|メディカル|ヘルス/i.test(hay)) return ['医療DX', '治験効率化', '製薬マーケティング支援', '医療人材/病院DX'];
  if (/宇宙|衛星|SAR|ロケット/i.test(hay)) return ['衛星打ち上げ', '政府・防衛需要', '衛星データ販売', '資金調達状況'];
  if (/半導体|製造装置|材料/i.test(hay)) return ['AI投資', '半導体設備投資', '受注回復', '中国規制の影響'];
  if (/証券|金融|銀行|保険/i.test(hay)) return ['日本株活況', '新NISA/資産運用', '金利上昇', '還元策'];
  if (/不動産/i.test(hay)) return ['都市再開発', '賃料上昇', 'ホテル/インバウンド', '金利動向'];
  return ['直近IR', '決算説明資料', '中期経営計画', 'セクター材料'];
}

function inferRiskPoints({ name, sector, text }) {
  const hay = `${name || ''} ${sector || ''} ${text || ''}`;
  if (/水産|食品|養殖|サーモン|ブリ/i.test(hay)) return ['原材料・飼料価格', '魚病/海水温', '市況悪化', '値上げ不発'];
  if (/医療|製薬|病院|治験|メディカル|ヘルス/i.test(hay)) return ['市場期待未達', '成長鈍化', 'PER調整', '製薬需要の鈍化'];
  if (/宇宙|衛星|SAR|ロケット/i.test(hay)) return ['打ち上げ遅延/失敗', '増資/ワラント', '赤字継続', '期待先行剥落'];
  if (/半導体|製造装置|材料/i.test(hay)) return ['設備投資減速', '在庫調整', '米中規制', '高PER調整'];
  if (/証券|金融|銀行|保険/i.test(hay)) return ['相場急落', '信用コスト', 'トレーディング損失', '金利急変'];
  if (/不動産/i.test(hay)) return ['金利上昇', '空室率上昇', '評価損', '事故/施設トラブル'];
  return ['下方修正', '赤字転落', '希薄化', '信用需給悪化'];
}

function defaultWatchPoints({ name, sector, text }) {
  const hay = `${name || ''} ${sector || ''} ${text || ''}`;
  if (/医療|製薬|病院|治験|メディカル|ヘルス|m3|エムスリー/i.test(hay)) return ['市場予想との比較', '成長率の鈍化有無', '製薬・治験・人材の伸び', '自社株買い・還元策', 'PERと成長率の釣り合い'];
  if (/半導体|製造装置|材料|シリコン|露光|検査/i.test(hay)) return ['受注・在庫', 'AI投資', '中国規制', '設備投資サイクル', '利益率'];
  if (/宇宙|衛星|SAR|打上|ロケット/i.test(hay)) return ['打ち上げ進捗', '受注残', '資金調達', '赤字幅', '希薄化'];
  if (/銀行|保険|金融|証券/i.test(hay)) return ['金利', '与信費用', '還元策', '政策保有株', '自己株買い'];
  if (/鉄鋼|化学|石油|資源|商社/i.test(hay)) return ['市況', '原材料価格', '為替', '配当', '中国需要'];
  return ['直近決算', '通期見通し', 'セグメント別売上・利益', '売られている理由', '信用需給'];
}


function firstSentence(text, fallback = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  const m = t.match(/^(.{24,180}?[。.!?])\s*/);
  return (m ? m[1] : t.slice(0, 180)).trim();
}

function pctText(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(2)}%`;
}

function yenText(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Math.round(Number(v)).toLocaleString('ja-JP')}円`;
}

function materialTitles(items = [], n = 3) {
  return (items || []).filter(x => x && x.title).slice(0, n).map(x => x.title);
}

function inferBusinessTypeForNarrative({ name, sector, profile = '', segments = '' }) {
  const hay = `${name || ''} ${sector || ''} ${profile || ''} ${segments || ''}`;
  if (/断熱|ウレタン|建材|省エネ|住宅/i.test(hay)) return 'building_materials';
  if (/医療|製薬|病院|治験|m3|エムスリー|メディカル/i.test(hay)) return 'medical_dx';
  if (/水産|養殖|食品|サーモン|ブリ/i.test(hay)) return 'food_aquaculture';
  if (/宇宙|衛星|SAR|ロケット/i.test(hay)) return 'space';
  if (/半導体|AI|量子|ソフト|GPU|HPC|システム|DX/i.test(hay)) return 'tech_growth';
  if (/不動産|住宅|マンション|オフィス|賃貸|再開発/i.test(hay)) return 'realestate';
  if (/銀行|証券|保険|金融/i.test(hay)) return 'finance';
  if (/鉄鋼|化学|素材|石油|資源|商社/i.test(hay)) return 'cyclical';
  return 'general';
}

function narrativeTemplates(type) {
  const dict = {
    building_materials: {
      drivers: ['省エネ基準・断熱性能向上', '住宅/非住宅の着工', '価格転嫁', '施工能力・人員体制'],
      risks: ['原料高', '円安', '住宅着工減', '価格転嫁遅れ', '施工コスト増'],
      angle: '断熱・省エネ建材は政策/電気代/住宅性能の追い風を受けやすい一方、化学原料・施工コストに利益率が左右されます。'
    },
    medical_dx: {
      drivers: ['医療DX', '製薬会社向け支援', '治験/臨床開発', '医療人材', '自社株買い/還元'],
      risks: ['市場期待未達', '成長率鈍化', 'PER調整', '製薬会社の販促費抑制'],
      angle: '医療DX/製薬支援系は、業績そのものより市場期待との差で売られやすく、増収増益でも保守予想なら評価倍率が切り下がります。'
    },
    food_aquaculture: {
      drivers: ['養殖高度化', '食品の値上げ浸透', '海外展開', 'ファインケミカル', '原材料コスト改善'],
      risks: ['飼料価格', '魚病/海水温', '市況悪化', '値上げ不発', '海外事業悪化'],
      angle: '水産食品は市況株に見えますが、養殖・加工食品・ファインケミカルなどの成長/改善テーマが残っているかが歪み判定の軸になります。'
    },
    space: {
      drivers: ['打ち上げ進捗', '衛星機数', '政府/防衛契約', 'データ販売', '受注残'],
      risks: ['打ち上げ遅延/失敗', '赤字継続', '増資/ワラント', '期待先行剥落'],
      angle: '宇宙関連は連続的な業績より、打ち上げ・受注・資金調達など離散イベントで評価が変わります。'
    },
    tech_growth: {
      drivers: ['AI/半導体投資', '受注・顧客開拓', '利益率', '新規テーマの実需化'],
      risks: ['高PER調整', '期待先行剥落', '受注鈍化', 'テーマ資金流出'],
      angle: '技術成長株は会社が壊れていなくても、期待値が高すぎると大きく売られます。期待剥落か実需悪化かの分離が重要です。'
    },
    realestate: {
      drivers: ['賃料上昇', '都市再開発', 'ホテル/インバウンド', '還元策', '含み益'],
      risks: ['金利上昇', '空室率', '分譲利益悪化', '評価損', '事故/施設トラブル'],
      angle: '不動産は金利・地合いで一括売りされやすいので、コンセンサスや賃料/再開発が崩れていない安値圏は歪み候補になります。'
    },
    finance: {
      drivers: ['金利上昇', '相場活況', '資産運用需要', '還元策'],
      risks: ['相場急落', '信用コスト', 'トレーディング損失', '金利急変'],
      angle: '金融は個別よりマクロ/相場環境の影響が大きく、悪材料の有無と還元姿勢で押し目の質が変わります。'
    },
    cyclical: {
      drivers: ['商品市況', '為替', '高配当/還元', '中国需要', 'スプレッド改善'],
      risks: ['市況悪化', '在庫損', '中国需要減', '原材料高'],
      angle: '市況株は「安い」だけではなく、市況・スプレッド・配当姿勢が維持されているかを見ます。'
    },
    general: {
      drivers: ['直近IR', '決算進捗', '通期見通し', 'セグメント利益', '還元策'],
      risks: ['下方修正', '赤字転落', '希薄化', '信用需給悪化', '市場期待未達'],
      angle: 'まず事業内容・稼ぎ方・直近IRを照合し、下落が一時要因か構造要因かを切り分けます。'
    }
  };
  return dict[type] || dict.general;
}


function hasHighConfidenceCompanyProfile(profile = {}) {
  const src = String(profile.source || '');
  const conf = String(profile.confidence || '');
  const text = `${profile.profile || ''} ${profile.segments || ''}`;
  if (/内蔵会社DB|株探|Yahooファイナンス/.test(src) && !/業種テンプレート|銘柄名推定|未取得/.test(src)) return true;
  if (/高|中/.test(conf) && text.length >= 120 && !/上場企業です|公式IR|決算説明資料|有価証券報告書で確認/.test(text)) return true;
  return false;
}

function buildEvidenceOnlyCompanyReport({ profile, quote, good, bad, neutral, uniqueMaterials }) {
  const materialGood = materialTitles(good, 3);
  const materialBad = materialTitles(bad, 3);
  const materialNeutral = materialTitles(neutral, 4);
  const hasMaterials = uniqueMaterials && uniqueMaterials.length;
  let headline = '高信頼の会社説明は未取得です。テンプレ文章では判断せず、取れた材料と公式IRで確認してください。';
  let className = 'wait';
  if (materialBad.length) { headline = '会社説明は弱い一方、悪材料候補があります。まず開示本文を優先確認してください。'; className = 'danger'; }
  else if (materialGood.length) { headline = '会社説明は弱い一方、好材料候補があります。材料の金額・時期・通期影響を確認してください。'; className = 'good'; }
  return {
    type: 'evidence_only',
    headline,
    className,
    sections: [
      { title: '取得できた確定情報', body: `${profile.name || profile.code} / ${profile.sector || '業種未取得'}。会社概要は高信頼ソースから自動取得できていません。` },
      { title: '自動検出した材料', body: hasMaterials ? `確認対象は「${[...materialGood, ...materialBad, ...materialNeutral].filter(Boolean).slice(0, 4).join('」「')}」。タイトルだけで良悪を決めず、本文の金額・時期・通期影響を見ます。` : '銘柄一致のIR/ニュース材料は限定的です。公式IR・決算説明資料・有報で事業内容と通期見通しを確認してください。' },
      { title: '株価反応だけで見るなら', body: quote ? `現在値は${yenText(quote.price)}、前日比は${pctText(quote.changePct)}、出来高倍率は${quote.volumeRatio == null ? '—' : Number(quote.volumeRatio).toFixed(2)+'倍'}です。事業内容が取れていない銘柄では、テクニカル判定は仮説止まりにします。` : '株価データは未取得です。' },
    ],
    bullets: {
      drivers: materialGood.length ? materialGood : [],
      risks: materialBad.length ? materialBad : [],
      checks: ['公式IR', '決算説明資料', '有価証券報告書の事業内容', 'セグメント別売上・利益', '通期見通し', '信用需給']
    },
    lowConfidence: true
  };
}

function buildChattyCompanyReport({ profile, quote, good, bad, neutral, uniqueMaterials }) {
  if (!hasHighConfidenceCompanyProfile(profile)) {
    return buildEvidenceOnlyCompanyReport({ profile, quote, good, bad, neutral, uniqueMaterials });
  }
  const type = inferBusinessTypeForNarrative({ name: profile.name, sector: profile.sector, profile: profile.profile, segments: profile.segments });
  const tmpl = narrativeTemplates(type);
  const priceMove = quote ? `現在値は${yenText(quote.price)}、前日比は${pctText(quote.changePct)}です。` : '株価データは未取得です。';
  const bbNote = quote?.bbPos != null
    ? quote.bbPos <= -2 ? 'BB下限割れで、テクニカル上はかなり売られています。ここは「安い」より先に、悪材料の深刻度と下げ止まりを確認する位置です。'
      : quote.bbPos <= -1 ? 'BB -1σ〜下限付近で、悪材料が軽いなら押し目・試し玉候補になりやすい位置です。'
      : quote.bbPos >= 1 ? 'BB中心より上で、押し目というより上昇継続・浅押し待ちの見方が自然です。'
      : 'BB中心付近で、方向感よりも材料と出来高の確認が必要です。'
    : 'BB位置は未取得です。';
  const materialGood = materialTitles(good, 3);
  const materialBad = materialTitles(bad, 3);
  const materialNeutral = materialTitles(neutral, 3);
  let decision = '材料確認型。事業内容・直近決算・需給を合わせて、拾える下落かを判断します。';
  let decisionClass = 'wait';
  if (materialBad.length) {
    decision = '悪材料候補があります。株価反応が大きくても、まず本文で一過性か構造悪化かを確認する局面です。';
    decisionClass = 'danger';
  } else if (quote?.score >= 60 && quote?.predictedRR >= 1.5 && !materialBad.length) {
    decision = '株価は売られていますが、明確な悪材料が強く出ていないため、事業シナリオが維持されていれば歪み・試し玉候補です。';
    decisionClass = 'good';
  } else if (materialGood.length) {
    decision = '好材料候補があります。材料後の利確・地合い売りなら、押し目/戻り選別として見る価値があります。';
    decisionClass = 'good';
  }
  return {
    type,
    headline: decision,
    className: decisionClass,
    sections: [
      { title: '何をしている会社か', body: firstSentence(profile.profile, `${profile.name}は${profile.sector || '上場企業'}です。事業内容は公式IR・決算説明資料で確認してください。`) },
      { title: '主な稼ぎ方', body: firstSentence(profile.segments, '主な稼ぎ方はセグメント別売上・利益、通期見通し、利益率で確認します。') },
      { title: '今伸びる理由', body: `${tmpl.angle} 見るべき材料は、${[...(profile.freshThemes || []), ...tmpl.drivers].slice(0, 5).join('、')}です。${materialGood.length ? `直近では「${materialGood.join('」「')}」も確認対象です。` : ''}` },
      { title: '悪材料・注意点', body: `注意点は、${[...(profile.riskPoints || []), ...tmpl.risks].slice(0, 5).join('、')}です。${materialBad.length ? `直近の悪材料候補は「${materialBad.join('」「')}」です。` : '現時点で強い悪材料候補が自動検出されない場合でも、決算本文・通期見通し・信用需給は確認します。'}` },
      { title: '直近決算・材料の読み方', body: materialNeutral.length || uniqueMaterials.length ? `自動検出した材料は${uniqueMaterials.length}件です。確認材料として「${[...materialNeutral, ...materialGood, ...materialBad].slice(0, 3).join('」「')}」を優先して本文確認します。タイトルだけでは良悪を断定せず、金額・時期・通期影響を見ます。` : '直近材料が少ないため、公式IR、決算短信、決算説明資料、月次/受注/中計を直接確認します。' },
      { title: '株価反応の見方', body: `${priceMove}${bbNote}${quote?.volumeRatio != null ? ` 出来高倍率は${Number(quote.volumeRatio).toFixed(2)}倍です。` : ''} 下落時に出来高が急増していれば投げ売り/材料売り、反発時に出来高が増えれば買い戻し初動として見ます。` },
      { title: '押し目・歪みとして見るなら', body: `${profile.oshimeUse || '売られている理由が一時要因か構造要因かを切り分けます。'} 結論としては「${decision}」` },
    ],
    bullets: {
      drivers: [...new Set([...(profile.freshThemes || []), ...tmpl.drivers])].slice(0, 7),
      risks: [...new Set([...(profile.riskPoints || []), ...tmpl.risks])].slice(0, 7),
      checks: [...new Set([...(profile.watchPoints || []), '直近IR本文', '通期見通し', '信用需給'])].slice(0, 8),
    }
  };
}





function stripForPrompt(s, max = 600) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function compactMaterialForAI(items = [], n = 10) {
  return (items || []).slice(0, n).map((x) => ({
    source: x.source || '',
    date: x.date || x.time || x.publishedAt || x.pubDate || '',
    title: stripForPrompt(x.title, 180),
    tone: x.tone || x.kind || '',
    url: x.url || x.link || '',
  }));
}

function buildAiCompanyPrompt(report) {
  const q = report.quote || {};
  const materials = compactMaterialForAI(report.materials || [], 12);
  const payload = {
    code: report.code,
    name: report.name,
    sector: report.sector,
    confidence: report.confidence,
    source: report.source,
    price: q.price,
    changePct: q.changePct,
    bbPos: q.bbPos,
    predictedRR: q.predictedRR,
    volumeRatio: q.volumeRatio,
    score: q.score,
    dangerScore: q.dangerScore,
    totalJudge: q.totalJudge,
    businessProfile: stripForPrompt(report.business?.profile, 900),
    segments: stripForPrompt(report.business?.segments, 900),
    watchPoints: report.business?.watchPoints || [],
    growthThemes: report.growth?.themes || [],
    riskPoints: report.risks?.points || [],
    judgement: report.summary?.judgement || '',
    technicalNotes: report.summary?.technicalNotes || [],
    materials,
  };
  return `あなたは日本株の会社調査アシスタントです。以下の取得データを材料に、投資推奨ではなく「事業理解・材料の質・下落/上昇反応の解釈」を整理してください。

重要ルール:
- データにない事実は断定しない。
- 不明な点は「未確認」と明記する。
- 株を買え/売れとは言わない。
- ただし、ユーザーが知りたい「歪み」「試し玉」「上昇継続」「回避」の判断材料ははっきり整理する。
- 薄い一般論ではなく、銘柄固有の見方に寄せる。
- 日本語で、短すぎず長すぎず、右側パネルで読める密度にする。

出力形式:
# 会社調査AIサマリー
## 1. 何をしている会社か
## 2. 主な稼ぎ方・事業構造
## 3. 今見るべき成長材料
## 4. 悪材料・逆風候補
## 5. 直近材料と株価反応の読み方
## 6. 歪み/試し玉として見るなら
## 7. 次に確認する一次情報

取得データ(JSON):
${JSON.stringify(payload, null, 2)}`;
}

async function callOpenAICompanyResearch(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY が未設定です。.env に OPENAI_API_KEY=... を入れるとAI会社調査が使えます。');
    err.status = 401;
    throw err;
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.2,
      max_output_tokens: 1800,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const text = data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || '').filter(Boolean).join('\n');
  return { model, text: text || 'AI出力を取得できませんでした。', rawId: data.id || null };
}


async function fetchCompanyInvestigation(code) {
  const c = bareCode(code);
  const profile = await fetchCompanyProfile(c);
  let quote = null;
  try { quote = await fetchYahooQuote(c); } catch {}
  let ir = { items: [], summary: null };
  try { ir = await fetchIrMaterials(c); } catch {}
  let news = [];
  try { news = await fetchGoogleNewsForStock(c, profile.name); } catch {}

  const materials = [...(ir.items || []), ...(news || [])]
    .filter((x) => x && x.title)
    .map((x) => {
      const tone = x.tone ? { tone: x.tone, className: x.className || 'wait' } : materialToneFromTitle(x.title);
      return { ...x, tone: tone.tone, className: tone.className };
    });
  const seen = new Set();
  const uniqueMaterials = materials.filter((x) => {
    const key = compactText(x.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);

  const good = uniqueMaterials.filter((x) => x.className === 'good').slice(0, 5);
  const bad = uniqueMaterials.filter((x) => x.className === 'danger').slice(0, 5);
  const neutral = uniqueMaterials.filter((x) => x.className === 'wait').slice(0, 6);

  const technicalNotes = [];
  if (quote) {
    if (quote.score >= 80) technicalNotes.push('テクニカル上はかなり売られています。ただしスコアは「売られ具合」で、買い判定ではありません。');
    if (quote.bbPos <= -2) technicalNotes.push('BB下限割れ。悪材料がある場合は押し目ではなく下落継続の可能性があります。');
    else if (quote.bbPos <= -1) technicalNotes.push('BB -1σ〜下限付近。悪材料がなければ押し目監視に入りやすい位置です。');
    if (quote.volumeRatio >= 1.5 && quote.changePct < 0) technicalNotes.push('出来高を伴う下落。投げ売りか材料売りかを優先確認してください。');
    if (quote.predictedRR >= 2) technicalNotes.push('予測RRは2倍以上。反発確認が取れれば数値上は候補になりやすいです。');
  }

  let judgement = '確認材料不足。事業内容・直近IR・ニュースを照合して判断。';
  let className = 'wait';
  if (bad.length) {
    judgement = '悪材料候補が検出されています。押し目ではなく材料売りの可能性があるため、開示本文と下落継続リスクを優先確認。';
    className = 'danger';
  } else if (quote?.dangerScore >= 70) {
    judgement = 'テクニカル上の売られすぎは強い一方、出来高急増・急落・下限割れなど危険度が高めです。即買いより反発確認と下落理由確認を優先。';
    className = 'danger';
  } else if (quote?.score >= 70 && !bad.length) {
    judgement = '明確な悪材料は強く検出されていません。テクニカル売られすぎ＋事業シナリオ維持なら押し目候補。ただし5分足の反発確認が必要。';
    className = quote?.predictedRR >= 2 ? 'good' : 'wait';
  } else if (good.length) {
    judgement = '好材料候補があります。材料後の調整なら押し目になり得ますが、すでに織り込み済みか確認。';
    className = 'good';
  }

  const matThemes = extractThemesFromMaterials(uniqueMaterials);
  const freshThemes = [ ...(profile.freshThemes || []), ...matThemes.good.map((x) => `直近材料: ${x}`) ].slice(0, 8);
  const riskPoints = [ ...(profile.riskPoints || []), ...matThemes.bad.map((x) => `直近悪材料候補: ${x}`) ].slice(0, 8);
  const watchPoints = (profile.watchPoints || []).slice(0, 8);

  const researchLinks = {
    officialIr: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + profile.name + ' 公式 IR 決算説明資料 中期経営計画')}`,
    business: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + profile.name + ' 事業内容 セグメント 売上 利益')}`,
    recent: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + profile.name + ' 直近 材料 進捗 取り組み')}`,
    negative: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + profile.name + ' 悪材料 下落 理由 決算')}`,
    credit: `https://www.google.com/search?q=${encodeURIComponent(c + ' ' + profile.name + ' 信用倍率 買い残 売り残')}`,
  };

  const chattyReport = buildChattyCompanyReport({ profile, quote, good, bad, neutral, uniqueMaterials });

  return {
    code: c,
    name: profile.name,
    sector: profile.sector,
    fetchedAt: new Date().toISOString(),
    confidence: profile.confidence,
    source: profile.source,
    quote,
    chatty: chattyReport,
    summary: {
      judgement,
      className,
      technicalNotes,
      quality: quote ? { dangerScore: quote.dangerScore, dangerLabel: quote.dangerLabel, dropType: quote.dropType, materialSignal: quote.materialSignal, supplySignal: quote.supplySignal, totalJudge: quote.totalJudge, dangerReasons: quote.dangerReasons } : null,
      dataCoverage: {
        profile: profile.confidence,
        irCount: ir.items?.length || 0,
        newsCount: news.length,
        materialCount: uniqueMaterials.length,
      }
    },
    business: {
      profile: profile.profile,
      segments: profile.segments,
      watchPoints,
      oshimeUse: profile.oshimeUse,
    },
    growth: {
      themes: freshThemes,
      hints: (profile.businessHints || []).slice(0, 8),
      goodMaterials: good,
      neutralMaterials: neutral,
    },
    risks: {
      points: riskPoints,
      badMaterials: bad,
    },
    materials: uniqueMaterials,
    links: { ...(profile.links || {}), ...researchLinks },
  };
}

app.get('/api/resolve', async (req, res) => {
  try { res.json(await resolveInput(req.query.q)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

app.get('/api/drop-reason', async (req, res) => {
  try { res.json(await investigateDrop(req.query.q || req.query.code)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/ir/:code', async (req, res) => {
  try { res.json(await fetchIrMaterials(req.params.code)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/chart/:code', async (req, res) => {
  try { res.json(await fetchChartSeries(req.params.code, req.query.range, req.query.interval)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});


app.get('/api/ai-company-research/:code', async (req, res) => {
  try {
    const report = await fetchCompanyInvestigation(req.params.code);
    const prompt = buildAiCompanyPrompt(report);
    const ai = await callOpenAICompanyResearch(prompt);
    res.json({
      code: report.code,
      name: report.name,
      generatedAt: new Date().toISOString(),
      model: ai.model,
      text: ai.text,
      rawId: ai.rawId,
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});


app.get('/api/credit-jpx/:code', async (req, res) => {
  try {
    const data = await fetchJpxWeeklyMarginForCode(req.params.code);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message, source: 'JPX 銘柄別信用取引週末残高' });
  }
});

app.get('/api/credit-jpx-history/:code', async (req, res) => {
  try {
    const data = await fetchJpxWeeklyMarginHistoryForCode(req.params.code, Number(req.query.weeks || 8));
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message, source: 'JPX 銘柄別信用取引週末残高' });
  }
});

app.get('/api/company-research/:code', async (req, res) => {
  try { res.json(await fetchCompanyInvestigation(req.params.code)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/company/:code', async (req, res) => {
  try { res.json(await fetchCompanyProfile(req.params.code)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/quote/:code', async (req, res) => {
  try { res.json(await fetchYahooQuote(req.params.code)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/nikkei225-under', async (req, res) => {
  try {
    const maxPrice = Number(req.query.maxPrice || 3000);
    res.json(await fetchNikkei225Under(Number.isFinite(maxPrice) ? maxPrice : 3000));
  } catch (e) { res.status(502).json({ error: e.message }); }
});


app.get('/api/jpx-master', async (req, res) => {
  try {
    const force = String(req.query.force || '') === '1';
    const data = await fetchJpxListedMaster(force);
    res.json({ source: data.source, count: data.count, fetchedAt: data.fetchedAt, error: data.error || null, sample: (data.items || []).slice(0, 10) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/universe-preview', async (req, res) => {
  try {
    const universe = String(req.query.universe || 'nikkei225');
    const sector = String(req.query.sector || 'all');
    const maxCandidates = Number(req.query.maxCandidates || WIDE_SCAN_DEFAULT_LIMIT);
    const minVolume = Number(req.query.minVolume || 0);
    const maxPrice = Number(req.query.maxPrice || 3000);
    res.json(await previewUniverseScan({ universe, sector, maxCandidates, minVolume, maxPrice }));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/universe-scan', async (req, res) => {
  try {
    const universe = String(req.query.universe || 'nikkei225');
    const maxPrice = Number(req.query.maxPrice || 3000);
    const minPrice = Number(req.query.minPrice || 0);
    const minVolume = Number(req.query.minVolume || 0);
    const sector = String(req.query.sector || 'all');
    const maxCandidates = Number(req.query.maxCandidates || WIDE_SCAN_DEFAULT_LIMIT);
    const force = String(req.query.force || '') === '1';
    res.json(await fetchUniverseScan({
      universe,
      maxPrice: Number.isFinite(maxPrice) ? maxPrice : 3000,
      minPrice: Number.isFinite(minPrice) ? minPrice : 0,
      minVolume: Number.isFinite(minVolume) ? minVolume : 0,
      sector,
      maxCandidates: Number.isFinite(maxCandidates) ? maxCandidates : WIDE_SCAN_DEFAULT_LIMIT,
      force,
    }));
  } catch (e) {
    const code = e.statusCode || 502;
    res.status(code).json(e.payload || { error: e.message });
  }
});

app.get('/api/market', async (req, res) => {
  const codes = String(req.query.codes || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 250);
  const settled = await mapLimit(codes, 8, fetchYahooQuote);
  const baseItems = settled.map((r, i) => r.status === 'fulfilled' ? r.value : { code: bareCode(codes[i]), error: r.reason.message });
  const items = applySectorRelative(baseItems, { useCachedMedian: true });
  res.json({
    items,
    fetchedAt: new Date().toISOString(),
  });
});



app.get('/api/fundamental/:code', async (req, res) => {
  try { res.json(await fetchFundamentals(req.params.code)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/cache-stats', (req, res) => {
  res.json({ quote: quoteCacheV11.stats(), fundamental: fundamentalCache.stats(), json: jsonCache.stats(), tdnetPage: { size: tdnetPageCache?.size ?? 0 }, tdnetCode: { size: tdnetCodeCache?.size ?? 0 }, sectorMedian: sectorMedianCache.stats() });
});

app.post('/api/research', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY が未設定です。.env を確認してください。' });
  const { query, mode = 'stock', quote } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query is required' });
  const body = {
    model: 'claude-sonnet-4-20250514', max_tokens: 2500,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: `あなたは日本株の情報リサーチ・アシスタントです。日本語、構造化、出典URL明記。投資推奨はしない。\n\n対象: ${query}\n\nローカル価格データ:\n${quote ? JSON.stringify(quote, null, 2) : 'なし'}\n\n直近材料、業績、株価位置、ボリンジャーバンド、押し目目安、RR、リスクを整理。` }]
  };
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body)
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error?.message || `Anthropic ${upstream.status}` });
    const text = (data.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    res.json({ text });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'dist'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
app.listen(PORT, () => console.log(`相場歪観測機 server: http://localhost:${PORT}`));
