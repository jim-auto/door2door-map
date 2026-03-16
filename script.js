// ============================================================
// door2door-map - メインスクリプト
// 2駅比較モード対応: 駅A（青）と駅B（赤）の到達圏を重ねて表示
// ============================================================

// --- 定数 ---
const SNAP_VALUES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

// 駅A（青系）の色定義
const COLORS_A = {
  10: "#1a237e", 15: "#283593", 20: "#303f9f", 25: "#3949ab",
  30: "#3f51b5", 35: "#5c6bc0", 40: "#7986cb", 45: "#9fa8da",
  50: "#b3c1e8", 55: "#c5cae9", 60: "#bbdefb",
};

// 駅B（赤系）の色定義
const COLORS_B = {
  10: "#b71c1c", 15: "#c62828", 20: "#d32f2f", 25: "#e53935",
  30: "#ef5350", 35: "#ef6c6c", 40: "#e57373", 45: "#ef9a9a",
  50: "#f4b4b4", 55: "#ffcdd2", 60: "#ffebee",
};

// 各時間帯の透明度
const TIME_OPACITY = {
  10: 0.45, 15: 0.40, 20: 0.35, 25: 0.32,
  30: 0.30, 35: 0.27, 40: 0.24, 45: 0.21,
  50: 0.18, 55: 0.16, 60: 0.14,
};

// --- グローバル変数 ---
let map;
let markers = [];               // 駅マーカーの配列
let isochroneLayers = [];        // ポリゴンレイヤーの配列
let stations = [];
let geojsonCache = {};
let legendControl = null;
let infoPanel = null;

// ============================================================
// 初期化
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  await loadStations();
  setupEventListeners();
});

function initMap() {
  map = L.map("map").setView([35.68, 139.76], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  createLegend();
  createInfoPanel();
}

async function loadStations() {
  try {
    const response = await fetch("data/stations.json");
    stations = await response.json();
    // 両方のドロップダウンに駅を追加
    populateDropdown("station-select", stations);
    populateDropdown("station-select-b", stations);
  } catch (error) {
    console.error("駅データの読み込みに失敗しました:", error);
  }
}

/**
 * ドロップダウンに駅を追加（都市ごとにグループ化）
 */
function populateDropdown(selectId, stations) {
  const select = document.getElementById(selectId);
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

function createLegend() {
  legendControl = L.control({ position: "bottomright" });

  legendControl.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.id = "legend-content";
    return div;
  };

  legendControl.addTo(map);
  legendControl.getContainer().style.display = "none";
}

/**
 * 凡例の内容を動的に更新する
 */
function updateLegend(stationA, stationB, selectedTime) {
  const div = document.getElementById("legend-content");
  if (!div) return;

  let html = "";

  if (stationA && stationB) {
    // 比較モード: シンプルに3色の説明
    html += `<div class="legend-title">${selectedTime}分圏の比較</div>`;
    html += '<div class="legend-item">';
    html += '<span class="legend-color" style="background:#1565c0;opacity:0.8"></span>';
    html += `<span class="legend-label">${stationA.name}のみ到達</span>`;
    html += '</div>';
    html += '<div class="legend-item">';
    html += '<span class="legend-color" style="background:#c62828;opacity:0.8"></span>';
    html += `<span class="legend-label">${stationB.name}のみ到達</span>`;
    html += '</div>';
    html += '<div class="legend-item">';
    html += '<span class="legend-color" style="background:#7b1fa2;opacity:0.8"></span>';
    html += '<span class="legend-label">両方から到達</span>';
    html += '</div>';
  } else if (stationA) {
    // 単独モード
    const displaySteps = [10, 20, 30, 40, 50, 60];
    html += '<div class="legend-title">移動時間</div>';
    displaySteps.forEach((time) => {
      html += '<div class="legend-item">';
      html += `<span class="legend-color" style="background:${COLORS_A[time]};opacity:${Math.min(TIME_OPACITY[time] + 0.3, 0.9)}"></span>`;
      html += `<span class="legend-label">${time}分</span>`;
      html += '</div>';
    });
  }

  div.innerHTML = html;
}

function showLegend(visible) {
  if (legendControl) {
    legendControl.getContainer().style.display = visible ? "block" : "none";
  }
}

// ============================================================
// 駅情報パネル
// ============================================================

function createInfoPanel() {
  infoPanel = L.control({ position: "topleft" });

  infoPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "info-panel");
    div.innerHTML = '<p class="info-placeholder">駅を選択してください</p>';
    return div;
  };

  infoPanel.addTo(map);
}

