# 05. QA レポート — ノーコード WebAR サービス MVP

- 実施日: 2026-11-07
- 実施者: QA
- 対象: リポジトリ `/home/user/nocode-ar` コミット `56a1dcf`（Add web app (editor + AR viewer), E2E with fake camera, README, and spec updates）
- 計画: `docs/05_test_plan.md`。要件は `docs/03_requirements_spec.md`（§11 の Q1〜Q20 確定事項を含む）、`docs/03_review_log.md`（R1〜R3 は実装必須扱い）
- 判定: **不合格（Major 5 件の修正後に再検証）**。Blocker は 0 件。Must 7 件（M1〜M7）の基本フロー（登録 → 作成 → ターゲット解析 → 配置 → ボタン → 公開 → QR → 閲覧ページでカメラ起動 → 認識 → タップ → 計測 → 差し替え → 停止 → 再開）は本環境で全て動作した。実機確認（15 件）は未実施（オーナー依頼、§7）。

---

## 1. 環境

| 項目 | 内容 |
| --- | --- |
| OS / Node | Linux（コンテナ）、Node v22.23.4、npm 10.9.9 |
| ブラウザ | Playwright Chromium 153.0.8010.12（ヘッドレス、SwiftShader、フェイクカメラ `camera.y4m`。E2E と同じく `failIfMajorPerformanceCaveat` を無効化） |
| サーバ | `npm run build` の成果物を `node server/dist/server/src/index.js` で起動。`PORT=3999`、`DATA_DIR=<scratchpad>/qa/data`（一時 DB）、`PUBLIC_ORIGIN=http://127.0.0.1:3999`、`SUPPORT_EMAIL=support@example.com`。Secure Cookie 確認用に `COOKIE_SECURE=1` の別インスタンス（:3998）、復元確認用にデータ複製インスタンス（:3997） |
| 作業ファイル | `/tmp/claude-0/-home-user-nocode-ar/56dd9180-4a16-5bf4-983f-8a9d8f97776f/scratchpad/qa/`（検証スクリプト `api-tests.mjs` / `api-recheck.mjs` / `ui-tests.mjs` / `ui-tests-2.mjs` / `ui-tests-3.mjs`、ログ、スクリーンショット `ui-out/`、フィクスチャ `fix/`）。リポジトリは変更していない（`git status` クリーン、コミットなし） |
| フィクスチャ | `scripts/gen-fixtures.mjs` の画像 / GLB / y4m に加え、ffmpeg 生成の MP4（H.264 + AAC）/ MOV / WebM、JPEG / WebP、拡張子偽装・ポリグロット・SVG・0 バイト、上限超過ファイル（50 MiB + 1 等） |

本環境の制約（計画 §1.1 のとおり）: iOS Safari / Android Chrome の実カメラ・トラッキング品質・fps、QR の実読み取り、LINE アプリ、実回線、音声の実出力は検証できない。ヘッドレス Chromium は H.264 を再生できたため、動画の UI 登録（サムネイル生成）まで確認できた。

---

## 2. 実施結果の内訳

### 2.1 開発者の自動テスト（再実行）

| コマンド | 結果 |
| --- | --- |
| `npm run typecheck` | 成功（server / web） |
| `npm test` | Vitest 2 ファイル 32 件 すべて成功（2.5 秒） |
| `npm run e2e` | Playwright 20 ステップ すべて成功、フィルタ後のコンソールエラー 0 件。ターゲット解析 6.2 秒（特徴点 2,437「良い」）、フェイクカメラでの認識 約 2 秒、計測 view 1 / rec 1 / tap 1 |

開発者テストのカバレッジの穴（QA が追加で検証した主な点）: 認証必須エンドポイント全件の 401 / 他ユーザー 404（開発者テストは GET/PATCH のみ）、拡張子偽装・ポリグロット・SVG・0 バイト・kind 不正、パストラバーサル、CSRF の `Origin: null` とログアウト、期限切れセッション、ファイル上限（50 MiB + 1 / 20 MiB + 1 / 合計 100 MiB）、QR のデコード内容と公開前後の同一性、10 世代保持、プレビュー token の 1 文字違い、JST 境界の集計、CSV インジェクション、XSS の描画、未公開素材の露出、カメラ許可拒否、解析中の画面離脱、スマホ幅の編集、axe、転送量、バックアップ復元、`reset-password` CLI。

### 2.2 テスト計画ケースの結果

計画 128 件 = 自動 85 / 手動 28 / 実機 15。本環境で実施したのは自動 + 手動の **113 件**。

| 区分 | 実施 | Pass | Fail | 未実施 |
| --- | --- | --- | --- | --- |
| 自動（85） | 85 | 80 | 5 | 0 |
| 手動（28） | 28 | 23 | 5 | 0 |
| 実機（15） | 0 | — | — | 15（§7 のチェックリストでオーナーに依頼） |
| 合計 | 113 | 103 | 10 | 15 |

QA スクリプトの個別チェック数: API / セキュリティ 111 項目（サイズ誤りの再検証 4 項目を含め Pass 105 / Fail 6）、UI 104 項目（Pass 86 / Fail 18。うち 11 件は検証側の要因で、再検証で Pass または記録扱い）。Fail の内訳は §3 の不具合に集約した。

### 2.3 ケース別結果（計画 §2〜§4 の ID 順）

記号: ○ = Pass、× = Fail（→ 不具合番号）、◎ = Pass だが記録事項あり、実機 = 未実施。

