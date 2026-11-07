# アーキテクチャ

> 本書は開発者担当の成果物。本セクションの調査はマーケターのサービス要求（`docs/02_service_requirements.md`）の提出前に、一般的なノーコード AR サービス像を仮置きして実施した（2026-11-07）。調査完了時点で要求書が提出されており、その中核（印刷物をマーカーにした画像トラッキング、動画/画像/3D の表示、iOS Safari 必須、SLAM/VPS はスコープ外）は本調査の推奨構成（§5）と整合している。要件定義（`docs/03_requirements_spec.md`）は要求書を精読したうえで別途作成し、そのときに本書へ「採用アーキテクチャ」「設計詳細」セクションを追記する。

---

## 技術調査

### 0. 調査の前提（仮置きのサービス像）

要求が未確定のため、以下の一般的なノーコードARサービス像を前提に調査した。

- 制作者はブラウザ上のエディタで、3Dモデル / 画像 / 動画を「マーカー画像の上」または「床・壁などの平面上」に配置した AR 体験をノーコードで作成する。
- 作成した体験は URL / QR コードで公開する。
- 閲覧者はアプリをインストールせず、スマートフォンのブラウザ（iOS Safari / Android Chrome）から体験する。

### 1. プラットフォーム上の制約（最初に押さえるべき事実）

WebAR の技術選定は、ライブラリより先に **iOS と Android のブラウザが何を提供しているか** で大枠が決まる。

| 項目 | iOS Safari | Android Chrome |
| --- | --- | --- |
| WebXR Device API（ブラウザ内でのマーカーレス AR） | **非対応**。2026 年時点でも iOS/iPadOS Safari は `immersive-ar` / `immersive-vr` を提供していない（WebXR 対応は visionOS Safari のみ） [S1][S2] | 対応。ARCore 対応端末 + 「Google Play 開発者サービス（AR）」が必要 [S3] |
| OS 標準の AR ビューア | **AR Quick Look**（USDZ / .reality。iOS 12+）。Safari から `<a rel="ar">` で起動。3D モデル表示・配置・スケール・簡易バナーのみで、JS によるカスタム挙動は不可 [S4] | **Scene Viewer**（glTF/GLB。ARCore 必須）。model-viewer 等から Intent で起動 [S5] |
| カメラ映像へのアクセス（`getUserMedia`） | 対応（Safari のみ。iOS の他ブラウザも WebKit ベースで利用可） | 対応 |
| WebGL / WebGL2 | 対応 | 対応 |

含意:

- **マーカーレス（平面検出）AR をブラウザ内で動かせるのは Android Chrome のみ**。iOS では「AR Quick Look に USDZ を渡す」形になり、表示できるのは 3D モデル（+ 静止画テクスチャ）に限られ、動画・ボタン・クリック遷移などのカスタム挙動は載せられない。
- **画像トラッキング（マーカー型）はカメラ映像 + WebGL で動く JS ライブラリ方式のため、iOS / Android 両対応**できる。画像・動画・3D のいずれも自由に重ねられる。
- したがって「iOS でも Android でも同じ体験」を保証したいなら、MVP の主軸は **画像トラッキング型**、マーカーレスは **model-viewer 経由で OS 標準ビューアに委ねる（3D モデルのみ）** という二本立てが現実的。

### 2. WebAR 技術の選択肢と比較

#### 2.1 比較表

バージョン・更新日・ライセンスは npm registry（`npm view`）で 2026-11-07 に確認した値。

