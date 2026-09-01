const REGION_LABELS = { jp: "日本", us: "米国" };
const PHASE_CLASS = {
  利上げ局面: "up",
  利下げ局面: "down",
  据え置き: "hold",
  データなし: "hold",
};

let siteData = null;
let charts = {};

async function loadData() {
  const res = await fetch("data/site-data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`site-data.json の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return dateStr;
}

function renderPhaseCard(region, data) {
  const { policyRate } = data;
  const cls = PHASE_CLASS[policyRate.phase] ?? "hold";
  const card = document.querySelector(`#panel-${region} .card-policy-rate`);
  card.querySelector(".value").textContent =
    policyRate.current !== null ? `${formatNumber(policyRate.current)}%` : "データなし";
  const badge = card.querySelector(".badge");
  badge.textContent = policyRate.phase;
  badge.className = `badge ${cls}`;

  const sub = card.querySelector(".sub");
  if (policyRate.lastChange) {
    const dir = policyRate.lastChange.direction === "up" ? "上昇" : policyRate.lastChange.direction === "down" ? "低下" : "変化なし";
    sub.textContent = `${formatDate(policyRate.lastChange.date)} に ${formatNumber(policyRate.lastChange.from)}% → ${formatNumber(policyRate.lastChange.to)}%（${dir}）`;
  } else {
    sub.textContent = policyRate.currentDate ? `${formatDate(policyRate.currentDate)} 時点` : "";
  }
}

function renderCpiCard(region, data) {
  const { cpi } = data;
  const card = document.querySelector(`#panel-${region} .card-cpi`);
  card.querySelector(".value").textContent = cpi.current !== null ? formatNumber(cpi.current) : "データなし";
  card.querySelector(".sub").textContent = cpi.currentDate
    ? `${formatDate(cpi.currentDate)} 時点（前回比: ${cpi.trend}）`
    : "";
}

function renderPolicyRateChart(region, data) {
  const ctx = document.getElementById(`chart-${region}`);
  const series = data.policyRate.series;
  const labels = series.map((p) => p.date);
  const values = series.map((p) => p.value);

  if (charts[region]) {
    charts[region].destroy();
  }

  charts[region] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${REGION_LABELS[region]} 政策金利 (%)`,
          data: values,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          ticks: { maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          ticks: { callback: (v) => `${v}%` },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${formatNumber(item.raw)}%`,
          },
        },
      },
    },
  });
}

function correlationColor(value) {
  if (value === null || value === undefined) return "transparent";
  const abs = Math.min(Math.abs(value), 1);
  const alpha = 0.15 + abs * 0.7;
  return value >= 0 ? `rgba(220, 38, 38, ${alpha})` : `rgba(37, 99, 235, ${alpha})`;
}

function renderHeatmap(region, data) {
  const { sectors, factors, matrix } = data.sectorCorrelation;
  const container = document.querySelector(`#panel-${region} .heatmap-container`);
  container.innerHTML = "";

  if (sectors.length === 0) {
    container.innerHTML = '<p class="sub">セクターETFのデータがありません（APIキー設定後に取得してください）。</p>';
    return;
  }

  const table = document.createElement("table");
  table.className = "heatmap";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = `<th>セクター</th>${factors.map((f) => `<th>${f.label}</th>`).join("")}`;
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  sectors.forEach((sector, i) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.className = "sector-name";
    nameCell.textContent = sector.name;
    row.appendChild(nameCell);

    matrix[i].forEach((value) => {
      const cell = document.createElement("td");
      cell.className = "corr-cell" + (value === null ? " na" : "");
      cell.textContent = value === null ? "—" : formatNumber(value);
      cell.style.background = correlationColor(value);
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderRegion(region) {
  const data = siteData.regions[region];
  renderPhaseCard(region, data);
  renderCpiCard(region, data);
  renderPolicyRateChart(region, data);
  renderHeatmap(region, data);
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const region = btn.dataset.region;
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".region-panel").forEach((panel) => {
        panel.hidden = panel.id !== `panel-${region}`;
      });
      // タブ切り替え時にチャートを再描画してレイアウト崩れを防ぐ
      if (charts[region]) charts[region].resize();
    });
  });
}

async function main() {
  setupTabs();
  try {
    siteData = await loadData();
  } catch (err) {
    document.querySelector(".wrap").insertAdjacentHTML(
      "afterbegin",
      `<div class="error-banner">データの読み込みに失敗しました: ${err.message}</div>`
    );
    return;
  }

  document.getElementById("generated-at").textContent = `最終更新: ${new Date(siteData.generatedAt).toLocaleString("ja-JP")}`;
  document.getElementById("disclaimer-text").textContent = siteData.meta.disclaimer;

  renderRegion("jp");
  renderRegion("us");
}

main();
