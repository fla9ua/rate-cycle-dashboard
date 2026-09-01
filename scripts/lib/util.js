import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export const HISTORY_PATH = path.join(ROOT, "data", "history.json");
export const SITE_DATA_PATH = path.join(ROOT, "public", "data", "site-data.json");

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function readJSON(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  const raw = await readFile(filePath, "utf-8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

export async function writeJSON(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function emptyHistory() {
  return {
    jp: { policyRate: [], cpi: [], bond: [], sectors: {} },
    us: { policyRate: [], cpi: [], bond: [], sectors: {} },
    gold: [],
  };
}

// 系列は [{date:"YYYY-MM-DD", value:Number}] 形式。日付でソートしつつ重複日は新しい値で上書きする。
export function mergeSeries(existing = [], incoming = []) {
  const map = new Map(existing.map((p) => [p.date, p.value]));
  for (const p of incoming) {
    if (p && p.date && Number.isFinite(p.value)) {
      map.set(p.date, p.value);
    }
  }
  return [...map.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// .env を読み込み process.env にセットする（依存パッケージなしの簡易実装）
export async function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
