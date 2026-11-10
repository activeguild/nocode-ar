# 01. 市場調査 — ノーコード AR / WebAR

- 作成日: 2026-11-07
- 作成者: マーケター
- 調査方法: Web 検索（複数クエリ）。検索結果スニペットと要約をもとに記述し、各節末尾に出典 URL を列挙する。
- 注意: 本セッションの環境では外部サイトの本文取得（WebFetch）が制限されていたため、数値は検索結果に表示された範囲のみを採用した。一次資料で未確認のものには **[要確認]** を付した。出典のない数値は書かない。見つからなかった情報は「不明」とする。

---

## 1. 市場規模・成長率

### 1.1 世界（WebAR / WebXR）

| 指標 | 数値 | 出典 |
| --- | --- | --- |
| WebAR 市場（アプリ型 AR・ヘッドセットを除く） | 2025 年 25.0 億 USD → 2034 年 115.2 億 USD、CAGR 18.5%（2026–2034） | TrendX Insights [1] |
| WebXR / ブラウザベース没入プラットフォーム市場（WebAR より広い定義） | 2025 年 49.2 億 USD → 2026 年 65.9 億 USD → 2031 年 192.8 億 USD、CAGR 23.95%（2026–2031） | Mordor Intelligence [2] |
| AR マーケティングサービス市場 | CAGR 15.49%（2026–2031） | Mordor Intelligence [3] |
| AR 全体（定義が広く数値が大きい） | 2025 年 989.7 億 USD → 2026 年 1,402.3 億 USD（CAGR 41.7%） | The Business Research Company（GII 経由）[4] |
| モバイル AR | CAGR 30.2%（2025–2030） | Technavio [5] |
| 小売向け AR（世界） | 2025 年 約 78.4 億 USD、CAGR 32.4%（2025–2035） | DRI（bizwit）[6] |

**所見**
- WebAR 単体の推定は少なく、調査会社によって定義・数値が大きく異なる。「WebAR に限ると 2025 年で数十億 USD 規模、年 18〜24% 成長」が最も直接的な推定。
- 成長率の高さよりも、「定義がぶれる市場であり、数字を鵜呑みにできない」ことを前提に置く。レポート本文は未取得のため、方法論は **[要確認]**。

### 1.2 日本

| 指標 | 数値 | 出典 |
| --- | --- | --- |
| 国内 法人向け XR コンテンツ市場（2024 年） | 264 億 6,500 万円（推計） | 矢野経済研究所（MONOist 記事経由）[7] |
| 国内 XR デバイス市場（台数） | 2024 年 約 45.6 万台 → 2030 年 87 万台予測 | 矢野経済研究所 [8] |
| 国内 AR/VR/MR ヘッドセット出荷（2024 年通年） | 48.6 万台、前年比 14.8% 減 | IDC Japan（EE Times 記事経由）[9] |
| 日本 AR ショッピング市場 CAGR | 26.0%（分析期間は不明） | Global Industry Analysts（GII 経由）[10] |
| 国内 WebAR 市場規模 | **不明**（国内 WebAR に特化した公開調査は見つからなかった） | — |

**所見**
- 日本はデバイス（ヘッドセット）出荷が伸び悩む一方、法人向けコンテンツ需要は堅調（MONOist 見出し）。スマホで完結する WebAR は、デバイス普及に依存しない点で国内環境に合う。
- 国内 WebAR 市場の金額ベースの一次データは存在しない（または有料レポート内）。市場規模の精緻化は PMF 検証の優先事項ではないため、本資料では「不明」として扱う。

**出典**
- [1] https://trendxinsights.com/syndicated-market-research-reports/webar-market/
- [2] https://www.mordorintelligence.com/industry-reports/webxr-and-browser-based-immersive-platform-market
- [3] https://www.mordorintelligence.com/industry-reports/ar-marketing-services-market
- [4] https://www.giiresearch.com/report/tbrc1984933-augmented-reality-global-market-report.html
- [5] https://technavio.com/report/mobile-augmented-reality-market-industry-size-analysis
- [6] https://www.dri.co.jp/auto/report/bizwit/260219-global-augmented-reality.html
- [7] https://monoist.itmedia.co.jp/mn/spv/2508/14/news035.html
- [8] https://www.yano.co.jp/press-release/show/press_id/3688
- [9] https://eetimes.itmedia.co.jp/ee/articles/2508/18/news043.html
- [10] https://www.gii.co.jp/report/go1785755-augmented-reality-ar-shopping.html

