"""
door2door-map isochrone 生成スクリプト v2

OpenStreetMap の実際の鉄道路線データを使い、
路線に沿った実距離でダイクストラ法を実行して到達圏を算出する。

アプローチ:
  1. Overpass API で鉄道路線 (way) と駅 (node) を取得
  2. 駅を最寄りの路線にスナップ
  3. 同一路線上の隣接駅間の実距離でグラフを構築
  4. ダイクストラ法でハブ駅からの所要時間を計算
  5. 到達駅 + 徒歩バッファ → ポリゴン → 陸地クリップ
"""

import heapq
import json
import math
import time as time_mod
from collections import defaultdict
from pathlib import Path

import requests
from shapely.geometry import LineString, MultiPoint, Point, mapping, shape
from shapely.ops import unary_union

# === 定数 ===
TRAIN_SPEED_KMH = 50        # 電車の表定速度 (テスト139区間で平均誤差4.4分)
WALK_SPEED_KMH = 5          # 徒歩速度
STATION_SNAP_DIST_M = 500   # 駅を路線にスナップする最大距離 (m)
TRANSFER_PENALTY_MIN = 5    # 乗換ペナルティ (ホーム移動+待ち時間)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SEARCH_RADIUS_KM = 40       # 検索半径
TIME_STEPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
CIRCLE_POINTS = 32

# ファイルパス
SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR.parent / "data" / "isochrones"
LAND_FILE = SCRIPT_DIR / "japan_land.geojson"
CACHE_DIR = SCRIPT_DIR / "cache"

HUB_STATIONS = [
    {"name": "渋谷",   "id": "shibuya",   "city": "東京",   "lat": 35.6580, "lng": 139.7016},
    {"name": "新宿",   "id": "shinjuku",  "city": "東京",   "lat": 35.6896, "lng": 139.7006},
    {"name": "池袋",   "id": "ikebukuro", "city": "東京",   "lat": 35.7295, "lng": 139.7109},
    {"name": "上野",   "id": "ueno",      "city": "東京",   "lat": 35.7141, "lng": 139.7774},
    {"name": "横浜",   "id": "yokohama",  "city": "神奈川", "lat": 35.4657, "lng": 139.6225},
    {"name": "名古屋", "id": "nagoya",    "city": "名古屋", "lat": 35.1709, "lng": 136.8815},
    {"name": "栄",     "id": "sakae",     "city": "名古屋", "lat": 35.1706, "lng": 136.9086},
    {"name": "金山",   "id": "kanayama",  "city": "名古屋", "lat": 35.1425, "lng": 136.9005},
    {"name": "梅田",   "id": "umeda",     "city": "大阪",   "lat": 34.7024, "lng": 135.4959},
    {"name": "難波",   "id": "namba",     "city": "大阪",   "lat": 34.6629, "lng": 135.5014},
]

# グローバル
land_polygon = None


# ============================================================
# ユーティリティ
# ============================================================

def haversine_km(lat1, lon1, lat2, lon2):
    """2点間の距離 (km)"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def polyline_distance_km(coords):
    """座標列 [(lat, lng), ...] に沿った総距離 (km)"""
    total = 0.0
    for i in range(len(coords) - 1):
        total += haversine_km(coords[i][0], coords[i][1],
                              coords[i+1][0], coords[i+1][1])
    return total


def load_land_polygon():
    """陸地ポリゴンを読み込み"""
    global land_polygon
    if not LAND_FILE.exists():
        print("  警告: japan_land.geojson なし。海上クリップなし。")
        return
    with open(LAND_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    polygons = []
    for feature in data["features"]:
        geom = shape(feature["geometry"])
        polygons.append(geom if geom.is_valid else geom.buffer(0))
    land_polygon = unary_union(polygons)
    print("  陸地ポリゴン読み込み完了")


# ============================================================
# Overpass API からデータ取得
# ============================================================

def fetch_rail_data(lat, lng, radius_km):
    """
    鉄道路線 (way) と駅 (station/halt node) を取得。
    キャッシュがあればそれを使う。
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = f"rail_{lat:.4f}_{lng:.4f}_{radius_km}"
    cache_file = CACHE_DIR / f"{cache_key}.json"

    if cache_file.exists():
        print(f"  キャッシュ使用: {cache_file.name}")
        with open(cache_file, "r", encoding="utf-8") as f:
            return json.load(f)

    radius_m = int(radius_km * 1000)

    # 駅と路線を一度に取得
    query = f"""
    [out:json][timeout:120];
    (
      node["railway"="station"](around:{radius_m},{lat},{lng});
      node["railway"="halt"](around:{radius_m},{lat},{lng});
      way["railway"~"^(rail|subway|light_rail|narrow_gauge|monorail)$"](around:{radius_m},{lat},{lng});
    );
    out body;
    >;
    out skel qt;
    """

    for attempt in range(5):
        print(f"  Overpass クエリ実行中... (attempt {attempt+1})")
        try:
            resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=180)
        except requests.exceptions.Timeout:
            wait = 30 * (attempt + 1)
            print(f"  タイムアウト。{wait}秒待機...")
            time_mod.sleep(wait)
            continue

        if resp.status_code in (429, 504):
            wait = 30 * (attempt + 1)
            print(f"  {resp.status_code}エラー。{wait}秒待機...")
            time_mod.sleep(wait)
            continue
        resp.raise_for_status()
        break

    data = resp.json()

    # キャッシュに保存
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"  キャッシュ保存: {cache_file.name} ({cache_file.stat().st_size / 1024 / 1024:.1f} MB)")

    return data


