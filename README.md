# door2door-map

主要都市のハブ駅から、指定時間以内に到達できる範囲を地図上で可視化する Web アプリです。

## デモ

GitHub Pages で公開:
https://jim-auto.github.io/door2door-map/

## 概要

通勤や引っ越しの検討時に「この駅から30分で、どのくらいの範囲に行けるのか？」をざっくり把握するためのツールです。

OpenStreetMap の実際の鉄道路線ネットワーク（線路形状）を使い、ダイクストラ法で到達圏を算出。事前計算した GeoJSON ポリゴンを時間帯別グラデーションで表示します。

### 対応駅

| 都市 | 駅 |
|------|-----|
| 東京 | 渋谷・新宿・池袋・上野 |
| 神奈川 | 横浜 |
| 名古屋 | 名古屋（名駅）・栄 |
| 大阪 | 梅田・難波 |

## 使い方

1. ドロップダウンから駅を選択
2. スライダーで移動時間（10〜60分）を設定
3. 地図上に到達可能範囲がグラデーション表示されます
   - **濃い青**: 短時間で到達可能（10分圏）
   - **薄い青**: 長い時間が必要（60分圏）
4. 左上の情報パネルに駅情報、右下に凡例が表示されます

## モデルについて

### 計算方法

1. **Overpass API** で各地域の鉄道路線ジオメトリと駅を一括取得
   - 東京圏: 1,371駅, 19,410路線way, 130,289ノード
   - 名古屋圏: 579駅, 8,447路線way
   - 大阪圏: 907駅, 13,489路線way
2. OSM ノードレベルで鉄道ネットワークグラフを構築
   - 路線に沿った実距離（ハーバーサイン公式）でエッジ重み付け
   - 同名 or 200m以内の駅を乗換接続
3. **ダイクストラ法**でハブ駅から全駅への最短路線距離を計算
4. 路線距離 / 表定速度 (50 km/h) で所要時間を推定
5. 残り時間で徒歩バッファ (5 km/h) を追加
6. 全バッファを結合 → 陸地でクリップ → ポリゴン化

### 精度

38区間の実時刻表データ（[トラベルタウンズ](https://www.traveltowns.jp/)）で検証:

| 評価 | 件数 | 割合 |
|------|------|------|
| OK (誤差 ±5分以内) | 28 | 74% |
| ~ (誤差 ±10分以内) | 7 | 18% |
| NG (誤差 10分超) | 3 | 8% |
| **平均誤差** | **4.0分** | |

### 考慮していない要素

- 実際の鉄道ダイヤ・運行頻度
- 乗換待ち時間
- 急行・特急の速度差（表定速度で近似）
- 道路・地形による徒歩の迂回

あくまで「概算でどの程度の範囲か」を把握するためのツールです。

## 技術スタック

- HTML / CSS / JavaScript（フレームワーク不使用）
- [Leaflet.js](https://leafletjs.com/) — 地図表示・凡例・情報パネル
- [OpenStreetMap](https://www.openstreetmap.org/) — タイルデータ・鉄道路線データ
- [Overpass API](https://overpass-api.de/) — 鉄道ネットワーク取得
- Python + Shapely — ダイクストラ法 + isochrone ポリゴン事前生成

## ファイル構成

```
door2door-map/
├── index.html                        # メインHTML
├── style.css                         # スタイルシート（凡例・情報パネル含む）
├── script.js                         # 時間帯別グラデーション描画
├── data/
│   ├── stations.json                 # ハブ駅データ
│   └── isochrones/                   # 事前計算済み GeoJSON (9駅 × 11ステップ)
├── scripts/
│   ├── generate_isochrones_v2.py     # ダイクストラ法による GeoJSON 生成
│   ├── generate_isochrones.py        # v1 (簡易モデル, 参考用)
│   ├── fetch_land.py                 # 陸地ポリゴン取得
│   └── test_calibration.py           # 38区間のキャリブレーションテスト
└── README.md
```

## ローカルで動かす

```bash
git clone https://github.com/jim-auto/door2door-map.git
cd door2door-map
python -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

### isochrone データを再生成する場合

```bash
pip install requests shapely numpy
python scripts/fetch_land.py               # 陸地データ取得（初回のみ）
python scripts/generate_isochrones_v2.py   # GeoJSON 生成
python scripts/test_calibration.py         # キャリブレーション検証
```

> Overpass API のレートリミットがあるため、全駅の生成には数分かかります。

## 将来の拡張予定

- [ ] GTFS データとの連携による正確な所要時間計算
- [ ] 急行・特急の速度差を反映
- [ ] 駅の追加（福岡・札幌・京都など）
- [ ] 複数駅の同時表示・比較機能
- [ ] 家賃データとの重ね合わせ表示

## ライセンス

MIT