---

## 2. 競合環境

### 2.1 2025〜2026 年の構造変化: 大手プラットフォームの相次ぐ撤退

この 2 年で、ノーコード／ローコード AR 制作の主要プラットフォームが立て続けに終了・縮小した。**既存ユーザー（特に代理店・制作会社・自治体）の「作り直し需要」と「長期運用への不安」が同時に発生している**のが現在の最大の市場特性。

| プラットフォーム | 出来事 | 時期 | 出典 |
| --- | --- | --- | --- |
| Meta Spark（Instagram/Facebook の AR フィルタ） | サードパーティ製エフェクト・制作ツール終了。クリエイターは資産の保存を求められた | 2025-01-14 | [11][12] |
| Adobe Aero | iOS/Android/デスクトップで動作停止。コンテンツ DL 期限 2025-12-03、サーバーデータ削除 2025-12-16 | 2025-11-06 | [13][14] |
| Niantic 8th Wall | ホスト型サービス（ログイン、クラウドエディタ、XR Studio）終了。エンジンは MIT ライセンスで OSS 化（8thwall.org）。SLAM・VPS・Maps・ハンドトラッキングは OSS に含まれない。ホスト済み体験は 2027-02-28 まで稼働 [要確認] | 2026-02-28 | [15][16][17][18] |
| Onirix | 2025 年 9 月に閉鎖を発表、サービスは 2026-09-01 まで、とされる（**競合 ARLOOPA のページが唯一の出典。要確認**） | 2025-09 発表 | [19] |

**示唆**
- 8th Wall 終了前の料金は「商用ライセンス 700 USD/プロジェクト/月（2024 年 9 月に 3,000 USD から値下げ）」「Pro 99 USD/月（年払い）」だった [20][21]。この価格帯の顧客（代理店・ブランド）が行き場を探している。
- 競合各社（Blippar、Zappar、ARLOOPA、Kivicube、AR Code）は「8th Wall からの移行先」を訴求して獲得合戦中 [22][23][24]。
- 自治体・長期キャンペーン向けの国内記事では、提供終了リスクを踏まえ「自社ドメインで配信できる構成」が推奨されている [25]。→ **「終了しても体験が消えない」「エクスポートできる」ことが差別化要素になり得る**。

### 2.2 海外競合

| サービス | 価格（確認できた範囲） | 機能・特徴 | 主なターゲット | 弱点（調査から見える範囲） | 出典 |
| --- | --- | --- | --- | --- | --- |
| **Zappar / ZapWorks（Designer, Studio, Mattercraft）** | 情報が錯綜。Capterra: Basic 35 USD/席/月、Pro 99 USD/席/月（年払い）。SourceForge: Starter 816 USD/年、Pro 5,496 USD/年。G2: Pro 3,060 USD/年。Enterprise は個別見積 [要確認]。Pro 超過は 1,000 ビューあたり 30 USD（Banuba 比較） | Designer はノーコード、Studio は JS 必須。Mattercraft は 3D Web ツール。2025-11 に WebXR 対応。MultiSet の VPS と提携（2025-12）。Infinite Reality による買収報道あり [要確認] | 代理店、ブランド、教育 | 料金体系が複雑。Pro まで Zappar ブランドのドメイン、完全ホワイトラベルは Enterprise のみ。高機能側はコードが必要 | [26][27][28][29][30][31] |
| **Blippar（WebAR SDK / Blippbuilder）** | 従量課金、1,000 ビューあたり 0.01 USD〜と記載 [要確認]。無料トライアル 100 ビュー | 面・顔・マーカー追跡。8th Wall 移行先を自称 | 開発者、代理店、FMCG パッケージ | 第三者サイトに「プラットフォーム刷新のため新規契約を停止中」との記載あり（調達リスク）[要確認]。Enterprise は個別見積 | [32][33][22] |
| **MyWebAR（DEVAR）** | 無料 Creator: 5 プロジェクト、年 100 ビュー、非商用のみ。有料入口は 25 USD/月（年払い）または 39 USD とサイトにより相違 [要確認]。Ultimate 250 USD/月（年払い）。Enterprise 個別 | ノーコード Web エディタ。有料でロゴ非表示・独自ドメイン・カスタムコード（three.js） | 中小、マーケター、教育 | 無料枠は商用不可。日本語サポートは不明 | [34][35][36] |
| **Aryel** | 個別見積（公開価格なし） | ノーコード、マーケティング向け。無料トライアル | ブランド、代理店 | 価格が不透明 | [37][38] |
| **ARLOOPA Studio / Kivicube / AR Code** | 不明（8th Wall・Onirix 代替として訴求中） | ノーコード系 | 代理店、中小 | 情報が自社マーケ記事中心で客観評価が乏しい | [19][23][24] |
| **Snap Lens Studio / TikTok Effect House** | 無料（プラットフォーム内） | ソーシャル AR フィルタ。Meta Spark 終了後の受け皿 | クリエイター、ブランド | 各 SNS アプリ内限定。印刷物や自社サイトとの連携には不向き | [12] |
| **8th Wall OSS（8thwall.org）** | 無料（MIT） | エンジン OSS。SLAM/VPS/ハンド追跡は非含有 | 開発者 | ノーコードではなく、ホスティングも自前 | [15][16] |

