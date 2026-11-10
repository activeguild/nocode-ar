import { useEffect, useMemo, useState } from 'react'
import { toDayJst } from '@shared/scene.ts'
import { api, type ProjectDetail, type StatsResponse } from '../api.ts'
import { navigate } from '../router.ts'

const TYPE_LABEL: Record<string, string> = {
  page_open: 'ページを開いた',
  blocked: '非対応・アプリ内ブラウザの案内を表示',
  view_start: '体験回数（延べ）',
  recognized: '認識回数',
  cta_tap: 'ボタンタップ',
}
const OS_LABEL: Record<string, string> = { ios: 'iPhone / iPad', android: 'Android', other: 'その他' }

function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function StatsPage({ id }: { id: string }) {
  const today = toDayJst(new Date())
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.project(id).then(setDetail).catch(() => setError('プロジェクトを取得できませんでした'))
  }, [id])
  useEffect(() => {
    if (from > to) return
    api
      .stats(id, from, to)
      .then(setStats)
      .catch(() => setError('計測データを取得できませんでした'))
  }, [id, from, to])

  const firstPublish = detail?.publishEvents.find((e) => e.type === 'publish')?.at
  const buttonLabel = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of [...(detail?.publishedScene?.buttons ?? []), ...(detail?.draftScene.buttons ?? [])]) if (!m[b.id]) m[b.id] = b.label
    return m
  }, [detail])

  const agg = useMemo(() => {
    const total: Record<string, number> = {}
    const byDay: Record<string, Record<string, number>> = {}
    const byOs: Record<string, Record<string, number>> = {}
    const byButton: Record<string, number> = {}
    for (const r of stats?.rows ?? []) {
      total[r.type] = (total[r.type] ?? 0) + r.count
      ;(byDay[r.day] ??= {})[r.type] = (byDay[r.day][r.type] ?? 0) + r.count
      ;(byOs[r.os] ??= {})[r.type] = (byOs[r.os][r.type] ?? 0) + r.count
      if (r.type === 'cta_tap') byButton[r.buttonId ?? '?'] = (byButton[r.buttonId ?? '?'] ?? 0) + r.count
    }
    return { total, byDay, byOs, byButton }
  }, [stats])

  const days = useMemo(() => {
    const out: string[] = []
    if (from > to) return out
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
    return out
  }, [from, to])

  const views = agg.total.view_start ?? 0
  const taps = agg.total.cta_tap ?? 0
  const rate = views > 0 ? Math.round((taps / views) * 1000) / 10 : null

  const preset = (kind: 'today' | '7' | '30' | 'since') => {
    if (kind === 'today') {
      setFrom(today)
      setTo(today)
    } else if (kind === 'since') {
      // Q12: 「公開以降」= 初回公開日以降
      setFrom(firstPublish ? toDayJst(new Date(firstPublish)) : addDays(today, -29))
      setTo(today)
    } else {
      setFrom(addDays(today, -(Number(kind) - 1)))
      setTo(today)
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>計測: {detail?.project.name ?? '…'}</h1>
        <button className="btn small" onClick={() => navigate(`/projects/${id}`)}>
          編集へ戻る
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="card">
        <div className="row">
          <div>
            <label htmlFor="from">開始日</label>
            <input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="to">終了日</label>
            <input id="to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="row" style={{ alignSelf: 'flex-end' }}>
            <button className="btn small" onClick={() => preset('today')}>
              今日
            </button>
            <button className="btn small" onClick={() => preset('7')}>
              7 日
            </button>
            <button className="btn small" onClick={() => preset('30')}>
              30 日
            </button>
            <button className="btn small" onClick={() => preset('since')} disabled={!firstPublish}>
              公開以降
            </button>
            <a className="btn small" href={`/api/projects/${id}/stats.csv?from=${from}&to=${to}`} download>
              CSV
            </a>
          </div>
        </div>
      </div>

      <div className="stat-tiles" style={{ marginBottom: 16 }}>
        <div className="stat-tile">
          <div className="v" data-testid="stat-view_start">
            {views}
          </div>
          <div className="l">体験回数（延べ）</div>
        </div>
        <div className="stat-tile">
          <div className="v" data-testid="stat-recognized">
            {agg.total.recognized ?? 0}
          </div>
          <div className="l">認識回数</div>
        </div>
        <div className="stat-tile">
          <div className="v" data-testid="stat-cta_tap">
            {taps}
          </div>
          <div className="l">ボタンタップ</div>
        </div>
        <div className="stat-tile">
          <div className="v">{rate === null ? '—' : `${rate}%`}</div>
          <div className="l">タップ率（タップ ÷ 体験回数）</div>
        </div>
        <div className="stat-tile">
          <div className="v" data-testid="stat-page_open">
            {agg.total.page_open ?? 0}
          </div>
          <div className="l">ページを開いた回数</div>
        </div>
        <div className="stat-tile">
          <div className="v">{agg.total.blocked ?? 0}</div>
          <div className="l">非対応ブラウザの案内を表示</div>
        </div>
      </div>
      <p className="fine">
        体験回数 = カメラを起動した回数（延べ）。認識回数 = チラシが認識された回数。同じ人が 2 回体験すると 2 回と数えます。個人を識別する情報は記録していません。集計は日本時間の日付です。
      </p>

      <div className="card">
        <h2>日別の推移</h2>
        <DailyChart days={days} byDay={agg.byDay} publishEvents={stats?.publishEvents ?? []} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>ボタン別タップ</h2>
          <table>
            <thead>
              <tr>
                <th>ボタン</th>
                <th>タップ</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(agg.byButton).length === 0 ? (
                <tr>
                  <td colSpan={2} className="muted">
                    データなし
                  </td>
                </tr>
              ) : (
                Object.entries(agg.byButton).map(([bid, n]) => (
                  <tr key={bid}>
                    <td>{buttonLabel[bid] ?? bid}</td>
                    <td>{n}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>OS 別</h2>
          <table>
            <thead>
              <tr>
                <th>OS</th>
                <th>体験回数</th>
                <th>認識</th>
                <th>タップ</th>
              </tr>
            </thead>
            <tbody>
              {['ios', 'android', 'other'].map((os) => (
                <tr key={os}>
                  <td>{OS_LABEL[os]}</td>
                  <td>{agg.byOs[os]?.view_start ?? 0}</td>
                  <td>{agg.byOs[os]?.recognized ?? 0}</td>
                  <td>{agg.byOs[os]?.cta_tap ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>公開履歴</h2>
        {detail?.publishEvents.length ? (
          <ul className="fine">
            {detail.publishEvents.map((e, i) => (
              <li key={i}>
                {new Date(e.at).toLocaleString('ja-JP')} — {{ publish: '公開', republish: '更新を公開', unpublish: '停止', resume: '再開', delete: '削除' }[e.type]}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">まだ公開されていません。</p>
        )}
      </div>
      <p className="fine">種別の説明: {Object.entries(TYPE_LABEL).map(([k, v]) => `${k} = ${v}`).join(' / ')}</p>
    </div>
  )
}

function DailyChart({ days, byDay, publishEvents }: { days: string[]; byDay: Record<string, Record<string, number>>; publishEvents: { type: string; at: string }[] }) {
  const W = 720
  const H = 220
  const padL = 36
  const padB = 28
  const padT = 10
  const n = days.length || 1
  const bw = (W - padL - 8) / n
  const max = Math.max(1, ...days.map((d) => Math.max(byDay[d]?.view_start ?? 0, byDay[d]?.cta_tap ?? 0)))
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const dayIndex = (iso: string) => days.indexOf(toDayJst(new Date(iso)))
  return (
    <div>
      <div className="legend">
        <span>
          <i style={{ background: '#1f5eff' }} />
          体験回数
        </span>
        <span>
          <i style={{ background: '#2e7d32' }} />
          ボタンタップ
        </span>
        <span>
          <i style={{ background: '#b26a00', width: 2 }} />
          公開・停止
        </span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="日別の体験回数とボタンタップ">
        {(max >= 2 ? [0, 0.5, 1] : [0, 1]).map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - 4} y1={y(max * f)} y2={y(max * f)} stroke="#d9dde3" />
            <text x={padL - 6} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="#5d6470">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = byDay[d]?.view_start ?? 0
          const t = byDay[d]?.cta_tap ?? 0
          const x = padL + i * bw
          return (
            <g key={d}>
              <rect x={x + bw * 0.1} y={y(v)} width={bw * 0.4} height={H - padB - y(v)} fill="#1f5eff" />
              <rect x={x + bw * 0.5} y={y(t)} width={bw * 0.4} height={H - padB - y(t)} fill="#2e7d32" />
              {(n <= 14 || i % Math.ceil(n / 10) === 0) && (
                <text x={x + bw / 2} y={H - 8} fontSize="10" textAnchor="middle" fill="#5d6470">
                  {d.slice(5)}
                </text>
              )}
            </g>
          )
        })}
        {publishEvents.map((e, i) => {
          const idx = dayIndex(e.at)
          if (idx < 0) return null
          const x = padL + idx * bw + bw / 2
          return <line key={i} x1={x} x2={x} y1={padT} y2={H - padB} stroke="#b26a00" strokeWidth={2} strokeDasharray={e.type === 'unpublish' ? '4 3' : undefined} />
        })}
      </svg>
    </div>
  )
}
