# ARチラシ（仮）— ノーコード WebAR サービス MVP

印刷物（チラシ・パネル・名刺）にスマホをかざすと動画・画像・3D が現れ、行動ボタンで資料請求や LINE 友だち追加に誘導する AR を、**ブラウザだけで作成・公開**できるサービスの MVP です。体験者はアプリ不要で、iPhone の Safari / Android の Chrome から QR を読むだけで体験できます。

- 要求: `docs/02_service_requirements.md` / 要件定義: `docs/03_requirements_spec.md` / 技術調査・構成: `docs/04_architecture.md` / テスト計画: `docs/05_test_plan.md`
- 体験方式: 画像トラッキング（MindAR）。カメラ映像は端末内でのみ処理し、サーバーには送りません。

## 構成

```
server/src/worker.ts   Cloudflare Workers エントリ（fetch: API + 静的配信、scheduled: 掃除）
server/src/index.ts    Node 常駐サーバ（ローカル開発 / E2E / Docker）
server/src/app.ts      Hono アプリ（API・素材配信・計測・掃除。Workers と Node で共通）
server/                db-neon.ts（Workers → Neon HTTP）/ db-pg.ts（Node → PostgreSQL）/ db-pglite.ts（ローカル・テスト）
                       storage.ts（R2 / メモリ）/ storage-local.ts（ファイル）
  migrations/          PostgreSQL スキーマ（npm run migrate で適用。同じ SQL を src/migrations.ts に埋め込み）
web/                   Vite + React 19 + TypeScript … 作成画面（index.html）と閲覧ページ（viewer.html）
shared/                シーン定義の型・検証（zod）。server と web がソースのまま参照する
wrangler.toml          Workers の設定（Static Assets、R2、Cron、vars）
scripts/ e2e/          dev / e2e / フィクスチャ生成、Playwright E2E
data/                  ローカル実行時のデータ（PGlite `pglite/` と素材 `assets/`。git 管理外）
```

本番は **Cloudflare Workers + Neon PostgreSQL + R2**（Static Assets で画面配信、Cron Triggers で掃除）。ローカル開発・テストは外部サービス無しで動く（DB は PGlite = WASM の Postgres、素材はローカルファイル）。`Dockerfile` は Cloudflare 以外で常駐サーバとして動かす場合の参考構成（DB は `DATABASE_URL` の PostgreSQL か PGlite、素材はローカルファイル）。

## 必要なもの

- Node.js 22 以上、npm 10 以上
- E2E を実行する場合: Playwright の Chromium（`npx playwright install chromium`。本リポジトリの開発環境ではプリインストール済み）

## セットアップ

```bash
npm install
```

`mind-ar` が依存する `canvas`（ネイティブ拡張。Node 側でターゲットをコンパイルする場合のみ必要）は、ルート `package.json` の `overrides` で空パッケージに置き換えています。本サービスはターゲットデータ（`.mind`）を作成者のブラウザ内で生成するため不要です。

環境変数のキー一覧は `.env.example` を参照（値はコミットしない）。

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

## Cloudflare へのデプロイ（本番）

前提: Cloudflare アカウント（Workers Free でも可）、Neon アカウント、Node 22。`wrangler` は devDependency に含まれる（`npx wrangler`）。以下はオーナーが 1 回だけ行う。

1. **ログイン**: `npx wrangler login`
2. **R2 バケット作成**: `npx wrangler r2 bucket create nocode-ar-assets`（`wrangler.toml` の `bucket_name` と一致させる。プレビュー用に `nocode-ar-assets-preview` も作る）。R2 の有効化にはダッシュボードで R2 の利用開始（支払い方法の登録）が必要
3. **Neon プロジェクト作成**: Neon コンソールで作成し、**pooled** 接続文字列（`...-pooler.<region>.aws.neon.tech`、`sslmode=require`）を控える
4. **シークレット登録**:
   ```bash
   npx wrangler secret put DATABASE_URL     # Neon の接続文字列
   npx wrangler secret put CRON_SECRET      # 任意（HTTP の /api/cron/cleanup を使う場合）。openssl rand -hex 32 等
   ```
   公開してよい値（`PUBLIC_ORIGIN`、`SUPPORT_EMAIL`、`SERVICE_NAME`、`ACCOUNT_QUOTA_BYTES`）は `wrangler.toml` の `[vars]` に書く
