import { createContext, useContext, useEffect, useState } from 'react'
import { SERVICE_NAME } from '@shared/scene.ts'
import { api } from './api.ts'
import { EditorPage } from './pages/EditorPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { ProjectsPage } from './pages/ProjectsPage.tsx'
import { StatsPage } from './pages/StatsPage.tsx'
import { matchPath, navigate, usePath } from './router.ts'

export interface AppConfig {
  serviceName: string
  supportEmail: string | null
}
interface Session {
  user: { id: string; email: string } | null
  config: AppConfig
  setUser(u: { id: string; email: string } | null): void
}
const SessionContext = createContext<Session>({ user: null, config: { serviceName: SERVICE_NAME, supportEmail: null }, setUser: () => {} })
export const useSession = () => useContext(SessionContext)

export function App() {
  const path = usePath()
  const [user, setUser] = useState<Session['user']>(null)
  const [config, setConfig] = useState<AppConfig>({ serviceName: SERVICE_NAME, supportEmail: null })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([api.config().catch(() => null), api.me().catch(() => null)]).then(([c, m]) => {
      if (c) setConfig(c)
      setUser(m?.user ?? null)
      setReady(true)
    })
  }, [])

  useEffect(() => {
    document.title = config.serviceName
  }, [config.serviceName])

  if (!ready) return <div className="page muted">読み込み中…</div>

  const isAuthPage = path === '/login' || path === '/signup'
  if (!user && !isAuthPage) {
    navigate('/login', true)
    return null
  }
  if (user && (isAuthPage || path === '/')) {
    navigate('/projects', true)
    return null
  }

  let page: React.ReactNode
  let params: Record<string, string> | null
  if (isAuthPage) page = <LoginPage mode={path === '/signup' ? 'signup' : 'login'} />
  else if ((params = matchPath('/projects/:id/stats', path))) page = <StatsPage id={params.id} />
  else if ((params = matchPath('/projects/:id', path))) page = <EditorPage id={params.id} />
  else if (path === '/projects') page = <ProjectsPage />
  else
    page = (
      <div className="page">
        <h1>ページが見つかりません</h1>
        <a href="/projects">プロジェクト一覧へ</a>
      </div>
    )

  return (
    <SessionContext.Provider value={{ user, config, setUser }}>
      <header className="app-header">
        <a
          className="brand"
          href="/projects"
          onClick={(e) => {
            e.preventDefault()
            navigate('/projects')
          }}
        >
          {config.serviceName}
        </a>
        {user && (
          <div className="row">
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {user.email}
            </span>
            <button
              className="btn small"
              onClick={async () => {
                await api.logout()
                setUser(null)
                navigate('/login')
              }}
            >
              ログアウト
            </button>
          </div>
        )}
      </header>
      {page}
    </SessionContext.Provider>
  )
}
