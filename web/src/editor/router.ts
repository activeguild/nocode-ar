import { useEffect, useState } from 'react'

export function usePath(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    window.addEventListener('app:navigate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('app:navigate', onPop)
    }
  }, [])
  return path
}

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.dispatchEvent(new Event('app:navigate'))
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = path.split('/').filter(Boolean)
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i])
    else if (pp[i] !== sp[i]) return null
  }
  return params
}
