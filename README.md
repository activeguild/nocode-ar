# ARチラシ（仮）— ノーコード WebAR サービス MVP

印刷物（チラシ・パネル・名刺）にスマホをかざすと動画・画像・3D が現れ、行動ボタンで資料請求や LINE 友だち追加に誘導する AR を、**ブラウザだけで作成・公開**できるサービスの MVP です。体験者はアプリ不要で、iPhone の Safari / Android の Chrome から QR を読むだけで体験できます。

- 要求: `docs/02_service_requirements.md` / 要件定義: `docs/03_requirements_spec.md` / 技術調査・構成: `docs/04_architecture.md` / テスト計画: `docs/05_test_plan.md`
- 体験方式: 画像トラッキング（MindAR）。カメラ映像は端末内でのみ処理し、サーバーには送りません。

## 構成

```
server/   Express 5 + better-sqlite3 + multer + qrcode（TypeScript, ESM）  … API・素材配信・ビルド済みフロントの配信
web/      Vite + React 19 + TypeScript                                    … 作成画面（index.html）と閲覧ページ（viewer.html）
shared/   シーン定義の型・検証（zod）。server と web がソースのまま参照する
scripts/  dev / e2e / フィクスチャ生成
e2e/      Playwright（ヘッドレス Chromium + フェイクカメラ）による E2E
data/     実行時データ（SQLite `app.db` と素材ファイル `assets/`。git 管理外）
```

主要ライブラリの選定理由と、MindAR を現行 three.js で使うための互換 shim（`web/vite.config.ts` の `mindArThreeCompat`）については `docs/04_architecture.md` を参照してください。

## 必要なもの

- Node.js 22 以上、npm 10 以上
- E2E を実行する場合: Playwright の Chromium（`npx playwright install chromium`。本リポジトリの開発環境ではプリインストール済み）

## セットアップ

```bash
npm install
```

`mind-ar` が依存する `canvas`（ネイティブ拡張。Node 側でターゲットをコンパイルする場合のみ必要）は、ルート `package.json` の `overrides` で空パッケージに置き換えています。本サービスはターゲットデータ（`.mind`）を作成者のブラウザ内で生成するため不要です。

## 起動（開発）

```bash
npm run dev
```

- API サーバ: http://localhost:3000（`tsx watch`）
- 作成画面 / 閲覧ページ: http://localhost:5173（Vite。`/api` と `/a` は API サーバへプロキシ）

初回は http://localhost:5173/signup でメールアドレスとパスワードを登録してください（固定のデモアカウントはありません）。

### スマホ実機で確認する（HTTPS が必要）

カメラ（`getUserMedia`）は HTTPS でしか使えません。開発サーバを自己署名証明書の HTTPS で起動できます。

```bash
HTTPS=1 npm run dev
# → https://<PC の LAN IP>:5173 をスマホで開く（証明書の警告を許可する）
```

PC とスマホを同じ Wi-Fi に接続し、作成画面の「スマホで確認（プレビュー）」の QR を読むと下書きを実機で確認できます。QR に埋め込む URL のホスト名は、API サーバの環境変数 `PUBLIC_ORIGIN`（例: `PUBLIC_ORIGIN=https://192.168.1.10:5173 npm run dev`）で指定できます（未指定時はアクセスされた Host を使用）。

## 本番相当で起動

```bash
npm run build      # web/dist と server/dist を生成
npm start          # http://localhost:3000 で API とビルド済みフロントを配信
```

### 環境変数（server）

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `PORT` | 3000 | 待ち受けポート |
| `DATA_DIR` | `./data` | SQLite とアップロード素材の保存先（ボリュームにする） |
| `WEB_DIST` | `./web/dist` | 配信するフロントのビルド成果物 |
| `PUBLIC_ORIGIN` | （Host から推定） | QR・公開 URL に使うオリジン（例 `https://ar.example.com`） |
| `SUPPORT_EMAIL` | （なし） | ログイン画面に出すパスワード再設定の連絡先 |
| `SERVICE_NAME` | ARチラシ（仮） | サービス名 |
| `NODE_ENV=production` または `COOKIE_SECURE=1` | | セッション Cookie に `Secure` を付ける（HTTPS 配信時に設定） |
| `TRUST_PROXY` | `loopback` | Express の `trust proxy`（`X-Forwarded-*` を信頼する範囲）。既定は同一ホストのプロキシのみ。CDN / 別ホストの LB 配下では `true` や IP 範囲を指定 |
| `ACCOUNT_QUOTA_BYTES` | 2147483648（2 GB） | 1 アカウントの素材合計上限（NFR-4） |