### 2.3 日本の競合

| サービス | 提供元 | 価格（確認できた範囲） | 機能・特徴 | 主なターゲット | 弱点 | 出典 |
| --- | --- | --- | --- | --- | --- | --- |
| **palanAR（パラナル）** | 株式会社 palan | 公式: フリー 0 円（AR 作成数 3）、レギュラー 月額 38,500 円（税込）。プレミアムオプションは 1 AR あたり月額 38,500 円〜。第三者記事の「ライト 9,800 円 / スタンダード 39,800 円」は公式ページで確認できず | ファイルをアップロードするだけで WebAR 作成。コード編集機能も追加。LINE 公式アカウント連携の観光 AR マップ事例あり | 企業マーケ、自治体、制作会社 | 月額 38,500 円は中小・単発キャンペーン用途には高い。無料枠は 3 AR | [39][40][41][42] |
| **LESSAR（レッサー）** | クラウドサーカス株式会社（Cloud CIRCUS） | フリープランあり（2022 年記事）。単体「0 円〜」、クリエイティブ企業向けパック「Cloud CIRCUS for Creative」月額 150,000 円〜（COCOAR・LESSAR・ActiBook 等を含む）。第三者サイトでは最低利用期間 1 年と記載 [要確認] | アプリ不要の WebAR。3D オブジェクト、クーポン・イベント情報、QR 起動の画像認識 AR。導入 8,500 社以上（第三者サイト）[要確認] | 印刷会社、制作会社、企業マーケ | MA スイート（Cloud CIRCUS）の一部で、AR 単体ユーザーには重い。有料プランの単価・無料枠の制限が公開情報で分かりにくい | [43][44][45][46] |
| **COCOAR** | クラウドサーカス株式会社（旧スターティアラボ） | フリープランあり（2022 年記事）。有料価格は不明 | **専用アプリ型** AR。印刷業を中心に 1,300 社以上に導入（2017 年時点）。中小印刷会社（ホクト印刷など）が印刷物 +AR 提案に採用 | 印刷会社とその顧客 | 専用アプリのインストールが必要（体験の離脱要因） | [47][48][49] |
| **STYLY** | STYLY 株式会社 | STYLY Business 月額 98,000 円（税別）、Enterprise 要問合せ | 都市・空間スケールの XR プラットフォーム。AUGGIE Awards 2024 受賞 | 自治体、都市開発、クリエイター | 価格が高く、印刷物・販促用途のライトな AR には過剰 | [50] |
| **ダイオーミウラ、テンプリント、ZETTAI WORKS 等** | 印刷会社・制作会社 | 不明 | 印刷物に QR を組み込んで 3D/動画を表示（アプリ不要）、「QR レス AR」、グラフィック認識 AR など、**受託**で提供 | 印刷物発注企業 | SaaS ではなく受託。発注側が自分で作り直せない | [51][52][53] |

### 2.4 競合まとめ

