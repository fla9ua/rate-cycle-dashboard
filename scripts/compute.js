// data/history.json を集計し、public/data/site-data.json を生成する。
import { readJSON, writeJSON, HISTORY_PATH, SITE_DATA_PATH, emptyHistory } from "./lib/util.js";

const DISCLAIMER = "本サイトは情報提供のみを目的としており、投資助言ではありません。";

const JP_SECTORS = [
  { code: "1617", name: "食品" },
  { code: "1618", name: "エネルギー資源" },
  { code: "1619", name: "建設・資材" },
  { code: "1620", name: "素材・化学" },
  { code: "1621", name: "医薬品" },
  { code: "1622", name: "自動車・輸送機" },
  { code: "1623", name: "鉄鋼・非鉄" },
  { code: "1624", name: "機械" },
  { code: "1625", name: "電機・精密" },
  { code: "1626", name: "情報通信・サービスその他" },
  { code: "1627", name: "電力・ガス" },
  { code: "1628", name: "運輸・物流" },
  { code: "1629", name: "商社・卸売" },
  { code: "1630", name: "小売" },
  { code: "1631", name: "銀行" },
  { code: "1632", name: "金融（除く銀行）" },
  { code: "1633", name: "不動産" },
];

const US_SECTORS = [
  { code: "XLF", name: "Financials" },
  { code: "XLE", name: "Energy" },
  { code: "XLK", name: "Technology" },
  { code: "XLU", name: "Utilities" },
  { code: "XLRE", name: "Real Estate" },
  { code: "XLV", name: "Health Care" },
  { code: "XLI", name: "Industrials" },
  { code: "XLB", name: "Materials" },
  { code: "XLY", name: "Consumer Discretionary" },
  { code: "XLP", name: "Consumer Staples" },
  { code: "XLC", name: "Communication Services" },
];

const FACTORS = ["policyRate", "bond", "gold"];
const FACTOR_LABELS = { policyRate: "政策金利", bond: "債券ETF", gold: "金" };

const HOLD_THRESHOLD_DAYS = 180; // これ以上変更が無ければ「据え置き」局面とみなす

function toSeriesMap(series) {
  return new Map(series.map((p) => [p.date, p.value]));
}

const RATE_STEP = 0.25; // 政策金利の水準判定に使う丸め単位（%）。市場実勢レートの日々のノイズを吸収する。
const MIN_RUN_DAYS = 3; // この日数未満しか続かない水準変化はノイズとみなし、直前の水準に統合する

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

// 連続する日次データを「水準（丸め値）がどれだけ続いたか」の区間列に変換し、
// 短命な区間（ノイズ）は直前の区間に統合することで、実際の利上げ/利下げ判断だけを残す。
function detectLevels(series, step = RATE_STEP, minRunDays = MIN_RUN_DAYS) {
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const rounded = sorted.map((p) => ({ date: p.date, value: roundToStep(p.value, step) }));

  const runs = [];
  for (const p of rounded) {
    const last = runs[runs.length - 1];
    if (last && last.value === p.value) {
      last.end = p.date;
      last.count += 1;
    } else {
      runs.push({ value: p.value, start: p.date, end: p.date, count: 1 });
    }
  }

  const merged = [];
  for (const run of runs) {
    if (merged.length > 0 && run.count < minRunDays) {
      merged[merged.length - 1].end = run.end; // ノイズとして直前の区間に吸収する
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24));
}

function computePolicyRatePhase(series) {
  if (!series || series.length === 0) {
    return { current: null, phase: "データなし", lastChange: null };
  }
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const current = sorted[sorted.length - 1].value;
  const currentDate = sorted[sorted.length - 1].date;
  const today = new Date().toISOString().slice(0, 10);

  const levels = detectLevels(series);
  if (levels.length < 2) {
    return {
      current,
      currentDate,
      phase: "据え置き",
      lastChange: null,
      sinceLastChangeDays: null,
    };
  }

  const prev = levels[levels.length - 2];
  const last = levels[levels.length - 1];
  const direction = last.value > prev.value ? "up" : last.value < prev.value ? "down" : "flat";
  const sinceLastChangeDays = daysBetween(last.start, today);

  let phase;
  if (sinceLastChangeDays > HOLD_THRESHOLD_DAYS) {
    phase = "据え置き";
  } else if (direction === "up") {
    phase = "利上げ局面";
  } else if (direction === "down") {
    phase = "利下げ局面";
  } else {
    phase = "据え置き";
  }

  return {
    current,
    currentDate,
    phase,
    lastChange: { date: last.start, from: prev.value, to: last.value, direction },
    sinceLastChangeDays,
  };
}