応答は Express の `compression` で gzip / brotli 圧縮されます（JS / CSS / JSON / HTML と、ターゲットデータ `.mind` を含む）。リバースプロキシ側の圧縮は必須ではありません。

### Docker

```bash
docker build -t nocode-ar .
docker run -p 3000:3000 -v nocode-ar-data:/data -e PUBLIC_ORIGIN=https://ar.example.com nocode-ar
```

`/data`（SQLite と素材）をボリュームにしてください。HTTPS はリバースプロキシ（Caddy / nginx 等）で終端し、`COOKIE_SECURE=1`（`NODE_ENV=production` で自動）と、プロキシが別ホストなら `TRUST_PROXY` を設定します。

バックアップは `DATA_DIR` 配下（`app.db` と `assets/`）をコピーするだけです（NFR-5）。

## テスト

```bash
npm run typecheck   # tsc --noEmit（server / web）
npm test            # Vitest: ユニット + API（supertest）。server/test/
npm run e2e         # ビルド → フィクスチャ生成 → 一時 DB でサーバ起動 → Playwright（trace なし）
```

`npm run e2e` は次を自動検証します（`e2e/run.mjs`）: 登録 → プロジェクト作成 → 公開前の QR 取得 → ターゲット画像の登録とブラウザ内解析（認識しやすさ判定）→ オーバーレイ（画像 / GLB）の配置 → 行動ボタン → 自動保存 → 実機プレビュー URL → 公開 → 閲覧ページでカメラ起動（Chromium のフェイクカメラにターゲット画像の映像 `camera.y4m` を流す）→ ターゲット認識 → ボタンタップ → 計測ダッシュボードに反映 → アプリ内ブラウザ案内と「このまま試す」→ 差し替え → 停止（終了画面のボタン）→ 再開 → ログアウト。結果とスクリーンショットは `e2e/.out/` に出力されます。

ヘッドレス Chromium（SwiftShader）では TF.js が WebGL を拒否するため、E2E ではテスト用の初期化スクリプトで `failIfMajorPerformanceCaveat` を無効化しています（実機では不要）。

## 運用コマンド

### パスワードの再設定（Q19 / D1）

MVP ではメール送信を行わないため、オーナーが次のコマンドで再設定します（新しいパスワードは対話入力。引数やシェル履歴には残りません）。

```bash
npm run reset-password -- user@example.com
# 本番相当（DATA_DIR を指定）
DATA_DIR=/srv/nocode-ar/data npm run reset-password -- user@example.com
```

実行後、そのユーザーの既存セッションは無効化されます。

## 実機確認の手順（QA 向け）

1. `HTTPS=1 npm run dev`（または HTTPS のリバースプロキシ配下で `npm start`）で起動し、PC で AR を作成・公開する。
2. 印刷用 QR（PNG）をダウンロードして印刷する。**ディスプレイ表示ではなく印刷物で**認識を確認する（光沢紙・会場照明の反射も 1 条件に含める）。
3. iPhone（iOS 16 以上、Safari）と Android（Android 10 以上、Chrome）の標準カメラで QR を読み、「カメラを起動」1 タップとカメラ許可のみで体験が始まることを確認する。
4. 動画は音声なしで自動再生、「音声あり」設定時はスピーカーアイコンのタップで音が出る。
5. LINE の QR リーダーで読むと「Safari / Chrome で開いてください」の案内と「このまま試す」が表示される。
6. 通信の確認（AC-K5）: Safari の Web インスペクタ / Chrome の DevTools で、体験中の送信が `/api/public/<slug>/events`（計測）と素材の取得のみであること。

## 既知の制限（MVP）

- ターゲット解析（`.mind` 生成）は作成者のブラウザで行い、画面を離れても続行して結果を下書きに保存します。タブを閉じた場合は中断されるため、戻ったときに「再解析」を押してください。
- ログインロック（10 回失敗で 15 分）はアカウント単位です。ロック中でも 60 秒に 1 回は照合するため、正しいパスワードを知る本人は締め出されません。
- 1 プロジェクト = ターゲット画像 1 枚 + オーバーレイ 1 つ（動画 / 画像 / 3D のいずれか）+ 行動ボタン 1〜3 個。
- 動画は MP4（H.264）。MOV は拒否し案内を出す。MP4 コンテナの HEVC はサーバー側では判別できない（ブラウザで再生できない場合はアップロード時にエラーになる）。
- 確認メール・パスワード再設定メールは送らない（上記コマンドで対応）。
- プラン上限（公開 AR 数・体験回数）の制御は行わない（計測のみ）。
- 実機（iOS Safari / Android Chrome）のカメラ・トラッキング品質は自動テストでは検証できないため、QA の実機確認に依存する。