- 海外勢は「代理店・開発者向け（コード前提、USD 建て、英語）」か「安価だが商用制限のあるノーコード」に二極化。日本語 UI・日本の商習慣（請求書払い、LINE 連携、QR 文化）に合うものは少ない。
- 国内勢は (a) palanAR: 月 38,500 円から、(b) LESSAR/COCOAR: MA スイートまたは印刷会社経由、(c) STYLY: 月 98,000 円の空間 XR、(d) 受託制作、に分かれる。**「月 1 万円前後で、自分で作って、アプリ不要で配れる」ポジションは相対的に空いている**（ただし LESSAR の無料枠と palanAR の無料枠の実力は要実機検証）。
- 2025〜2026 年の終了ラッシュで、「提供終了リスクの低さ」「作った AR を手元に残せること」が購買判断に入るようになった。

**出典**
- [11] https://www.auganix.org/?p=16067
- [12] https://www.tubefilter.com/2024/08/27/meta-shutting-down-spark-ar-augmented-reality-platform/
- [13] https://helpx.adobe.com/my_ms/aero/faq.html
- [14] https://www.xrtoday.com/?p=58555
- [15] https://info.nianticspatial.com/blog/8th-wall-open-source
- [16] https://roadtovr.com/niantic-webar-platform-8th-wall-open-source/
- [17] https://forum.8thwall.com/t/important-changes-to-8th-wall-business/8578
- [18] https://www.moguravr.com/?p=302403
- [19] https://studio.arloopa.com/compare/arloopa-studio-vs-onirix
- [20] https://info.nianticspatial.com/blog/new-commercial-license-pricing
- [21] https://8thwall.com/pricing
- [22] https://www.blippar.com/?p=2968
- [23] https://www.kivicube.com/blog/?p=19060
- [24] https://ar-code.com/blog/8th-wall-is-shutting-down-timeline-impact-and-the-best-8th-wall-alternative-for-webar
- [25] https://www.issoh.co.jp/md/column/2231
- [26] https://www.capterra.com/p/163574/ZapWorks/
- [27] https://www.sourceforge.net/software/product/ZapWorks
- [28] https://www.g2.com/products/zapworks/pricing
- [29] https://www.banuba.com/blog/web-ar-sdk-pricing
- [30] https://updates.zap.works/webxr-support-arrives-in-mattercraft-and-designer
- [31] https://www.packworld.com/coding-printing-labeling/package-printing/news/22922957/infinite-reality-ir-infinite-reality-acquires-zappar-strengthening-its-immersive-technology-suite
- [32] https://www.blippar.com/?p=2958
- [33] https://www.rfp.wiki/design-multimedia/augmented-reality-development-software/blippar
- [34] https://mywebar.com/pricing/
- [35] https://mywebar.com/blog/important-changes-to-mywebar-subscription-plans
- [36] https://www.capterra.com/p/204566/MyWebAR/
- [37] https://capterra.com/p/228393/Aryel/
- [38] https://www.spotsaas.com/product/aryel/alternatives/better-pricing
- [39] https://palanar.com/price
- [40] https://crexgroup.com/ja/xr/ar/palanar-pricing-guide/
- [41] https://palan.co.jp/news/AN6ZcGnK
- [42] https://prtimes.jp/main/html/rd/p/000000010.000028239.html
- [43] https://www.moguravr.com/?p=165287
- [44] https://www.itreview.jp/products/cloud-circus/price
- [45] https://www.krowdbase.com/software/lessar
- [46] https://saas.imitsu.jp/cate-marketing-automation/service/2045/price
- [47] https://weekly.ascii.jp/elem/000/001/509/1509027/
- [48] https://newswitch.jp/p/18384
- [49] https://mono.ipros.com/product/detail/2000323094
- [50] https://styly.inc/?p=6557
- [51] https://pc.watch.impress.co.jp/docs/release/atpress/2072772.html
- [52] https://webtan.impress.co.jp/r/prtimes/items/000000009.000023144
- [53] https://webtan.impress.co.jp/r/prtimes/items/000000013.000170310

---

## 3. 顧客セグメント候補とペイン