| ID | 結果 | 根拠・備考 |
| --- | --- | --- |
| TC-M0-01〜06 | ○ | 登録 201 と `HttpOnly; SameSite=Lax; Path=/`（`COOKIE_SECURE=1` で `Secure` 付与を確認）。重複 409「このメールアドレスは登録済みです」、形式不正 / 7 文字 400。誤パスワードと未登録メールで同一の 401・同一文言。10 回失敗で 429（他ユーザーに影響なし）。ログアウト後の旧 Cookie 401、ログインごとに新セッション ID。他ユーザーのプロジェクトは全 15 エンドポイントで 404、データ不変 |
| TC-M0-07 | ○ | ログイン画面に「パスワードをお忘れの方は サポート（support@example.com）へ」の mailto。再設定は `npm run reset-password` で動作確認（旧パスワード 401、新 200、既存セッション 401、8 文字未満・未登録メールは終了コード非 0） |
| TC-P-01〜06 | ○ | slug `[a-z0-9]{8}`・token 32 文字・draft。61 文字 / 空白のみ 400。一覧は更新日降順・累計付き。削除は確認ダイアログ（公開中は「公開中です。削除すると QR からアクセスできなくなります」）→ 論理削除、公開 URL は 410「終了しました」+ 公開版ボタン（Q1）、素材ファイル削除・配信 404、プレビュー 404。インライン名前変更が保持。slug 1 万回で重複なし、`node:crypto` 使用 |
| TC-M1-01〜05 | ○ | PNG → 5.9〜6.2 秒で「良い」（特徴点 2,437。SwiftShader 参考値）。JPEG 受理。単色画像 → 「認識しにくい画像です」+ 理由（単色・グラデーション、文字が少ない、繰り返し模様）+ 改善案、登録はブロックされずセクション完了扱い。GIF / SVG / 拡張子偽装 / WebP は拒否（マジックバイト判定、日本語文言）。10 MB 超 413「10 MB 以下の画像にしてください」、長辺 8,001 px 400 |
| TC-M1-06 | ○ | 解析中に入力を無効化する処理は無く、案内文「解析中も他の項目を編集できます」を確認（静的確認） |
| TC-M1-07 | ◎ | `.mind` 保存を 500 にすると エラー + 「再試行」、再試行で成功。文言はサーバの「サーバーでエラーが発生しました」で、FR-3-3 の「画像の解析に失敗しました。別の画像をお試しください」ではない（D-14） |
| TC-M1-08 | ○ | 10 / 3000 受理、9 / 3001 / 文字列 400、既定 210。UI は範囲外を反映しない |
| TC-M1-09 | ○ | JPEG へ差し替えで `imageAssetId` / `mindAssetId` が更新され、`overlay.transform` は同一 |
| TC-M1-10 | ○ | 初回ガイドと「1. かざす対象」に R4 の 3 点を明記 |
| TC-M1-11 | 実機 | |
| TC-M2-01〜05 | ○ | MP4 登録でサムネイル生成・ループ / 音声トグル・字幕推奨文言。PNG / JPEG / WebP / GLB 受理。幅 45% → `width: 0.45`、表示幅 0.449、ドラッグで x / y 変化、再読み込み後も保持。自動保存「保存中…」→「保存済み」 |
| TC-M2-06 | ○ | PATCH 遮断で「保存に失敗しました。再試行します」→ 3 回で「保存できませんでした。ページを再読み込みしてください」、復旧後に保存 |
| TC-M2-07〜09 | ○ | 50 MiB + 1 動画 413「動画は 50 MB 以下にしてください」、20 MiB + 1 GLB 413、10 MB 超画像 413。MOV は UI / API とも R5 文言、WebM 400。壊れた GLB は 3D プレビューで「この 3D ファイルは読み込めません」 |
| TC-M2-10〜13 | ○ | オーバーレイは 1 つで差し替え動作、未参照の旧素材は 15 分猶予後に自動削除（Q4、開発者テストで確認）。ループ既定 ON、音声あり時の案内。20 MB 超の動画に R7 の注意。「3D プレビュー（閲覧ページと同じ描画）」で合成表示 |
| TC-M2-14 | ○ | 公開版参照中の素材削除 409、未参照は 204 でファイル削除 |
| TC-M2-15 | 実機 | |
| TC-M3-01〜02, 04〜09 | ○ | プリセットでラベル「資料を請求する」。4 個目は UI で追加不可、API 400。URL: `https://` / `lin.ee` / `line.me` / `line://` 受理、`http://` / `javascript:` / `ftp:` / 空 / `data:` 拒否（UI エラー文言は LINE 形式を含み整合、R10）。ラベル 0 / 21 文字 400。ボタン 0 で公開無効 + 不足項目、API 400。閲覧ページで新規タブ、`cta_tap` を `sendBeacon` で遷移前に送信。認識前からボタン表示。44 px 以上・`aria-label` |
| TC-M3-03 | ◎ | 並べ替えは ↑ / ↓ ボタン（仕様 FR-5-3 は「ドラッグ」。D-13）。順序は保存される |
| TC-M3-10 | 実機 | |
| TC-M4-01〜03, 05〜07 | ○ | 不足項目の列挙と完了チェック 4 つ。公開で SceneVersion 1 行・`publish` 記録・「公開しました」。QR PNG 1,024 px、`jsqr` デコード = 公開 URL そのもの、公開前に取得可、公開前後・再公開後でバイト同一、SVG 妥当。公開 API: 公開中 200 `no-cache` で `previewToken` / 下書きを含まず、下書き 404 `draft`、停止 410 `unpublished`、不明 404。導入画面はプロジェクト名 + 案内 + 「カメラを起動」で、押すまで `getUserMedia` 未呼び出し。カメラ起動 2.0 秒、認識 0.2 秒（PNG）、ガイド枠は認識後に消える |
| TC-M4-04 | ○ | 生成パラメータ（`errorCorrectionLevel: 'M'`, `margin: 4`）をソースで確認 + デコード成功 |
| TC-M4-08 | × | カメラ許可拒否（`NotAllowedError`）で「カメラを起動できませんでした」のみ。「カメラの許可が必要です」+ 設定手順が出ない → **D-03** |
| TC-M4-09〜13 | ○ | `getUserMedia` 無し →「このブラウザではカメラを使えません」、WebGL 無し →「この端末では AR を表示できません」、Instagram / LINE UA →「Safari / Chrome で開いてください」+ URL コピー + 「このまま試す」で起動（R3）。いずれも `blocked` を記録（R2）。動画は `muted` / `playsinline` / `loop` 設定どおり、音声あり時はスピーカーアイコン、タップで `muted=false`。GLB は閲覧ページでエラーなく描画（三角形 1 枚の最小 GLB のため見え方は実機で確認）。`lang="ja"`、ロゴ 12 px、`/legal.html` リンク |
| TC-M4-14〜16 | ○ | 導入画面で `.mind` を先読み（オーバーレイ画像は HTTP キャッシュ済みのため記録なし）、動画は `Range` で 206。素材配信: `Accept-Ranges`、`max-age=31536000, immutable`、`nosniff`、`Content-Disposition: inline`、正しい `Content-Type`。公開前は「準備中です」でカメラ未起動 |
| TC-M4-17〜22 | 実機 | |
| TC-M5-01〜06 | ○ | 「スマホで確認」の QR が `/p/<32 文字>` にデコード。プレビュー API は下書き（`no-store`）、公開 API は公開版。「プレビュー（未公開）」バッジ。プレビューでは POST が 0 件で集計不変。token 再発行で旧 404 / 新 200、1 文字違い 404 |
| TC-M5-07 | 実機 | |
| TC-M6-01〜09 | ○ | 再公開で新内容・slug / URL / QR 不変・旧版保持・`republish`。「未公開の変更があります」の表示と消去。下書き編集中は公開版（SceneVersion / 素材 URL）不変。停止 → 410 + 公開版ボタン + 「終了後の案内 URL」（R1）、カメラ起動ボタン無し、`getUserMedia` 未呼び出し、リンクは `_blank` + `noopener`。再開は停止前の版へ即時復帰（`resume`、下書き未反映、Q2）。履歴は計測画面と縦線に表示。12 回再公開で 10 世代。375 px 幅（タッチ）でボタン編集 → 再公開 → 停止 → 再開（R11）、横スクロールなし |
| TC-M6-10 | 実機 | |
| TC-M7-01 | ◎ | 正常 204、type / os 不正 400、不明 slug 404、buttonId 21 文字 400、不正 JSON 400、認証不要。停止中の slug でも `page_open` を受理し `scene_version_id` は NULL（Q3）。公開版に無い buttonId は検証されず受理（D-02 の前提） |
| TC-M7-02〜12 | ○ / ◎ | 1 体験が即時に 1 / 1 / 1（OS 別）に反映。JST 境界（14:59Z → 11-06、15:00Z → 11-07）。プリセット（今日 / 7 日 / 30 日 / 公開以降）で期間が変わる。OS 別内訳、CSV（BOM 付き UTF-8、日付 / 種別 / ボタンID / OS / 回数）。タップ率表示、0 回は「—」。R8 表記と注記。`page_open` / `blocked` の受理と表示（R2）。レート制限は slug 単位 60 / 分で 429、別 slug 受理。DB に IP / UA / Cookie 列なし、余分な送信項目は保存されない、ログに IP なし、閲覧ページに `Set-Cookie` なし。リトライ 1 回はソースで確認（`sendBeacon` 失敗時のみ `fetch` → 1.5 秒後に 1 回）。`page_open` / `view_start` / `recognized` は各 1 回のみ送信（計測値で確認）。`from > to` は 400 ではなく空の 200（D-15）、CSV インジェクション（× → **D-02**） |
| TC-M7-13 | 実機 | |
| TC-K2-01 | ○ | 入力欄はテキスト / URL / 数値 / ファイル / チェックボックスのみ。コード・スクリプト・設定ファイル欄なし |
| TC-K3-01 | 実機 | |
| TC-K4-01 | ○ | 一覧・編集・計測・ログイン・404・閲覧ページ（導入 / 終了 / 見つからない）で英語のみのテキストノード 0 件 |
| TC-K4-02 | × | i18n 辞書（JSON）が存在せず、文言はコンポーネント内のリテラル（NFR-7「i18n 辞書に外出し」未実装）→ **D-10**。あわせて zod の既定英語メッセージが API エラーに混入 → **D-07** |
| TC-K5-01 | ○ | 閲覧ページの通信は自サーバへの静的ファイル / `/api/public` / `/a/` の GET と `/api/public/<slug>/events` の POST（3 件、各 512 バイト未満）のみ。WebSocket / WebRTC / 外部ドメインなし（ボタンのリンク先 example.com はスタブ） |
| TC-K5-02 | 実機 | |
| TC-K6-01 / TC-K8-01 | ○ | `data/assets/<pid>/<id>.<ext>` の sha256 = 元ファイル = DB の `sha256`。配信ファイルもバイト同一。変換・独自形式の要求なし |
| TC-K7-01 | 実機（オーナー / マーケター） | |
| TC-N-01 | × | 1 プロジェクト合計 100 MiB は 413「このプロジェクトの素材の合計が 100 MB を超えます」（猶予中の未参照素材も合計に含む）。**1 アカウント合計 2 GB は未実装** → **D-06** |
| TC-N-02 / TC-N-03 | × | 応答が無圧縮（`Content-Encoding` なし）。導入画面の初期転送 **578 KB**（目標 300 KB）、カメラ起動時に追加 **1,246 KB + `.mind` 549 KB**（512×640 ターゲット）。gzip なら 167 KB / 327 KB + 253 KB → **D-05**、`.mind` のサイズは D-19 |
| TC-N-04 | × | axe（WCAG 2.0 A/AA）: 作成画面 `label`（critical、`sr-only` のファイル入力 2 つ）、初回計測で `color-contrast`（serious、1 ノード、再計測では非再現）。閲覧ページ `meta-viewport`（moderate、`user-scalable=no`）。Tab キーで公開ボタンに到達可。→ **D-11** |
| TC-N-05 | × | `/healthz` 200、ログは 1 行 1 JSON、`PORT` / `DATA_DIR` / `PUBLIC_ORIGIN` / `SUPPORT_EMAIL` / `COOKIE_SECURE` が反映。**Dockerfile が無い**（NFR-11）→ **D-09** |
| TC-N-06 | ○ | `DATA_DIR` を複製して別ポートで起動 → 公開 API / 素材 / 閲覧ページが 200 |
| TC-N-07 | ○ | 閲覧ページで Cookie / localStorage / sessionStorage / IndexedDB が空、`Set-Cookie` なし |
| TC-S-01 | ○ | 認証必須 17 エンドポイントが Cookie なし / 無効 / 期限切れで 401。認証不要のものは Cookie なしで応答 |
| TC-S-02 | ○ | 拡張子偽装、MIME 偽装、0 バイト、PNG 署名のみ、SVG、GIF ポリグロット、kind 不正 / 空、thumbnail に動画、target_mind に PNG、file なし → すべて 400 / 413。部分ファイルは残らない |
| TC-S-03 | ○ | ファイル名 `../../etc/passwd` 等は使われず保存先はランダム ID。`/a/../../app.db`、`%2e%2e%2f`、`%5c`、NUL、`/app.db`、`/data/app.db` 等は到達不可。拡張子違い 404。他人の assetId の DELETE 404、他人の assetId の下書き参照 400 |
| TC-S-04 | ○ | 固定のログイン ID / パスワード・API キー・署名鍵・`.env` のコミットなし（`sato@example.com` / `password123` は `server/test/api.test.ts` のテスト専用で、アプリの初期データではない）。セッション ID は `crypto.randomBytes(32)` を DB 保存（署名鍵不要）。README「固定のデモアカウントはありません」どおり |
| TC-S-05 | ○ | Cookie 属性、サーバ側無効化、セッション ID 更新。`COOKIE_SECURE=1` / `NODE_ENV=production` で `Secure` |
| TC-S-06 | ◎ | `Origin` 不一致 / `null` → 403、同一 → 200、ログアウトも保護。`X-Forwarded-Host` を偽装した `Origin` は通過するがブラウザからは送れない（D-22 記録） |
| TC-S-07 | ◎ | `scrypt$<salt>$<hash>`（Node 組み込み、N=16384）。平文なし、API 応答にハッシュなし。要件 FR-1-1 の「argon2 または bcrypt」とは異なる（D-12、安全性は同等と判断） |
| TC-S-08 | × | XSS: プロジェクト名 / ボタンラベルの HTML は一覧・編集・閲覧ページ導入・体験中・終了画面・計測で文字列として表示され実行されない（○）。`javascript:` URL は拒否。**CSV で `=` / `+` 始まりの buttonId が無害化されない** → **D-02** |
| TC-S-09 | × | 不正 JSON → 400「JSON の形式が不正です」、未知ルート・エラーでスタック / パスの漏えいなし、`X-Powered-By` なし。**1 MB 超の JSON 本文が 500**「サーバーでエラーが発生しました」（413 が妥当）→ **D-08** |
| TC-S-10 | ○ | `npm audit`（本番依存 / 全依存とも）0 件 |
| TC-S-11 | × | **公開 API `GET /api/public/<slug>` の `assets` にプロジェクトの全素材（下書きでのみ参照する未公開素材を含む）が列挙される** → **D-01** |

---

## 3. 不具合一覧

重要度は計画 §6.1 の基準。再現は本環境（§1）。番号順で「要修正」は D-01〜D-05。

### 3.1 Major（5 件）

