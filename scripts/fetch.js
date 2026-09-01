// 各データソースから最新値を取得し、data/history.json に追記する。
// APIキー未設定のソースはスキップし、取得できたものだけ反映する（部分実行を許容）。
import {
  readJSON,
  writeJSON,
  mergeSeries,
  emptyHistory,
  HISTORY_PATH,
  loadEnv,
} from "./lib/util.js";

await loadEnv();
import {
  fetchJpPolicyRate,
  fetchUsPolicyRate,
  fetchUsCpi,
  fetchJpCpi,
  fetchUsBond,
  fetchJpBond,
  fetchUsSector,
  fetchJpSector,
  fetchGold,
  JP_SECTOR_CODES,
  US_SECTOR_CODES,
} from "./lib/sources.js";

// 直近90日分を取得して既存データにマージする（欠損日の補完も兼ねる）
function recentRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { from, to };
}

async function safeFetch(label, fn) {
  try {
    const data = await fn();
    console.log(`  ✓ ${label}: ${data.length}件`);
    return data;
  } catch (err) {
    console.warn(`  ⚠ ${label}: 取得失敗 (${err.message})`);
    return null;
  }
}

async function main() {
  const history = await readJSON(HISTORY_PATH, emptyHistory());
  const range = recentRange();

  console.log("日本のデータを取得中...");
  const jpPolicyRate = await safeFetch("日本 政策金利 (BOJ)", () => fetchJpPolicyRate(range));
  const jpCpi = await safeFetch("日本 CPI (e-Stat)", () => fetchJpCpi());
  const jpBond = await safeFetch("日本 債券ETF (J-Quants)", () => fetchJpBond(range));

  const jpSectors = {};
  for (const code of JP_SECTOR_CODES) {
    const data = await safeFetch(`日本 セクターETF ${code} (J-Quants)`, () => fetchJpSector(code, range));
    if (data) jpSectors[code] = data;
  }

  console.log("米国のデータを取得中...");
  const usPolicyRate = await safeFetch("米国 政策金利 (FRED)", () => fetchUsPolicyRate(range));
  const usCpi = await safeFetch("米国 CPI (FRED)", () => fetchUsCpi(range));
  const usBond = await safeFetch("米国 債券ETF TLT (Yahoo Finance)", () => fetchUsBond(range));

  const usSectors = {};
  for (const code of US_SECTOR_CODES) {
    const data = await safeFetch(`米国 セクターETF ${code} (Yahoo Finance)`, () => fetchUsSector(code, range));
    if (data) usSectors[code] = data;
  }

  console.log("金価格を取得中...");
  const gold = await safeFetch("金価格 (Yahoo Finance)", () => fetchGold(range));

  const next = {
    jp: {
      policyRate: mergeSeries(history.jp.policyRate, jpPolicyRate ?? []),
      cpi: mergeSeries(history.jp.cpi, jpCpi ?? []),
      bond: mergeSeries(history.jp.bond, jpBond ?? []),
      sectors: { ...history.jp.sectors },
    },
    us: {
      policyRate: mergeSeries(history.us.policyRate, usPolicyRate ?? []),
      cpi: mergeSeries(history.us.cpi, usCpi ?? []),
      bond: mergeSeries(history.us.bond, usBond ?? []),
      sectors: { ...history.us.sectors },
    },
    gold: mergeSeries(history.gold, gold ?? []),
  };

  for (const [code, data] of Object.entries(jpSectors)) {
    next.jp.sectors[code] = mergeSeries(history.jp.sectors[code], data);
  }
  for (const [code, data] of Object.entries(usSectors)) {
    next.us.sectors[code] = mergeSeries(history.us.sectors[code], data);
  }

  await writeJSON(HISTORY_PATH, next);
  console.log(`\n書き出しました: ${HISTORY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