| # | セグメント | 想定ユースケース | 観測されたペイン / 事実 | 購買力・意思決定 | 出典 |
| --- | --- | --- | --- | --- | --- |
| A | **印刷・パッケージ（中小印刷会社と、その顧客）** | チラシ・パンフ・名刺・パッケージに QR → AR | ペーパーレス化とネット印刷で価格競争が激化し、印刷物に付加価値を付ける手段として AR に注目（ホクト印刷、三和印刷社）。既存は専用アプリ型 COCOAR が中心 | 印刷会社は「再販・提案」側。単価は低いが案件数が多い | [48][52][47] |
| B | **イベント・展示会（出展企業、イベント制作会社）** | ブース・パネル・配布物で AR 体験、リード獲得、フォトスポット | 出展側は「声かけ数・名刺数」の量に注力する一方、来場者が評価するのは「質」の体験（展示会白書）。来場者 400 人調査では約半数が導入検討中。ノベルティ・ゲーム型ブースがリードを増やした事例報告。国内イベントのアプリ不要 WebAR 事例（大相撲いるま場所、2026-04）、QR×デジタルガチャのリード獲得サービス（2026-07）が登場 | 展示会は年間予算が確保され、1 回あたり数十万〜の制作費が動く（金額の一次データは不明）。意思決定は担当者レベルで速い | [54][55][56][57][58][59] |
| C | **観光・自治体** | AR スタンプラリー、観光マップ、地域 DX | 「AR システム構築は専門知識が必要で難易度が高い」（学術資料）。提供プラットフォーム終了リスクが懸念され、自社ドメイン配信が推奨されている。総務省が「没入型技術導入の手引き 2026」を公表し、観光・地域活性化が課題領域として明記 | 予算は公的資金で、調達が年度単位・入札。PMF 検証サイクルとしては遅い | [60][25][61] |
| D | **小売・EC** | 3D 商品の試し置き、バーチャル試着 | 「3D/AR 付き商品は CV 94% 向上」は 2022 年の Shopify 由来とされ、2025 年の一次資料は未確認 [要確認]。Shopify は model-viewer ベースの無料 3D ビューアを提供。国内はニッセンの家具 AR（2022）などがあるが効果数値は不明 | 既に無料の標準機能（Shopify、model-viewer）があり、差別化は 3D モデル制作側に移っている | [62][63][64] |
| E | **不動産・建築** | 住宅展示場、内見、完成予想 | 非対面接客需要、移動時間削減が導入背景。事例は多いが VR 寄りで、受託開発が中心 | 単価は高いが VR/3D 制作の比重が大きく、ノーコード WebAR の守備範囲外になりやすい | [65][66] |
| F | **教育** | 教材・校内展示 | 国内の 2025 年事例・課題の一次情報は **不明** | 予算小、意思決定が遅い | — |
| G | **マーケティング代理店・制作会社** | クライアント向けキャンペーン AR | 8th Wall・Aero・Spark・Onirix の終了で「作り直し・乗り換え」が発生。海外では WebAR キャンペーン予算は 15,000〜85,000 GBP の幅（英代理店の例）、3D 制作が予算の 2/3 を占めることもある。国内の制作費相場は **不明** | 支払い能力は高いが、コード制御を求める層が多く、ノーコード MVP では要求を満たしにくい | [22][67][68][69] |

**出典**
- [54] https://forbesjapan.com/articles/detail/100584
- [55] https://webtan.impress.co.jp/r/prtimes/items/000000004.000078256
- [56] https://wavecnct.com/ja/blogs/raijosha-o-hikitsukeru-tenjikai-busu-no-kurieitibu-na-aidea
- [57] https://aeo.washinmura.jp/ai/%E3%82%B7%E3%83%B3%E3%82%AF%E3%83%AC%E3%82%A4%E3%83%A4%E6%A0%AA%E5%BC%8F%E4%BC%9A%E7%A4%BE/en/news/2026-04-30-regional-dx-commemorative-photos-with-yo
- [58] https://zaikei.co.jp/releases/3511560/
- [59] https://conference.vrsj.org/ac2025/program/doc/2B2-02.pdf
- [60] https://www.yatex.org/gitbucket/HiroseLabo./2021-fumiya/raw/master/paper/c119115-thesis.pdf
- [61] https://www.soumu.go.jp/main_content/001080024.pdf
- [62] https://ufo3d.com/?p=11198
- [63] https://www.shopify.com/jp/blog/ar-commerce
- [64] https://netshop.impress.co.jp/index%2Ephp/g/ar
- [65] https://crexgroup.com/ja/xr/ar/ar-in-real-estate/
- [66] https://crexgroup.com/ja/xr/ar/souken-real-estate-2/
- [67] https://visualise.com/services/augmented-reality
- [68] https://itrexgroup.com/blog/augmented-reality-cost-factors-examples/
- [69] https://www.utsubo.com/ja/blog/webar-brand-campaigns-guide