| # | 件名 | 対応 TC / 要件 | 再現手順 | 期待 / 実際 |
| --- | --- | --- | --- | --- |
| **D-01** | 公開 API が未公開（下書き専用）の素材を列挙する | TC-S-11 / FR-6-3、NFR-9 | 1. プロジェクトを公開 2. 下書きで別のオーバーレイ（WebP 等）をアップロードし `draftScene` を更新（再公開しない） 3. Cookie なしで `GET /api/public/<slug>` | 期待: 公開版が参照する素材のみ。実際: `assets` に手順 2 の素材 ID / URL が含まれ、`GET /a/<id>.webp` で取得できる。公開 URL を知る誰でも次回差し替え予定の未公開コンテンツを入手できる（`app.ts` の `assetMap(db, p.id)` が全素材を返す。公開版の参照 ID に絞る必要がある） |
| **D-02** | 計測 CSV の数式インジェクション（未認証の buttonId 経由） | TC-S-08b、TC-M7-01b / FR-9-3、NFR-9 | 1. 公開中の slug に `POST /api/public/<slug>/events` で `{"type":"cta_tap","buttonId":"=cmd\|\"/c calc\"!A1","os":"ios"}`（認証不要、20 文字以内） 2. 作成者が計測画面から CSV をダウンロードし Excel で開く | 期待: buttonId は公開版のボタン ID のみ受理、または CSV 出力時に `=` `+` `-` `@` 始まりを無害化。実際: `"=cmd\|""/c calc""!A1"` がそのままセルに出力される（`app.ts` の `esc` は引用符のみ処理）。あわせて計測画面のボタン別タップに未知 ID 行が増える |
| **D-03** | カメラ許可を拒否したとき「カメラの許可が必要です」と設定手順が表示されない | TC-M4-08 / FR-7-2 異常系 | 1. 閲覧ページで「カメラを起動」 2. カメラ許可を拒否（本環境では `getUserMedia` を `DOMException('NotAllowedError')` で reject） | 期待: 「カメラの許可が必要です」+ iPhone / Android の設定手順。実際: 「カメラを起動できませんでした」+ 再読み込みのみ。原因: `mind-ar` の `_startVideo` が `getUserMedia` の失敗を `console.log("getUserMedia error", r); reject()` と引数なしで reject するため、`ar.ts` の `err.name` 判定（`NotAllowedError` / `NotFoundError` 等）が常に不成立。展示会でもっとも多い失敗（許可拒否）で来場者に復旧手順が出ない。対策例: `mindar.start()` の前に自前で `getUserMedia` を試行して失敗種別を取る、または MindAR をフォークして reject に error を渡す |
| **D-04** | ターゲット解析中（または変更の 2 秒以内）に画面を離れると結果・変更が失われ、「解析待ち」から復旧できない | 追加ケース（FR-3-3、FR-4-7、FR-6-2） | 1. 編集画面でターゲット画像を登録し、進捗バー表示中にヘッダのサービス名（または「計測を見る」、ブラウザの戻る）で画面を離れる 2. 8 秒以上待って編集画面に戻る | 期待: 解析結果が保存されている、または戻ったときに再解析できる / 離脱前に警告。実際: `draftScene.target.mindAssetId` が `null` のまま、画面は「解析待ち」で再試行ボタンなし、公開欄に「ターゲット画像の解析が完了していません」。復旧には画像の再アップロードが必要だが、その案内がない。同様に、配置やラベルを変更して 2 秒以内に SPA 遷移すると変更が保存されない（幅 33% に変更 → 保存値 0.61 のまま）。対策例: アンマウント / `beforeunload` 時の即時保存、`compile` を画面遷移後も継続、「解析待ち」に再解析ボタン |
| **D-05** | 応答が無圧縮で、閲覧ページの転送量が目標を大きく超える | TC-N-02、TC-N-03 / NFR-2(a)(b) | `curl -H 'Accept-Encoding: gzip, br' http://<host>/v/<slug>` と参照 JS / CSS を取得し `Content-Encoding` とサイズを確認 | 期待: 導入画面 300 KB 以下、ライブラリ + ターゲットデータ gzip 後 600 KB 以下。実際: `Content-Encoding` なし。導入画面 **578 KB**（viewer 11 KB + overlay/three 559 KB + CSS 9 KB、目標比 +93%）、カメラ起動時に追加 **1,246 KB**（MindAR 1,084 KB + three ビルド 192 KB）+ `.mind` 549 KB = 約 1.8 MB。gzip 可能なら 167 KB / 327 KB + 253 KB になり目標内。Express に `compression` 等が無く、README も圧縮を行うリバースプロキシを必須としていない。対策例: `compression` ミドルウェア（または事前 gzip / brotli の静的配信）、`.mind` も圧縮対象に含める |

### 3.2 Minor（17 件。記録のみで合否に影響しない）

| # | 件名 | 対応 TC / 要件 | 内容 |
| --- | --- | --- | --- |
| D-06 | 1 アカウント合計 2 GB の上限が未実装 | TC-N-01 / NFR-4 | プロジェクト単位の 100 MiB のみ。`assets.ts` にアカウント合計の判定なし |
| D-07 | シーン検証エラーに zod の英語メッセージが混入 | TC-K4-03 / NFR-7 | `PATCH /api/projects/:id` の 400 が「入力内容に誤りがあります: draftScene.buttons Too big: expected array to have <=3 items」。UI は通常これを出さないが、保存失敗時に `e.message` を表示する経路がある |
| D-08 | 1 MB 超の JSON 本文が 500 | TC-S-09 / NFR-9 | `express.json({ limit: '1mb' })` の `PayloadTooLargeError` がエラーハンドラで 500 扱い（内容の漏えいは無し）。413 と日本語文言が妥当。error ログにスタックが出続ける |
| D-09 | Dockerfile が無い | TC-N-05 / NFR-11 | 「Docker イメージ 1 つで起動」が未達。README にも記載なし。`npm start` で起動は可能 |
| D-10 | 文言が i18n 辞書（JSON）に外出しされていない | TC-K4-02 / NFR-7 | 将来の多言語化（C3）の前提。現状は全て日本語で K4 は満たす |
| D-11 | アクセシビリティ: ファイル入力に label なし、`user-scalable=no`、コントラスト 1 件 | TC-N-04 / NFR-10 | `FileDrop` の `input.sr-only` ×2 が axe `label`（critical）。閲覧ページの `meta viewport` に `user-scalable=no`（拡大不可、axe moderate）。作成画面で `color-contrast` serious 1 ノード（初回のみ検出） |
| D-12 | パスワードハッシュが scrypt（要件は argon2 / bcrypt） | TC-S-07 / FR-1-1 | ソルト付き scrypt（N=16384）で安全性は同等。要件か実装のどちらかを揃える |
| D-13 | ボタンの並べ替えが ↑↓ ボタン（要件は「ドラッグ」） | TC-M3-03 / FR-5-3 | 機能は満たす。キーボード操作可能で NFR-10 には有利 |
| D-14 | 解析失敗時の文言がサーバのエラー文言 | TC-M1-07 / FR-3-3 | `.mind` 保存失敗時は「サーバーでエラーが発生しました」。再試行は可能 |
| D-15 | 計測 API で `from > to` が 400 ではなく空の 200 | TC-M7-03 / FR-9-1 | UI は `min` / `max` で防いでおり実害なし |
| D-16 | レート制限・ログインロックの Map が無制限に増える | TC-M7-09b / NFR-9 | イベント API は存在しない slug でもバケットを作る（slug 存在確認の前に `eventLimiter`）。ログインロックも未登録メールごとにエントリを持つ。長期稼働でメモリ増（再起動で解消） |
| D-17 | ISO-BMFF 全般（HEIC / 3GP / M4A 等）を `video/mp4` として受理 | TC-S-02 / FR-4-2 | `detectFileType` は `ftyp` のみ判定（`qt  ` 以外は mp4）。UI 経由はブラウザのサムネイル生成で弾かれるが API 直接では保存される。HEVC-in-MP4 の非判別は Q15 で既知 |
| D-18 | 長辺 8,000 px の判定がクライアント申告値に依存 | TC-M1-05c / FR-3-2 | `width=abc` で `null` 保存。画像の実寸はサーバで検証しない（ブラウザ内で縮小する設計のため実害は小さい） |
| D-19 | `.mind` が大きい（512×640 で 549 KB、gzip 253 KB） | TC-N-03 / NFR-2(b) | 作成画面は長辺 1,024 px に縮小して解析するため、本番のターゲットでは 2〜4 倍になる見込み。ライブラリ gzip 327 KB と合わせ 600 KB を超える可能性が高い（Q6 で「目標値、超過は Minor」と合意済み）。実機の 3 秒目標（TC-M4-21）で確認 |
| D-20 | JPEG ターゲットがフェイクカメラで認識されない（要実機確認） | TC-M4-07-jpg | 同じ図柄の PNG（特徴点 2,437）は 0.2 秒で認識、JPEG 版（特徴点 2,424、品質 90%）は 90 秒待っても認識せず（2 回再現）。フェイクカメラ映像が PNG 由来のため本環境固有の可能性があるが、実機で「JPEG で登録したチラシ」を 1 条件に含めること |
| D-21 | ログインロックがアカウント単位（第三者が作成者を 15 分ロックできる） | TC-M0-05 / Q5 | 設計どおり（Q5）だが、展示会当日に作成者のメールアドレスを知る第三者がログイン不能にできる。レート制限は IP を持たない方針のため、CAPTCHA や「ロック中でも正しいパスワードは通す」等を次スプリントで検討 |
| D-22 | `trust proxy: true` が無条件、`X-Forwarded-Host` を含む Origin 検査 | TC-S-06b | プロキシ無しで公開した場合に `X-Forwarded-*` を偽装できる。`PUBLIC_ORIGIN` 設定時は公開 URL / QR に影響しないことを確認済み。CSRF には使えない（ブラウザは当該ヘッダを送らない） |

### 3.3 検証側の記録（不具合ではない）

- QA フィクスチャの初回サイズ誤り（51,000,000 バイト < 50 MiB）により TC-M2-07a / TC-N-01 が一度 Fail したが、50 MiB + 1 / 20 MiB + 1 / 50 MiB × 2 + PNG で再検証し Pass。
- UI 検証 1 回目は、同一プロジェクトでターゲットを JPEG に差し替えた後の閲覧ページで認識せず（D-20）、それに依存する `recognized` / タップ率のチェックが Fail になった。PNG ターゲットの別プロジェクトで再検証し Pass。
- オーバーレイ画像の先読み（TC-M4-14）は作成画面で同じ URL を読み込み済みのため HTTP キャッシュから供給され、リクエストとして観測されなかった。`.mind` の先読みは観測。
- `cta_tap` の `sendBeacon` 本文は Playwright から読めないため、送信回数は計測値（page_open 1 / view_start 1 / recognized 1）で確認した。