| 候補 | 最新版 / 最終更新 | ライセンス | 保守状況 | 画像トラッキング | マーカーレス（平面） | iOS Safari | Android Chrome | 所感 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@google/model-viewer` [S6][S7] | 4.4.0 / 2026-10-09 | Apache-2.0 | Google が継続開発。2026 年に 4.3.0, 4.3.1, 4.4.0 をリリース [S8] | × | ○（`ar-modes="webxr scene-viewer quick-look"` の優先順で WebXR → Scene Viewer → Quick Look にフォールバック）[S9] | ○（Quick Look。`ios-src` 未指定なら glTF から USDZ を自動生成。4.4.0 で iOS のサードパーティブラウザにも対応）[S8][S9] | ○（WebXR / Scene Viewer） | 3D モデルの「置いて見る」用途では最も手軽で堅い。画像/動画は不可（3D のテクスチャとしてなら可） |
| `mind-ar` (MindAR) [S10][S11] | 1.2.5 / 2024-01-16 | MIT | 個人メンテナ。最終コミット 2024-01。Issue 100 件超が未対応 [S11][S12] | ○（NFT 方式。複数ターゲット可。`.mind` ターゲットファイルはブラウザ内の `Compiler` で生成可能＝エディタ内で完結できる） | × | ○（カメラ + WebGL/TF.js） | ○ | 画像トラッキングのデファクト OSS。AR.js 自身が README で画像トラッキングは MindAR を推奨 [S13]。**ただし現行 three.js とそのままでは組み合わせ不可**（§3 参照） |
| `@ar-js-org/ar.js` (AR.js) [S13][S14] | 3.4.8 / 2026-03-16 | MIT（依存の artoolkit5-js は LGPLv3 + 追加許諾） | AR-js-org が保守中。2026-03 に 3.4.8（iPhone 向け位置情報 AR 修正等）[S14] | ○（NFT。ただしターゲット画像の事前処理ツールが別途必要）／○（Hiro・バーコード型マーカー） | ×（位置情報 AR はあり） | ○ | ○ | A-Frame 中心の設計で React/three.js アプリへの組み込みは扱いにくい。例示は three@0.164 に固定 [S13]。画像トラッキング目的なら MindAR の方が精度・導入ともに有利 |
| `three` + WebXR [S15][S16] | 0.187.0 / 2026-10-30 | MIT | 活発（月次リリース） | ×（自前実装は非現実的） | ○（`immersive-ar` + `hit-test`。公式例 `webxr_ar_hittest` あり）[S16] | ×（WebXR 非対応）→ Quick Look にフォールバックが必要 | ○ | 自由度最大。model-viewer の内部エンジンでもある。MindAR の three.js ビルドとも接続可能 |
| `aframe` (A-Frame) [S17][S18] | 1.8.0 / 2026-06-23 | MIT | 活発（1.8.0 で three r184 へ更新）[S18] | ×（AR.js / MindAR の A-Frame 拡張が必要） | ○（WebXR。Android のみ） | △（WebXR 非対応。3D 表示のみ） | ○ | 宣言的 HTML で手早いが、React エディタとの二重管理になる。閲覧ページ専用なら選択肢 |
| 8th Wall（Niantic） [S19][S20][S21] | — | エンジン枠組みは MIT（GitHub `8thwall/8thwall`）。SLAM を含む XR Engine バイナリは別途の限定利用ライセンス | **ホスト型サービスは 2026-02-28 で終了**。公開済み体験は 2027-02-28 まで稼働。以後は 8thwall.org の OSS として継続 [S19][S20] | ○（Image Targets は OSS に含まれる） | △（SLAM はクローズドなバイナリ配布のみ） | ○ | ○ | かつての商用デファクトだが、SaaS が無くなりセルフホスト前提になった。独自 SLAM で iOS でもブラウザ内マーカーレスが動く点は唯一無二だが、バイナリ依存・再配布条件・保守先行きがリスク |
| Zappar Universal AR (`@zappar/zappar-threejs`) [S22] | 4.3.0 / 2026-07-23 | ラッパーは MIT だがエンジンは商用（ドメイン登録 + ライセンスチェック） | 商用で継続 | ○ | ○（Instant World Tracking。iOS でも可） | ○ | ○ | 商用ライセンス費が乗る。iOS でブラウザ内マーカーレスが必須要件になった場合の有償代替 |

#### 2.2 各候補の補足所見

- **model-viewer**: Web Components なので React からは `<model-viewer>` タグを置くだけ。`canActivateAR` プロパティで「この端末で AR に入れるか」を事前判定でき、非対応端末には 3D ビューアとして表示できる [S9]。`ar-placement="wall"`（壁置き）、`ar-scale="fixed"`（実寸固定）など、ノーコードエディタの設定項目にそのまま対応付けられる属性が揃っている。three.js を `^0.183` に固定しているため、プロジェクト全体の three.js バージョンはこれに合わせる必要がある（§3）。
- **MindAR**: 画像トラッキングの OSS としては唯一実用水準で、A-Frame 用 / three.js 用 / コア（three 非依存）の 3 種のビルドを同梱。ターゲット画像のコンパイル（特徴点抽出）をブラウザ内で実行できるため、**エディタで画像をアップロード → その場で `.mind` を生成 → 保存**というノーコードフローが外部ツール無しで組める。一方で 2024-01 以降更新が止まっており、現行 three.js との非互換（削除済み API `sRGBEncoding` の import）が発生している。短期的には shim で回避可能（§3 で検証済み）だが、**中期的にはフォークして自前保守する前提**を持つべき。
- **AR.js**: 位置情報 AR（GPS）が必要になった場合の候補。画像トラッキングは MindAR に劣後。
- **three.js 直接利用**: Android の WebXR マーカーレスで「動画や画像を床に置く」「タップで URL に遷移する」といった model-viewer では実現できない表現を行う場合に必要。MVP では model-viewer に任せ、必要になった段階で three.js + `ARButton` + `hit-test` の閲覧ページを追加する拡張経路として位置づける。
- **8th Wall**: 2026-02 の SaaS 終了により「サービスに組み込んで売る」土台としては不確実性が高い。OSS 化された Image Targets は MindAR の代替候補になり得るが、XR Engine バイナリのライセンス条件（再配布・表示義務）を精査してからでないと採用できない。
- **Zappar / その他商用 SDK**: 「iOS でもブラウザ内でマーカーレスを動かしたい」という要求が出た場合のみ検討。費用が売価に直結するため、マーケター側で要否を確認したい。

### 3. 技術検証（スパイク）結果

本セッションの環境（Node v22.23.4 / npm 10.9.9、HTTPS はエージェントプロキシ経由）で、`Vite + React + TypeScript` プロジェクトを作り、候補ライブラリのインストール・ビルド・ヘッドレスブラウザ実行を検証した。検証コードはスクラッチパッド（`/tmp/claude-0/-home-user-nocode-ar/56dd9180-4a16-5bf4-983f-8a9d8f97776f/scratchpad/techspike/`）のみに置き、リポジトリには含めていない。

#### 3.1 手順

1. `npm create vite@latest app -- --template react-ts`（create-vite 9.3.4 → Vite 8.3.6 / React 19.3.1 / TypeScript 7.0.2）
2. `npm install @google/model-viewer three @types/three qrcode @types/qrcode`
3. `npm install --ignore-scripts mind-ar`
4. `App.tsx` に以下を実装: `<model-viewer ar ar-modes="webxr scene-viewer quick-look">` で GLB 表示、three.js でキューブ描画、`qrcode` で公開 URL の QR を DataURL 生成、`mind-ar` のコアビルドと three.js ビルドを dynamic import
5. `npm run build`（`tsc -b && vite build`）
6. Playwright（pre-installed）のヘッドレス Chromium 153 で `dist/` を静的配信して開き、`console.error` / `pageerror` / `requestfailed` を収集

#### 3.2 結果

| 項目 | 結果 | 備考 |
| --- | --- | --- |
| プロキシ経由の npm registry アクセス | **成功** | `registry.npmjs.org` は NO_PROXY 対象で直接到達。追加設定不要 |
| `@google/model-viewer@4.4.0` install | **成功** | 依存の `three` は `^0.183.0` に固定されるため、プロジェクトの `three` は 0.183.2 になる（最新 0.187 は使えない） |
| `three@0.183.2` / `@types/three` install | **成功** | `@types/three` は 0.187 が入ったが型チェックは通過。実運用では 0.183 系に揃える |
| `qrcode@1.5.4` install / 実行 | **成功** | ブラウザ内で DataURL 生成を確認（Node 側でも同じ API で PNG/SVG 生成可） |
| `mind-ar@1.2.5` install（通常） | **失敗** | 依存の `canvas@2.11.2` に Node 22（ABI 127）向けプレビルドバイナリが無く（GitHub Releases が 404）、node-gyp のソースビルドにフォールバックして失敗。プロキシ起因ではない |
| `mind-ar@1.2.5` install（`--ignore-scripts`） | **成功** | `canvas` は Node 側のターゲットコンパイル用で、ブラウザ実行には不要。本番では `overrides` で `canvas` を除外するか、フォーク版を使う |
| `vite build`（mind-ar three ビルドを素のまま import） | **失敗** | `mindar-image-three.prod.js` が three から削除済みの `sRGBEncoding` を import しており `MISSING_EXPORT` |
| `vite build`（互換 shim 適用後） | **成功** | Vite プラグインで mind-ar 配下からの `"three"` import だけを「`three` を re-export + `sRGBEncoding`/`LinearEncoding` 定数を追加した shim」に差し替え。ビルド 0.7 秒。主要チャンク: index 1.27 MB（gzip 369 KB）、mind-ar controller（TF.js 含む）1.08 MB（gzip 290 KB） |
| Playwright ヘッドレス Chromium | **成功（コンソールエラー 0 件）** | `<model-viewer>` 定義・GLB ロード完了（`loaded: true`）、three.js WebGL2 描画、QR 生成、`mind-ar` コア（`Controller`/`Compiler`）と three ビルド（`MindARThree`）の両方の import 成功を確認。警告は SwiftShader の `GPU stall due to ReadPixels` のみ（ヘッドレス GPU 固有）。`canActivateAR` は Linux デスクトップのため `false`（想定どおり） |

#### 3.3 検証から得た設計上の留意点

- **three.js のバージョンは model-viewer が決める**（現状 0.183 系）。独自 three.js コードや MindAR もこれに合わせる。
- **MindAR は依存・互換の手当てが必須**: (a) `canvas` をインストール対象から外す、(b) three 互換 shim、(c) 将来的にはフォーク。これを怠ると CI の Node バージョン更新で壊れる。
- **バンドルサイズ**: TF.js を含む MindAR は閲覧ページに 300 KB 近い gzip 後サイズを足す。閲覧ページは「マーカーレス（model-viewer のみ）」と「画像トラッキング（MindAR）」で**エントリを分け、必要な方だけ読み込む**構成にする。
- **AR 実機確認は自動化できない**: ヘッドレス Chromium では WebXR / Quick Look / カメラは検証できない。QA フェーズで iOS 実機（Safari）と ARCore 対応 Android 実機（Chrome）を用意する必要がある。開発中はローカル HTTPS（`@vitejs/plugin-basic-ssl` 等）が必須（カメラ・WebXR は secure context 限定）。
- **コンテンツ形式**: 3D モデルは glTF/GLB に統一（Quick Look 用 USDZ は model-viewer が自動生成）。画像は PNG/JPEG/WebP、動画は MP4(H.264)/WebM を想定し、サーバ側でサイズ制限・サムネイル生成を行う。

### 4. バックエンド / 永続化の選択肢

#### 4.1 MVP（外部サービス無しで動く構成）

| 層 | MVP 採用案 | 根拠 | 将来の置き換え先 |
| --- | --- | --- | --- |
| API サーバ | **Node 22 + Express 5**（`express@5.3.0` install 済み確認） | フロントと同じ TypeScript。単一プロセス・単一コンテナで完結 | Next.js API Routes / Hono / 任意の Node フレームワークに置換可 |
| データベース | **SQLite**。本環境で `better-sqlite3@13.0.3`（プレビルド有、動作確認済み）と Node 22 組み込みの `node:sqlite`（experimental 警告あり、動作確認済み）の両方が使えた。MVP は `better-sqlite3` を推奨 | ファイル 1 つ・サーバ不要・バックアップはファイルコピー。プロジェクト／シーン定義（JSON）／公開情報を保持 | PostgreSQL（Prisma / Drizzle 等の ORM を最初から挟んでおけば移行容易） |
| アセット（3D・画像・動画・`.mind`） | **ローカルファイルシステム**（`data/assets/<projectId>/...`）+ Express 静的配信（`multer` でアップロード受付） | 外部依存ゼロ。メタデータは SQLite | S3 / R2 / GCS（ストレージ抽象インタフェースを 1 枚挟む） |
| 認証 | MVP はメール + パスワードのセッション Cookie、またはマジックリンク（送信はログ出力で代替） | 要求次第。公開ページは認証不要 | OAuth（Google 等）/ Auth.js / Clerk |
| 公開 | 公開 ID（短い乱数 slug）付き URL `/v/<slug>` と、`qrcode` で生成した PNG/SVG | 静的に配信できる閲覧ページ + JSON シーン定義を返す API | CDN 配信、独自ドメイン |
| デプロイ | 単一 Docker イメージ（Node）+ ボリューム 1 つ | | Fly.io / Render / Cloud Run など |

#### 4.2 シーン定義データモデル（叩き台）

エディタと閲覧ページの間は **JSON のシーン定義**で疎結合にする。例:

```jsonc
{
  "version": 1,
  "mode": "image-tracking",         // "image-tracking" | "markerless"
  "target": { "imageAssetId": "...", "mindAssetId": "...", "widthMeters": 0.2 },
  "layers": [
    { "type": "model", "assetId": "...", "transform": { "position": [0,0,0], "rotation": [0,0,0], "scale": 1 } },
    { "type": "video", "assetId": "...", "transform": { ... }, "autoplay": true, "loop": true },
    { "type": "image", "assetId": "...", "transform": { ... }, "link": "https://..." }
  ],
  "placement": "floor"               // markerless 時: "floor" | "wall"
}
```

### 5. 推奨アーキテクチャ案（1 案に絞る）

#### 5.1 構成

```
[ブラウザ: エディタ]  React 19 + Vite + TypeScript
   ├ 3D プレビュー: three.js（model-viewer と同じ 0.183 系）
   ├ マーカー画像 → MindAR Compiler（ブラウザ内）で .mind 生成
   └ REST で保存                      ─┐
                                        │ JSON シーン定義 + アセット
