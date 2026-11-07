import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUTTON_PRESETS,
  LIMITS,
  PROJECT_STATUS_LABEL,
  defaultTransform,
  isAllowedButtonUrl,
  publishBlockers,
  type AssetInfo,
  type ButtonPreset,
  type Overlay,
  type Scene,
  type SceneButton,
  type Transform,
} from '@shared/scene.ts'
import { api, ApiError, type ProjectDetail } from '../api.ts'
import { compileTarget } from '../compile.ts'
import { PlacementEditor } from '../components/PlacementEditor.tsx'
import { ThreePreview } from '../components/ThreePreview.tsx'
import { downscale, formatBytes, loadImage, videoMeta } from '../media.ts'
import { navigate } from '../router.ts'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
interface CompileState {
  running: boolean
  progress: number
  error: string | null
}

const GUIDE_KEY = 'nocode-ar:guide-dismissed'

export function EditorPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [scene, setSceneRaw] = useState<Scene | null>(null)
  const [name, setName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [compile, setCompile] = useState<CompileState>({ running: false, progress: 0, error: null })
  const [targetError, setTargetError] = useState<string | null>(null)
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const [overlayBusy, setOverlayBusy] = useState<string | null>(null)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [showPreviewQr, setShowPreviewQr] = useState(false)
  const [show3d, setShow3d] = useState(false)
  const [guideOpen, setGuideOpen] = useState(() => {
    try {
      return !localStorage.getItem(GUIDE_KEY)
    } catch {
      return true
    }
  })
  const dirtyRef = useRef(false)
  const failCountRef = useRef(0)
  const saveSeqRef = useRef(0)

  // ---- 読み込み
  useEffect(() => {
    api
      .project(id)
      .then((d) => {
        setDetail(d)
        setSceneRaw(d.draftScene)
        setName(d.project.name)
      })
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'プロジェクトが見つかりません' : '読み込みに失敗しました'))
  }, [id])

  const setScene = useCallback((fn: (s: Scene) => Scene) => {
    setSceneRaw((s) => (s ? fn(s) : s))
    dirtyRef.current = true
    setSaveState('dirty')
  }, [])

  // ---- 自動保存（FR-4-7: 2 秒デバウンス。Q16: 3 回連続失敗で案内）
  const save = useCallback(async () => {
    if (!scene) return
    const seq = ++saveSeqRef.current
    setSaveState('saving')
    try {
      const d = await api.updateProject(id, { name: name.trim() || undefined, draftScene: scene })
      if (seq !== saveSeqRef.current) return
      failCountRef.current = 0
      setSaveError(null)
      setDetail((prev) => (prev ? { ...d, draftScene: prev.draftScene } : d))
      setSaveState(dirtyRef.current ? 'dirty' : 'saved')
    } catch (e) {
      if (seq !== saveSeqRef.current) return
      failCountRef.current += 1
      setSaveState('error')
      setSaveError(
        failCountRef.current >= 3 ? '保存できませんでした。ページを再読み込みしてください' : e instanceof ApiError ? e.message : '保存に失敗しました。再試行します',
      )
      dirtyRef.current = true
    }
  }, [id, name, scene])

  useEffect(() => {
    if (!scene || !dirtyRef.current) return
    const t = setTimeout(() => {
      dirtyRef.current = false
      save()
    }, 2000)
    return () => clearTimeout(t)
  }, [scene, name, save])

  // 失敗時の自動再試行（最大 3 回）
  useEffect(() => {
    if (saveState !== 'error' || failCountRef.current >= 3) return
    const t = setTimeout(() => {
      dirtyRef.current = false
      save()
    }, 4000)
    return () => clearTimeout(t)
  }, [saveState, save])

  const addAsset = (a: AssetInfo) => setDetail((d) => (d ? { ...d, assets: { ...d.assets, [a.id]: a } } : d))

  // ---- FR-3: ターゲット画像
  const compileAndStore = useCallback(
    async (img: HTMLImageElement) => {
      setCompile({ running: true, progress: 0, error: null })
      try {
        const small = await downscale(img, 1024)
        const r = await compileTarget(small, (p) => setCompile((c) => ({ ...c, progress: p })))
        const mind = await api.uploadAsset(id, 'target_mind', r.mind)
        addAsset(mind.asset)
        setScene((s) => ({ ...s, target: { ...s.target, mindAssetId: mind.asset.id, quality: r.quality, featureCount: r.featureCount } }))
        setCompile({ running: false, progress: 100, error: null })
      } catch (e) {
        setCompile({ running: false, progress: 0, error: e instanceof ApiError ? e.message : '画像の解析に失敗しました。別の画像をお試しください' })
      }
    },
    [id, setScene],
  )

  const onTargetFile = async (file: File) => {
    setTargetError(null)
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setTargetError('PNG または JPG を選択してください')
    if (file.size > LIMITS.targetImageBytes) return setTargetError('10 MB 以下の画像にしてください')
    let img: HTMLImageElement
    try {
      img = await loadImage(file)
    } catch {
      return setTargetError('画像を読み込めません')
    }
    if (Math.max(img.naturalWidth, img.naturalHeight) > LIMITS.targetImageMaxEdgePx) return setTargetError('長辺 8,000 px 以下の画像にしてください')
    try {
      const up = await api.uploadAsset(id, 'target_image', file, { width: img.naturalWidth, height: img.naturalHeight })
      addAsset(up.asset)
      // FR-3-6: 配置（相対座標）は維持したまま差し替え
      setScene((s) => ({
        ...s,
        target: { ...s.target, imageAssetId: up.asset.id, imageWidth: img.naturalWidth, imageHeight: img.naturalHeight, mindAssetId: null, quality: null, featureCount: null },
      }))
      await compileAndStore(img)
    } catch (e) {
      setTargetError(e instanceof ApiError ? e.message : 'アップロードに失敗しました')
    }
  }

  const retryCompile = async () => {
    const url = scene?.target.imageAssetId ? detail?.assets[scene.target.imageAssetId]?.url : null
    if (!url) return
    try {
      await compileAndStore(await loadImage(url))
    } catch {
      setCompile({ running: false, progress: 0, error: '画像を読み込めません' })
    }
  }

  // ---- FR-4: オーバーレイ
  const onOverlayFile = async (file: File) => {
    setOverlayError(null)
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    const isVideo = file.type.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm'].includes(ext)
    const isImage = /^image\/(png|jpeg|webp)$/.test(file.type)
    const isModel = ext === 'glb' || file.type === 'model/gltf-binary'
    if (isVideo && (file.type === 'video/quicktime' || ext === 'mov')) {
      return setOverlayError(
        'MOV 形式には対応していません。iPhone で撮影した動画は「設定 > カメラ > フォーマット > 互換性優先」で撮影するか、MP4（H.264）で書き出してください',
      )
    }
    if (!isVideo && !isImage && !isModel) return setOverlayError('MP4 / PNG / JPG / GLB のファイルを選択してください')
    if (isVideo && file.size > LIMITS.videoBytes) return setOverlayError('動画は 50 MB 以下にしてください')
    if (isImage && file.size > LIMITS.imageBytes) return setOverlayError('画像は 10 MB 以下にしてください')
    if (isModel && file.size > LIMITS.modelBytes) return setOverlayError('3D モデルは 20 MB 以下にしてください')
    const keepTransform = (s: Scene): Transform => s.overlay?.transform ?? defaultTransform()
    try {
      if (isVideo) {
        setOverlayBusy('動画を確認しています')
        const meta = await videoMeta(file)
        setOverlayBusy('アップロードしています')
        const thumb = await api.uploadAsset(id, 'thumbnail', meta.thumbnail, { width: meta.width, height: meta.height })
        addAsset(thumb.asset)
        const up = await api.uploadAsset(id, 'overlay', file, { width: meta.width, height: meta.height, durationSec: meta.duration })
        addAsset(up.asset)
        setScene((s) => ({
          ...s,
          overlay: {
            type: 'video',
            assetId: up.asset.id,
            thumbnailAssetId: thumb.asset.id,
            aspect: meta.width / meta.height,
            transform: keepTransform(s),
            video: s.overlay?.video ?? { loop: true, withAudio: false },
            model: s.overlay?.model ?? { lift: 0.1, yawDeg: 0, autoRotate: true },
          },
        }))
      } else if (isImage) {
        setOverlayBusy('アップロードしています')
        const img = await loadImage(file)
        const up = await api.uploadAsset(id, 'overlay', file, { width: img.naturalWidth, height: img.naturalHeight })
        addAsset(up.asset)
        setScene((s) => ({
          ...s,
          overlay: {
            type: 'image',
            assetId: up.asset.id,
            thumbnailAssetId: null,
            aspect: img.naturalWidth / img.naturalHeight,
            transform: keepTransform(s),
            video: { loop: true, withAudio: false },
            model: s.overlay?.model ?? { lift: 0.1, yawDeg: 0, autoRotate: true },
          },
        }))
      } else {
        setOverlayBusy('アップロードしています')
        const up = await api.uploadAsset(id, 'overlay', file)
        addAsset(up.asset)
        setScene((s) => ({
          ...s,
          overlay: {
            type: 'model',
            assetId: up.asset.id,
            thumbnailAssetId: null,
            aspect: 1,
            transform: { ...keepTransform(s), width: Math.min(keepTransform(s).width, 0.6) },
            video: { loop: true, withAudio: false },
            model: s.overlay?.model ?? { lift: 0.1, yawDeg: 0, autoRotate: true },
          },
        }))
        setShow3d(true)
      }
    } catch (e) {
      setOverlayError(e instanceof ApiError ? e.message : (e as Error).message || 'アップロードに失敗しました')
    } finally {
      setOverlayBusy(null)
    }
  }

  const updateOverlay = (fn: (o: Overlay) => Overlay) => setScene((s) => (s.overlay ? { ...s, overlay: fn(s.overlay) } : s))

  // ---- FR-5: ボタン
  const addButton = (preset: ButtonPreset) =>
    setScene((s) => {
      if (s.buttons.length >= 3) return s
      const idn = `b${Date.now().toString(36)}`
      const label = preset === 'custom' ? '' : BUTTON_PRESETS[preset]
      return { ...s, buttons: [...s.buttons, { id: idn, label, url: '', preset }] }
    })
  const updateButton = (bid: string, patch: Partial<SceneButton>) => setScene((s) => ({ ...s, buttons: s.buttons.map((b) => (b.id === bid ? { ...b, ...patch } : b)) }))
  const removeButton = (bid: string) => setScene((s) => ({ ...s, buttons: s.buttons.filter((b) => b.id !== bid) }))
  const moveButton = (idx: number, dir: -1 | 1) =>
    setScene((s) => {
      const arr = [...s.buttons]
      const j = idx + dir
      if (j < 0 || j >= arr.length) return s
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return { ...s, buttons: arr }
    })

  // ---- FR-6: 公開
  const flushSave = async () => {
    // 公開前に未保存の変更を確実に送る
    if (dirtyRef.current || saveState === 'dirty' || saveState === 'saving' || saveState === 'error') {
      dirtyRef.current = false
      await save()
    }
  }
  const doPublish = async () => {
    setPublishBusy(true)
    setPublishMsg(null)
    try {
      await flushSave()
      const d = await api.publish(id)
      setDetail((prev) => (prev ? { ...d, draftScene: prev.draftScene } : d))
      setPublishMsg(d.publishEvents.length > 1 ? '更新を公開しました' : '公開しました')
    } catch (e) {
      setPublishMsg(e instanceof ApiError ? e.message : '公開に失敗しました')
    } finally {
      setPublishBusy(false)
    }
  }
  const doUnpublish = async () => {
    if (!confirm('公開を停止しますか？停止中に QR を読むと「終了しました」と表示されます。')) return
    setPublishBusy(true)
    try {
      const d = await api.unpublish(id)
      setDetail((prev) => (prev ? { ...d, draftScene: prev.draftScene } : d))
      setPublishMsg('公開を停止しました')
    } catch (e) {
      setPublishMsg(e instanceof ApiError ? e.message : '停止に失敗しました')
    } finally {
      setPublishBusy(false)
    }
  }
  const doResume = async () => {
    setPublishBusy(true)
    try {
      const d = await api.resume(id)
      setDetail((prev) => (prev ? { ...d, draftScene: prev.draftScene } : d))
      setPublishMsg('公開を再開しました（停止前の内容に戻しました）')
    } catch (e) {
      setPublishMsg(e instanceof ApiError ? e.message : '再開に失敗しました')
    } finally {
      setPublishBusy(false)
    }
  }

  // ---- 派生値
  const blockers = useMemo(() => (scene ? publishBlockers(scene) : []), [scene])
  const buttonErrors = useMemo(() => {
    const errs: Record<string, string> = {}
    scene?.buttons.forEach((b) => {
      if (!b.label.trim()) errs[b.id] = 'ラベルを入力してください'
      else if (!isAllowedButtonUrl(b.url)) errs[b.id] = 'https:// から始まる URL、または LINE のリンク（https://lin.ee/…、https://line.me/…、line://）を入力してください'
    })
    return errs
  }, [scene])
  const hasUnpublishedChanges = !!(detail?.publishedScene && scene && JSON.stringify(detail.publishedScene) !== JSON.stringify(scene))

  if (loadError)
    return (
      <div className="page">
        <h1>{loadError}</h1>
        <a href="/projects" onClick={(e) => (e.preventDefault(), navigate('/projects'))}>
          プロジェクト一覧へ
        </a>
      </div>
    )
  if (!detail || !scene) return <div className="page muted">読み込み中…</div>

  const assets = detail.assets
  const targetAsset = scene.target.imageAssetId ? assets[scene.target.imageAssetId] : null
  const overlayAsset = scene.overlay ? assets[scene.overlay.assetId] : null
  const overlayPreviewUrl = scene.overlay
    ? scene.overlay.type === 'image'
      ? overlayAsset?.url ?? null
      : scene.overlay.type === 'video'
        ? scene.overlay.thumbnailAssetId
          ? assets[scene.overlay.thumbnailAssetId]?.url ?? null
          : null
        : null
    : null
  const status = detail.project.status
  const canPublish = blockers.length === 0 && Object.keys(buttonErrors).length === 0 && !compile.running
  const sectionDone = {
    target: !!scene.target.imageAssetId && !!scene.target.mindAssetId,
    overlay: !!scene.overlay,
    buttons: scene.buttons.length > 0 && Object.keys(buttonErrors).length === 0,
    publish: status === 'published',
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <input
          className="inline-name"
          aria-label="プロジェクト名"
          value={name}
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value)
            dirtyRef.current = true
            setSaveState('dirty')
          }}
        />
        <div className="row">
          <span className={`tag ${status}`}>{PROJECT_STATUS_LABEL[status]}</span>
          <span className={`save-status ${saveState === 'error' ? 'error' : ''}`} aria-live="polite" data-testid="save-status" data-state={saveState}>
            {saveState === 'saved' ? '保存済み' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存の変更' : saveError}
          </span>
          <button className="btn small" onClick={() => navigate(`/projects/${id}/stats`)}>
            計測を見る
          </button>
        </div>
      </div>

      {guideOpen && (
        <div className="notice">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>4 ステップで公開できます</strong>
            <button
              className="btn small"
              onClick={() => {
                setGuideOpen(false)
                try {
                  localStorage.setItem(GUIDE_KEY, '1')
                } catch {
                  /* ignore */
                }
              }}
            >
              閉じる
            </button>
          </div>
          <div className="step-guide" style={{ marginTop: 8 }}>
            <div>1. チラシの画像を入れる</div>
            <div>2. 動画・画像・3D を載せる</div>
            <div>3. 行動ボタンを付ける</div>
            <div>4. 公開して QR をダウンロード</div>
          </div>
          <p className="fine" style={{ marginTop: 8, marginBottom: 0 }}>
            QR を入れた最終の印刷データを「かざす対象」に登録してください。QR は「4. 公開」から公開前でもダウンロードできます。画像を差し替えても配置は保持されます。
          </p>
        </div>
      )}

      <div className="editor-layout">
        <div>
          {/* ---- 1. かざす対象 */}
          <section className="card" aria-labelledby="sec-target">
            <h2 id="sec-target" className="section-title">
              <span className={`check ${sectionDone.target ? 'done' : ''}`}>1</span> かざす対象（チラシの画像）
            </h2>
            <p className="fine">QR を入れた最終の印刷データ（PNG / JPG、10 MB 以下）を登録してください。画像を差し替えても、コンテンツの配置は保持されます。</p>
            <FileDrop accept="image/png,image/jpeg" label={targetAsset ? '別の画像に差し替える' : '画像を選択またはドラッグ&ドロップ'} onFile={onTargetFile} testId="target-file" />
            {targetError && (
              <p className="error-text" role="alert">
                {targetError}
              </p>
            )}
            {targetAsset && (
              <div className="row" style={{ marginTop: 12, alignItems: 'flex-start' }}>
                <img className="thumb" src={targetAsset.url} alt="登録したターゲット画像" style={{ maxWidth: 200 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  {compile.running ? (
                    <div>
                      <p>画像を解析しています（通常 10〜60 秒かかります）。解析中も他の項目を編集できます。</p>
                      <div className="progress" role="progressbar" aria-valuenow={compile.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="progress-bar" style={{ width: `${compile.progress}%` }} />
                      </div>
                      <p className="fine">{compile.progress}%</p>
                    </div>
                  ) : compile.error ? (
                    <div>
                      <p className="error-text" role="alert">
                        {compile.error}
                      </p>
                      <button className="btn small" onClick={retryCompile}>
                        再試行
                      </button>
                    </div>
                  ) : scene.target.quality ? (
                    <QualityBadge quality={scene.target.quality} featureCount={scene.target.featureCount} />
                  ) : (
                    <p className="muted">解析待ち</p>
                  )}
                  <div className="field" style={{ marginTop: 12, maxWidth: 240 }}>
                    <label htmlFor="print-width">印刷したときの横幅（mm）</label>
                    <input
                      id="print-width"
                      type="number"
                      min={LIMITS.printWidthMm.min}
                      max={LIMITS.printWidthMm.max}
                      value={scene.target.printWidthMm}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (v >= LIMITS.printWidthMm.min && v <= LIMITS.printWidthMm.max) setScene((s) => ({ ...s, target: { ...s.target, printWidthMm: v } }))
                      }}
                    />
                    <span className="fine">A4 横 = 297、A4 縦 = 210、名刺 = 91</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ---- 2. 表示するコンテンツ */}
          <section className="card" aria-labelledby="sec-overlay">
            <h2 id="sec-overlay" className="section-title">
              <span className={`check ${sectionDone.overlay ? 'done' : ''}`}>2</span> 表示するコンテンツ（動画・画像・3D のいずれか 1 つ）
            </h2>
            <p className="fine">動画: MP4（H.264）50 MB 以下・1080p / 30 秒以内を推奨。画像: PNG / JPG / WebP 10 MB 以下。3D: GLB 20 MB 以下。</p>
            <FileDrop
              accept="video/mp4,image/png,image/jpeg,image/webp,.glb,model/gltf-binary"
              label={scene.overlay ? '別のファイルに差し替える' : 'ファイルを選択またはドラッグ&ドロップ'}
              onFile={onOverlayFile}
              testId="overlay-file"
            />
            {overlayBusy && <p className="muted">{overlayBusy}…</p>}
            {overlayError && (
              <p className="error-text" role="alert">
                {overlayError}
              </p>
            )}
            {scene.overlay && overlayAsset && (
              <div style={{ marginTop: 12 }}>
                <p className="fine">
                  {scene.overlay.type === 'video' ? '動画' : scene.overlay.type === 'image' ? '画像' : '3D モデル'} / {formatBytes(overlayAsset.sizeBytes)}
                  {scene.overlay.type === 'video' && overlayAsset.sizeBytes > LIMITS.videoWarnBytes && (
                    <span className="warn-text"> — 会場の回線では再生開始が遅くなることがあります。1080p・30 秒以内を推奨します。</span>
                  )}
                </p>
                {targetAsset && scene.target.imageWidth && scene.target.imageHeight ? (
                  <>
                    <PlacementEditor
                      targetUrl={targetAsset.url}
                      targetWidth={scene.target.imageWidth}
                      targetHeight={scene.target.imageHeight}
                      overlay={scene.overlay}
                      previewUrl={overlayPreviewUrl}
                      onChange={(t) => updateOverlay((o) => ({ ...o, transform: t }))}
                    />
                    <p className="fine">ドラッグで移動、右下の丸で大きさ、上の丸で回転。数値でも調整できます。</p>
                  </>
                ) : (
                  <p className="notice warn">先に「1. かざす対象」の画像を登録すると、画像の上で位置を調整できます。</p>
                )}
                <div className="grid-2" style={{ marginTop: 8 }}>
                  <NumberField label="横位置（%）" value={Math.round(scene.overlay.transform.x * 100)} min={-50} max={150} onChange={(v) => updateOverlay((o) => ({ ...o, transform: { ...o.transform, x: v / 100 } }))} />
                  <NumberField label="縦位置（%）" value={Math.round(scene.overlay.transform.y * 100)} min={-50} max={150} onChange={(v) => updateOverlay((o) => ({ ...o, transform: { ...o.transform, y: v / 100 } }))} />
                  <NumberField label="幅（チラシ幅に対する %）" value={Math.round(scene.overlay.transform.width * 100)} min={5} max={300} onChange={(v) => updateOverlay((o) => ({ ...o, transform: { ...o.transform, width: v / 100 } }))} testId="overlay-width" />
                  <NumberField label="回転（°）" value={scene.overlay.transform.rotationDeg} min={-180} max={180} onChange={(v) => updateOverlay((o) => ({ ...o, transform: { ...o.transform, rotationDeg: v } }))} />
                </div>
                {scene.overlay.type === 'video' && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <label className="row" style={{ fontWeight: 400 }}>
                      <input type="checkbox" checked={scene.overlay.video.loop} onChange={(e) => updateOverlay((o) => ({ ...o, video: { ...o.video, loop: e.target.checked } }))} /> ループ再生
                    </label>
                    <label className="row" style={{ fontWeight: 400 }}>
                      <input type="checkbox" checked={scene.overlay.video.withAudio} onChange={(e) => updateOverlay((o) => ({ ...o, video: { ...o.video, withAudio: e.target.checked } }))} /> 音声あり
                    </label>
                    <span className="fine">スマホでは音声なしで自動再生され、音声ありの場合は体験者がタップすると音が出ます。音声が重要な場合は字幕入りの動画をおすすめします。</span>
                  </div>
                )}
                {scene.overlay.type === 'model' && (
                  <div className="grid-2" style={{ marginTop: 8 }}>
                    <NumberField label="浮かせる高さ（チラシ幅に対する %）" value={Math.round(scene.overlay.model.lift * 100)} min={0} max={200} onChange={(v) => updateOverlay((o) => ({ ...o, model: { ...o.model, lift: v / 100 } }))} />
                    <NumberField label="向き（°）" value={scene.overlay.model.yawDeg} min={-180} max={180} onChange={(v) => updateOverlay((o) => ({ ...o, model: { ...o.model, yawDeg: v } }))} />
                    <label className="row" style={{ fontWeight: 400, alignSelf: 'end' }}>
                      <input type="checkbox" checked={scene.overlay.model.autoRotate} onChange={(e) => updateOverlay((o) => ({ ...o, model: { ...o.model, autoRotate: e.target.checked } }))} /> 自動で回転させる
                    </label>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ---- 3. 行動ボタン */}
          <section className="card" aria-labelledby="sec-buttons">
            <h2 id="sec-buttons" className="section-title">
              <span className={`check ${sectionDone.buttons ? 'done' : ''}`}>3</span> 行動ボタン（1〜3 個）
            </h2>
            <p className="fine">体験画面の下部に表示され、タップでリンク先が開きます。公開には 1 個以上必要です。</p>
            {scene.buttons.map((b, i) => (
              <div key={b.id} className="card" style={{ padding: 12, marginBottom: 8 }} data-testid="button-row">
                <div className="grid-2">
                  <div>
                    <label htmlFor={`label-${b.id}`}>ラベル（20 文字まで）</label>
                    <input id={`label-${b.id}`} type="text" maxLength={20} value={b.label} onChange={(e) => updateButton(b.id, { label: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={`url-${b.id}`}>リンク先 URL</label>
                    <input id={`url-${b.id}`} type="url" placeholder="https://" value={b.url} onChange={(e) => updateButton(b.id, { url: e.target.value.trim() })} />
                  </div>
                </div>
                {buttonErrors[b.id] && <p className="error-text">{buttonErrors[b.id]}</p>}
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn small" onClick={() => moveButton(i, -1)} disabled={i === 0} aria-label="上へ">
                    ↑
                  </button>
                  <button className="btn small" onClick={() => moveButton(i, 1)} disabled={i === scene.buttons.length - 1} aria-label="下へ">
                    ↓
                  </button>
                  <button className="btn small danger" onClick={() => removeButton(b.id)}>
                    削除
                  </button>
                </div>
              </div>
            ))}
            {scene.buttons.length < 3 && (
              <div className="row">
                <span className="fine">追加:</span>
                <button className="btn small" onClick={() => addButton('docs')} data-testid="add-button-docs">
                  資料請求
                </button>
                <button className="btn small" onClick={() => addButton('line')}>
                  LINE 友だち追加
                </button>
                <button className="btn small" onClick={() => addButton('web')}>
                  Web サイトへ
                </button>
                <button className="btn small" onClick={() => addButton('custom')}>
                  自由入力
                </button>
              </div>
            )}
          </section>

          {/* ---- 4. 公開 */}
          <section className="card" aria-labelledby="sec-publish">
            <h2 id="sec-publish" className="section-title">
              <span className={`check ${sectionDone.publish ? 'done' : ''}`}>4</span> 公開
            </h2>
            <div className="field">
              <label>公開 URL（固定。再公開しても変わりません）</label>
              <div className="row">
                <code data-testid="public-url">{detail.publicUrl}</code>
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(detail.publicUrl)}>
                  コピー
                </button>
              </div>
            </div>
            {blockers.length > 0 && (
              <div className="notice warn">
                公開するには次の項目が必要です:
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {status === 'published' && hasUnpublishedChanges && <div className="notice warn">未公開の変更があります。「更新を公開」で体験者に反映されます。</div>}
            <div className="row">
              {status === 'published' ? (
                <>
                  <button className="btn primary" onClick={doPublish} disabled={!canPublish || publishBusy} data-testid="publish">
                    更新を公開
                  </button>
                  <button className="btn danger" onClick={doUnpublish} disabled={publishBusy} data-testid="unpublish">
                    公開を停止
                  </button>
                </>
              ) : status === 'unpublished' ? (
                <>
                  <button className="btn primary" onClick={doResume} disabled={publishBusy} data-testid="resume">
                    公開を再開（停止前の内容）
                  </button>
                  <button className="btn" onClick={doPublish} disabled={!canPublish || publishBusy} data-testid="publish">
                    下書きを公開
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={doPublish} disabled={!canPublish || publishBusy} data-testid="publish">
                  公開する
                </button>
              )}
              <button className="btn" onClick={() => setShowPreviewQr((v) => !v)} data-testid="preview-qr">
                スマホで確認（プレビュー）
              </button>
            </div>
            {publishMsg && (
              <p className={publishMsg.includes('失敗') || publishMsg.includes('ません') ? 'error-text' : 'ok-text'} role="status" data-testid="publish-msg">
                {publishMsg}
              </p>
            )}
            {showPreviewQr && (
              <div className="card qr-box" style={{ marginTop: 12 }}>
                <p>
                  スマホのカメラでこの QR を読むと、<strong>下書きの内容</strong>を実機で確認できます（計測には含まれません）。
                </p>
                <img src={`/api/projects/${id}/preview-qr.png?t=${detail.project.previewToken}`} alt="プレビュー用 QR コード" data-testid="preview-qr-img" />
                <p className="fine">
                  <a href={detail.previewUrl} target="_blank" rel="noopener noreferrer">
                    {detail.previewUrl}
                  </a>
                </p>
                <button
                  className="btn small"
                  onClick={async () => {
                    const d = await api.rotatePreviewToken(id)
                    setDetail((prev) => (prev ? { ...d, draftScene: prev.draftScene } : d))
                  }}
                >
                  プレビュー URL を再発行
                </button>
              </div>
            )}

            <div className="card qr-box" style={{ marginTop: 12 }}>
              <p>
                <strong>印刷用 QR コード</strong>（公開前でもダウンロードできます）
              </p>
              <img src={`/api/projects/${id}/qr.png`} alt="公開 URL の QR コード" data-testid="qr-img" />
              <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                <a className="btn small" href={`/api/projects/${id}/qr.png`} download>
                  PNG をダウンロード
                </a>
                <a className="btn small" href={`/api/projects/${id}/qr.svg`} download>
                  SVG をダウンロード
                </a>
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="ended-url">終了後の案内 URL（任意）</label>
              <input id="ended-url" type="url" placeholder="https://" value={scene.endedUrl} onChange={(e) => setScene((s) => ({ ...s, endedUrl: e.target.value.trim() }))} />
              <span className="fine">公開を停止したあとに QR を読んだ人に表示する案内ページです。行動ボタンも引き続き表示されます。</span>
              {scene.endedUrl && !isAllowedButtonUrl(scene.endedUrl) && <p className="error-text">https:// から始まる URL を入力してください</p>}
            </div>

            {detail.publishEvents.length > 0 && (
              <details>
                <summary className="fine">公開履歴</summary>
                <ul className="fine">
                  {detail.publishEvents.map((e, i) => (
                    <li key={i}>
                      {new Date(e.at).toLocaleString('ja-JP')} — {EVENT_LABEL[e.type]}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>

        {/* ---- 右カラム: プレビュー */}
        <aside className="editor-preview">
          <div className="card">
            <h2>プレビュー</h2>
            {scene.overlay && overlayAsset && targetAsset && scene.target.imageWidth && scene.target.imageHeight ? (
              <>
                <label className="row" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /> 3D プレビュー（閲覧ページと同じ描画）
                </label>
                {show3d ? (
                  <ThreePreview targetUrl={targetAsset.url} targetWidth={scene.target.imageWidth} targetHeight={scene.target.imageHeight} overlay={scene.overlay} overlayUrl={overlayAsset.url} />
                ) : (
                  <p className="fine">左の配置エディタで位置・大きさを調整できます。実機での見え方は「スマホで確認」から。</p>
                )}
              </>
            ) : (
              <p className="muted">ターゲット画像とコンテンツを登録するとプレビューが表示されます。</p>
            )}
            {scene.buttons.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p className="fine">体験画面のボタン:</p>
                {scene.buttons.map((b) => (
                  <div key={b.id} className="btn primary" style={{ width: '100%', marginBottom: 6, pointerEvents: 'none' }}>
                    {b.label || '（ラベル未入力）'}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

const EVENT_LABEL: Record<ProjectDetail['publishEvents'][number]['type'], string> = {
  publish: '公開',
  republish: '更新を公開',
  unpublish: '停止',
  resume: '再開',
  delete: '削除',
}

function QualityBadge({ quality, featureCount }: { quality: 'good' | 'fair' | 'poor'; featureCount: number | null }) {
  const label = quality === 'good' ? '認識しやすさ: 良い' : quality === 'fair' ? '認識しやすさ: 普通' : '認識しにくい画像です'
  return (
    <div data-testid="quality" data-quality={quality}>
      <span className={`tag ${quality}`}>{label}</span>
      {featureCount !== null && <span className="fine"> （特徴点 {featureCount}）</span>}
      {quality === 'poor' && (
        <p className="fine" style={{ marginTop: 6 }}>
          単色・グラデーションが多い、文字が少ない、繰り返し模様、などが原因かもしれません。写真やロゴを含む面を使う、余白を減らす、と改善します。登録はこのままでもできますが、「スマホで確認」で実機の認識をお試しください。
        </p>
      )}
      {quality === 'fair' && <p className="fine" style={{ marginTop: 6 }}>多くの場合は問題ありません。「スマホで確認」で実機の認識をお試しください。</p>}
    </div>
  )
}

function NumberField({ label, value, min, max, onChange, testId }: { label: string; value: number; min: number; max: number; onChange(v: number): void; testId?: string }) {
  const id = useMemo(() => `nf-${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        data-testid={testId}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v) && v >= min && v <= max) onChange(v)
        }}
      />
    </div>
  )
}

function FileDrop({ accept, label, onFile, testId }: { accept: string; label: string; onFile(f: File): void; testId: string }) {
  const [active, setActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={`dropzone ${active ? 'active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setActive(true)
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setActive(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
    </div>
  )
}