---

## 4. 要件・レビュー推奨の充足状況（要約）

| 項目 | 状況 |
| --- | --- |
| Must M1〜M7 | 本環境で検証可能な範囲はすべて動作。AC-M1(3)、AC-M4(1)(2)(3)(4)(5)、AC-M5(1)、AC-M6 の実機部分、AC-M7(1) の実機部分、AC-K3 は実機待ち |
| K1〜K8 | K1（アプリ不要の方式）・K2・K4・K5（本環境）・K6・K8 は充足。K3 は実機待ち。K7 はテスター待ち |
| R1〜R3（必須） | R1: 終了画面に公開版ボタン + 案内 URL ○。R2: `page_open` / `blocked` の記録と表示 ○。R3: 「このまま試す」で UA 遮断しない ○ |
| R4〜R11 | R4 ○、R5 ○（MOV）、R6 README に記載 ○、R7 ○、R8 ○、R9 ○、R10 ○、R11 ○ |
| Q1〜Q20 の確定事項 | 本環境で検証した範囲（Q1〜Q6、Q10〜Q19）は実装どおり。Q7〜Q9 は実機 / テスター依存 |

---

## 5. 合格判定

- Blocker: 0 件
- Major: **5 件**（D-01〜D-05）→ 計画 §6.2 の条件 2（Major 0 件）を満たさないため **不合格**。
- 修正後の再検証範囲: 自動テスト全件（開発者テスト + QA スクリプト `api-tests.mjs` / `ui-tests-2.mjs`）と、D-01（TC-S-11、TC-M6-03）、D-02（TC-S-08b、TC-M7-01、TC-M7-05）、D-03（TC-M4-08、実機 TC-M4-18 で許可拒否を 1 回含める）、D-04（追加ケース TC-FR-4-7-nav、TC-M1-01、TC-M2-05）、D-05（TC-N-02、TC-N-03。あわせて README に圧縮の前提を明記）。
- Major 修正後に Blocker / Major が 0 件であれば、実機チェックリスト（§7）の結果を待って最終判定する。D-06〜D-22 は次スプリント以降の引き継ぎ事項として扱ってよい。

---

## 6. 開発者への補足（優先度順の修正提案）

1. D-01: `GET /api/public/:slug` の `assets` を公開版 SceneVersion が参照する ID（`publishedAssetIds`）に限定する。`/api/preview/:token` は下書き参照分でよい。
2. D-02: `events` の `buttonId` を公開版（または直近 10 世代）のボタン ID と照合し、不一致は 400 または破棄。CSV 出力は `esc` で先頭の `=` `+` `-` `@` `\t` `\r` に `'` を前置。
3. D-03: `startArSession` で `mindar.start()` の前に `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` を自前で試し、失敗時の `err.name` で分岐してからストリームを停止する（または MindAR フォーク）。
4. D-04: `EditorPage` のアンマウント時に未保存ならその場で `PATCH`（`navigator.sendBeacon` または `keepalive`）、`beforeunload` の警告、「解析待ち」状態に「再解析」ボタン。
5. D-05: `compression`（gzip / brotli）を `express.static` と `/a/*.mind` に適用。

---

## 7. オーナー向け実機確認チェックリスト（未実施 15 件）

QA が用意するもの: 印刷見本 4 枚（写真多め / 文字中心 / 名刺 / 光沢紙。各公開 QR 付き）、未公開プロジェクトのプレビュー QR、LINE 友だち追加ボタン付きプロジェクト、音声あり動画のプロジェクト、JPEG で登録したチラシのプロジェクト（D-20 確認用）。サーバは `HTTPS=1 npm run dev`（README）または HTTPS リバースプロキシ配下で起動し、`PUBLIC_ORIGIN` を実機から到達できる URL にする。**D-03 / D-05 の修正後に実施する**ことを推奨（許可拒否の案内と回線速度の結果が変わるため）。

端末: iPhone（iOS 16 以上、Safari）、Android（Android 10 以上、Chrome）各 1 台。可能なら下限端末（iPhone 8 相当 / Android 10 の中価格帯）。Wi-Fi を切り 4G / 5G で実施。各項目を両端末で ○ / × と気づいた点（秒数・機種・OS バージョン）で記録してください。

| # | 手順 | 確認すること | 対応 TC |
| --- | --- | --- | --- |
| 1 | 標準カメラアプリで公開 QR を読む | アプリのインストール要求なしに導入画面が開く。開くまで 2 秒以内（3 回の中央値） | TC-M4-17、TC-M4-21 |
| 2 | 「カメラを起動」をタップしてカメラを許可 | この 2 操作だけでカメラ映像が出る（3 秒以内） | TC-M4-18、TC-M4-21 |
| 3 | 印刷見本（写真多め）にかざす | 2 秒以内に動画が現れ、スマホを動かしても追従する。動画は無音で自動再生 | TC-M1-11、TC-M4-18、TC-M4-19 |
| 4 | 文字中心・名刺・光沢紙・JPEG 登録の見本でも 3 を行う | 各 2 秒以内に認識。光沢紙は照明の反射がある角度でも試す | TC-M1-11、D-20 |
| 5 | 見本から外して 1〜2 秒待ち、再び映す | ガイド枠に戻り、再認識で続きから再生 | TC-M4-22 |
| 6 | 音声ありプロジェクトでスピーカーアイコンをタップ | タップ後に音が出る（iPhone はサイレントスイッチ ON / OFF 両方を記録） | TC-M4-19 |
| 7 | 画像 / 3D のプロジェクトでかざす | 編集画面で決めた位置・大きさに表示。3D が回転する | TC-M2-15 |
| 8 | 画面下のボタンをタップ | 新しいタブで外部ページが開く。LINE ボタンは LINE が開く | TC-M3-10 |
| 9 | 1 分後に PC の計測画面を見る（QA が確認） | 体験 1 / 認識 1 / タップ 1、OS 別に 1 | TC-M7-13 |
| 10 | プレビュー QR を読む | 未公開の内容が見え、「プレビュー（未公開）」が出る。公開 URL は「準備中です」 | TC-M5-07 |
| 11 | QA が PC で内容を差し替えて再公開 → 同じ QR を読み直す | 新しい内容になる | TC-M6-10 |
| 12 | QA が停止 → 同じ QR を読む → QA が再開 → 読む | 停止中は「この AR は終了しました」と行動ボタン（カメラは起動しない）。再開後は元に戻る | TC-M6-10 |
| 13 | LINE の QR リーダーで公開 QR を読む | 「Safari / Chrome で開いてください」案内と「このまま試す」が出る。「このまま試す」でカメラが使えるかを記録（使えなくても案内があれば ○） | TC-M4-20 |
| 14 | 一度カメラを「許可しない」にしてから 2 を行う | 「カメラの許可が必要です」と設定手順が出る（**D-03 修正後**） | TC-M4-08 |
| 15 | （下限端末がある場合）1〜3 を行い、追従中のなめらかさを記録 | カクつきなく追従する（QA が USB 接続で fps を測定、20 fps 以上） | TC-K3-01 |
| 16 | （QA 同席）PC のプロキシ経由で 1〜8 を行う | 通信記録に映像・画像の送信が無い（QA が確認） | TC-K5-02 |
| 17 | （マーケター推薦のテスター 3 名）手元の素材で登録 → 公開を 30 分以内に | 2 名以上が 30 分以内。詰まった箇所を記録 | TC-K7-01 |

所要時間の目安: 1 端末あたり 25〜35 分（項目 17 を除く）。

---

## 8. 添付（スクラッチパッド `qa/` 配下）

- `auto-tests.log`: typecheck / Vitest / E2E の実行ログ
- `api-tests.log`, `api-results.json`, `api-recheck.log`, `transfer.json`: API / セキュリティ検証と転送量
- `ui-tests.log`, `ui-tests-2.log`, `ui-results-2.json`: UI 検証
- `ui-out/`: スクリーンショット（`editor-published.png`, `editor-mobile.png`, `viewer-png.png`, `viewer-jpg.png`, `viewer-glb.png`, `viewer-ended.png`, `viewer-intro-mobile.png`, `stats.png`）、axe 結果（`axe-editor-detail.json` 等）
- `server.log`, `server-secure.log`: サーバログ（1 行 1 JSON、IP なし）

---

# ラウンド 2（再検証）

- 実施日: 2026-11-07
- 対象: コミット `146c195`（Fix QA round 1 findings (D-01..D-22)）。要件定義 §12、README の更新を含む
- 判定: **条件付き合格**。Blocker 0 件、Major 0 件（D-01〜D-05 はすべて修正を確認、デグレなし）。条件は (1) オーナーによる実機チェックリスト（§R2-6）の完了と iPhone / Android 両方で項目 1〜14 が ○ であること、(2) Docker イメージのビルド・起動確認（本環境では Docker デーモンが無く未確認）、(3) AC-K7（30 分テスト）の結果記録。残存する Minor（§R2-4）は次スプリントへの引き継ぎでよい。

## R2-1. 環境・手順

ラウンド 1 と同じ環境（Node v22.23.4、Playwright Chromium 153、SwiftShader + フェイクカメラ）。`npm run e2e` が生成した `web/dist` / `server/dist` を使い、新しい一時 DB（`DATA_DIR=<scratchpad>/qa/data-r2`、`PORT=3999`、`PUBLIC_ORIGIN` / `SUPPORT_EMAIL` 設定）で起動。QA スクリプトは D-02 / D-15 / D-16 / D-18 の仕様変更に合わせて期待値を更新した（`api-tests.mjs`: 公開版に無い buttonId → 400、`from > to` → 400、存在しない slug は常に 404、長辺 8,001 px は実ファイル `target_8001px.png` で検証、転送量は圧縮後のバイト数で計測。`ui-tests.mjs`: ダイアログ処理の衝突を修正、D-14 の文言）。追加スクリプト: `ui-tests-4.mjs`（D-04 のフルページ遷移 / タブを閉じる / 解析中にタブを閉じる）、`ui-tests-5.mjs`（`.mind` 保存失敗 → 再試行、axe の対象ノード特定）。ログ: `auto-tests-r2.log`, `api-tests-r2.log`, `api-recheck-r2.log`, `ui-tests-r2.log`, `ui-tests-2-r2.log`, `docker-build.log`, `server-r2.log`。

## R2-2. 自動テスト（再実行）

