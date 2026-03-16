"""
モデルのキャリブレーション用テストデータと検証スクリプト

データソース: トラベルタウンズ (traveltowns.jp) の路線別所要時間
各区間で「快速・急行系」の代表的な所要時間を採用。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_isochrones_v2 import *

# ==============================================
# テストデータ
# 出典: traveltowns.jp の路線別所要時間
# 時間は快速・急行系の代表値 (特急除く)
# ==============================================

TEST_CASES_TOKYO = [
    # --- JR山手線 (渋谷起点, 外回り) ---
    ("渋谷", "原宿", 3, "JR山手線外回り"),
    ("渋谷", "新宿", 7, "JR山手線外回り"),
    ("渋谷", "高田馬場", 11, "JR山手線外回り"),
    ("渋谷", "池袋", 16, "JR山手線外回り"),
    ("渋谷", "上野", 32, "JR山手線外回り"),

    # --- JR山手線 (渋谷起点, 内回り) ---
    ("渋谷", "恵比寿", 2, "JR山手線内回り"),
    ("渋谷", "品川", 12, "JR山手線内回り"),
    ("渋谷", "東京", 24, "JR山手線内回り"),

    # --- JR山手線 (池袋起点, 内回り) ---
    ("池袋", "新宿", 9, "JR山手線内回り"),
    ("池袋", "渋谷", 16, "JR山手線内回り (=埼京線11分)"),
    ("池袋", "品川", 28, "JR山手線内回り"),

    # --- JR山手線 (池袋起点, 外回り) ---
    ("池袋", "上野", 16, "JR山手線外回り"),
    ("池袋", "東京", 24, "JR山手線外回り"),

    # --- 池袋→渋谷 (最速) ---
    ("池袋", "渋谷", 11, "JR埼京線/湘南新宿ライン"),

    # --- 渋谷→横浜 ---
    ("渋谷", "横浜", 26, "東急東横線特急/JR湘南新宿ライン快速"),

    # --- 池袋→横浜 ---
    ("池袋", "横浜", 37, "JR湘南新宿ライン快速"),

    # --- 上野→横浜 (JR京浜東北線/上野東京ライン) ---
    # 上野東京ライン: 約35分, 京浜東北線快速: 約40分
    ("上野", "横浜", 35, "JR上野東京ライン"),

    # --- 新宿→横浜 ---
    ("新宿", "横浜", 28, "JR湘南新宿ライン快速 (実際26-28分)"),

    # --- 上野→大宮 ---
    ("上野", "大宮", 26, "JR高崎線/宇都宮線快速"),

    # --- 新宿→立川 ---
    ("新宿", "立川", 27, "JR中央線中央特快"),

    # --- 西武池袋線 (池袋起点) ---
    ("池袋", "石神井公園", 12, "西武池袋線急行"),
    ("池袋", "所沢", 24, "西武池袋線急行"),
    ("池袋", "入間市", 39, "西武池袋線急行"),
    ("池袋", "飯能", 49, "西武池袋線急行"),

    # --- 池袋→大宮 ---
    ("池袋", "大宮", 27, "JR埼京線快速 (実際25-30分)"),

    # --- 新宿→調布 ---
    ("新宿", "調布", 18, "京王線急行"),

    # --- 渋谷→二子玉川 ---
    ("渋谷", "二子玉川", 10, "東急田園都市線急行"),

    # --- 上野→松戸 ---
    ("上野", "松戸", 20, "JR常磐線快速"),

    # --- 上野→柏 ---
    ("上野", "柏", 30, "JR常磐線快速"),
]

TEST_CASES_NAGOYA = [
    ("名古屋", "栄町", 5, "地下鉄東山線"),
    ("名古屋", "金山", 5, "JR東海道線/地下鉄"),
    ("名古屋", "千種", 8, "JR中央線"),
    ("名古屋", "大曽根", 12, "JR中央線"),
]

TEST_CASES_OSAKA = [
    ("大阪", "難波", 10, "地下鉄御堂筋線"),
    ("大阪", "天王寺", 15, "地下鉄御堂筋線"),
    ("大阪", "京橋", 8, "JR環状線"),
    ("大阪", "三ノ宮", 22, "JR東海道線新快速"),
    ("難波", "天王寺", 8, "地下鉄御堂筋線"),
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


def run_tests(region_name, cache_pattern, test_cases, speed_kmh=50):
    """テストケースを実行して結果を表示"""
    cache = Path("scripts/cache")
    cache_files = list(cache.glob(cache_pattern))
    if not cache_files:
        print(f"  cache not found: {cache_pattern}")
        return []

    with open(cache_files[0], encoding="utf-8") as f:
        raw = json.load(f)

    stations, ways, node_coords = parse_rail_data(raw)
    graph = build_rail_graph(stations, ways, node_coords)

    results = []

    print(f"\n{'='*75}")
    print(f" {region_name}  (speed={speed_kmh} km/h)")
    print(f"{'='*75}")
    print(f"{'from':<8} {'to':<12} {'graph':>6} {'model':>6} {'real':>6} {'diff':>6} {'grade':<4} note")
    print(f"{'-'*75}")

    for src_name, dst_name, real_min, note in test_cases:
        src = find_station_by_name(src_name, stations)
        dst = find_station_by_name(dst_name, stations)

        if src is None:
            print(f"{src_name:<8} -- not found")
            continue
        if dst is None:
            print(f"{src_name:<8} {dst_name:<12} -- dst not found")
            continue

        dist = dijkstra(graph, src["id"], stations)
        d_km = dist.get(dst["id"], float("inf"))

        if d_km == float("inf"):
            print(f"{src_name:<8} {dst_name:<12} -- unreachable")
            continue

        model_min = d_km / speed_kmh * 60
        diff = model_min - real_min

        if abs(diff) <= 5:
            grade = "OK"
        elif abs(diff) <= 10:
            grade = "~"
        else:
            grade = "NG"

        print(f"{src_name:<8} {dst_name:<12} {d_km:>5.1f}km {model_min:>5.0f}m {real_min:>5.0f}m {diff:>+5.0f}m  {grade:<4} {note}")
        results.append((src_name, dst_name, d_km, model_min, real_min, diff))

    # summary
    if results:
        diffs = [abs(r[5]) for r in results]
        ok_count = sum(1 for d in diffs if d <= 5)
        approx_count = sum(1 for d in diffs if 5 < d <= 10)
        ng_count = sum(1 for d in diffs if d > 10)
        avg_diff = sum(diffs) / len(diffs)
        print(f"\n  OK(+-5m): {ok_count}  ~(+-10m): {approx_count}  NG(>10m): {ng_count}  avg_err: {avg_diff:.1f}min")

    return results


if __name__ == "__main__":
    speeds = [45, 50, 55]

    for speed in speeds:
        all_results = []
        all_results += run_tests("Tokyo", "rail_35.69*", TEST_CASES_TOKYO, speed)
        all_results += run_tests("Nagoya", "rail_35.17*", TEST_CASES_NAGOYA, speed)
        all_results += run_tests("Osaka", "rail_34.68*", TEST_CASES_OSAKA, speed)

        if all_results:
            diffs = [abs(r[5]) for r in all_results]
            ok = sum(1 for d in diffs if d <= 5)
            approx = sum(1 for d in diffs if 5 < d <= 10)
            ng = sum(1 for d in diffs if d > 10)
            avg = sum(diffs) / len(diffs)
            print(f"\n>>> TOTAL @{speed}km/h: OK={ok} ~={approx} NG={ng} avg_err={avg:.1f}min")
            print()