def parse_rail_data(data):
    """
    Overpass レスポンスを解析し、駅リストと路線リストを返す。

    Returns:
        stations: [{"id": int, "name": str, "lat": float, "lng": float}, ...]
        ways: [{"id": int, "coords": [(lat, lng), ...], "node_ids": [int, ...]}, ...]
        node_coords: {node_id: (lat, lng)}
    """
    node_coords = {}
    stations = []
    ways = []

    # まず全ノード座標を収集
    for el in data["elements"]:
        if el["type"] == "node":
            node_coords[el["id"]] = (el["lat"], el["lon"])

            # 駅ノード
            tags = el.get("tags", {})
            if tags.get("railway") in ("station", "halt"):
                name = tags.get("name", "")
                if name:
                    stations.append({
                        "id": el["id"],
                        "name": name,
                        "lat": el["lat"],
                        "lng": el["lon"],
                    })

    # 路線 way を処理
    for el in data["elements"]:
        if el["type"] == "way":
            tags = el.get("tags", {})
            if tags.get("railway") not in ("rail", "subway", "light_rail", "narrow_gauge", "monorail"):
                continue

            node_ids = el.get("nodes", [])
            coords = []
            for nid in node_ids:
                if nid in node_coords:
                    coords.append(node_coords[nid])

            if len(coords) >= 2:
                ways.append({
                    "id": el["id"],
                    "coords": coords,
                    "node_ids": node_ids,
                })

    print(f"  駅数: {len(stations)}, 路線way数: {len(ways)}")
    return stations, ways, node_coords


# ============================================================
# グラフ構築
# ============================================================