---

## 4. 日本市場の特徴

| 項目 | 事実 | 出典 |
| --- | --- | --- |
| スマートフォン世帯保有率 | 2025 年 91.8%（モバイル端末全体 97.1%）。テレビ（90.1%）を初めて上回った | 総務省 令和 8 年版 情報通信白書 [70][71] |
| インターネット利用率（個人） | 2025 年 85.7%、端末別ではスマートフォンが 74.3% | 同上 [70] |
| QR コード文化 | QR 決済アプリ利用率 約 68%（2024-04、Statista）。屋外広告の QR を直近 1 年で読み取った経験は 29.8%（20〜59 歳 800 人、調査時期不明） | [72][73] |
| LINE | 国内 MAU 1 億ユーザー突破（2025 年 12 月時点、LINE ヤフー公式） | [74] |
| アプリインストール忌避 | 国内で「AR のためのアプリインストールによる離脱率」を示す定量調査は **不明**。一般論として「Web→アプリ移行の途中離脱」が指摘される（AppsFlyer）。国内 WebAR 解説記事はアプリ不要を主要な利点として訴求 | [75][69] |
| 印刷業の動き | 印刷物減少・価格競争のなか、中小印刷会社が印刷 +AR 提案に取り組む。QR 起動・アプリ不要の仕組みが「導入ハードルを下げる」と訴求 | [48][52] |
| 行政の後押し | 総務省「社会課題の解決に向けた没入型技術導入の手引き 2026」（自治体・観光・地域活性化を含む） | [61] |

**示唆**
- 「スマホはほぼ全員が持っている」「QR で URL を開く行動は（特に決済を通じて）定着している」「LINE は実質的な国民インフラ」。この 3 点から、**QR → ブラウザ → AR → LINE/フォームで接点化**という導線は日本で自然に機能する。
- 逆に「アプリをもう 1 本入れてもらう」導線は、COCOAR 型の既存勢の弱点として攻められる。

**出典**
- [70] https://www.soumu.go.jp/johotsusintokei/whitepaper/ja/r08/html/nd21b120.html
- [71] https://www.cross-m.co.jp/column/digital_marketing/dmc20260619
- [72] https://statista.com/statistics/1440624/japan-usage-rate-qr-code-payment-apps
- [73] https://webtan.impress.co.jp/r/prtimes/items/000000647.000018991
- [74] https://www.lycorp.co.jp/ja/story/20260210/line_100million.html
- [75] https://www.appsflyer.com/ja/blog/measurement-analytics/web-to-app-conversion-leak/

---

## 5. 技術トレンド