| コマンド | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | Vitest 40 件 すべて成功（D-01 / D-02 / D-05 / D-06 / D-07 / D-08 / D-15 / D-16 / D-17 / D-21 の回帰テストが追加されている） |
| `npm run e2e` | 24 ステップ すべて成功、コンソールエラー 0 件（D-03 カメラ拒否、D-04 解析中の離脱 / 再解析 / 2 秒以内の遷移 が追加されている） |
| QA `api-tests.mjs` | 112 項目中 Pass 109。Fail 3 は検証側要因（50 MiB 1 本のみの上限テスト、D-02 で cta_tap が 1 件減った期待値、21 文字ラベル）で、`api-recheck.mjs`（50 MiB × 2 + PNG → 413 quota、20 文字ラベルの HTML 片 → 200、2 MB JSON → 413）で Pass を確認 |
| QA `ui-tests-2.mjs` | 18 項目中 Pass 17。Fail 1 は D-20（JPEG ターゲットのフェイクカメラ認識、実機確認へ） |
| QA `ui-tests.mjs` | 93 項目中 Pass 78。Fail 15 のうち 14 件はラウンド 1 と同じ検証側要因（JPEG 差し替え後の認識不能 D-20 に連鎖した 9 件、キャッシュ / ポップアップ / slug 文字列の誤検出 4 件、文言変更に未追従の正規表現 1 件）。残り 1 件は `color-contrast`（§R2-4 D-11 残） |
| QA `ui-tests-4.mjs` / `ui-tests-5.mjs` | すべて Pass（§R2-3 D-04 / D-14 参照） |
| サーバログ | `level: error` 0 行（1 MB 超 JSON が 500 でなくなったため） |

## R2-3. Major の修正確認（D-01〜D-05）

| # | 結果 | 確認内容 |
| --- | --- | --- |
| D-01 | **修正確認** | TC-S-11: 公開後に下書き専用の WebP をアップロードして下書きに参照させても、`GET /api/public/<slug>` の `assets` は公開版が参照する 3 件（画像 / `.mind` / オーバーレイ）のみ。TC-M6-03: 下書き編集中の公開版・素材 URL 不変。プレビュー API（token 保持者）は下書きの素材を返す（開発者テスト） |
| D-02 | **修正確認** | TC-M7-01: `cta_tap` は公開版のボタン ID のみ 204、`=cmd\|"/c calc"!A1` / `+1+1` / `not-in-scene` / 未公開・停止中の slug は 400。`page_open` / `blocked` は停止中でも 204（Q3）。TC-M7-05 / TC-S-08b: DB に直接 `=HYPERLINK("x")` を入れても CSV は `"'=HYPERLINK(""x"")"` と `'` 前置で無害化され、`=` `+` `-` `@` 始まりのセル 0 件 |
| D-03 | **修正確認** | TC-M4-08: `getUserMedia` を `DOMException('NotAllowedError')` で reject → 「カメラの許可が必要です」+ iPhone / Android の設定手順 + 再読み込み（UI-1 / UI-2 / E2E の 3 経路）。`ar.ts` の `probeCamera` が MindAR 起動前に失敗種別を判別する。注意: カメラが 2 回開かれる（probe → MindAR）。実機で許可ダイアログが 1 回で済むこと、起動時間への影響を確認する（§R2-6 項目 2） |
| D-04 | **修正確認** | 解析中に SPA 遷移 → 12 秒後に戻ると `mindAssetId` が保存済み（E2E）。変更の 2 秒以内に SPA 遷移 / フルページ遷移（`beforeunload`）/ タブを閉じる（`keepalive`）のいずれでも保存される（幅 0.33 / 0.41 / 0.42 を確認）。解析中にタブを閉じた場合は `mindAssetId` が null になるが、戻ると「画像の解析が完了していません」+「再解析」ボタンが出て、押すと復旧して保存される。`.mind` 保存が 500 のときは D-14 の文言「画像の解析結果を保存できませんでした。『再試行』を押してください」+ 再試行で 1.5 秒で復旧 |
| D-05 | **修正確認** | `compression`（gzip / brotli）。導入画面の初期転送 **169 KB**（br。ラウンド 1 は 578 KB、目標 300 KB 以下を達成）。カメラ起動時の追加は MindAR 280 KB + three ビルド 46 KB = **326 KB**（br）、`.mind`（512×640 ターゲット）は 549 KB → **237 KB**（br）/ 253 KB（gzip）。合計 563 KB で 600 KB 以下（この解像度の場合。§R2-4 D-19 参照）。`Accept-Encoding: identity` では無圧縮 |

## R2-4. ラウンド 1 で Fail だった 10 件の再実施と残存事項

| ID | ラウンド 1 | ラウンド 2 | 備考 |
| --- | --- | --- | --- |
| TC-M4-08 | × D-03 | ○ | 上記 |
| TC-K4-02 | × D-10 | 見送り合意 | i18n 辞書は未実装のまま。K4（全画面日本語）は TC-K4-01 で再確認し充足。開発者の理由（多言語化 C3 の前提作業で MVP 外）は妥当。合否に影響しない |
| TC-N-01 | × D-06 | ○ | プロジェクト 100 MiB（50 MiB × 2 + PNG → 413）、アカウント合計上限 `ACCOUNT_QUOTA_BYTES`（既定 2 GB、開発者テストで 1,500 バイトに縮小して 413 と「アカウント全体」の文言を確認） |
| TC-N-02 | × D-05 | ○ | 169 KB（目標 300 KB） |
| TC-N-03 | × D-05 / D-19 | ◎ | 326 KB + `.mind` 237 KB = 563 KB（512×640）。作成画面は長辺 1,024 px で解析するため本番ターゲットでは `.mind` が 2〜4 倍になり 600 KB を超える見込み。開発者の理由（MindAR の形式依存、解像度を下げると精度低下、Q6 で目標値扱い）は妥当。実機の「カメラ起動 3 秒」（§R2-6 項目 2）で最終確認 |
| TC-N-04 | × D-11 | ◎ | ファイル入力の `aria-label`、`user-scalable=no` 削除を確認（axe `label` / `meta-viewport` 消失）。**残: `.warn-text`（`#b26a00` on `#ffffff`、12.8 px）のコントラスト 4.23:1 < 4.5:1**（20 MB 超動画の注意文など）。Minor として残存（D-11 残） |
| TC-N-05 | × D-09 | ◎ | `Dockerfile` / `.dockerignore` を追加。静的確認: マルチステージ、`npm ci` → `npm run build` → `npm prune --omit=dev`、`server/dist`（`shared` を含む）と `web/dist` のみコピー、`USER node`、`/data` ボリューム、`HEALTHCHECK`。`config.ts` の `dist` 判定で `repoRoot=/app` となり `web/dist` を解決できる。**本環境は Docker デーモンが無く `docker build` は未実行**（`docker-build.log`）。オーナー環境でのビルド・起動確認を条件に含める |
| TC-S-08 | × D-02 | ○ | 上記。XSS の描画確認もラウンド 1 と同じく実行されない |
| TC-S-09 | × D-08 | ○ | 1 MB 超 JSON → 413「送信データが大きすぎます（1 MB まで）」 |
| TC-S-11 | × D-01 | ○ | 上記 |

Minor の修正確認（デグレなし）: D-07（PATCH 400 は「入力内容に誤りがあります（draftScene.buttons）」のみ）、D-12（要件側を scrypt に修正）、D-14、D-15、D-16（存在しない slug に 65 回送っても 404）、D-17（`heic` / `3gp5` / `M4A ` は 400、`isom` / `mp42` / `avc1` は 201。開発者テスト）、D-18（申告値 `abc` でもヘッダから 512×640 を読む、8,001 px の実 PNG は 400）、D-21（開発者テストで 60 秒に 1 回の照合を確認）、D-22（`TRUST_PROXY` 既定 `loopback`）。

見送り 4 件への判断:

| # | 開発者の理由 | QA の判断 | 合否への影響 |
| --- | --- | --- | --- |
| D-10 | i18n 辞書化は多言語化（C3）の前提作業。K4 は満たす | 妥当。NFR-7 の「辞書に外出し」は将来要件の準備であり、MVP の受け入れ基準 AC-K4 は充足 | なし（次スプリント候補） |
| D-13 | 最大 3 個の並べ替えは ↑↓ で十分、キーボード操作可。FR-5-3 を改める | 妥当。要件定義を実装に合わせて修正済みで、マーケターの意図（順序を変えられる）は満たす | なし |
| D-19 | `.mind` は形式依存。gzip で半減。解像度を下げると精度低下 | 妥当。圧縮後の実測で 512×640 なら目標内。1,024 px での超過は Q6 で「目標値、Minor」と合意済み。実機の 3 秒目標で判断 | なし（実機で確認） |
| D-20 | フェイクカメラ映像が PNG 由来で本環境固有の可能性 | 妥当。本環境では JPEG 版が 2 ラウンドとも 90 秒で認識せず再現性はあるが、実カメラでは印刷物を撮るため条件が異なる。実機チェックリスト項目 4 で JPEG 登録のチラシを必須とする | なし（実機で確認。実機で再現すれば Major として再起票） |

残存不具合（すべて Minor）:

| # | 件名 | 内容 |
| --- | --- | --- |
| D-11 残 | `.warn-text` のコントラスト 4.23:1 | `--warn: #b26a00` を白背景・12.8 px で使用。`#9a5c00` 程度に濃くすれば 4.5:1 を満たす |
| D-22 残 | `checkOrigin` が `X-Forwarded-Host` ヘッダを直接読む | `trust proxy` の設定に関わらず、リクエストの `X-Forwarded-Host` が Origin 検査の許可ホストに加わる。ブラウザは当該ヘッダを送れないため CSRF には使えない（記録） |
| 新規 R2-01 | カメラが 2 回開かれる（`probeCamera` → MindAR） | D-03 の実装方式。起動時間と iOS の許可ダイアログ回数を実機で確認（§R2-6 項目 2） |
| D-10 / D-13 / D-19 / D-20 | 上記の見送り | 次スプリント / 実機確認 |

## R2-5. 合格判定

- Blocker 0 件、Major 0 件。計画 §6.2 の条件 1〜4 を満たす。条件 5（実機）・6（AC-K5 実機）・7（AC-K7）は未実施のため **条件付き合格**。
- 条件: (1) §R2-6 の実機チェックリストを iPhone / Android 両方で実施し、項目 1〜14 が ○（項目 13 の「このまま試す」でカメラが使えないこと自体は不合格にしない）。(2) オーナー環境で `docker build` / `docker run` を行い、`/healthz` と作成〜閲覧が動くこと（README の手順）。(3) AC-K7 の結果を記録（未達でも他条件を満たせば合格、オーナー判断）。
- 実機で D-20（JPEG ターゲットの認識）や許可拒否の案内（項目 14）が × の場合は Major として再起票し、修正後に該当項目のみ再確認する。