function updateInfoPanel(stationA, stationB, selectedTime) {
  if (!infoPanel) return;
  const container = infoPanel.getContainer();

  if (stationA && stationB) {
    // 比較モード
    container.innerHTML = `
      <div class="info-header">駅比較</div>
      <div class="info-body">
        <div class="info-compare-row">
          <span class="info-dot info-dot-a"></span>
          <span class="info-station-name">${stationA.name}駅</span>
          <span class="info-city">(${stationA.city})</span>
        </div>
        <div class="info-compare-row">
          <span class="info-dot info-dot-b"></span>
          <span class="info-station-name">${stationB.name}駅</span>
          <span class="info-city">(${stationB.city})</span>
        </div>
        <div class="info-time">
          選択中: <strong>${selectedTime}分</strong>圏
        </div>
      </div>
    `;
  } else if (stationA) {
    container.innerHTML = `
      <div class="info-header">駅情報</div>
      <div class="info-body">
        <div class="info-station-name">${stationA.name}駅</div>
        <div class="info-city">${stationA.city}</div>
        <div class="info-time">
          選択中: <strong>${selectedTime}分</strong>圏
        </div>
      </div>
    `;
  }
}

function clearInfoPanel() {
  if (!infoPanel) return;
  infoPanel.getContainer().innerHTML =
    '<p class="info-placeholder">駅を選択してください</p>';
}

// ============================================================
// イベントリスナー
// ============================================================

function setupEventListeners() {
  const selectA = document.getElementById("station-select");
  const selectB = document.getElementById("station-select-b");
  const slider = document.getElementById("time-slider");
  const timeValue = document.getElementById("time-value");

  selectA.addEventListener("change", () => updateMap());
  selectB.addEventListener("change", () => updateMap());

  slider.addEventListener("input", () => {
    timeValue.textContent = slider.value;
    updateMap();
  });
}

// ============================================================
// GeoJSON 読み込み・地図更新
// ============================================================

function snapTime(value) {
  return SNAP_VALUES.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );
}

