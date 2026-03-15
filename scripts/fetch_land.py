"""
日本の陸地ポリゴンを Overpass API から取得して GeoJSON で保存する。
generate_isochrones.py が海上クリップに使う。
"""

import json
import requests
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT = Path(__file__).resolve().parent / "japan_land.geojson"

# 日本の主要な陸地 (relation ID)
# 関東・中部・関西をカバーする都府県の行政境界を取得する代わりに、
# Natural Earth 相当の簡易ポリゴンを bbox で取得する方法を使う。

# 別アプローチ: Natural Earth の簡易版を使う
NATURAL_EARTH_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_land.geojson"
)


def fetch_land():
    """Natural Earth から陸地ポリゴンを取得し、日本周辺だけ抽出"""
    print("Natural Earth 陸地データを取得中...")
    resp = requests.get(NATURAL_EARTH_URL, timeout=60)
    resp.raise_for_status()
    world = resp.json()

    # 日本周辺の bbox でフィルタ (lat: 30-46, lng: 128-146)
    japan_features = []
    for feature in world["features"]:
        geom = feature["geometry"]
        if intersects_japan(geom):
            japan_features.append(feature)

    result = {
        "type": "FeatureCollection",
        "features": japan_features,
    }

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f)

    print(f"保存: {OUTPUT} ({OUTPUT.stat().st_size / 1024:.1f} KB)")
    print(f"フィーチャー数: {len(japan_features)}")


def intersects_japan(geom):
    """ジオメトリが日本周辺 bbox と交差するか簡易判定"""
    # Japan bbox
    min_lng, max_lng = 128, 146
    min_lat, max_lat = 30, 46

    def check_coords(coords):
        for c in coords:
            if isinstance(c[0], (list, tuple)):
                if check_coords(c):
                    return True
            else:
                lng, lat = c[0], c[1]
                if min_lng <= lng <= max_lng and min_lat <= lat <= max_lat:
                    return True
        return False

    if geom["type"] == "Polygon":
        return check_coords(geom["coordinates"])
    elif geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            if check_coords(poly):
                return True
    return False


if __name__ == "__main__":
    fetch_land()