## R2-6. オーナー向け実機チェックリスト（最新版）

ラウンド 1 の §7 を次のとおり更新した。QA が用意するもの、端末、回線条件は §7 と同じ。**コミット `146c195` 以降のビルドで実施すること**（D-03 / D-05 を含む）。

| # | 手順 | 確認すること | 対応 TC |
| --- | --- | --- | --- |
| 1 | 標準カメラアプリで公開 QR を読む | アプリのインストール要求なしに導入画面が開く。開くまで 2 秒以内（3 回の中央値） | TC-M4-17、TC-M4-21 |
| 2 | 「カメラを起動」をタップしてカメラを許可 | 許可ダイアログは 1 回だけ。この 2 操作だけでカメラ映像が出る（3 秒以内。`.mind` が大きいチラシでも計測） | TC-M4-18、TC-M4-21、R2-01、D-19 |
| 3 | 印刷見本（写真多め）にかざす | 2 秒以内に動画が現れ、スマホを動かしても追従する。動画は無音で自動再生 | TC-M1-11、TC-M4-18、TC-M4-19 |
| 4 | 文字中心・名刺・光沢紙・**JPEG で登録した**見本でも 3 を行う | 各 2 秒以内に認識。光沢紙は照明の反射がある角度でも試す。JPEG 登録の見本が認識しない場合は × として報告 | TC-M1-11、D-20 |
| 5 | 見本から外して 1〜2 秒待ち、再び映す | ガイド枠に戻り、再認識で続きから再生 | TC-M4-22 |
| 6 | 音声ありプロジェクトでスピーカーアイコンをタップ | タップ後に音が出る（iPhone はサイレントスイッチ ON / OFF 両方を記録） | TC-M4-19 |
| 7 | 画像 / 3D のプロジェクトでかざす | 編集画面で決めた位置・大きさに表示。3D が回転する | TC-M2-15 |
| 8 | 画面下のボタンをタップ | 新しいタブで外部ページが開く。LINE ボタンは LINE が開く | TC-M3-10 |
| 9 | 1 分後に PC の計測画面を見る（QA が確認） | 体験 1 / 認識 1 / タップ 1、OS 別に 1 | TC-M7-13 |
| 10 | プレビュー QR を読む | 未公開の内容が見え、「プレビュー（未公開）」が出る。公開 URL は「準備中です」 | TC-M5-07 |
| 11 | QA が PC で内容を差し替えて再公開 → 同じ QR を読み直す | 新しい内容になる | TC-M6-10 |
| 12 | QA が停止 → 同じ QR を読む → QA が再開 → 読む | 停止中は「この AR は終了しました」と行動ボタン（カメラは起動しない）。再開後は元に戻る | TC-M6-10 |
| 13 | LINE の QR リーダーで公開 QR を読む | 「Safari / Chrome で開いてください」案内と「このまま試す」が出る。「このまま試す」でカメラが使えるかを記録（使えなくても案内があれば ○） | TC-M4-20 |
| 14 | 一度カメラを「許可しない」にしてから 2 を行う | 「カメラの許可が必要です」と iPhone / Android の設定手順が出る | TC-M4-08（D-03） |
| 15 | （下限端末がある場合）1〜3 を行い、追従中のなめらかさを記録 | カクつきなく追従する（QA が USB 接続で fps を測定、20 fps 以上） | TC-K3-01 |
| 16 | （QA 同席）PC のプロキシ経由で 1〜8 を行う | 通信記録に映像・画像の送信が無い（QA が確認） | TC-K5-02 |
| 17 | （オーナー環境）`docker build -t nocode-ar .` → `docker run -p 3000:3000 -v nocode-ar-data:/data -e PUBLIC_ORIGIN=... nocode-ar` | ビルド成功、`/healthz` が 200、登録〜公開〜閲覧が動く | TC-N-05（D-09） |
| 18 | （マーケター推薦のテスター 3 名）手元の素材で登録 → 公開を 30 分以内に | 2 名以上が 30 分以内。詰まった箇所を記録 | TC-K7-01 |

---

# ラウンド 3（Vercel 構成への載せ替えのデグレ確認と新構成の検証）

- 実施日: 2026-11-09
- 対象: コミット `c1909e5`（Move to Vercel: Functions entry, PostgreSQL/PGlite adapter, Vercel Blob storage, cron cleanup, docs）、`644b2b0`（zod override）。要件定義 §13、`docs/04_architecture.md`「Vercel 構成」、README「Vercel へのデプロイ」
- 判定: **不合格（Blocker 1 件: Blob 直接アップロードの登録 API `POST /api/projects/:id/assets/register` が `url` を検証しない）**。ローカル構成（PGlite + ローカル素材）では機能・セキュリティともにデグレなし。Blocker は Vercel（Blob）構成でのみ露出するが、本番基盤が Vercel になったため合格にできない。修正は小さく（`url` が自ストアの Blob URL で、かつ `pathname` と一致することの検証）、修正後は該当ケースの再確認のみで合格判定に進める。

## R3-1. 環境・手順

ラウンド 2 と同じ環境。本ラウンドで追加したもの:

| 項目 | 内容 |
| --- | --- |
| ローカルサーバ | `node server/dist/server/src/index.js`（`DATA_DIR=<scratchpad>/qa/data-r3`、PGlite + ローカル素材、`CRON_SECRET` 設定）。`/healthz` → `{"ok":true,"db":"pglite","storage":"local"}` |
| QA スクリプト | `api-tests.mjs`（SQLite 直接参照だった 11 項目は SKIP にし、`r3-checks.mts` で PGlite を直接参照して実施）、`ui-tests-2.mjs`、新規 `r3-checks.mts`（PGlite インメモリ + メモリ / Blob ストレージアダプタで、DB 依存ケース・Cron・`assets/register` の認可と検証・SSRF）、`func-invoke.mjs`（`npx vercel build` の成果物を Node から直接起動） |
| `npx vercel build` | ダミーの `.vercel/project.json` で実行し成功（`.vercel/output/`。git 管理外）。ローカル起動のため `server/migrations` を関数ディレクトリへコピーした（後述） |
| 検証不可 | 実デプロイ（Neon 接続、Blob への実アップロード・Range GET、Cron の実行、CDN 圧縮）。Docker デーモンも引き続き無し |

## R3-2. 自動テスト（再実行）

| コマンド | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | Vitest 47 件 すべて成功（PGlite インメモリ。Blob 登録・Cron・設定エラーのテストが追加） |
| `npm run e2e` | 24 ステップ すべて成功、コンソールエラー 0 件（PGlite + ローカル素材） |
| `npm audit` | 0 件（`644b2b0` の zod override 後） |
| QA `api-tests.mjs`（ローカル構成） | 112 項目中 PASS 100 / SKIP 11（DB 直接確認 → `r3-checks.mts` で代替）/ FAIL 1（TC-M6-03。SceneVersion ID の DB 比較がスタブ化されたための検証側要因。公開版が不変であることは TC-M5-02（プレビュー = 下書き、公開 API = 公開版）と開発者テスト「下書きを編集しても公開版は変わらない」で確認） |
| QA `ui-tests-2.mjs` | 18 項目中 PASS 17 / FAIL 1（D-20 JPEG ターゲットのフェイクカメラ認識、実機確認へ） |
| QA `r3-checks.mts` | 25 項目中 PASS 24 / FAIL 1（**TC-R3-SSRF**、§R3-4） |
| サーバログ | `level: error` 0 行 |

## R3-3. デグレ確認（ローカル構成）

ラウンド 2 で合格した機能・セキュリティケースはすべて維持されている。

| 区分 | 確認内容 | 結果 |
| --- | --- | --- |
| TC-S 全件 | 未認証 401（17 エンドポイント）、他ユーザー 404、アップロード偽装（拡張子 / MIME / 0 バイト / SVG / GIF ポリグロット / kind 不正 / MP4 以外の ISO-BMFF）、パストラバーサル（保存先 `data/assets/projects/<pid>/<kind>/<id>.<ext>`、`/a/../`、`%2e%2e`、他人 assetId の DELETE・参照）、固定 ID / パスワード・接続文字列・トークンの埋め込みなし（`.env.example` はキー名のみ、`.env` / `.vercel` は未追跡、README の `postgres://...` はプレースホルダ）、Cookie 属性・無効化・ID 更新、CSRF `Origin` 検査、scrypt、XSS・CSV 無害化、エラー応答（1 MB 超 413、スタック漏えいなし）、`npm audit` 0、未公開素材の非露出（D-01 維持） | ○ |
| TC-M6-03 / TC-S-11 | 公開後に下書きで差し替えた素材が公開 API に出ない。公開版の内容・素材 URL は下書き編集で変わらない | ○ |
| TC-M7 ロック・レート制限（DB 化） | 10 回失敗で 429 が `login_locks` に記録され、60 秒後に 1 回照合（D-21）。`rate_limits` の原子的加算で 61 回目以降 429、別 slug は受理、存在しない slug は常に 404（D-16） | ○ |
| TC-N-01 容量 | 50 MiB × 2 + PNG → 413 quota。アカウント合計上限の実装維持 | ○ |
| DB 依存ケース（PGlite） | 期限切れセッション 401、`analytics_events` に IP / UA 列なし、JST 境界（`COUNT` が数値で返る）、10 世代保持、停止中 slug の `page_open` 受理 / `cta_tap` 400、sha256 一致（ローカル保存） | ○ |
| Cron | Bearer なし / 誤り 401、未設定 503、正しい secret で 200 と `{assetsDeleted, orphanBlobsDeleted, sessionsDeleted}`。15 分超の未参照素材を削除、参照中・猶予内は残す | ○ |
| UI（ui-tests-2） | 認識（PNG）、差し替え、R7、解析中の離脱 / 2 秒以内の遷移、カメラ拒否、axe、削除ダイアログ、スマホ幅、日本語、ログアウト | ○（D-20 のみ従来どおり） |
| 転送量 | ローカル構成では `compression` が有効のまま（Vercel 上は CDN に委ねる設計。実測は実デプロイ後） | ○ |

## R3-4. 新構成固有の確認