async function fetchIsochrone(stationId, timeMin) {
  const key = `${stationId}_${timeMin}`;
  if (geojsonCache[key]) return geojsonCache[key];

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

async function fetchAllIsochrones(stationId) {
  const promises = SNAP_VALUES.map((time) => fetchIsochrone(stationId, time));
  const results = await Promise.all(promises);

  const isochroneMap = {};
  SNAP_VALUES.forEach((time, index) => {
    if (results[index]) isochroneMap[time] = results[index];
  });
  return isochroneMap;
}

/**
 * 1駅分のポリゴンレイヤーを描画する
 */
function drawStationLayers(allIsochrones, colors, selectedTime) {
  const sortedTimes = Object.keys(allIsochrones)
    .map(Number)
    .sort((a, b) => b - a);

  sortedTimes.forEach((time) => {
    const geojson = allIsochrones[time];
    const isSelected = time === selectedTime;

    const layer = L.geoJSON(geojson, {
      style: () => ({
        color: colors[time],
        fillColor: colors[time],
        fillOpacity: TIME_OPACITY[time],
        weight: isSelected ? 2.5 : 0.8,
        dashArray: isSelected ? null : "4 4",
      }),
    }).addTo(map);

    isochroneLayers.push(layer);
  });
}

/**
 * メイン: 地図を更新する
 * 単独モード: 全時間帯グラデーション表示
 * 比較モード: 選択時間のみ、A/B/重複を色分け表示
 */
async function updateMap() {
  const selectA = document.getElementById("station-select");
  const selectB = document.getElementById("station-select-b");
  const slider = document.getElementById("time-slider");

  if (selectA.value === "") {
    clearOverlays();
    clearInfoPanel();
    showLegend(false);
    return;
  }

  const stationA = stations[parseInt(selectA.value)];
  const stationB = selectB.value !== "" ? stations[parseInt(selectB.value)] : null;
  const selectedTime = snapTime(parseInt(slider.value));

  clearOverlays();

  if (stationB) {
    // === 比較モード: 選択時間のみ表示 ===
    await drawComparisonMode(stationA, stationB, selectedTime);
  } else {
    // === 単独モード: 全時間帯グラデーション ===
    await drawSingleMode(stationA, selectedTime);
  }

  updateLegend(stationA, stationB, selectedTime);
  updateInfoPanel(stationA, stationB, selectedTime);
}

/**
 * 単独モード: 全時間帯のグラデーション表示
 */
async function drawSingleMode(station, selectedTime) {
  const allIsochrones = await fetchAllIsochrones(station.id);
  drawStationLayers(allIsochrones, COLORS_A, selectedTime);

  if (isochroneLayers.length > 0) {
    map.fitBounds(isochroneLayers[0].getBounds(), { padding: [30, 30] });
    showLegend(true);
  } else {
    map.setView([station.lat, station.lng], 12);
    showLegend(false);
  }

  const marker = L.marker([station.lat, station.lng], {
    icon: createColoredIcon("#1a237e"),
  })
    .addTo(map)
    .bindPopup(createPopupContent(station, selectedTime, "A"))
    .openPopup();
  markers.push(marker);
}

/**
 * 比較モード: Turf.js でポリゴンの差分・交差を計算し、
 * A だけ（青）/ B だけ（赤）/ 両方（紫）を明確に塗り分ける
 */
async function drawComparisonMode(stationA, stationB, selectedTime) {
  const [geojsonA, geojsonB] = await Promise.all([
    fetchIsochrone(stationA.id, selectedTime),
    fetchIsochrone(stationB.id, selectedTime),
  ]);

  if (!geojsonA && !geojsonB) {
    map.setView([stationA.lat, stationA.lng], 11);
    return;
  }

  const allBounds = L.latLngBounds([]);

  // Turf.js で集合演算
  if (geojsonA && geojsonB) {
    try {
      // GeoJSON の Feature を取得
      const featA = combineFeaturesForTurf(geojsonA);
      const featB = combineFeaturesForTurf(geojsonB);

      // 交差（両方から到達可能なエリア）
      const intersection = safeIntersect(featA, featB);

      // A のみ（A - B）
      const aOnly = safeDifference(featA, featB);

      // B のみ（B - A）
      const bOnly = safeDifference(featB, featA);

      // A のみ → 青
      if (aOnly) {
        const layer = L.geoJSON(aOnly, {
          style: () => ({
            color: "#1565c0",
            fillColor: "#1565c0",
            fillOpacity: 0.45,
            weight: 1.5,
          }),
        }).addTo(map);
        isochroneLayers.push(layer);
        allBounds.extend(layer.getBounds());
      }

      // B のみ → 赤
      if (bOnly) {
        const layer = L.geoJSON(bOnly, {
          style: () => ({
            color: "#c62828",
            fillColor: "#c62828",
            fillOpacity: 0.45,
            weight: 1.5,
          }),
        }).addTo(map);
        isochroneLayers.push(layer);
        allBounds.extend(layer.getBounds());
      }

      // 両方 → 紫
      if (intersection) {
        const layer = L.geoJSON(intersection, {
          style: () => ({
            color: "#6a1b9a",
            fillColor: "#9c27b0",
            fillOpacity: 0.45,
            weight: 1.5,
          }),
        }).addTo(map);
        isochroneLayers.push(layer);
        allBounds.extend(layer.getBounds());
      }
    } catch (e) {
      console.warn("Turf.js 演算エラー、フォールバック表示:", e);
      // フォールバック: 単純な重ね合わせ
      drawFallbackComparison(geojsonA, geojsonB, allBounds);
    }
  } else {
    // 片方だけある場合
    const geojson = geojsonA || geojsonB;
    const color = geojsonA ? "#1565c0" : "#c62828";
    const layer = L.geoJSON(geojson, {
      style: () => ({
        color: color,
        fillColor: color,
        fillOpacity: 0.4,
        weight: 2,
      }),
    }).addTo(map);
    isochroneLayers.push(layer);
    allBounds.extend(layer.getBounds());
  }

  // ズーム
  if (allBounds.isValid()) {
    map.fitBounds(allBounds, { padding: [30, 30] });
    showLegend(true);
  }

  // マーカー
  const markerA = L.marker([stationA.lat, stationA.lng], {
    icon: createColoredIcon("#1565c0"),
  })
    .addTo(map)
    .bindPopup(createPopupContent(stationA, selectedTime, "A"));
  markers.push(markerA);

  const markerB = L.marker([stationB.lat, stationB.lng], {
    icon: createColoredIcon("#c62828"),
  })
    .addTo(map)
    .bindPopup(createPopupContent(stationB, selectedTime, "B"));
  markers.push(markerB);
}

/**
 * GeoJSON FeatureCollection の全 Feature を1つの MultiPolygon に結合する
 */
function combineFeaturesForTurf(geojson) {
  const features = geojson.features || [geojson];
  if (features.length === 1) return features[0];

  // 複数 Feature → union で1つに結合
  let combined = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const result = turf.union(
        turf.featureCollection([combined, features[i]])
      );
      if (result) combined = result;
    } catch {
      // union 失敗時はスキップ
    }
  }
  return combined;
}