def build_rail_graph(stations, ways, node_coords):
    """
    OSM のノードレベルで詳細な鉄道ネットワークグラフを構築し、
    駅を最寄りのネットワークノードに接続する。

    OSM の way は短い断片に分割されているため、way 単位ではなく
    ノード単位でグラフを構築する必要がある。

    Returns:
        graph: {node_id: [(neighbor_id, distance_km), ...]}
    """
    graph = defaultdict(list)
    rail_edge_count = 0

    # Step 1: 全 way の隣接ノード間をエッジで接続
    # これにより way の断片が自動的に結合される
    # (隣接 way は端点ノードを共有している)
    rail_nodes = set()

    for way in ways:
        node_ids = way["node_ids"]
        for i in range(len(node_ids) - 1):
            n1 = node_ids[i]
            n2 = node_ids[i + 1]
            if n1 not in node_coords or n2 not in node_coords:
                continue

            c1 = node_coords[n1]
            c2 = node_coords[n2]
            d = haversine_km(c1[0], c1[1], c2[0], c2[1])

            if d > 5.0:  # 5km超のセグメントは異常値
                continue

            graph[n1].append((n2, d))
            graph[n2].append((n1, d))
            rail_nodes.add(n1)
            rail_nodes.add(n2)
            rail_edge_count += 1

    print(f"  鉄道ネットワーク: {len(rail_nodes)} ノード, {rail_edge_count} エッジ")

    # Step 2: 各駅を近傍の全鉄道ネットワークノードに接続
    # 複数路線（JR・地下鉄等）が交差する駅では、全ネットワークに接続する必要がある
    STATION_CONNECT_RADIUS_KM = 0.5  # 500m以内の全ノードに接続

    rail_node_list = list(rail_nodes)
    rail_node_lats = [node_coords[n][0] for n in rail_node_list]
    rail_node_lngs = [node_coords[n][1] for n in rail_node_list]

    connected_stations = 0
    total_station_edges = 0

    for s in stations:
        nearby_nodes = []

        # 緯度経度で粗いフィルタ後、500m 以内の全ノードを収集
        for idx, rn in enumerate(rail_node_list):
            if abs(rail_node_lats[idx] - s["lat"]) > 0.006:
                continue
            if abs(rail_node_lngs[idx] - s["lng"]) > 0.008:
                continue
            d = haversine_km(s["lat"], s["lng"],
                             rail_node_lats[idx], rail_node_lngs[idx])
            if d <= STATION_CONNECT_RADIUS_KM:
                nearby_nodes.append((rn, d))

        if nearby_nodes:
            for rn, d in nearby_nodes:
                graph[s["id"]].append((rn, d))
                graph[rn].append((s["id"], d))
                total_station_edges += 1
            connected_stations += 1

    print(f"  接続済み駅: {connected_stations} / {len(stations)} (駅-ノード エッジ: {total_station_edges})")

    # Step 3: 乗換接続 (同名 or 200m以内の駅)
    # 乗換コスト = 物理距離 + ペナルティ (ホーム移動 + 待ち時間)
    # 5分ペナルティ → 距離に換算: 5min × 50km/h / 60 = 4.17km 相当
    transfer_penalty_km = TRANSFER_PENALTY_MIN / 60 * TRAIN_SPEED_KMH
    transfer_edges = 0
    for i, s1 in enumerate(stations):
        for j, s2 in enumerate(stations):
            if i >= j:
                continue
            d = haversine_km(s1["lat"], s1["lng"], s2["lat"], s2["lng"])
            if s1["name"] == s2["name"] or d < 0.2:
                cost = d + transfer_penalty_km
                graph[s1["id"]].append((s2["id"], cost))
                graph[s2["id"]].append((s1["id"], cost))
                transfer_edges += 1

    print(f"  乗換エッジ: {transfer_edges} (penalty: {TRANSFER_PENALTY_MIN}min={transfer_penalty_km:.1f}km)")
    return graph


# ============================================================
# ダイクストラ法
# ============================================================

def dijkstra(graph, start_id, stations):
    """
    ダイクストラ法でハブ駅から全駅への最短距離 (km) を計算。

    Returns:
        {station_id: distance_km}
    """
    dist = {start_id: 0.0}
    visited = set()
    heap = [(0.0, start_id)]

    while heap:
        d, u = heapq.heappop(heap)

        if u in visited:
            continue
        visited.add(u)

        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))

    return dist


def find_hub_station_id(hub, stations):
    """ハブ駅に最も近い駅ノードの ID を返す"""
    best_id = None
    best_dist = float("inf")
    for s in stations:
        d = haversine_km(hub["lat"], hub["lng"], s["lat"], s["lng"])
        if d < best_dist:
            best_dist = d
            best_id = s["id"]
    if best_dist > 1.0:
        print(f"  警告: 最寄り駅が {best_dist:.1f}km 離れています")
    return best_id


# ============================================================
# Isochrone 生成
# ============================================================

def create_circle_points(lat, lng, radius_km, n_points=CIRCLE_POINTS):
    """円の頂点リスト"""
    points = []
    for i in range(n_points):
        angle = 2 * math.pi * i / n_points
        dlat = radius_km / 111.32 * math.cos(angle)
        dlng = radius_km / (111.32 * math.cos(math.radians(lat))) * math.sin(angle)
        points.append(Point(lng + dlng, lat + dlat))
    return points


