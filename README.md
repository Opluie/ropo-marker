# 六法マーカー

司法試験用の法令を Android スマホで読み、3色マーカーを引くための PWA。
法令データは e-Gov 法令検索（デジタル庁）の法令 API から取得して加工している。

仕様: [docs/spec.md](docs/spec.md)

## 法令データの更新

```
py scripts/fetch_laws.py
py scripts/convert_laws.py
py -m unittest scripts/test_convert.py -v
```

## 画面の開発

```
npm install
npm run dev      # 開発用サーバー
npm test         # 検索・マーカー計算・目次のテスト
npm run build    # dist/ に公開用ファイルを出力
```

main に push すると GitHub Actions がテスト・ビルドして GitHub Pages に公開する。