/**
 * 安全な intersection（エラー時は null）
 */
function safeIntersect(featA, featB) {
  try {
    return turf.intersect(turf.featureCollection([featA, featB]));
  } catch {
    return null;
  }
}

/**
 * 安全な difference（エラー時は null）
 */
function safeDifference(featA, featB) {
  try {
    return turf.difference(turf.featureCollection([featA, featB]));
  } catch {
    return null;
  }
}

/**
 * フォールバック: Turf.js が使えない場合の単純重ね合わせ
 */
function drawFallbackComparison(geojsonA, geojsonB, allBounds) {
  if (geojsonA) {
    const layer = L.geoJSON(geojsonA, {
      style: () => ({
        color: "#1565c0", fillColor: "#1565c0",
        fillOpacity: 0.35, weight: 2,
      }),
    }).addTo(map);
    isochroneLayers.push(layer);
    allBounds.extend(layer.getBounds());
  }
  if (geojsonB) {
    const layer = L.geoJSON(geojsonB, {
      style: () => ({
        color: "#c62828", fillColor: "#c62828",
        fillOpacity: 0.35, weight: 2,
      }),
    }).addTo(map);
    isochroneLayers.push(layer);
    allBounds.extend(layer.getBounds());
  }
}

/**
 * 色付きマーカーアイコンを作成する
 */
function createColoredIcon(color) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background: ${color};
      width: 14px; height: 14px;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
}

function createPopupContent(station, timeMinutes, label) {
  const color = label === "A" ? "#1a237e" : "#b71c1c";
  return `
    <div class="popup-content">
      <div class="popup-station" style="color:${color}">
        駅${label}: ${station.name}駅
      </div>
      <div class="popup-city">${station.city}</div>
      <hr class="popup-divider">
      <div class="popup-time">
        選択時間: <strong>${timeMinutes}分</strong>
      </div>
    </div>
  `;
}

function clearOverlays() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
  isochroneLayers.forEach((layer) => map.removeLayer(layer));
  isochroneLayers = [];
}
