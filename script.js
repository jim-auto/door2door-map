// ============================================================
// door2door-map - メインスクリプト
// ============================================================

// --- 定数 ---
const WALK_SPEED_KMH = 5;   // 徒歩速度 (km/h)
const TRAIN_SPEED_KMH = 40; // 電車速度 (km/h)

// 円の表示スタイル
const CIRCLE_STYLES = {
  walk: {
    color: "#43a047",
    fillColor: "#a5d6a7",
    fillOpacity: 0.25,
    weight: 2,
    dashArray: "6, 4",
  },
  train: {
    color: "#1a73e8",
    fillColor: "#90caf9",
    fillOpacity: 0.15,
    weight: 2,
  },
};

// --- グローバル変数 ---
let map;
let stationMarker = null;
let walkCircle = null;
let trainCircle = null;
let stations = [];

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
  // 日本全体が見える位置で初期化
  map = L.map("map").setView([35.68, 139.76], 6);

  // OpenStreetMap タイルレイヤー
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
 * 駅データからドロップダウンの選択肢を生成する
 */
function populateDropdown(stations) {
  const select = document.getElementById("station-select");

  // 都市ごとにグループ化して表示
  const cities = [...new Set(stations.map((s) => s.city))];

  cities.forEach((city) => {
    const group = document.createElement("optgroup");
    group.label = city;

    stations
      .filter((s) => s.city === city)
      .forEach((station, index) => {
        const option = document.createElement("option");
        // stations 配列内のインデックスを値にする
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

  // 駅が選択されたとき
  select.addEventListener("change", () => {
    updateMap();
  });

  // スライダーが変更されたとき
  slider.addEventListener("input", () => {
    timeValue.textContent = slider.value;
    updateMap();
  });
}

// ============================================================
// 地図更新
// ============================================================

/**
 * 選択された駅と時間に基づいて地図を更新する
 */
function updateMap() {
  const select = document.getElementById("station-select");
  const slider = document.getElementById("time-slider");

  // 駅が未選択の場合はクリア
  if (select.value === "") {
    clearOverlays();
    return;
  }

  const station = stations[parseInt(select.value)];
  const timeMinutes = parseInt(slider.value);

  // 移動可能距離を計算 (km → メートル)
  const walkDistanceM = calcDistance(WALK_SPEED_KMH, timeMinutes);
  const trainDistanceM = calcDistance(TRAIN_SPEED_KMH, timeMinutes);

  const latlng = [station.lat, station.lng];

  // 既存のオーバーレイをクリア
  clearOverlays();

  // 電車圏（外側の大きな円）
  trainCircle = L.circle(latlng, {
    radius: trainDistanceM,
    ...CIRCLE_STYLES.train,
  }).addTo(map);

  // 徒歩圏（内側の小さな円）
  walkCircle = L.circle(latlng, {
    radius: walkDistanceM,
    ...CIRCLE_STYLES.walk,
  }).addTo(map);

  // 駅マーカー
  stationMarker = L.marker(latlng)
    .addTo(map)
    .bindPopup(createPopupContent(station, timeMinutes, walkDistanceM, trainDistanceM))
    .openPopup();

  // 電車圏が収まるようにズーム
  map.fitBounds(trainCircle.getBounds(), { padding: [30, 30] });
}

/**
 * 速度と時間から移動距離（メートル）を計算する
 */
function calcDistance(speedKmh, timeMinutes) {
  const timeHours = timeMinutes / 60;
  const distanceKm = speedKmh * timeHours;
  return distanceKm * 1000; // km → m
}

/**
 * ポップアップの内容を生成する
 */
function createPopupContent(station, timeMinutes, walkDistM, trainDistM) {
  const walkKm = (walkDistM / 1000).toFixed(1);
  const trainKm = (trainDistM / 1000).toFixed(1);

  return `
    <div style="font-size: 14px; line-height: 1.6;">
      <strong>📍 ${station.name}駅</strong>（${station.city}）<br>
      ⏱ ${timeMinutes} 分<br>
      <span style="color: #43a047;">🚶 徒歩圏: ${walkKm} km</span><br>
      <span style="color: #1a73e8;">🚃 電車圏: ${trainKm} km</span>
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
  if (walkCircle) {
    map.removeLayer(walkCircle);
    walkCircle = null;
  }
  if (trainCircle) {
    map.removeLayer(trainCircle);
    trainCircle = null;
  }
}
