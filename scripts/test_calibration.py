"""
モデルのキャリブレーション用テストデータと検証スクリプト

実際の乗換案内で調べた所要時間と、モデルの推定時間を比較する。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_isochrones_v2 import *

# ==============================================
# テストデータ: (出発駅名, 到着駅名, 実際の所要時間(分), メモ)
# 時間は平日日中の標準的な所要時間 (乗換含む)
# ==============================================

TEST_CASES_TOKYO = [
    # 短距離 (山手線内)
    ("渋谷", "新宿", 5, "JR山手線 直通"),
    ("渋谷", "池袋", 20, "JR山手線/副都心線"),
    ("新宿", "池袋", 15, "JR山手線/丸ノ内線"),
    ("新宿", "上野", 25, "JR中央線+山手線"),
    ("渋谷", "上野", 25, "JR山手線/銀座線"),
    ("池袋", "上野", 18, "JR山手線"),

    # 中距離 (都心→郊外)
    ("渋谷", "横浜", 30, "東急東横線 特急"),
    ("新宿", "横浜", 33, "JR湘南新宿ライン"),
    ("池袋", "横浜", 50, "JR湘南新宿ライン/副都心線経由"),
    ("上野", "横浜", 40, "JR京浜東北線/上野東京ライン"),

    # 都心→千葉方面
    ("上野", "柏", 30, "JR常磐線快速"),
    ("上野", "松戸", 20, "JR常磐線快速"),

    # 都心→埼玉方面
    ("池袋", "大宮", 30, "JR埼京線/湘南新宿ライン"),
    ("上野", "大宮", 25, "JR宇都宮線/高崎線"),
    ("新宿", "立川", 25, "JR中央線快速"),

    # 都心→多摩方面
    ("渋谷", "二子玉川", 10, "東急田園都市線"),
    ("新宿", "調布", 18, "京王線"),
    ("池袋", "所沢", 25, "西武池袋線"),
]

TEST_CASES_NAGOYA = [
    ("名古屋", "栄町", 5, "地下鉄東山線"),
    ("名古屋", "金山", 5, "JR/地下鉄"),
    ("名古屋", "千種", 8, "JR中央線/地下鉄"),
    ("名古屋", "大曽根", 12, "JR中央線/地下鉄"),
    ("名古屋", "岡崎", 30, "JR東海道線快速"),
    ("名古屋", "豊橋", 50, "JR東海道線快速"),
]

TEST_CASES_OSAKA = [
    ("大阪", "難波", 10, "地下鉄御堂筋線"),
    ("大阪", "天王寺", 15, "地下鉄御堂筋線"),
    ("大阪", "京橋", 8, "JR環状線"),
    ("大阪", "三ノ宮", 22, "JR東海道線新快速"),
    ("大阪", "京都", 28, "JR東海道線新快速"),
    ("難波", "天王寺", 8, "地下鉄御堂筋線"),
    ("難波", "関西空港", 40, "南海ラピート"),
]


def find_station_by_name(name, stations):
    """名前で駅を検索 (完全一致 → 部分一致)"""
    for s in stations:
        if s["name"] == name:
            return s
    for s in stations:
        if name in s["name"] or s["name"] in name:
            return s
    return None


def run_tests(region_name, cache_pattern, test_cases, speed_kmh=40):
    """テストケースを実行して結果を表示"""
    cache = Path("scripts/cache")
    cache_files = list(cache.glob(cache_pattern))
    if not cache_files:
        print(f"  キャッシュなし: {cache_pattern}")
        return []

    with open(cache_files[0], encoding="utf-8") as f:
        raw = json.load(f)

    stations, ways, node_coords = parse_rail_data(raw)
    graph = build_rail_graph(stations, ways, node_coords)

    results = []

    print(f"\n{'='*70}")
    print(f" {region_name}  (speed={speed_kmh} km/h)")
    print(f"{'='*70}")
    print(f"{'出発':<8} {'到着':<10} {'graph':>6} {'model':>6} {'real':>6} {'diff':>6} {'評価'}")
    print(f"{'-'*70}")

    for src_name, dst_name, real_min, note in test_cases:
        src = find_station_by_name(src_name, stations)
        dst = find_station_by_name(dst_name, stations)

        if src is None:
            print(f"{src_name:<8} -- not found")
            continue
        if dst is None:
            print(f"{src_name:<8} {dst_name:<10} -- dst not found")
            continue

        dist = dijkstra(graph, src["id"], stations)
        d_km = dist.get(dst["id"], float("inf"))

        if d_km == float("inf"):
            print(f"{src_name:<8} {dst_name:<10} -- unreachable")
            continue

        model_min = d_km / speed_kmh * 60
        diff = model_min - real_min
        ratio = model_min / real_min if real_min > 0 else 0

        if abs(diff) <= 5:
            grade = "OK"
        elif abs(diff) <= 10:
            grade = "~"
        else:
            grade = "NG"

        print(f"{src_name:<8} {dst_name:<10} {d_km:>5.1f}km {model_min:>5.0f}m {real_min:>5.0f}m {diff:>+5.0f}m  {grade}  ({note})")
        results.append((src_name, dst_name, d_km, model_min, real_min, diff))

    # サマリー
    if results:
        diffs = [abs(r[5]) for r in results]
        ok_count = sum(1 for d in diffs if d <= 5)
        approx_count = sum(1 for d in diffs if 5 < d <= 10)
        ng_count = sum(1 for d in diffs if d > 10)
        avg_diff = sum(diffs) / len(diffs)
        print(f"\n  OK(+-5m): {ok_count}  ~(+-10m): {approx_count}  NG(>10m): {ng_count}  平均誤差: {avg_diff:.1f}分")

    return results


if __name__ == "__main__":
    speeds = [35, 40, 45, 50]

    for speed in speeds:
        all_results = []
        all_results += run_tests("東京", "rail_35.69*", TEST_CASES_TOKYO, speed)
        all_results += run_tests("名古屋", "rail_35.17*", TEST_CASES_NAGOYA, speed)
        all_results += run_tests("大阪", "rail_34.68*", TEST_CASES_OSAKA, speed)

        if all_results:
            diffs = [abs(r[5]) for r in all_results]
            ok = sum(1 for d in diffs if d <= 5)
            approx = sum(1 for d in diffs if 5 < d <= 10)
            ng = sum(1 for d in diffs if d > 10)
            avg = sum(diffs) / len(diffs)
            print(f"\n>>> TOTAL @{speed}km/h: OK={ok} ~={approx} NG={ng} avg_err={avg:.1f}m")
            print()
