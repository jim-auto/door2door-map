# door2door-map

主要都市のハブ駅から、指定時間以内に到達できる範囲を地図上で可視化する Web アプリです。

## デモ

GitHub Pages で公開:
https://jim-auto.github.io/door2door-map/

## 概要

通勤や引っ越しの検討時に「この駅から30分で、どのくらいの範囲に行けるのか？」をざっくり把握するためのツールです。

OpenStreetMap の実在する鉄道駅データを使い、交通経路ベースの到達圏ポリゴンを事前計算して表示します。

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
3. 地図上に到達可能範囲がポリゴンで表示されます

## モデルについて

このアプリは、実在する駅の位置データと簡易的な移動モデルを組み合わせて到達圏を算出しています。

### 計算方法

1. **Overpass API** で各ハブ駅の周辺 35km 以内の鉄道駅を取得
2. 各駅への所要時間を推定:
   - 直線距離 × 迂回係数 (1.3) / 電車速度 (40 km/h)
   - 停車駅ペナルティ: 約 2km ごとに 1 駅、1 駅あたり +1 分
3. 残り時間で徒歩圏 (5 km/h) をバッファとして追加
4. 全バッファを結合してポリゴン化

### 考慮していない要素

- 実際の鉄道ダイヤ・運行頻度
- 乗換時間・待ち時間
- 急行・特急の速度差
- 道路・地形による迂回

あくまで「概算でどの程度の範囲か」を把握するためのツールです。

## 技術スタック

- HTML / CSS / JavaScript（フレームワーク不使用）
- [Leaflet.js](https://leafletjs.com/) — 地図表示
- [OpenStreetMap](https://www.openstreetmap.org/) — タイルデータ・駅データ
- [Overpass API](https://overpass-api.de/) — 駅座標の取得
- Python + Shapely — isochrone ポリゴンの事前生成

## ファイル構成

```
door2door-map/
├── index.html              # メインHTML
├── style.css               # スタイルシート
├── script.js               # アプリケーションロジック
├── data/
│   ├── stations.json       # ハブ駅データ
│   └── isochrones/         # 事前計算済み GeoJSON (9駅 × 11ステップ)
│       ├── shibuya_10.geojson
│       ├── shibuya_15.geojson
│       ├── ...
│       └── namba_60.geojson
├── scripts/
│   └── generate_isochrones.py  # GeoJSON 生成スクリプト
└── README.md
```

## ローカルで動かす

```bash
# リポジトリをクローン
git clone https://github.com/jim-auto/door2door-map.git
cd door2door-map

# ローカルサーバーを起動（例: Python）
python -m http.server 8000

# ブラウザで http://localhost:8000 を開く
```

> `file://` プロトコルでは `fetch()` が動作しないため、ローカルサーバーが必要です。

### isochrone データを再生成する場合

```bash
pip install requests shapely numpy
python scripts/generate_isochrones.py
```

> Overpass API のレートリミットがあるため、全駅の生成には数分かかります。

## 将来の拡張予定

- [ ] GTFS データとの連携による正確な所要時間計算
- [ ] 急行・特急の速度差を反映
- [ ] 駅の追加（福岡・札幌・京都など）
- [ ] 複数駅の同時表示・比較機能
- [ ] 家賃データとの重ね合わせ表示
- [ ] モバイル UI の最適化

## ライセンス

MIT
