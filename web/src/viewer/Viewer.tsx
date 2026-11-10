import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SERVICE_NAME, type AssetInfo, type Scene, type SceneButton } from '@shared/scene.ts'
import { buildOverlay, type BuiltOverlay } from '../ar/overlay.ts'
import { createAnalytics, isInAppBrowser, type AnalyticsSink } from './analytics.ts'
import { CameraError, startArSession, type ArSession } from './ar.ts'

type PublicResponse =
  | { ok: true; name: string; slug: string; scene: Scene; assets: Record<string, AssetInfo>; preview: boolean }
  | { ok: false; reason: 'not_found' | 'draft' | 'unpublished'; name?: string; buttons?: SceneButton[]; endedUrl?: string }

type Phase =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: 'not_found' | 'draft' | 'unpublished'; name?: string; buttons: SceneButton[]; endedUrl: string }
  | { kind: 'intro' }
  | { kind: 'blocked'; reason: 'inapp' | 'nocamera' | 'nowebgl' }
  | { kind: 'starting'; progress: number; label: string }
  | { kind: 'running'; found: boolean }
  | { kind: 'error'; message: string; hint?: string }

function parseLocation(): { mode: 'public' | 'preview'; key: string } | null {
  const m = location.pathname.match(/^\/(v|p)\/([^/?#]+)/)
  if (!m) return null
  return { mode: m[1] === 'v' ? 'public' : 'preview', key: decodeURIComponent(m[2]) }
}

async function fetchScene(loc: { mode: 'public' | 'preview'; key: string }): Promise<PublicResponse> {
  const url = loc.mode === 'public' ? `/api/public/${encodeURIComponent(loc.key)}` : `/api/preview/${encodeURIComponent(loc.key)}`
  const res = await fetch(url, { cache: 'no-cache' })
  const body = await res.json().catch(() => ({}))
  if (res.ok) return { ok: true, ...body }
  return { ok: false, reason: body.reason ?? 'not_found', name: body.name, buttons: body.buttons, endedUrl: body.endedUrl }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

async function prefetch(url: string) {
  try {
    await fetch(url, { cache: 'force-cache' })
  } catch {
    /* ネットワーク失敗は本番の読み込みで再試行される */
  }
}

export function Viewer() {
  const loc = useMemo(parseLocation, [])
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [data, setData] = useState<Extract<PublicResponse, { ok: true }> | null>(null)
  const [audioOn, setAudioOn] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<ArSession | null>(null)
  const overlayRef = useRef<BuiltOverlay | null>(null)
  const analyticsRef = useRef<AnalyticsSink>(createAnalytics('', false))

  // 初期ロード（FR-7-1 / FR-7-8）
  useEffect(() => {
    if (!loc) {
      setPhase({ kind: 'unavailable', reason: 'not_found', buttons: [], endedUrl: '' })
      return
    }
    let cancelled = false
    fetchScene(loc)
      .then((r) => {
        if (cancelled) return
        if (!r.ok) {
          analyticsRef.current = createAnalytics(loc.mode === 'public' ? loc.key : '', loc.mode === 'public')
          analyticsRef.current.send('page_open')
          setPhase({ kind: 'unavailable', reason: r.reason, name: r.name, buttons: r.buttons ?? [], endedUrl: r.endedUrl ?? '' })
          return
        }
        analyticsRef.current = createAnalytics(r.slug, !r.preview)
        analyticsRef.current.send('page_open')
        setData(r)
        document.title = `${r.name} | ${SERVICE_NAME}`
        if (!webglAvailable()) {
          analyticsRef.current.send('blocked')
          setPhase({ kind: 'blocked', reason: 'nowebgl' })
        } else if (!navigator.mediaDevices?.getUserMedia) {
          analyticsRef.current.send('blocked')
          setPhase({ kind: 'blocked', reason: 'nocamera' })
        } else if (isInAppBrowser()) {
          analyticsRef.current.send('blocked')
          setPhase({ kind: 'blocked', reason: 'inapp' })
        } else {
          setPhase({ kind: 'intro' })
        }
        // 先読み（FR-7-4）: ターゲットデータと画像 / 3D。動画はストリーミング
        const s = r.scene
        if (s.target.mindAssetId) prefetch(r.assets[s.target.mindAssetId]?.url)
        if (s.overlay && s.overlay.type !== 'video') prefetch(r.assets[s.overlay.assetId]?.url)
      })
      .catch(() => setPhase({ kind: 'error', message: '読み込みに失敗しました。通信環境を確認して再読み込みしてください' }))
    return () => {
      cancelled = true
    }
  }, [loc])

  useEffect(() => () => sessionRef.current?.stop(), [])

  const start = useCallback(async () => {
    if (!data) return
    const { scene, assets } = data
    const mindUrl = scene.target.mindAssetId ? assets[scene.target.mindAssetId]?.url : null
    if (!mindUrl || !scene.target.imageWidth || !scene.target.imageHeight) {
      setPhase({ kind: 'error', message: 'この AR にはターゲット画像が設定されていません' })
      return
    }
    const container = containerRef.current!
    try {
      setPhase({ kind: 'starting', progress: 15, label: 'コンテンツを準備しています' })
      const target = { heightRatio: scene.target.imageHeight / scene.target.imageWidth }
      let overlay: BuiltOverlay | null = null
      if (scene.overlay) {
        overlay = await buildOverlay(scene.overlay, assets[scene.overlay.assetId].url, target)
        overlayRef.current = overlay
      }
      setPhase({ kind: 'starting', progress: 55, label: 'カメラを起動しています' })
      const session = await startArSession({
        container,
        mindUrl,
        overlay,
        onFound: () => {
          analyticsRef.current.send('recognized')
          setPhase({ kind: 'running', found: true })
          overlay?.video?.play().catch(() => {})
        },
        onLost: () => {
          setPhase({ kind: 'running', found: false })
          overlay?.video?.pause()
        },
      })
      sessionRef.current = session
      analyticsRef.current.send('view_start')
      setPhase({ kind: 'running', found: false })
    } catch (e) {
      if (e instanceof CameraError && e.kind === 'denied') {
        setPhase({
          kind: 'error',
          message: 'カメラの許可が必要です',
          hint: 'iPhone: 設定 > アプリ > Safari > カメラ を「許可」または「確認」にして再読み込み。Android: アドレスバー左のアイコン > 権限 > カメラ を許可。',
        })
      } else if (e instanceof CameraError && e.kind === 'unavailable') {
        setPhase({ kind: 'error', message: 'カメラを利用できません', hint: '他のアプリがカメラを使用中の場合は終了してから再読み込みしてください。' })
      } else {
        setPhase({ kind: 'error', message: (e as Error).message || 'AR を開始できませんでした' })
      }
    }
  }, [data])

  const onTapButton = (b: SceneButton) => {
    analyticsRef.current.send('cta_tap', b.id)
    const w = window.open(b.url, '_blank', 'noopener')
    if (!w) location.href = b.url
  }

  const toggleAudio = () => {
    const v = overlayRef.current?.video
    if (!v) return
    v.muted = audioOn
    setAudioOn(!audioOn)
    if (!audioOn) v.play().catch(() => {})
  }

  const scene = data?.scene
  const buttons = scene?.buttons ?? []
  const running = phase.kind === 'running'
  const showGuide = running && !phase.found

  return (
    <div className="viewer" data-phase={phase.kind} data-found={running ? String(phase.found) : undefined}>
      <div ref={containerRef} className="ar-container" aria-hidden={!running} />

      {data?.preview && <div className="preview-badge">プレビュー（未公開）</div>}
      {running && <div className="service-logo" aria-label={SERVICE_NAME}>{SERVICE_NAME}</div>}

      {phase.kind === 'loading' && (
        <div className="screen">
          <div className="spinner" aria-label="読み込み中" />
        </div>
      )}

      {phase.kind === 'unavailable' && (
        <div className="screen">
          {phase.reason === 'unpublished' && (
            <>
              <h1>この AR は終了しました</h1>
              {phase.name && <p className="muted">{phase.name}</p>}
              {(phase.buttons.length > 0 || phase.endedUrl) && <p>引き続き、以下からご覧いただけます。</p>}
              <div className="cta-list">
                {phase.endedUrl && (
                  <a className="btn primary" href={phase.endedUrl} target="_blank" rel="noopener noreferrer">
                    案内ページを見る
                  </a>
                )}
                {phase.buttons.map((b) => (
                  <a key={b.id} className="btn" href={b.url} target="_blank" rel="noopener noreferrer">
                    {b.label}
                  </a>
                ))}
              </div>
            </>
          )}
          {phase.reason === 'draft' && (
            <>
              <h1>準備中です</h1>
              <p className="muted">この AR はまだ公開されていません。公開後にもう一度お試しください。</p>
            </>
          )}
          {phase.reason === 'not_found' && (
            <>
              <h1>ページが見つかりません</h1>
              <p className="muted">URL をご確認ください。</p>
            </>
          )}
        </div>
      )}

      {phase.kind === 'intro' && data && (
        <div className="screen intro">
          <p className="eyebrow">{SERVICE_NAME}</p>
          <h1>{data.name}</h1>
          <p>カメラを起動して、チラシ（印刷物）にスマホをかざしてください。</p>
          <button className="btn primary big" onClick={start} data-testid="start-camera">
            カメラを起動
          </button>
          <p className="fine">
            カメラの映像は端末内でのみ処理され、送信・保存されません。<a href="/legal.html" target="_blank" rel="noopener noreferrer">利用規約・プライバシー</a>
          </p>
        </div>
      )}

      {phase.kind === 'blocked' && (
        <div className="screen">
          {phase.reason === 'inapp' ? (
            <>
              <h1>Safari / Chrome で開いてください</h1>
              <p>アプリ内のブラウザではカメラが使えないことがあります。右上のメニューから「Safari で開く」「Chrome で開く」「ブラウザで開く」を選んでください。</p>
            </>
          ) : phase.reason === 'nocamera' ? (
            <>
              <h1>このブラウザではカメラを使えません</h1>
              <p>iPhone は Safari、Android は Chrome で開いてください。</p>
            </>
          ) : (
            <>
              <h1>この端末では AR を表示できません</h1>
              <p>3D 表示（WebGL）に対応したブラウザで開いてください。</p>
            </>
          )}
          <div className="cta-list">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(location.href).catch(() => {})}>
              URL をコピー
            </button>
            {/* R3: UA だけで遮断しない */}
            <button className="btn primary" onClick={start} data-testid="try-anyway">
              このまま試す
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'starting' && (
        <div className="screen">
          <p>{phase.label}</p>
          <div className="progress" role="progressbar" aria-valuenow={phase.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${phase.progress}%` }} />
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="screen">
          <h1>{phase.message}</h1>
          {phase.hint && <p className="muted">{phase.hint}</p>}
          <button className="btn primary" onClick={() => location.reload()}>
            再読み込み
          </button>
        </div>
      )}

      {showGuide && (
        <div className="guide" aria-live="polite">
          <div className="guide-frame" />
          <p>チラシ全体が映るようにかざしてください</p>
        </div>
      )}

      {running && scene?.overlay?.type === 'video' && scene.overlay.video.withAudio && (
        <button className="audio-toggle" onClick={toggleAudio} aria-label={audioOn ? '音声をオフにする' : '音声をオンにする'}>
          {audioOn ? '🔊 音声 ON' : '🔇 タップで音声 ON'}
        </button>
      )}

      {(running || phase.kind === 'starting') && buttons.length > 0 && (
        <div className="cta-bar">
          {buttons.map((b) => (
            <button key={b.id} className="btn primary" onClick={() => onTapButton(b)} data-testid={`cta-${b.id}`} aria-label={b.label}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
