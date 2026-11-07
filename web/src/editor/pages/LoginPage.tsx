import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api.ts'
import { useSession } from '../App.tsx'
import { navigate } from '../router.ts'

export function LoginPage({ mode }: { mode: 'login' | 'signup' }) {
  const { setUser, config } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const r = mode === 'signup' ? await api.signup(email, password) : await api.login(email, password)
      setUser(r.user)
      navigate('/projects')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '通信に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="card">
        <h1>{mode === 'signup' ? '新規登録' : 'ログイン'}</h1>
        <p className="muted">{mode === 'signup' ? 'メールアドレスとパスワードだけで始められます。' : '登録したメールアドレスとパスワードを入力してください。'}</p>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">メールアドレス</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">パスワード（8 文字以上）</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy} data-testid="auth-submit">
            {mode === 'signup' ? '登録して始める' : 'ログイン'}
          </button>
        </form>
        <p style={{ marginTop: 16 }}>
          {mode === 'signup' ? (
            <>
              登録済みの方は{' '}
              <a href="/login" onClick={(e) => (e.preventDefault(), navigate('/login'))}>
                ログイン
              </a>
            </>
          ) : (
            <>
              初めての方は{' '}
              <a href="/signup" onClick={(e) => (e.preventDefault(), navigate('/signup'))}>
                新規登録
              </a>
            </>
          )}
        </p>
        {/* R9 / D1: 再設定メールは送らない。サポート連絡先を案内 */}
        <p className="fine">
          パスワードをお忘れの方は{' '}
          {config.supportEmail ? <a href={`mailto:${config.supportEmail}?subject=パスワード再設定`}>サポート（{config.supportEmail}）</a> : 'サポート'}
          へご連絡ください。
        </p>
      </div>
    </div>
  )
}