| 項目 | 現状（2026 年時点で確認できた範囲） | サービス設計への影響 | 出典 |
| --- | --- | --- | --- |
| WebXR（immersive-ar） | Android Chrome は ARCore 経由で対応。**iOS Safari は WebXR AR 非対応**で、Apple は AR Quick Look（USDZ）経由を維持。2026 年時点でも変更の発表なし | iPhone で動かすには WebXR に依存しない方式（カメラ映像 + JS 画像認識、または Quick Look へのフォールバック）が必須 | [76][77][25] |
| model-viewer / AR Quick Look / Scene Viewer | Shopify の 3D ビューアは Google model-viewer ベース。GLB/USDZ で iOS/Android 両対応の「床置き」が実現できる | 3D モデルの床置きは標準技術で低コストに実装可能。差別化にはならないが「できて当然」の機能 | [63][78] |
| 画像トラッキング（OSS） | MindAR は iOS Safari でも動作し性能評価が良い一方、AR.js は追跡品質が弱いとの声。両者とも「メンテナンスが止まっている」との指摘あり [要確認]。iOS Safari ではカメラ利用に HTTPS 必須、video に playsinline/muted が必要 | 印刷物をターゲットにした AR は OSS で実現可能だが、保守リスクを見込む必要がある | [79][80][81] |
| 8th Wall OSS 化 | エンジンが MIT で公開。SLAM・VPS・ハンド追跡は含まれず | 高度な空間追跡は依然として商用 SDK か自前開発が必要。MVP では深追いしない | [15][16] |
| Apple Vision Pro / visionOS | Safari は immersive-vr の WebXR を既定で有効化。AR モジュールは未有効（情報が錯綜）。`<model>` 要素で USDZ を立体表示（WWDC25） | 2026 年時点では販促 AR の配信先としては時期尚早。将来の互換性のため USDZ/GLB 資産を保持しておく程度 | [82][83][84] |
| スマートグラス（Meta Ray-Ban Display） | 2026-05 に開発者プレビュー（モバイル SDK と Web Apps の 2 経路）。一般配布ストアは未提供。「本格 AR ではなく、ちら見の情報表示」と評価 | MVP の対象外。ウォッチ対象 | [85][86][87] |
| プラットフォーム終了リスク | 2025〜2026 年に Spark、Aero、8th Wall、Onirix が終了・縮小 | 「データのエクスポート」「自社ドメイン配信」「標準フォーマット（GLB/USDZ/MP4）」が信頼性の訴求点になる | [11][13][15][19][25] |

**出典**
- [76] https://born-website.pages.dev/insights/webxr-standards-2026/
- [77] https://vr.org/articles/webxr-adoption-surge-2026-browsers-vs-apps
- [78] https://ecommercefastlane.com/shopify-3d-ar-vr-by-stage/
- [79] https://forum.babylonjs.com/t/nft-image-tracking-ar-with-babylon-js/34786?page=2
- [80] https://redlib.hbubli.cc/r/augmentedreality/comments/1je10vc/current_webar_solutions/miftcxp/?context=3
- [81] https://github.com/thiefcoder/web-ar-Image-Tracking
- [82] https://vr.org/articles/visionos-27-developer-features-safari-requestimmersive-spatial-web
- [83] https://developer.apple.com/videos/play/wwdc2025/237/?time=0
- [84] https://zenn.dev/ikkou/articles/337f584f7581da
- [85] https://vr.org/articles/meta-ray-ban-display-developer-sdk-2026
- [86] https://ppc.land/meta-opens-display-glasses-to-developers-with-two-sdk-paths/
- [87] https://www.auganix.org/?p=18402

---

## 6. ターゲット選定（ビーチヘッド）と PMF 仮説

### 6.1 候補の比較

| 評価軸 | A 印刷会社 | B イベント・展示会出展企業 | C 観光・自治体 | D 小売・EC | G 代理店 |
| --- | --- | --- | --- | --- | --- |
| ペインの切実さ | 中（付加価値提案が欲しい） | **高**（限られた時間で印象とリードを取りたい） | 中〜高 | 中（無料の標準機能あり） | 高（乗り換え需要） |
| 意思決定の速さ | 中 | **速い**（担当者裁量、イベント日程で締切が明確） | 遅い（年度・入札） | 中 | 中 |
| 利用の反復性（継続率を測れるか） | 高（案件ごと） | **高**（年数回の出展＋販促キャンペーン） | 低（年 1 回など） | 高 | 高 |
| ノーコード MVP で価値を出せるか | 中（既存 COCOAR/LESSAR と競合） | **高**（印刷物＋動画/3D＋CTA で十分） | 中（スタンプラリー等は機能が多い） | 低（3D モデル制作がボトルネック） | 低（コード制御を求める） |
| 既存競合の密度 | 高（Cloud CIRCUS 系が印刷業に浸透） | 中 | 中（palanAR、STYLY） | 高 | 高 |
| 日本市場特性との親和性（QR・LINE） | 高 | **高** | 高 | 中 | 中 |

### 6.2 選定: **B. 展示会・イベントに出展する中小〜中堅企業のマーケティング／販促担当者**

