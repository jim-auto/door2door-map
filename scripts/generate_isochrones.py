"""
door2door-map isochrone 生成スクリプト

Overpass API で実際の鉄道駅を取得し、
各ハブ駅からの到達圏ポリゴン (GeoJSON) を生成する。

モデル:
  - 電車: 駅間直線距離 × 1.1 (迂回係数) / 60 km/h (急行・快速含む表定速度)
  - 徒歩バッファ: 各到達駅から徒歩速度 × 残り時間 の円
  - ポリゴン: 全バッファの union → concave hull 風に簡略化

キャリブレーション:
  渋谷→横浜 (直線28km): 28×1.1/60×60 = 30.8分 (実際28-32分) ✓
  新宿→横浜 (直線30km): 30×1.1/60×60 = 33分 (実際30-35分) ✓
"""

import json
import math
import os
import time
from pathlib import Path

import numpy as np
import requests
from shapely.geometry import MultiPoint, Point, mapping
from shapely.ops import unary_union

# === 定数 ===
TRAIN_SPEED_KMH = 60       # 電車の表定速度 (急行・快速含む平均)
WALK_SPEED_KMH = 5         # 徒歩速度
DETOUR_FACTOR = 1.1         # 直線距離に対する迂回係数 (日本の鉄道は直線的)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SEARCH_RADIUS_KM = 35       # 各ハブ駅周辺の駅検索半径 (km)
TIME_STEPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
CIRCLE_POINTS = 32          # 円の近似頂点数

# 出力先
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "isochrones"

# ハブ駅データ (stations.json と同じ)
HUB_STATIONS = [
    {"name": "渋谷",   "id": "shibuya",   "city": "東京",   "lat": 35.6580, "lng": 139.7016},
    {"name": "新宿",   "id": "shinjuku",  "city": "東京",   "lat": 35.6896, "lng": 139.7006},
    {"name": "池袋",   "id": "ikebukuro", "city": "東京",   "lat": 35.7295, "lng": 139.7109},
    {"name": "上野",   "id": "ueno",      "city": "東京",   "lat": 35.7141, "lng": 139.7774},
    {"name": "横浜",   "id": "yokohama",  "city": "神奈川", "lat": 35.4657, "lng": 139.6225},
    {"name": "名古屋", "id": "nagoya",    "city": "名古屋", "lat": 35.1709, "lng": 136.8815},
    {"name": "栄",     "id": "sakae",     "city": "名古屋", "lat": 35.1706, "lng": 136.9086},
    {"name": "梅田",   "id": "umeda",     "city": "大阪",   "lat": 34.7024, "lng": 135.4959},
    {"name": "難波",   "id": "namba",     "city": "大阪",   "lat": 34.6629, "lng": 135.5014},
]