function computeCpiSummary(series) {
  if (!series || series.length === 0) {
    return { current: null, currentDate: null, previous: null, trend: "データなし" };
  }
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  let trend = "横ばい";
  if (prev) {
    if (last.value > prev.value) trend = "上昇";
    else if (last.value < prev.value) trend = "低下";
  }
  return {
    current: last.value,
    currentDate: last.date,
    previous: prev ? prev.value : null,
    trend,
  };
}

function pctChangeSeries(series) {
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const cur = sorted[i].value;
    if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      out.push({ date: sorted[i].date, value: (cur - prev) / prev });
    }
  }
  return out;
}

function diffSeries(series) {
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    out.push({ date: sorted[i].date, value: sorted[i].value - sorted[i - 1].value });
  }
  return out;
}

function pearson(pairs) {
  const n = pairs.length;
  if (n < 20) return null; // データ不足時は相関を出さない
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}

function alignAndCorrelate(seriesA, seriesB, lookbackDays = 365) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const mapB = toSeriesMap(seriesB);
  const pairs = [];
  for (const p of seriesA) {
    if (p.date < cutoffStr) continue;
    const v = mapB.get(p.date);
    if (Number.isFinite(v)) pairs.push([p.value, v]);
  }
  return pearson(pairs);
}

function computeSectorCorrelation(sectorDefs, sectorsData, policyRateSeries, bondSeries, goldSeries) {
  const factorSeries = {
    policyRate: diffSeries(policyRateSeries || []),
    bond: pctChangeSeries(bondSeries || []),
    gold: pctChangeSeries(goldSeries || []),
  };

  const sectors = [];
  const matrix = [];
  for (const def of sectorDefs) {
    const raw = sectorsData[def.code];
    if (!raw || raw.length === 0) continue;
    const returns = pctChangeSeries(raw);
    const row = FACTORS.map((f) => alignAndCorrelate(returns, factorSeries[f]));
    sectors.push(def);
    matrix.push(row);
  }

  return {
    sectors,
    factors: FACTORS.map((f) => ({ key: f, label: FACTOR_LABELS[f] })),
    matrix,
  };
}

function buildRegion(regionData, sectorDefs) {
  const policyRate = computePolicyRatePhase(regionData.policyRate);
  const cpi = computeCpiSummary(regionData.cpi);
  const sectorCorrelation = computeSectorCorrelation(
    sectorDefs,
    regionData.sectors || {},
    regionData.policyRate,
    regionData.bond,
    regionData.gold ? regionData.gold : null
  );

  return {
    policyRate: {
      ...policyRate,
      series: [...regionData.policyRate].sort((a, b) => (a.date < b.date ? -1 : 1)),
    },
    cpi: {
      ...cpi,
      series: [...regionData.cpi].sort((a, b) => (a.date < b.date ? -1 : 1)),
    },
    bond: {
      series: [...(regionData.bond || [])].sort((a, b) => (a.date < b.date ? -1 : 1)),
    },
    sectorCorrelation,
  };
}

async function main() {
  const history = await readJSON(HISTORY_PATH, emptyHistory());

  const jp = buildRegion({ ...history.jp, gold: history.gold }, JP_SECTORS);
  const us = buildRegion({ ...history.us, gold: history.gold }, US_SECTORS);

  const siteData = {
    generatedAt: new Date().toISOString(),
    regions: { jp, us },
    gold: {
      series: [...(history.gold || [])].sort((a, b) => (a.date < b.date ? -1 : 1)),
    },
    meta: { disclaimer: DISCLAIMER },
  };

  await writeJSON(SITE_DATA_PATH, siteData);
  console.log(`書き出しました: ${SITE_DATA_PATH}`);
  console.log(`JP policyRate phase: ${jp.policyRate.phase} (${jp.policyRate.current ?? "N/A"})`);
  console.log(`US policyRate phase: ${us.policyRate.phase} (${us.policyRate.current ?? "N/A"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