5. **マイグレーション**（手元から Neon へ。Workers からは実行しない）:
   ```bash
   DATABASE_URL="postgres://...（Neon）" npm run migrate
   ```
6. **デプロイ**: `npm run worker:deploy`（= `npm run build -w web && wrangler deploy`）。`*.workers.dev` の URL が表示される。独自ドメインは Workers の Custom Domains で割り当て、`PUBLIC_ORIGIN` に設定して再デプロイ
7. **動作確認**: `https://<host>/healthz` が `{"ok":true,"db":"neon","storage":"r2"}`。作成画面で登録 → 素材アップロード → 公開 → QR。`https://<host>/v/<slug>` が閲覧ページ
8. **Cron**: `wrangler.toml` の `[triggers] crons = ["*/15 * * * *"]` がデプロイ時に登録される（Workers Free でも 15 分間隔可）。ダッシュボードの Worker → Settings → Triggers で確認

### Cloudflare 上の動き方

- 1 Worker（`server/src/worker.ts`）が全リクエストを受ける（`run_worker_first = true`）。`/api/*`, `/a/*`, `/healthz` は Hono アプリ、それ以外は Static Assets（`web/dist`）を `ASSETS.fetch()` で配信。`/v/:slug`, `/p/:token` → `viewer.html`、存在しないパスの HTML 要求 → `index.html`（SPA）。`/assets/*` は immutable キャッシュ、全応答に `X-Content-Type-Options: nosniff`
- DB: `@neondatabase/serverless` の HTTP クエリ（WebSocket の Pool はリクエストをまたげないため）。トランザクションは文の配列を 1 回で送る方式（`db-neon.ts`）
- 素材: ブラウザがファイル本体を `POST /api/projects/:id/assets`（Content-Length 付き）で送り、Worker が **R2 にストリーミング保存**してから先頭 64 KB を読み戻してマジックバイト・寸法・上限・容量を検証（不正なら削除）。鍵（`projects/<projectId>/<kind>/<id>`）と URL（`/a/<id>.<ext>`）はサーバが生成し、クライアントから鍵や URL は受け取らない。配信は Worker 経由で R2 から Range 対応（動画のシーク）。`.mind` は gzip して保存し `Content-Encoding: gzip` で配信（CDN は octet-stream を圧縮しないため）
- 圧縮: Cloudflare のエッジが HTML / JS / CSS / JSON を gzip / brotli 圧縮するため Worker 側では行わない（Node 常駐時のみ Hono の `compress`）
- 状態: ログインロック・レート制限・セッションはすべて PostgreSQL（`login_locks` / `rate_limits` / `sessions`）
- 掃除: Cron Trigger → `scheduled()` → `runCleanup`（未参照素材の 15 分猶予後削除、DB に無い R2 オブジェクト、期限切れセッション等）。HTTP の `/api/cron/cleanup` も Bearer `CRON_SECRET` で残している

### ローカルで Cloudflare のビルドと起動を確認する

```bash
npm run worker:dry-run                 # web をビルドし、wrangler deploy --dry-run --outdir dist-worker（バンドルのみ。worker.js 約 1.2 MB / gzip 約 220 KB）
cp .dev.vars.example .dev.vars         # DATABASE_URL（Neon）等を入れる。git 管理外
npm run worker:dev                     # wrangler dev（Miniflare: R2 / Static Assets / Cron をローカルエミュレート。DB は Neon に接続）
```

Miniflare では PGlite は動かないため、`wrangler dev` の DB は Neon（または `DATABASE_URL` が指す PostgreSQL 互換の Neon HTTP エンドポイント）が前提。DB を使わない範囲（`/healthz`、静的配信、`/v/` の書き換え、`/api/config`、API の 404）はダミーの `DATABASE_URL` でも確認できる。Cron は `wrangler dev --test-scheduled` で `curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"` から手動実行できる。

## 常駐サーバとして起動（Cloudflare 以外。参考）

```bash
npm run build      # web/dist と server/dist を生成
npm start          # http://localhost:3000 で API とビルド済みフロントを配信（DATABASE_URL 無しなら PGlite）
```