def haversine_km(lat1, lon1, lat2, lon2):
    """2点間の距離 (km) をヒュベニ式で計算"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_stations_around(lat, lng, radius_km):
    """Overpass API で指定座標周辺の鉄道駅を取得"""
    radius_m = int(radius_km * 1000)
    query = f"""
    [out:json][timeout:60];
    (
      node["railway"="station"](around:{radius_m},{lat},{lng});
      node["railway"="halt"](around:{radius_m},{lat},{lng});
    );
    out body;
    """
    for attempt in range(5):
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=90)
        if resp.status_code in (429, 504):
            wait = 30 * (attempt + 1)
            print(f"  レートリミット。{wait}秒待機... (attempt {attempt+1}/5)")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        break
    data = resp.json()

    stations = []
    for el in data.get("elements", []):
        name = el.get("tags", {}).get("name", "")
        if not name:
            continue
        stations.append({
            "name": name,
            "lat": el["lat"],
            "lng": el["lon"],
        })

    print(f"  取得駅数: {len(stations)} (半径 {radius_km}km)")
    return stations


def estimate_travel_time_min(hub, station):
    """
    ハブ駅から目的駅への推定所要時間 (分)
    直線距離 × 迂回係数 / 表定速度
    停車・加減速は表定速度に含まれている想定
    """
    dist_km = haversine_km(hub["lat"], hub["lng"], station["lat"], station["lng"])
    rail_dist_km = dist_km * DETOUR_FACTOR
    travel_min = (rail_dist_km / TRAIN_SPEED_KMH) * 60
    return travel_min


def create_circle_polygon(lat, lng, radius_km, n_points=CIRCLE_POINTS):
    """指定座標を中心とした円ポリゴンの座標リストを返す"""
    points = []
    for i in range(n_points):
        angle = 2 * math.pi * i / n_points
        # 緯度・経度のオフセットを計算
        dlat = radius_km / 111.32 * math.cos(angle)
        dlng = radius_km / (111.32 * math.cos(math.radians(lat))) * math.sin(angle)
        points.append(Point(lng + dlng, lat + dlat))
    return points


def generate_isochrone(hub, nearby_stations, time_min):
    """
    指定時間内の到達圏ポリゴンを生成

    1. 各駅への電車所要時間を計算
    2. 残り時間で徒歩バッファを追加
    3. 全バッファの union をポリゴンとして返す
    """
    buffers = []

    # ハブ駅自体の徒歩圏
    walk_radius_km = (WALK_SPEED_KMH * time_min / 60)
    hub_circle = create_circle_polygon(hub["lat"], hub["lng"], walk_radius_km)
    buffers.append(MultiPoint(hub_circle).convex_hull)

    # 各駅への到達チェック
    for station in nearby_stations:
        train_time = estimate_travel_time_min(hub, station)

        if train_time >= time_min:
            continue  # 時間内に到達不可

        # 残り時間で徒歩
        remaining_min = time_min - train_time
        walk_km = WALK_SPEED_KMH * remaining_min / 60

        if walk_km < 0.1:
            continue

        circle = create_circle_polygon(station["lat"], station["lng"], walk_km)
        buffers.append(MultiPoint(circle).convex_hull)

    if not buffers:
        return None

    # 全バッファを結合
    merged = unary_union(buffers)

    # 頂点数を減らして軽量化
    simplified = merged.simplify(0.002, preserve_topology=True)

    return simplified


def polygon_to_geojson(polygon, hub, time_min):
    """Shapely ポリゴンを GeoJSON Feature に変換"""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "station": hub["name"],
                    "city": hub["city"],
                    "time_minutes": time_min,
                    "model": "train+walk",
                },
                "geometry": mapping(polygon),
            }
        ],
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for hub in HUB_STATIONS:
        print(f"\n=== {hub['name']}駅 ({hub['city']}) ===")

        # 既に全時間ステップ生成済みならスキップ
        all_exist = all((OUTPUT_DIR / f"{hub['id']}_{t}.geojson").exists() for t in TIME_STEPS)
        if all_exist:
            print(f"  既に生成済み。スキップ")
            continue

        # 周辺駅を取得 (Overpass API)
        nearby = fetch_stations_around(hub["lat"], hub["lng"], SEARCH_RADIUS_KM)

        # API レートリミット対策
        time.sleep(5)

        for t in TIME_STEPS:
            polygon = generate_isochrone(hub, nearby, t)
            if polygon is None or polygon.is_empty:
                print(f"  {t}分: スキップ (到達駅なし)")
                continue

            geojson = polygon_to_geojson(polygon, hub, t)
            filename = f"{hub['id']}_{t}.geojson"
            filepath = OUTPUT_DIR / filename

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(geojson, f, ensure_ascii=False, indent=None)

            # ファイルサイズ表示
            size_kb = filepath.stat().st_size / 1024
            print(f"  {t}分: {filename} ({size_kb:.1f} KB)")

    print("\n完了!")


if __name__ == "__main__":
    main()