[Node 22 + Express 5 + SQLite + ローカルファイル]  ←─┘
   ├ /api/projects, /api/assets (multer), /api/publish
   ├ /v/<slug>  閲覧ページ（静的 + シーン JSON）
   └ /qr/<slug>.png  (qrcode)

[ブラウザ: 閲覧ページ（スマホ、アプリ不要）]
   ├ mode=markerless     → <model-viewer ar ar-modes="webxr scene-viewer quick-look">
   │                         Android: WebXR/Scene Viewer、iOS: Quick Look（USDZ 自動生成）
   └ mode=image-tracking → MindAR(three.js ビルド, shim 適用) + three.js
                             iOS/Android 共通。画像・動画・3D をマーカー上に表示
```

#### 5.2 選定理由

1. **両 OS で「アプリ不要」を満たせる最小構成**。iOS に WebXR が無い以上、マーカーレスは OS 標準ビューア（Quick Look / Scene Viewer）に委ねるのが唯一の無料・無依存の手段で、それを 1 タグで吸収するのが model-viewer。画像トラッキングは MindAR で両 OS に同一体験を提供できる。
2. **すべて OSS（Apache-2.0 / MIT）で、商用 SaaS への依存が無い**。8th Wall の SaaS 終了が示すとおり、商用 WebAR 基盤への依存は事業リスクになる。
3. **three.js を共通基盤にできる**。エディタのプレビュー、MindAR の three ビルド、model-viewer の内部がすべて three.js なので、座標系・glTF ローダ・マテリアルの知識を一箇所に集約できる。
4. **本環境で install / build / ヘッドレス実行まで通ることを確認済み**（§3）。既知の落とし穴（`canvas`、`sRGBEncoding`）にも回避策がある。
5. **バックエンドは Express + SQLite + ローカルファイル**で MVP は完全自己完結。ストレージと DB の抽象層を薄く挟み、後から S3 / PostgreSQL に差し替える。

#### 5.3 MVP 実装の工数感（相対値。閲覧ページ marker-less = 1.0）

| 作業 | 相対工数 | メモ |
| --- | --- | --- |
| 閲覧ページ（マーカーレス: model-viewer） | 1.0 | 属性を JSON から流し込むだけ。最も小さい |
| 閲覧ページ（画像トラッキング: MindAR + three） | 2.0 | 動画テクスチャ、iOS の自動再生制約（ユーザー操作後に再生）、ローディング UI |
| エディタ（アセット登録、配置 UI、プレビュー、保存） | 4.0 | 最大のかたまり。three.js の TransformControls で位置・回転・スケールを編集 |
| ターゲット画像コンパイル（ブラウザ内 `.mind` 生成 + 品質警告） | 1.0 | MindAR Compiler をそのまま利用。処理時間が長い（数十秒）ので進捗表示が要る |
| バックエンド（API、SQLite、アップロード、公開 slug、QR） | 2.0 | 定型。アップロード上限とファイル検証を含む |
| 認証（最小） | 1.0 | 要求次第で変動 |
| MindAR 互換対応（shim、`canvas` 除外、CI） | 0.5 | 検証済み手法の適用 |
| 実機 QA 環境（HTTPS 開発サーバ、iOS/Android 実機手順書） | 0.5 | QA と共同 |
| **合計** | **約 12** | エディタの UI 要求の幅で ±30% |

#### 5.4 主なリスクと対策

| リスク | 対策 |
| --- | --- |
| MindAR が保守停止している | フォーク前提。three 互換 shim を最初から組み込む。代替として 8th Wall OSS の Image Targets、商用なら Zappar を控えに置く |
| iOS でマーカーレスに画像・動画・リンクを置けない | 要求として「iOS のマーカーレスは 3D モデルのみ」を明示するか、マーカーレス要件を Android 限定にする。マーケターに確認（§6） |
| ARCore 非対応 Android 端末 / 古い iOS | `canActivateAR` 判定で 3D ビューア表示にフォールバック。対応端末条件を利用規約に明記 |
| 閲覧ページの初期ロードが重い（TF.js） | エントリ分割、`.mind` と TF.js の事前ロード、アセットの最大サイズ制限 |
| USDZ 自動生成の品質（マテリアル再現） | 高品質が必要な案件向けに `ios-src`（USDZ 手動アップロード）を任意項目として用意 |

### 6. マーケターへの確認事項（要求定義に反映してほしい点）

1. 「マーカーレス」で iOS 閲覧者にも画像・動画を見せる必要があるか（必要なら商用 SDK か、擬似 AR（カメラ背景 + 端末姿勢）で妥協するかの判断が要る）。
2. 対応端末の下限（iOS バージョン、ARCore 非対応端末の扱い）。
3. 公開体験ごとのアセット上限（容量・点数）と、動画の有無。
4. 複数マーカー（1 体験に複数ターゲット）の要否。
5. 制作者の認証方式と、チーム共有の要否。

### 出典

- [S1] Babylon.js forum「WebXR AR with Safari on iOS」（iOS Safari は WebXR 非対応）: https://forum.babylonjs.com/t/webxr-ar-with-safari-on-ios/34570
- [S2] VR.org「WebXR Interop 2026」（2026 年時点で iOS Safari に WebXR 無し、visionOS のみ）: https://vr.org/articles/webxr-interop-2026-cross-browser-standard
- [S3] Google ARCore「WebXR requirements」（ARCore 対応端末 + Google Play Services for AR + secure context）: https://developers.google.com/ar/develop/webxr/requirements
- [S4] Apple「AR Quick Look」（iOS 12+ / USDZ / .reality、Safari からの起動）: https://developer.apple.com/augmented-reality/quick-look/
- [S5] Google「Scene Viewer」: https://developers.google.com/ar/develop/scene-viewer
- [S6] npm `@google/model-viewer`: https://www.npmjs.com/package/@google/model-viewer
- [S7] GitHub google/model-viewer（Apache-2.0）: https://github.com/google/model-viewer
- [S8] model-viewer Releases（4.3.0 / 4.3.1 / 4.4.0）: https://github.com/google/model-viewer/releases
- [S9] model-viewer ドキュメント（`ar-modes`, `ar-placement`, `ios-src`, `canActivateAR`）: https://modelviewer.dev/docs/index.html （本文は https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/docs.json で確認）
- [S10] npm `mind-ar`: https://www.npmjs.com/package/mind-ar
- [S11] GitHub hiukim/mind-ar-js（MIT、個人メンテ）: https://github.com/hiukim/mind-ar-js
- [S12] mind-ar-js コミット履歴（最終 2024-01-16）: https://github.com/hiukim/mind-ar-js/commits/master
- [S13] GitHub AR-js-org/AR.js（MIT、artoolkit5-js は LGPLv3、画像トラッキングは MindAR を案内）: https://github.com/AR-js-org/AR.js
- [S14] AR.js Releases（3.4.8, 2026-03-16）: https://github.com/AR-js-org/AR.js/releases
- [S15] npm `three`: https://www.npmjs.com/package/three
- [S16] three.js 公式例 `webxr_ar_hittest`: https://github.com/mrdoob/three.js/blob/dev/examples/webxr_ar_hittest.html
- [S17] npm `aframe`: https://www.npmjs.com/package/aframe
- [S18] A-Frame 1.8.0 リリース記事: https://aframe.io/blog/
- [S19] Road to VR「Niantic's WebAR Creation Platform '8th Wall' Goes Open Source as Hosted Services Go Offline」: https://roadtovr.com/niantic-webar-platform-8th-wall-open-source/
- [S20] Niantic Spatial「8th Wall open source」: https://info.nianticspatial.com/blog/8th-wall-open-source
- [S21] 8th Wall「Open Source」ドキュメント / 移行 FAQ: https://8thwall.org/docs/open-source , https://www.8thwall.com/docs/migration/faq/
- [S22] npm `@zappar/zappar-threejs`: https://www.npmjs.com/package/@zappar/zappar-threejs
- [S23] npm `qrcode`: https://www.npmjs.com/package/qrcode
- [S24] Apple WWDC25「HTML model element（visionOS 26 Safari）」: https://developer.apple.com/videos/play/wwdc2025/237

> 注: 本セッションのネットワーク制限により modelviewer.dev、developers.google.com、8thwall.org、webkit.org、caniuse.com 等は直接取得できなかった。これらの出典は検索結果の抜粋および GitHub 上の一次ファイルで裏取りしている。要件定義フェーズで必要に応じて再確認する。
