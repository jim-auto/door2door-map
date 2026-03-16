// ============================================================
// door2door-map - メインスクリプト
// 交通経路ベースの到達圏ポリゴンを時間帯別グラデーションで表示する
// ============================================================

// --- 定数 ---

// スライダーの値を GeoJSON ファイル名の時間値にスナップ
// (生成済み: 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60)
const SNAP_VALUES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

// 時間帯ごとの色定義（短い時間=濃い色、長い時間=薄い色）
const TIME_COLORS = {
  10: "#1a237e",
  15: "#283593",
  20: "#303f9f",
  25: "#3949ab",
  30: "#3f51b5",
  35: "#5c6bc0",
  40: "#7986cb",
  45: "#9fa8da",
  50: "#b3c1e8",
  55: "#c5cae9",
  60: "#bbdefb",
};

// 各時間帯のポリゴン透明度（長い時間ほど薄く表示）
const TIME_OPACITY = {
  10: 0.50,
  15: 0.45,
  20: 0.40,
  25: 0.38,
  30: 0.35,
  35: 0.32,
  40: 0.28,
  45: 0.25,
  50: 0.22,
  55: 0.20,
  60: 0.18,
};

// --- グローバル変数 ---
let map;
let stationMarker = null;
let isochroneLayers = [];       // 時間帯別レイヤーの配列
let stations = [];
let geojsonCache = {};          // キャッシュ: "shibuya_30" → GeoJSON data
let legendControl = null;       // 凡例コントロール
let infoPanel = null;           // 駅情報パネルコントロール

// ============================================================
// 初期化
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  await loadStations();
  setupEventListeners();
});

/**
 * Leaflet 地図を初期化する
 */
function initMap() {
  map = L.map("map").setView([35.68, 139.76], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  // 凡例を初期化（初期状態は非表示）
  createLegend();

  // 駅情報パネルを初期化
  createInfoPanel();
}

/**
 * stations.json を読み込み、ドロップダウンに反映する
 */
async function loadStations() {
  try {
    const response = await fetch("data/stations.json");
    stations = await response.json();
    populateDropdown(stations);
  } catch (error) {
    console.error("駅データの読み込みに失敗しました:", error);
  }
}

/**
 * 駅データからドロップダウンの選択肢を生成する (都市ごとにグループ化)
 */
function populateDropdown(stations) {
  const select = document.getElementById("station-select");
  const cities = [...new Set(stations.map((s) => s.city))];

  cities.forEach((city) => {
    const group = document.createElement("optgroup");
    group.label = city;

    stations
      .filter((s) => s.city === city)
      .forEach((station) => {
        const option = document.createElement("option");
        option.value = stations.indexOf(station);
        option.textContent = station.name;
        group.appendChild(option);
      });

    select.appendChild(group);
  });
}

// ============================================================
// 凡例コントロール
// ============================================================

/**
 * 地図右下にカラー凡例を作成する
 */
function createLegend() {
  legendControl = L.control({ position: "bottomright" });

  legendControl.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = '<div class="legend-title">移動時間</div>';

    // 表示する時間ステップ（5分刻みだと多いので10分刻みで主要なものを表示）
    const displaySteps = [10, 20, 30, 40, 50, 60];

    displaySteps.forEach((time) => {
      div.innerHTML +=
        `<div class="legend-item">` +
        `<span class="legend-color" style="background:${TIME_COLORS[time]};opacity:${Math.min(TIME_OPACITY[time] + 0.3, 0.9)}"></span>` +
        `<span class="legend-label">${time}分</span>` +
        `</div>`;
    });

    return div;
  };

  legendControl.addTo(map);

  // 初期状態は非表示
  legendControl.getContainer().style.display = "none";
}

/**
 * 凡例の表示・非表示を切り替える
 */
function showLegend(visible) {
  if (legendControl) {
    legendControl.getContainer().style.display = visible ? "block" : "none";
  }
}

// ============================================================
// 駅情報パネル
// ============================================================

/**
 * 地図左上に駅情報パネルを作成する
 */
function createInfoPanel() {
  infoPanel = L.control({ position: "topleft" });

  infoPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "info-panel");
    div.innerHTML = '<p class="info-placeholder">駅を選択してください</p>';
    return div;
  };

  infoPanel.addTo(map);
}

/**
 * 駅情報パネルの内容を更新する
 */
function updateInfoPanel(station, selectedTime) {
  if (!infoPanel) return;

  const container = infoPanel.getContainer();
  container.innerHTML = `
    <div class="info-header">駅情報</div>
    <div class="info-body">
      <div class="info-station-name">${station.name}駅</div>
      <div class="info-city">${station.city}</div>
      <div class="info-time">
        選択中: <strong>${selectedTime}分</strong>圏
      </div>
      <div class="info-coords">
        ${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}
      </div>
    </div>
  `;
}

/**
 * 駅情報パネルを初期状態に戻す
 */
