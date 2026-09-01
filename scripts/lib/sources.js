// 各データソースからの取得ロジック。fetch.js（最新値）と backfill.js（過去1年分）の両方から呼ばれる。
import { fetchJSON } from "./util.js";

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function toYYYYMM(date) {
  return date.toISOString().slice(0, 7).replace("-", "");
}

// ---------------------------------------------------------------------------
// 1. 日本の政策金利（日本銀行 時系列統計データ検索サイト API）
//    認証不要。DB=FM01（無担保コールO/N物レート・毎営業日）, 系列コード STRDCLUCON。
//    参照: https://www.stat-search.boj.or.jp/info/api_manual.pdf
// ---------------------------------------------------------------------------
export async function fetchJpPolicyRate({ from, to } = {}) {
  const startDate = from ? toYYYYMM(from) : undefined;
  const endDate = to ? toYYYYMM(to) : undefined;

  const params = new URLSearchParams({ format: "json", db: "FM01", code: "STRDCLUCON" });
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  const url = `https://www.stat-search.boj.or.jp/api/v1/getDataCode?${params.toString()}`;
  const json = await fetchJSON(url);

  if (json.STATUS !== 200) {
    throw new Error(`BOJ API error: ${json.MESSAGE ?? "unknown"}`);
  }

  const series = json.RESULTSET?.[0];
  if (!series) return [];

  const dates = series.VALUES.SURVEY_DATES; // YYYYMMDD
  const values = series.VALUES.VALUES;
  const out = [];
  for (let i = 0; i < dates.length; i++) {
    const raw = values[i];
    if (raw === null || raw === undefined) continue;
    const d = String(dates[i]);
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    out.push({ date, value: Number(raw) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. 米国の政策金利・CPI（FRED）
//    要 FRED_API_KEY。 https://fred.stlouisfed.org/docs/api/api_key.html
// ---------------------------------------------------------------------------
async function fetchFredSeries(seriesId, { from, to } = {}) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error("FRED_API_KEY が設定されていません（.env を参照）");
  }
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
  });
  if (from) params.set("observation_start", ymd(from));
  if (to) params.set("observation_end", ymd(to));

  const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
  const json = await fetchJSON(url);

  return (json.observations ?? [])
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: Number(o.value) }));
}

export function fetchUsPolicyRate(range) {
  // DFEDTARU: フェデラルファンド金利誘導目標の上限
  return fetchFredSeries("DFEDTARU", range);
}

export function fetchUsCpi(range) {
  // CPILFESL: コアCPI（食品・エネルギーを除く、季節調整済み、1982-84=100）
  return fetchFredSeries("CPILFESL", range);
}

