import type { AnalyticsEventType, OsKind } from '@shared/scene.ts'

/** Q11: iPadOS Safari は UA が Mac と同じため、タッチ対応の Macintosh を iOS とみなす */
export function detectOs(): OsKind {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

/** FR-7-2 / R3: アプリ内ブラウザの目安（遮断はしない） */
export function isInAppBrowser(): boolean {
  return /\bLine\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|; wv\)|WebView/i.test(navigator.userAgent)
}

export interface AnalyticsSink {
  send(type: AnalyticsEventType, buttonId?: string | null): void
}

/** FR-7-6: 送信内容は slug・種別・ボタン ID・OS 種別のみ（NFR-6）。プレビューでは送らない */
export function createAnalytics(slug: string, enabled: boolean): AnalyticsSink {
  const os = detectOs()
  const sent = new Set<string>()
  return {
    send(type, buttonId = null) {
      if (!enabled) return
      // page_open / view_start / recognized は 1 回だけ
      if (type !== 'cta_tap') {
        if (sent.has(type)) return
        sent.add(type)
      }
      const body = JSON.stringify({ type, buttonId, os })
      const url = `/api/public/${encodeURIComponent(slug)}/events`
      let ok = false
      try {
        if (navigator.sendBeacon) ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      } catch {
        ok = false
      }
      if (!ok) {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {
          // 1 回だけリトライ（FR-7-6）
          setTimeout(() => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}), 1500)
        })
      }
    },
  }
}