| # | 確認項目 | 結果 |
| --- | --- | --- |
| (a) `npx vercel build` | 成功。`.vercel/output/config.json`: ヘッダ（`/assets/*` immutable、`/(index\|viewer).html` no-cache、全体 nosniff）→ `handle: filesystem` → `/api/*`, `/a/*`, `/healthz` → `/api/index` → `/v/:slug` → `/viewer.html?slug=`、`/p/:token` → `/viewer.html?token=` → 除外付き catch-all → `/index.html`。`crons: [{path: /api/cron/cleanup, schedule: 0 3 * * *}]`。`.vc-config.json`: `runtime: nodejs22.x`、`memory: 1024`、`maxDuration: 30`、`handler: api/index.js`、`filePathMap` に `server/migrations/001_init.sql`。関数バンドル 8.9 MB（`@electric-sql/pglite` は除外、`pg` / `@vercel/blob` / `@vercel/functions` / `compression` / `express` / `multer` / `qrcode` を同梱）。**コンパイル済み関数を Node から直接起動**: `/healthz` 200 `{db:"pglite",storage:"local"}`、`/api/config` 200、`/api/cron/cleanup` Bearer なし 401 / 誤り 401 / 正しい secret 200、`/api/public/<不明>` 404、`/a/<不明>` 404。ただし **ローカル起動では `server/migrations` が関数ディレクトリに無く `ENOENT`**（`filePathMap` はデプロイ時に配置される参照のため）。`server/migrations` を手でコピーすると動作。Vercel 上では `DATABASE_URL` 必須のため `AUTO_MIGRATE` 未設定ならこのパスは通らない（§R3-5 M-R3-03） | ○（注記あり） |
| (b) `blob-upload` / `assets/register` の認可・検証 | メモリアダプタ: 未認証 401、他ユーザーのプロジェクト ID → 404（`blob-upload` も 404）、他プロジェクト配下の `pathname` → 400、`..` → 400、Content-Type を `image/png` と偽った GLB → 400 で Blob 削除、10 MB 超 → 413 で Blob 削除、寸法は申告値でなく先頭 64 KB のヘッダから、存在しない Blob → 400。**しかし `url` と `pathname` の対応が検証されず、`url` が自ストアの Blob URL かも検証されない**（§R3-5 B-R3-01） | × |
| (c) rewrites | 出力 `config.json` で確認: `filesystem` が先に評価されるため `/legal.html`、`/assets/*`、`/viewer.html`、`/index.html` は実ファイルが配信される。catch-all は `assets/`, `api/`, `a/`, `v/`, `p/`, `legal.html`, `viewer.html`, `index.html`, `favicon` を除外し、未知パス（`/foo`、`/projects/xxx`）は `/index.html` へ。`/favicon.ico`（ファイル無し）と `/v/a/b`（2 セグメント）は 404。`/api/*` の未知パスは関数（Express の既定 404） | ○ |
| (d) 秘密情報 | `.env.example` は 13 キーすべて値なし。コード・ドキュメントに接続文字列・トークンなし（grep: `postgres://user:pass@localhost:1/db` と `vercel_blob_rw_dummy` はテストのダミー、README は `postgres://...`）。`.env` / `.vercel/` は `.gitignore` 済みで未追跡 | ○ |
| (e) migrate の冪等性 | `npm run migrate` 1 回目 `applied: ["001_init.sql"]`、2 回目 `applied: []`（`schema_migrations` で管理）。その後の起動・動作に影響なし | ○ |
| (f) `VERCEL=1` での欠落エラー | `DATABASE_URL` なし → 「DATABASE_URL が設定されていません。Vercel では PostgreSQL（Neon）が必須です（README「Vercel へのデプロイ」参照）」、`BLOB_READ_WRITE_TOKEN` なし → 「BLOB_READ_WRITE_TOKEN が設定されていません。Vercel では素材の保存先として Vercel Blob が必須です」。両方あり（到達不能 DB）→ ランタイム生成は成功し最初のクエリで `ECONNREFUSED`（Pool は遅延接続。`vercel.ts` は失敗時に `runtimePromise` を破棄して次回再試行） | ○ |

## R3-5. 不具合一覧（ラウンド 3 で新規）

### Blocker（1 件）

| # | 件名 | 再現手順 | 期待 / 実際 |
| --- | --- | --- | --- |
| **B-R3-01** | `POST /api/projects/:id/assets/register` が `url` を検証せず、任意 URL の取得（SSRF）・外部 URL の素材登録・**他ユーザーの Blob 削除**が可能 | (1) SSRF（`r3-checks.mts` TC-R3-SSRF、Blob アダプタ + ダミートークンで再現）: 自分のプロジェクトで `{"kind":"target_image","url":"http://127.0.0.1:<port>/internal/anything.png","pathname":"projects/<自分の pid>/target_image/x.png"}` を送る → サーバがその URL へ `HEAD` と `GET Range: bytes=0-65535` を実行（QA のローカル HTTP サーバで到達を観測）。応答が PNG なら **201 で登録され、`assets.url` が攻撃者の URL になる**（公開すると閲覧ページがその URL を読み込む）。(2) 他ユーザーの Blob 削除（コード確認。メモリアダプタは key ベースのため再現しないが、`createBlobStorage.delete` は `del(obj.url)` と URL ベース）: 被害者の公開中素材の Blob URL（`GET /api/public/<slug>` で誰でも取得可）を `url` に、自分のプロジェクト配下の `pathname` と不一致の `kind` を指定して register → 検証失敗の後始末 `fail()` が `storage.delete({key, url})` → `del(被害者の URL)` → **被害者の公開中素材が消える**。`kind` を合わせれば 201 で登録でき（TC-R3-REG-11: 被害者 URL を自分の素材として登録可）、その後自分の素材を DELETE しても同様に被害者の Blob が消える | 期待: `url` が自ストアの Blob URL（`isBlobUrl`。`storage.ts` に定義済みだが未使用）であり、`new URL(url).pathname` が `pathname`（`projects/<pid>/<kind>/...`）と一致することを検証する。または `@vercel/blob` の `head(url, {token})` でストア内の pathname を取得し、クライアントの `pathname` を信用しない。検証前の取得・削除は行わない。実際: `z.string().url()` のみ。`registerUploadedAsset` は `key` の接頭辞だけ確認し、`url` は `storage.head(url)` → `readRange(url)` → `delete({key,url})` にそのまま渡る |

### Minor（4 件。合否に影響しない）

| # | 件名 | 内容 |
| --- | --- | --- |
| M-R3-01 | `blob-upload` のトークンがオーバーレイに一律 50 MB を許可 | `KIND_LIMITS.overlay.maxBytes = 50 MB` のため、画像 / GLB も 50 MB まで Blob に上がってから `register` で 413 → 削除される。帯域の無駄のみ。`clientPayload` にファイル種別を含めて上限を分ける余地 |
| M-R3-02 | `/v/:slug` 応答に `no-cache` ヘッダが付かない可能性 | `headers` の `/(index\|viewer)\.html` はリクエストパスに対して評価されるため、rewrite 元の `/v/<slug>` には適用されない見込み。Vercel の静的 HTML 既定（`max-age=0, must-revalidate`）で実害は小さい。実デプロイで `curl -I https://<host>/v/<slug>` を確認（§R3-6） |
| M-R3-03 | 関数バンドルをローカルで起動するには `server/migrations` のコピーが必要 | `filePathMap` はデプロイ時に配置される。Vercel 上では `AUTO_MIGRATE=1` のときだけ `runMigrations` が走り、`repoRoot` は `/var/task` に解決される想定だが未検証。README の「手動 migrate を推奨」どおり運用すれば影響なし |
| M-R3-04 | `/api/cron/cleanup` の Bearer 比較が定数時間でない、未知の `/api/*` は Express 既定の英語 404 HTML | `req.headers.authorization !== ...` の文字列比較（`crypto.timingSafeEqual` 推奨）。未知の API パスの 404 本文が英語（ブラウザ画面には出ない） |

記録（不具合ではない）: Blob 保存分は `sha256` を持たない（§13 で合意。AC-K6 は配信バイト列の一致で確認）。Cron の掃除は下書き・公開版以外の素材を削除するため、保持している過去 10 世代の SceneVersion はロールバックしても素材が無い（ラウンド 1 からの Q4 の仕様。NFR-5「ロールバック可能」と齟齬があるため次スプリントで整理を推奨）。`publicOrigin` は引き続き `X-Forwarded-Host` を参照するため Vercel では `PUBLIC_ORIGIN` 設定を推奨（README 記載済み）。

## R3-6. 合格判定と、実デプロイ後にオーナーが確認する項目

- Blocker 1 件（B-R3-01）のため **不合格**。修正後の再検証: `r3-checks.mts` の TC-R3-SSRF / REG-10 / REG-11 相当（`url` 不一致 → 400 かつ Blob に触れない、他ストア / 外部 URL → 400）、開発者テストへの追加を確認。ローカル構成のデグレ確認は本ラウンドの結果を流用してよい。
- Blocker 修正後も、Vercel 固有の挙動は実デプロイでしか確認できないため、以下をオーナー（または QA 同席）で実施し、結果をレポートに追記してから最終判定とする。ラウンド 2 の実機チェックリスト（§R2-6）は本番 URL で実施する。

| # | 確認項目 | 期待 |
| --- | --- | --- |
| 1 | `https://<host>/healthz` | `{"ok":true,"db":"pg","storage":"blob"}`（`pglite` / `local` なら環境変数未設定） |
| 2 | `npm run migrate`（Neon の pooled 接続文字列）を 2 回 | 1 回目 `applied: ["001_init.sql"]`、2 回目 `applied: []` |
| 3 | 作成画面で PNG（ターゲット）/ MP4 / GLB / `.mind`（解析で自動）をアップロード | ブラウザの Network で Blob（`*.public.blob.vercel-storage.com`）への PUT と `/api/projects/:id/assets/register` 201 を確認。8 MB 超の MP4 は multipart。Blob の URL に `-<random>` が付く |
| 4 | Blob の URL を Cookie なしで `curl -I` | `access-control-allow-origin: *`（閲覧ページは別オリジンの Blob から動画 / `.mind` / GLB を取得するため CORS が必要。無いと WebGL テクスチャが汚染され動画が表示されない）、`content-type` が正しい |
| 5 | 公開 → QR → 実機で体験（§R2-6 の 1〜14） | 動画 / 画像 / 3D が表示され、計測が 1 / 1 / 1 |
| 6 | `curl -I -H 'Accept-Encoding: br' https://<host>/assets/<overlay chunk>.js` と `.../a/`ではなく Blob の `.mind` URL | 前者 `content-encoding: br`（CDN 圧縮）。後者は Blob の配信ヘッダを記録（`.mind` が圧縮されない場合はカメラ起動時間を実機で計測し、必要なら事前 gzip を検討） |
| 7 | `curl -I https://<host>/v/<slug>` と `/legal.html` と `/foo` | `/v/` は viewer.html（200、`cache-control` を記録）、`/legal.html` は 200、`/foo` は index.html の 200、`/api/nothing` は 404 |
| 8 | Vercel ダッシュボード → Cron Jobs → `/api/cron/cleanup` を手動実行 | ログに 200 と `{assetsDeleted, orphanBlobsDeleted, sessionsDeleted}`。`CRON_SECRET` を外した状態の `curl` は 401 |
| 9 | 下書きで素材を差し替えて 15 分以上放置 → Cron 実行 | 旧素材が Blob から消え、公開版・下書きが参照する素材は残る |
| 10 | 2 アカウントで B-R3-01 の再現手順（修正後） | 他ユーザーの Blob URL を `register` に渡しても 400 で、被害者の素材が残る |
| 11 | `vercel logs` | `level: error` が出ていない。コールドスタート時の DB 接続エラーが無い |

