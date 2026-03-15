// ============================================================
// door2door-map - メインスクリプト
// 交通経路ベースの到達圏ポリゴンを表示する
// ============================================================

// --- 定数 ---
const ISOCHRONE_STYLE = {
  color: "#1a73e8",
  fillColor: "#42a5f5",
  fillOpacity: 0.2,
  weight: 2,
};

// スライダーの値を GeoJSON ファイル名の時間値にスナップ
// (生成済み: 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60)
const SNAP_VALUES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

// --- グローバル変数 ---
let map;
let stationMarker = null;
let isochroneLayer = null;
let stations = [];
let geojsonCache = {};  // キャッシュ: "shibuya_30" → GeoJSON data

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
 * 選択された駅と時間に基づいて地図を更新する
 */
async function updateMap() {
  const select = document.getElementById("station-select");
  const slider = document.getElementById("time-slider");

  if (select.value === "") {
    clearOverlays();
    return;
  }

  const station = stations[parseInt(select.value)];
  const timeMinutes = snapTime(parseInt(slider.value));
  const latlng = [station.lat, station.lng];

  // GeoJSON を取得
  const geojson = await fetchIsochrone(station.id, timeMinutes);

  // 既存のオーバーレイをクリア
  clearOverlays();

  if (geojson) {
    // 到達圏ポリゴンを描画
    isochroneLayer = L.geoJSON(geojson, {
      style: () => ISOCHRONE_STYLE,
    }).addTo(map);

    // ポリゴンの範囲にフィット
    map.fitBounds(isochroneLayer.getBounds(), { padding: [30, 30] });
  } else {
    // GeoJSON がない場合は駅周辺にズーム
    map.setView(latlng, 12);
  }

  // 駅マーカー
  stationMarker = L.marker(latlng)
    .addTo(map)
    .bindPopup(createPopupContent(station, timeMinutes))
    .openPopup();
}

/**
 * ポップアップの内容を生成する
 */
function createPopupContent(station, timeMinutes) {
  return `
    <div style="font-size: 14px; line-height: 1.6;">
      <strong>${station.name}駅</strong>（${station.city}）<br>
      ${timeMinutes} 分の到達圏
    </div>
  `;
}

/**
 * 地図上のオーバーレイをすべて削除する
 */
function clearOverlays() {
  if (stationMarker) {
    map.removeLayer(stationMarker);
    stationMarker = null;
  }
  if (isochroneLayer) {
    map.removeLayer(isochroneLayer);
    isochroneLayer = null;
  }
}
