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
function updateLegend(stationA, stationB) {
  const div = document.getElementById("legend-content");
  if (!div) return;

  const displaySteps = [10, 20, 30, 40, 50, 60];
  let html = "";

  if (stationA && stationB) {
    // 比較モード: 2列で表示
    html += `<div class="legend-title">${stationA.name} vs ${stationB.name}</div>`;
    html += '<div class="legend-compare-header">';
    html += `<span class="legend-label-a">${stationA.name}</span>`;
    html += '<span class="legend-label-time">時間</span>';
    html += `<span class="legend-label-b">${stationB.name}</span>`;
    html += '</div>';

    displaySteps.forEach((time) => {
      html += '<div class="legend-compare-row">';
      html += `<span class="legend-color" style="background:${COLORS_A[time]};opacity:0.8"></span>`;
      html += `<span class="legend-label">${time}分</span>`;
      html += `<span class="legend-color" style="background:${COLORS_B[time]};opacity:0.8"></span>`;
      html += '</div>';
    });
  } else if (stationA) {
    // 単独モード
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
 */
async function updateMap() {
  const selectA = document.getElementById("station-select");
  const selectB = document.getElementById("station-select-b");
  const slider = document.getElementById("time-slider");

  // 駅Aが未選択ならクリア
  if (selectA.value === "") {
    clearOverlays();
    clearInfoPanel();
    showLegend(false);
    return;
  }

  const stationA = stations[parseInt(selectA.value)];
  const stationB = selectB.value !== "" ? stations[parseInt(selectB.value)] : null;
  const selectedTime = snapTime(parseInt(slider.value));

  // GeoJSON を取得（A は必須、B はオプション）
  const fetchPromises = [fetchAllIsochrones(stationA.id)];
  if (stationB) fetchPromises.push(fetchAllIsochrones(stationB.id));

  const results = await Promise.all(fetchPromises);
  const isochronesA = results[0];
  const isochronesB = stationB ? results[1] : null;

  // 既存のオーバーレイをクリア
  clearOverlays();

  // 駅Aのレイヤーを描画（青系）
  drawStationLayers(isochronesA, COLORS_A, selectedTime);

  // 駅Bのレイヤーを描画（赤系）
  if (isochronesB) {
    drawStationLayers(isochronesB, COLORS_B, selectedTime);
  }

  // ズーム: 両方の最大範囲にフィット
  if (isochroneLayers.length > 0) {
    const allBounds = L.latLngBounds([]);
    isochroneLayers.forEach((layer) => {
      allBounds.extend(layer.getBounds());
    });
    map.fitBounds(allBounds, { padding: [30, 30] });
    showLegend(true);
  } else {
    map.setView([stationA.lat, stationA.lng], 12);
    showLegend(false);
  }

  // マーカー: 駅A（青）
  const markerA = L.marker([stationA.lat, stationA.lng], {
    icon: createColoredIcon("#1a237e"),
  })
    .addTo(map)
    .bindPopup(createPopupContent(stationA, selectedTime, "A"));
  markers.push(markerA);

  // マーカー: 駅B（赤）
  if (stationB) {
    const markerB = L.marker([stationB.lat, stationB.lng], {
      icon: createColoredIcon("#b71c1c"),
    })
      .addTo(map)
      .bindPopup(createPopupContent(stationB, selectedTime, "B"));
    markers.push(markerB);
  } else {
    markerA.openPopup();
  }

  // 凡例と情報パネルを更新
  updateLegend(stationA, stationB);
  updateInfoPanel(stationA, stationB, selectedTime);
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