**ユースケースの芯**: 「印刷した販促物（チラシ・パネル・名刺・ノベルティ）に QR を載せ、来場者がアプリなしでスマホをかざすと動画や 3D が飛び出し、その場で資料請求や LINE 友だち追加に誘導できる AR を、担当者が自分で 30 分以内に作って公開する」。

**選定理由**
1. 締切（出展日）が明確で、担当者が自分の裁量で小額のツールを買える。PMF 検証の回転が速い。
2. 年数回の出展＋通年の販促キャンペーンで反復利用が生まれるため、継続率が測れる。
3. 展示会白書（Forbes）が示す「出展側は量、来場者は質を求める」ギャップに、体験型の AR が直接効く。
4. 日本の QR 読み取り行動・スマホ保有率・LINE 普及が導線を支える。アプリ型（COCOAR）の弱点を突ける。
5. 必要機能が「画像ターゲット + 動画/画像/3D + CTA ボタン + QR 発行 + 計測」に収まり、1 セッションで実装可能な MVP と整合する。
6. 隣接セグメント（A 印刷会社、C 自治体イベント、G 制作会社）へ、同じ機能のまま横展開できる。

**あえて選ばない理由**
- 印刷会社（A）は魅力的だが、Cloud CIRCUS 系が既に浸透しており、最初に正面から戦うより、B で実績を作ってから「印刷会社の提案メニュー」として持ち込む方が勝ち筋が明確。
- 自治体（C）は調達サイクルが遅く、PMF の学習速度が落ちる。
- 代理店（G）は乗り換え需要があるが、コード制御・高度追跡の要求が強く、ノーコード MVP では不満が出やすい。

### 6.3 PMF 仮説

| 項目 | 仮説 |
| --- | --- |
| 課題仮説 | 展示会・イベントの販促担当者は「ブースで足を止めてもらい、その場で連絡先を取る」ことに困っている。AR は有効だと聞くが、(1) 制作会社に頼むと高くて遅い、(2) 既存ツールは月 4 万〜10 万円で単発には重い、(3) アプリ型は来場者がインストールしてくれない、(4) 大手ツールが相次いで終了して怖い、の 4 点で手を出せていない。 |
| 価値仮説 | 「印刷物の画像と動画/3D をアップロードし、ボタンを置いて公開するだけ」で、来場者がアプリなしで体験でき、体験数と CTA タップ数が見える。制作費と納期を桁違いに下げ、担当者が自分で何度でも作り直せる。 |
| 代替手段 | (a) 何もしない（紙＋口頭説明）、(b) 動画 QR（AR なし）、(c) 制作会社への受託発注、(d) palanAR（月 38,500 円）、LESSAR/COCOAR（スイート契約・アプリ型）、MyWebAR 等の海外ツール（英語・商用は有料）。 |
| 支払い意思（価格帯仮説） | 1 プロジェクト（1 出展）あたり数千円〜2 万円、または月額 1 万〜2 万円で「自分で作れる」なら担当者裁量で支払える、と仮定。根拠は競合価格の空白（LESSAR 無料〜、palanAR 38,500 円、STYLY 98,000 円、8th Wall 旧 Pro 99 USD）であり、**ユーザーインタビューで要検証**。 |
| 最重要リスク | (1) 展示会は季節性が強く、継続率が月次で読みにくい。(2) LESSAR・palanAR の無料枠で十分と判断される可能性。(3) iOS Safari での画像追跡品質（OSS の保守状況）。(4) 価格の一次データ不足。 |

---

## 7. 未確認事項・追加調査が必要な項目

- 国内 WebAR 市場規模（金額ベース）: 公開一次データなし。
- 国内の AR 制作受託費用の相場、展示会 1 回あたりの販促物予算: 一次データなし。ユーザーインタビューで収集する。
- palanAR・LESSAR の無料枠の実力（商用利用可否、ビュー数上限、ロゴ表示）: 実機で検証する。
- Onirix 閉鎖、Zappar 買収、Blippar 新規契約停止、8th Wall ホスト体験の稼働期限: いずれも第三者または競合情報のため公式確認が必要。
- MindAR / AR.js の保守状況: GitHub のコミット履歴で確認（開発者に依頼）。
- 「AR のためのアプリインストール離脱率」の国内定量データ: 見つからず。自社の体験ログで代替計測する。