---

# ラウンド 4（B-R3-01 と Minor 4 件の修正確認）

- 実施日: 2026-11-09
- 対象: コミット `6af34b4`（Fix B-R3-01: register assets by store-verified pathname only; kind-aware upload limits; timing-safe cron auth; embedded migrations）
- 判定: **条件付き合格**。Blocker 0 件、Major 0 件。B-R3-01 と M-R3-01〜04 の修正を確認し、ローカル構成（PGlite + ローカル素材）のデグレなし。条件は、Vercel 固有の挙動（Neon / Blob / Cron / CDN）と実機を本番 URL で確認すること（§R4-5）。

## R4-1. 自動テスト（再実行）

| コマンド | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | Vitest 53 件 すべて成功（`storage.test.ts` が追加: key 規約、他プロジェクト配下の拒否、埋め込み SQL と `server/migrations/*.sql` の同一性） |
| `npm run e2e` | 24 ステップ すべて成功、コンソールエラー 0 件 |
| `npm audit` | 0 件 |
| QA `api-tests.mjs`（ローカル構成） | 112 項目中 PASS 100 / SKIP 11（DB 直接確認は `r3-checks.mts` で実施）/ FAIL 1（TC-M6-03。ラウンド 3 と同じ検証側のスタブ要因。公開版不変は TC-M5-02 と開発者テストで確認） |
| QA `ui-tests-2.mjs` | 18 項目中 PASS 17 / FAIL 1（D-20、実機確認へ） |
| QA `r3-checks.mts`（PGlite + メモリアダプタ、ラウンド 4 向けに期待値を更新） | 29 項目すべて PASS（Blob アダプタの節は別スクリプト `r4-ssrf.mts` へ分離） |
| QA `r4-ssrf.mts`（Blob アダプタ、fetch スパイ付き） | 2 項目すべて PASS |
| QA `func-invoke.mjs`（`npx vercel build` の成果物を直接起動） | すべて期待どおり（§R4-3） |
| サーバログ | `level: error` 0 行 |

## R4-2. B-R3-01 の修正確認

`registerUploadedAsset` は `pathname` が `projects/<自分の projectId>/<要求 kind>/<name>` の規約（`isValidKey`）に一致することを必須にし、ストレージを **pathname で照会**（Blob は `head(pathname, {token})`）した結果の URL・サイズを正とする。クライアントの `url` は任意で照合のみ、Range GET は照会結果の Blob URL（`isBlobUrl` 検査）にのみ、削除は全経路で pathname 指定。

| ケース | 結果 |
| --- | --- |
| 外部 URL（QA のローカル HTTP サーバ）を `url` に渡す（Blob アダプタ + fetch スパイ） | 攻撃者サーバへの到達 0 件、Range fetch 0 件、登録なし。`stat` は自ストアの Vercel API への照会で止まる（本環境からは到達不可のため 15 秒で打ち切り） |
| 規約外の key（URL 文字列、`..`）を Blob アダプタの `stat` / `delete` に渡す | `stat` → null、`delete` → no-op、ネットワークに出ない |
| 自分の pathname + 他ユーザーの Blob URL、kind 不一致（メモリアダプタ） | 400、被害者の素材は残る（以前は後始末で削除されていた） |
| 自分の pathname + 他ユーザーの Blob URL、kind 一致 | 400（自分の pathname に実体が無い）、被害者の素材は残る |
| 他ユーザーの pathname を直接指定 | 400（接頭辞不一致）、被害者の素材は残る |
| 他プロジェクト配下 / `..` を含む pathname | 400 |
| 正規の自分の Blob: `url` 省略 | 201、`asset.url` はストア照会結果 |
| 正規の自分の Blob: `url` がストア照会結果と不一致 | 400「素材の URL が一致しません」、Blob は削除されない |
| Content-Type 偽装（GLB を `image/png`）/ 10 MB 超 | 400 / 413 で、自分の pathname の Blob のみ削除 |
| 未認証 / 他ユーザーのプロジェクト ID | 401 / 404 |

## R4-3. Minor 4 件の修正確認と新構成の再確認

| # | 確認 | 結果 |
| --- | --- | --- |
| M-R3-01 | `blob-upload` のトークンが `clientPayload.type`（video / image / model）ごとに上限と Content-Type を切り替える（`web/src/editor/api.ts` が `type` を送る）。type 未指定のオーバーレイはエラー | ○（コード確認。トークン発行は Blob 実環境でのみ実行可能） |
| M-R3-02 | `vercel.json` に `/(v\|p)/(.*)` → `Cache-Control: no-cache`。`.vercel/output/config.json` に `^(?:/(v\|p))(?:/(.*))$ {"Cache-Control":"no-cache"}` が生成される | ○ |
| M-R3-03 | マイグレーション SQL を `server/src/migrations.ts` に埋め込み、`includeFiles` を廃止。`npx vercel build` 成果物に `server/migrations` が無い状態で関数を直接起動し、`/healthz` 200（PGlite 自動マイグレーション成功）。埋め込み SQL と `.sql` の同一性は開発者テストで検証 | ○ |
| M-R3-04 | Cron の Bearer 比較が `timingSafeEqual`、401 は「認証に失敗しました」。未知の `/api/*` は `{"error":"ページが見つかりません"}` の 404 | ○ |
| デグレ確認 | TC-S 全件（未認証 401、他ユーザー 404、アップロード偽装、パストラバーサル、秘密情報なし、Cookie、CSRF、scrypt、XSS / CSV、エラー応答、audit 0）、未公開素材の非露出（D-01）、ログインロック / レート制限（DB）、Cron の 401 / 200 と掃除、容量上限、10 世代、JST、UI（ui-tests-2） | ○ |
| `npx vercel build` | 成功。`runtime: nodejs22.x`、`memory: 1024`、`maxDuration: 30`、rewrites / Cron はラウンド 3 と同一、ヘッダに `/(v\|p)/*` no-cache が追加 | ○ |
| 関数の直接起動 | `/healthz` 200 `{db:"pglite",storage:"local"}`、`/api/config` 200、Cron 401 / 401 / 200、`/api/public/<不明>` 404、`/a/<不明>` 404 | ○ |

## R4-4. 残存事項（すべて Minor / 記録。合否に影響しない）

- D-10 / D-13 / D-19 / D-20（ラウンド 2 の見送り 4 件）、D-11 残（`.warn-text` のコントラスト 4.23:1）、D-22 残（`checkOrigin` / `publicOrigin` の `X-Forwarded-Host` 参照。Vercel では `PUBLIC_ORIGIN` 設定を推奨）、R2-01（カメラが 2 回開かれる。実機で確認）。
- Blob 保存分は `sha256` を持たない（§13 合意）。Cron の掃除は下書き・公開版以外の素材を削除するため過去世代のロールバックで素材が無い（Q4 の仕様。NFR-5 との整理は次スプリント）。
- `@vercel/blob` の `head()` に pathname を渡す動作は本環境で実行できない（Vercel API に到達不可）。実デプロイの確認項目 3 で register が 201 になることをもって確認する。

## R4-5. 合格条件: 実デプロイ後にオーナーが確認する項目（最新版）

ラウンド 3 の §R3-6 を更新。`6af34b4` 以降をデプロイして実施し、結果をレポートに追記した時点で最終判定とする。実機チェックリスト（§R2-6 の 1〜14）は本番 URL で実施する。

| # | 確認項目 | 期待 |
| --- | --- | --- |
| 1 | `https://<host>/healthz` | `{"ok":true,"db":"pg","storage":"blob"}` |
| 2 | `npm run migrate`（Neon の pooled 接続文字列）を 2 回 | 1 回目 `applied: ["001_init.sql"]`、2 回目 `applied: []` |
| 3 | 作成画面で PNG（ターゲット）/ MP4（8 MB 超を含む）/ GLB / `.mind`（解析で自動）をアップロード | Network で Blob への PUT（8 MB 超は multipart）と `/api/projects/:id/assets/register` が 201。Blob URL に `-<random>` が付き、`register` の応答 `asset.url` がその URL と一致 |
| 4 | 画像を 11 MB、GLB を 21 MB でアップロード | ブラウザ側で拒否、または Blob トークン発行で拒否（種別ごとの上限 M-R3-01）。Blob に残骸が残らない（残っても Cron で削除） |
| 5 | Blob の URL を Cookie なしで `curl -I` | `access-control-allow-origin: *`（別オリジンの動画 / `.mind` / GLB の取得に必要）、`content-type` が正しい |
| 6 | 公開 → QR → 実機（§R2-6 の 1〜14） | 動画 / 画像 / 3D が表示され、計測が 1 / 1 / 1 |
| 7 | `curl -I -H 'Accept-Encoding: br' https://<host>/assets/<overlay chunk>.js`、Blob の `.mind` URL | 前者 `content-encoding: br`。後者は Blob の配信ヘッダを記録し、カメラ起動 3 秒を実機で計測 |
| 8 | `curl -I https://<host>/v/<slug>`、`/legal.html`、`/foo`、`/api/nothing` | `/v/` は viewer.html 200 で `cache-control: no-cache`、`/legal.html` 200、`/foo` は index.html 200、`/api/nothing` は 404 JSON「ページが見つかりません」 |
| 9 | Vercel ダッシュボード → Cron Jobs → `/api/cron/cleanup` を手動実行。`CRON_SECRET` なしの `curl` | ログに 200 と `{assetsDeleted, orphanBlobsDeleted, sessionsDeleted}`。`curl` は 401「認証に失敗しました」 |
| 10 | 下書きで素材を差し替えて 15 分以上放置 → Cron 実行 | 旧素材が Blob から消え、公開版・下書きが参照する素材は残る |
| 11 | 2 アカウントで B-R3-01 の再現手順（他ユーザーの Blob URL / pathname を `register` に渡す） | すべて 400 で、被害者の Blob が残る |
| 12 | `vercel logs` | `level: error` なし。コールドスタート時の DB 接続エラーなし |
