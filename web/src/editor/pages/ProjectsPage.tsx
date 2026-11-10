import { useEffect, useState, type FormEvent } from 'react'
import { PROJECT_STATUS_LABEL } from '@shared/scene.ts'
import { api, ApiError, type ProjectSummary } from '../api.ts'
import { navigate } from '../router.ts'

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = () => api.projects().then((r) => setProjects(r.projects))
  useEffect(() => {
    load().catch(() => setError('一覧を取得できませんでした'))
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const r = await api.createProject(name.trim())
      navigate(`/projects/${r.project.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '作成に失敗しました')
    }
  }

  const remove = async (p: ProjectSummary) => {
    const msg =
      p.status === 'published'
        ? `「${p.name}」は公開中です。削除すると QR からアクセスできなくなります（体験者には「終了しました」と表示されます）。削除しますか？`
        : `「${p.name}」を削除しますか？この操作は取り消せません。`
    if (!confirm(msg)) return
    await api.deleteProject(p.id)
    await load()
  }

  return (
    <div className="page">
      <h1>プロジェクト一覧</h1>
      <div className="card">
        <form onSubmit={create} className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="new-name">新しい AR を作る（プロジェクト名）</label>
            <input id="new-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 〇〇展 2026 チラシ" maxLength={60} required />
          </div>
          <button className="btn primary" type="submit" style={{ alignSelf: 'flex-end' }} data-testid="create-project">
            作成
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>

      {projects === null ? (
        <p className="muted">読み込み中…</p>
      ) : projects.length === 0 ? (
        <p className="muted">まだプロジェクトがありません。上のフォームから作成してください。</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>プロジェクト</th>
                <th>状態</th>
                <th>公開 URL</th>
                <th title="同じ人が 2 回体験すると 2 回と数えます">体験回数（延べ）</th>
                <th>ボタンタップ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-testid="project-row">
                  <td>
                    <a href={`/projects/${p.id}`} onClick={(e) => (e.preventDefault(), navigate(`/projects/${p.id}`))}>
                      {p.name}
                    </a>
                    <div className="fine">更新 {new Date(p.updatedAt).toLocaleString('ja-JP')}</div>
                  </td>
                  <td>
                    <span className={`tag ${p.status}`}>{PROJECT_STATUS_LABEL[p.status]}</span>
                  </td>
                  <td>
                    <code style={{ fontSize: '0.8rem' }}>/v/{p.slug}</code>
                  </td>
                  <td>{p.totals.viewStart}</td>
                  <td>{p.totals.ctaTap}</td>
                  <td>
                    <div className="row">
                      <button className="btn small" onClick={() => navigate(`/projects/${p.id}`)}>
                        編集
                      </button>
                      <button className="btn small" onClick={() => navigate(`/projects/${p.id}/stats`)}>
                        計測
                      </button>
                      <button className="btn small danger" onClick={() => remove(p)}>
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