def generate_isochrone(hub, stations_dict, distances_km, time_min):
    """
    ダイクストラの結果から isochrone ポリゴンを生成。

    distances_km: {station_id: rail_distance_km}
    """
    buffers = []

    # ハブ駅の徒歩圏
    walk_only_km = WALK_SPEED_KMH * time_min / 60
    hub_pts = create_circle_points(hub["lat"], hub["lng"], walk_only_km)
    buffers.append(MultiPoint(hub_pts).convex_hull)

    for sid, rail_km in distances_km.items():
        # 路線距離から所要時間を算出
        train_min = (rail_km / TRAIN_SPEED_KMH) * 60

        if train_min >= time_min:
            continue

        station = stations_dict.get(sid)
        if station is None:
            continue

        # 残り時間で徒歩
        remaining_min = time_min - train_min
        walk_km = WALK_SPEED_KMH * remaining_min / 60

        if walk_km < 0.1:
            continue

        pts = create_circle_points(station["lat"], station["lng"], walk_km)
        buffers.append(MultiPoint(pts).convex_hull)

    if not buffers:
        return None

    merged = unary_union(buffers)

    # 陸地クリップ
    if land_polygon is not None:
        clipped = merged.intersection(land_polygon)
        if not clipped.is_empty:
            merged = clipped

    simplified = merged.simplify(0.002, preserve_topology=True)
    return simplified


def polygon_to_geojson(polygon, hub, time_min):
    """GeoJSON Feature に変換"""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "station": hub["name"],
                    "city": hub["city"],
                    "time_minutes": time_min,
                    "model": "rail_network+walk",
                },
                "geometry": mapping(polygon),
            }
        ],
    }


# ============================================================
# メイン
# ============================================================

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    load_land_polygon()

    # 地域ごとにまとめてデータを取得 (API呼び出し削減)
    regions = {
        "tokyo": {
            "lat": 35.69, "lng": 139.70, "radius": 40,
            "hubs": [h for h in HUB_STATIONS if h["city"] in ("東京", "神奈川")],
        },
        "nagoya": {
            "lat": 35.17, "lng": 136.90, "radius": 40,
            "hubs": [h for h in HUB_STATIONS if h["city"] == "名古屋"],
        },
        "osaka": {
            "lat": 34.68, "lng": 135.50, "radius": 40,
            "hubs": [h for h in HUB_STATIONS if h["city"] == "大阪"],
        },
    }

    for region_name, region in regions.items():
        print(f"\n{'='*50}")
        print(f"地域: {region_name}")
        print(f"{'='*50}")

        # 全ハブが生成済みならスキップ
        all_done = all(
            all((OUTPUT_DIR / f"{h['id']}_{t}.geojson").exists() for t in TIME_STEPS)
            for h in region["hubs"]
        )
        if all_done:
            print("  全ハブ生成済み。スキップ")
            continue

        # 鉄道データ取得
        raw_data = fetch_rail_data(region["lat"], region["lng"], region["radius"])
        stations, ways, node_coords = parse_rail_data(raw_data)

        # 駅辞書
        stations_dict = {s["id"]: s for s in stations}

        # グラフ構築
        graph = build_rail_graph(stations, ways, node_coords)

        time_mod.sleep(3)

        # 各ハブ駅について処理
        for hub in region["hubs"]:
            print(f"\n--- {hub['name']}駅 ---")

            # 生成済みチェック
            if all((OUTPUT_DIR / f"{hub['id']}_{t}.geojson").exists() for t in TIME_STEPS):
                print("  生成済み。スキップ")
                continue

            # ハブ駅 ID 特定
            hub_id = find_hub_station_id(hub, stations)
            if hub_id is None:
                print("  ハブ駅が見つかりません。スキップ")
                continue

            hub_station = stations_dict[hub_id]
            print(f"  ハブ駅マッチ: {hub_station['name']} (距離: {haversine_km(hub['lat'], hub['lng'], hub_station['lat'], hub_station['lng']):.2f}km)")

            # ダイクストラ
            distances = dijkstra(graph, hub_id, stations)
            reachable = sum(1 for d in distances.values() if d < TRAIN_SPEED_KMH)
            print(f"  到達可能駅: {reachable} / {len(stations)}")

            # 各時間ステップで isochrone 生成
            for t in TIME_STEPS:
                polygon = generate_isochrone(hub, stations_dict, distances, t)
                if polygon is None or polygon.is_empty:
                    print(f"  {t}分: スキップ")
                    continue

                geojson = polygon_to_geojson(polygon, hub, t)
                filename = f"{hub['id']}_{t}.geojson"
                filepath = OUTPUT_DIR / filename

                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(geojson, f, ensure_ascii=False, indent=None)

                size_kb = filepath.stat().st_size / 1024
                print(f"  {t}分: {filename} ({size_kb:.1f} KB)")

    print("\n完了!")


if __name__ == "__main__":
    main()