function clearInfoPanel() {
  if (!infoPanel) return;
  const container = infoPanel.getContainer();
  container.innerHTML = '<p class="info-placeholder">駅を選択してください</p>';
}

// ============================================================
// イベントリスナー
// ============================================================

function setupEventListeners() {
  const select = document.getElementById("station-select");
  const slider = document.getElementById("time-slider");
  const timeValue = document.getElementById("time-value");

  select.addEventListener("change", () => updateMap());

  slider.addEventListener("input", () => {
    timeValue.textContent = slider.value;
    updateMap();
  });
}

// ============================================================
// GeoJSON 読み込み・地図更新
// ============================================================

/**
 * スライダー値を最寄りの生成済み時間値にスナップする
 */
function snapTime(value) {
  return SNAP_VALUES.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );
}

/**
 * isochrone GeoJSON を取得する (キャッシュ付き)
 */
async function fetchIsochrone(stationId, timeMin) {
  const key = `${stationId}_${timeMin}`;

  if (geojsonCache[key]) {
    return geojsonCache[key];
  }

  try {
    const resp = await fetch(`data/isochrones/${key}.geojson`);
    if (!resp.ok) return null;
    const data = await resp.json();
    geojsonCache[key] = data;
    return data;
  } catch {
    return null;
  }
}

/**
 * 選択された駅の全時間帯 GeoJSON を並列取得する
 */
async function fetchAllIsochrones(stationId) {
  const promises = SNAP_VALUES.map((time) => fetchIsochrone(stationId, time));
  const results = await Promise.all(promises);

  // { 10: geojsonData, 15: geojsonData, ... } の形で返す
  const isochroneMap = {};
  SNAP_VALUES.forEach((time, index) => {
    if (results[index]) {
      isochroneMap[time] = results[index];
    }
  });

  return isochroneMap;
}

/**
 * 選択された駅と時間に基づいて地図を更新する
 * 全時間帯を同心円状のグラデーションレイヤーとして描画する
 */
async function updateMap() {
  const select = document.getElementById("station-select");
  const slider = document.getElementById("time-slider");

  if (select.value === "") {
    clearOverlays();
    clearInfoPanel();
    showLegend(false);
    return;
  }

  const station = stations[parseInt(select.value)];
  const selectedTime = snapTime(parseInt(slider.value));
  const latlng = [station.lat, station.lng];

  // 全時間帯の GeoJSON を一括取得
  const allIsochrones = await fetchAllIsochrones(station.id);

  // 既存のオーバーレイをクリア
  clearOverlays();

  // 大きい時間帯（外側）から小さい時間帯（内側）の順にレイヤーを追加
  // → 内側の濃い色が上に描画される
  const sortedTimes = Object.keys(allIsochrones)
    .map(Number)
    .sort((a, b) => b - a);

  if (sortedTimes.length > 0) {
    sortedTimes.forEach((time) => {
      const geojson = allIsochrones[time];
      const isSelected = time === selectedTime;

      const layer = L.geoJSON(geojson, {
        style: () => ({
          color: TIME_COLORS[time],
          fillColor: TIME_COLORS[time],
          fillOpacity: TIME_OPACITY[time],
          weight: isSelected ? 2.5 : 0.8,
          // 選択中の時間帯は破線で強調
          dashArray: isSelected ? null : "4 4",
        }),
      }).addTo(map);

      isochroneLayers.push(layer);
    });

    // 最大範囲（60分）にフィット
    const outerLayer = isochroneLayers[0];
    map.fitBounds(outerLayer.getBounds(), { padding: [30, 30] });

    // 凡例を表示
    showLegend(true);
  } else {
    // GeoJSON がない場合は駅周辺にズーム
    map.setView(latlng, 12);
    showLegend(false);
  }

  // 駅マーカー
  stationMarker = L.marker(latlng)
    .addTo(map)
    .bindPopup(createPopupContent(station, selectedTime))
    .openPopup();

  // 駅情報パネルを更新
  updateInfoPanel(station, selectedTime);
}

/**
 * ポップアップの内容を生成する
 */
function createPopupContent(station, timeMinutes) {
  return `
    <div class="popup-content">
      <div class="popup-station">${station.name}駅</div>
      <div class="popup-city">${station.city}</div>
      <hr class="popup-divider">
      <div class="popup-time">
        選択時間: <strong>${timeMinutes}分</strong>
      </div>
      <div class="popup-note">
        全時間帯（10〜60分）を表示中
      </div>
    </div>
  `;
}

/**
 * 地図上のオーバーレイをすべて削除する
 */
function clearOverlays() {
  // 駅マーカーを削除
  if (stationMarker) {
    map.removeLayer(stationMarker);
    stationMarker = null;
  }

  // 全時間帯レイヤーを削除
  isochroneLayers.forEach((layer) => {
    map.removeLayer(layer);
  });
  isochroneLayers = [];
}