// ---------------------------------------------------------------------------
// 3. 日本のCPI（総務省統計局 e-Stat API）
//    要 ESTAT_APP_ID。 https://www.e-stat.go.jp/api/
//    統計表ID 0004052037: 2025年基準消費者物価指数・全国・総合指数
//    cdCat01=0001（総合）, cdArea=00000（全国）
// ---------------------------------------------------------------------------
export async function fetchJpCpi() {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) {
    throw new Error("ESTAT_APP_ID が設定されていません（.env を参照）");
  }
  const params = new URLSearchParams({
    appId,
    statsDataId: "0004052037",
    cdCat01: "0001",
    cdArea: "00000",
    metaGetFlg: "N",
  });
  const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?${params.toString()}`;
  const json = await fetchJSON(url);

  const result = json.GET_STATS_DATA?.RESULT;
  if (result && result.STATUS !== 0) {
    throw new Error(`e-Stat API error: ${result.ERROR_MSG ?? "unknown"}`);
  }

  const rawValues = json.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? [];
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];

  const out = [];
  for (const v of values) {
    const date = parseEstatTimeCode(v["@time"]);
    const value = Number(v["$"]);
    if (date && Number.isFinite(value)) out.push({ date, value });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// e-Stat の時間コード（例: "2024000105" 月次コード等）から YYYY-MM-01 を抽出する。
// 統計表によって時間コードの桁構成が異なるため、先頭4桁を年、続く2桁を月として解釈する。
function parseEstatTimeCode(timeCode) {
  if (!timeCode) return null;
  const s = String(timeCode);
  const year = s.slice(0, 4);
  const month = s.slice(4, 6);
  if (!/^\d{4}$/.test(year)) return null;
  const m = /^\d{2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12 ? month : "01";
  return `${year}-${m}-01`;
}

// ---------------------------------------------------------------------------
// 4. Yahoo Finance chart API（無認証）: 米国ETF・金価格
//    https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?period1=&period2=&interval=1d
//    ※非公式エンドポイントのため、将来的に仕様変更・停止のリスクがある点に留意。
// ---------------------------------------------------------------------------
export async function fetchYahooChart(symbol, { from, to } = {}) {
  const params = new URLSearchParams({ interval: "1d" });
  if (from) params.set("period1", String(Math.floor(from.getTime() / 1000)));
  else params.set("range", "1y");
  if (to) params.set("period2", String(Math.floor(to.getTime() / 1000)));

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
  const json = await fetchJSON(url, { headers: { "User-Agent": "Mozilla/5.0" } });

  const result = json.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (!Number.isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    out.push({ date, value: close });
  }
  return out;
}

export function fetchUsBond(range) {
  return fetchYahooChart("TLT", range); // iShares 20+ Year Treasury Bond ETF
}

export function fetchUsSector(code, range) {
  return fetchYahooChart(code, range);
}

export function fetchGold(range) {
  return fetchYahooChart("GC=F", range); // COMEX 金先物
}

// ---------------------------------------------------------------------------
// 5. J-Quants API v2: 日本の債券ETF・セクターETF価格
//    要 JQUANTS_API_KEY。 https://jpx-jquants.com/ （Freeプランで登録可、データに遅延あり）
// ---------------------------------------------------------------------------
export async function fetchJQuantsDailyBars(code, { from, to } = {}) {
  const apiKey = process.env.JQUANTS_API_KEY;
  if (!apiKey) {
    throw new Error("JQUANTS_API_KEY が設定されていません（.env を参照）");
  }

  const out = [];
  let paginationKey;
  do {
    const params = new URLSearchParams({ code });
    if (from) params.set("from", ymd(from).replace(/-/g, ""));
    if (to) params.set("to", ymd(to).replace(/-/g, ""));
    if (paginationKey) params.set("pagination_key", paginationKey);

    const url = `https://api.jquants.com/v2/equities/bars/daily?${params.toString()}`;
    const json = await fetchJSON(url, { headers: { "x-api-key": apiKey } });

    const bars = json.daily_bars ?? json.bars ?? [];
    for (const bar of bars) {
      const date = bar.Date ?? bar.date;
      const close = bar.AdjC ?? bar.C ?? bar.Close;
      if (date && Number.isFinite(Number(close))) {
        const iso = /^\d{8}$/.test(date)
          ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
          : date;
        out.push({ date: iso, value: Number(close) });
      }
    }
    paginationKey = json.pagination_key;
  } while (paginationKey);

  return out;
}

export function fetchJpBond(range) {
  // NEXT FUNDS 国内債券・NOMURA-BPI総合連動型上場投信（銘柄コード 2510）
  return fetchJQuantsDailyBars("2510", range);
}

export function fetchJpSector(code, range) {
  return fetchJQuantsDailyBars(code, range);
}

export const JP_SECTOR_CODES = [
  "1617", "1618", "1619", "1620", "1621", "1622", "1623", "1624", "1625",
  "1626", "1627", "1628", "1629", "1630", "1631", "1632", "1633",
];

export const US_SECTOR_CODES = [
  "XLF", "XLE", "XLK", "XLU", "XLRE", "XLV", "XLI", "XLB", "XLY", "XLP", "XLC",
];
