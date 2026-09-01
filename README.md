# Rate Cycle Dashboard

日本と米国の「金利サイクルの現在地」を一目で把握できるペライチダッシュボード。
政策金利の推移とフェーズ（利上げ / 利下げ / 据え置き）、CPIを表示し、
サブ情報としてセクター×金利・債券・金の相関ヒートマップを添えます。

## 構成

- `scripts/fetch.js` — 各データソースから最新値を取得し `data/history.json` に追記する
- `scripts/backfill.js` — 過去1年分のヒストリカルデータをまとめて取得し `data/history.json` を埋める（初回のみ実行）
- `scripts/compute.js` — `data/history.json` からフェーズ判定・相関計算を行い `public/data/site-data.json` を生成する
- `public/index.html` — 静的サイト本体（GitHub Pagesで配信）

## セットアップ

```bash
cp .env.example .env
# .env に各APIキーを設定
npm run backfill   # 初回のみ：過去1年分を取得
npm run update     # 最新値取得 + 再計算
```

ローカルで確認する場合：

```bash
npx serve public
# または
python3 -m http.server 8080 --directory public
```

## 必要なAPIキー（.env）

| 変数名 | 用途 | 取得方法 |
|---|---|---|
| `FRED_API_KEY` | 米国政策金利・CPI（FRED） | https://fred.stlouisfed.org/docs/api/api_key.html で無料登録 |
| `ESTAT_APP_ID` | 日本CPI（e-Stat API） | https://www.e-stat.go.jp/api/ で無料登録 |
| `JQUANTS_API_KEY` | 日本の債券・セクターETF価格（J-Quants API v2） | https://jpx-jquants.com/register で無料登録 → サブスクリプション登録 → 設定 > APIキー から発行（Freeプランはデータに遅延あり） |

日銀の政策金利（時系列統計データ検索サイトAPI）、米国ETF・金価格（Yahoo Finance）はAPIキー不要の公開ソースを使用しています。

## データソース

| データ | ソース | 認証 |
|---|---|---|
| 日本の政策金利 | 日本銀行 時系列統計データ検索サイト API（DB: FM01, 無担保コールO/N物レート） | 不要 |
| 米国の政策金利 | FRED（`DFEDTARU`: FF金利誘導目標上限） | APIキー |
| 日本のCPI | e-Stat API（統計表ID `0004052037`, 2025年基準CPI・全国・総合） | APIキー |
| 米国のCPI | FRED（`CPILFESL`: コアCPI） | APIキー |
| 日本の債券ETF | J-Quants API v2（銘柄コード2510: NEXT FUNDS 国内債券） | APIキー |
| 日本のセクターETF | J-Quants API v2（TOPIX-17業種別ETF, 銘柄コード1617〜1633） | APIキー |
| 米国の債券ETF | Yahoo Finance chart API（TLT） | 不要 |
| 米国のセクターETF | Yahoo Finance chart API（XLF, XLE, XLK など） | 不要 |
| 金価格 | Yahoo Finance chart API（GC=F: COMEX金先物） | 不要 |

Yahoo Financeのchart APIは非公式エンドポイントのため、将来的に仕様変更・停止のリスクがあります。

## GitHub Pagesでの公開

1. GitHubリポジトリの Settings > Secrets and variables > Actions で `FRED_API_KEY` / `ESTAT_APP_ID` / `JQUANTS_API_KEY` を登録する
2. Settings > Pages > Build and deployment > Source を「GitHub Actions」に設定する
3. `main` ブランチにpushすると `.github/workflows/deploy-pages.yml` が `public/` を自動デプロイする
4. `.github/workflows/daily-update.yml` が毎日 09:30 JST にデータを再取得し、変更があれば自動コミットする

## 免責事項

本サイトは情報提供のみを目的としており、投資助言ではありません。