### 環境変数（server）

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `PORT` | 3000 | 待ち受けポート（常駐時） |
| `DATABASE_URL` | （なし） | PostgreSQL 接続文字列。未設定なら PGlite（`DATA_DIR/pglite`） |
| `CRON_SECRET` | （なし） | `/api/cron/cleanup` の Bearer トークン。未設定だと 503（Cloudflare では Cron Trigger が直接掃除するため任意） |
| `AUTO_MIGRATE` | （なし） | `1` で PostgreSQL にも起動時マイグレーションを適用（PGlite は常に適用） |
| `DATA_DIR` | `./data` | PGlite とローカル素材の保存先（Node 常駐時） |
| `WEB_DIST` | `./web/dist` | 配信するフロントのビルド成果物 |
| `PUBLIC_ORIGIN` | （Host から推定） | QR・公開 URL に使うオリジン（例 `https://ar.example.com`） |
| `SUPPORT_EMAIL` | （なし） | ログイン画面に出すパスワード再設定の連絡先 |
| `SERVICE_NAME` | ARチラシ（仮） | サービス名 |
| `NODE_ENV=production` または `COOKIE_SECURE=1` | | セッション Cookie に `Secure` を付ける（HTTPS 配信時に設定） |
| `TRUST_PROXY` | `true` | Node 常駐時に `X-Forwarded-Host/Proto` を信頼するか（Vite 開発サーバやリバースプロキシ配下）。`false` で無効 |
| `ACCOUNT_QUOTA_BYTES` | 2147483648（2 GB） | 1 アカウントの素材合計上限（NFR-4） |

常駐時は Hono の `compress`（gzip / brotli）が JS / CSS / JSON / HTML を圧縮します。ターゲットデータ `.mind` は保存時に gzip 済みです。Cloudflare 上では CDN が圧縮するため Worker 側の圧縮は無効です。

### Docker

```bash
docker build -t nocode-ar .
docker run -p 3000:3000 -v nocode-ar-data:/data -e PUBLIC_ORIGIN=https://ar.example.com nocode-ar
```

`/data`（PGlite と素材）をボリュームにしてください（`DATABASE_URL` を与えれば PostgreSQL を使う）。Cloudflare を使う場合はこの節は不要。HTTPS はリバースプロキシ（Caddy / nginx 等）で終端し、`COOKIE_SECURE=1`（`NODE_ENV=production` で自動）と、プロキシが別ホストなら `TRUST_PROXY` を設定します。

バックアップ: Cloudflare 構成では Neon のブランチ / PITR と R2 の冗長化に依存する。常駐構成では `DATA_DIR` 配下（`pglite/` と `assets/`）をコピーする（NFR-5）。

## テスト

```bash
npm run typecheck   # tsc --noEmit（server / web）
npm test            # Vitest: ユニット + API（supertest）。server/test/
npm run e2e         # ビルド → フィクスチャ生成 → 一時 DB でサーバ起動 → Playwright（trace なし）
```

`npm run e2e` は次を自動検証します（`e2e/run.mjs`）: 登録 → プロジェクト作成 → 公開前の QR 取得 → ターゲット画像の登録とブラウザ内解析（認識しやすさ判定）→ オーバーレイ（画像 / GLB）の配置 → 行動ボタン → 自動保存 → 実機プレビュー URL → 公開 → 閲覧ページでカメラ起動（Chromium のフェイクカメラにターゲット画像の映像 `camera.y4m` を流す）→ ターゲット認識 → ボタンタップ → 計測ダッシュボードに反映 → アプリ内ブラウザ案内と「このまま試す」→ 差し替え → 停止（終了画面のボタン）→ 再開 → ログアウト。結果とスクリーンショットは `e2e/.out/` に出力されます。

ヘッドレス Chromium（SwiftShader）では TF.js が WebGL を拒否するため、E2E ではテスト用の初期化スクリプトで `failIfMajorPerformanceCaveat` を無効化しています（実機では不要）。

## 運用コマンド

### マイグレーション

```bash
npm run migrate                                   # ローカル PGlite（data/pglite）
DATABASE_URL=postgres://... npm run migrate       # 本番（Neon）
```

### パスワードの再設定（Q19 / D1）

MVP ではメール送信を行わないため、オーナーが次のコマンドで再設定します（新しいパスワードは対話入力。引数やシェル履歴には残りません）。

```bash
npm run reset-password -- user@example.com                        # ローカル
DATABASE_URL=postgres://... npm run reset-password -- user@example.com   # 本番（Neon）
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
