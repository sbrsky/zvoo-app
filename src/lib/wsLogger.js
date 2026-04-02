/**
 * wsLogger.js — WebSocket diagnostic logger for Supabase Realtime
 *
 * Collects timestamped events so we can analyze:
 *  - How often CHANNEL_ERROR occurs
 *  - Time-to-SUBSCRIBED
 *  - Browser/network context at time of failure
 *
 * Stored in sessionStorage under 'ZVOO_WS_LOG' (survives page navigation,
 * cleared when tab closes). Access via window.ZVOO.wsLog() in DevTools.
 */

const MAX_ENTRIES = 200
const STORAGE_KEY = 'ZVOO_WS_LOG'

function getEntries() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveEntries(entries) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES))) } catch {}
}

export function wsLog(event, meta = {}) {
  const entry = {
    t: new Date().toISOString(),
    ms: Date.now(),
    event,
    ua: navigator.userAgent.slice(0, 80),
    online: navigator.onLine,
    visible: document.visibilityState,
    ...meta,
  }
  const entries = getEntries()
  entries.push(entry)
  saveEntries(entries)
  // Always print to console for live debugging
  console.log(`[WS] ${entry.t} | ${event}`, meta)
}

export function wsLogSummary() {
  const entries = getEntries()
  if (!entries.length) { console.log('[WS] No log entries yet.'); return }
  const errors = entries.filter(e => e.event === 'CHANNEL_ERROR' || e.event === 'TIMED_OUT')
  const subs   = entries.filter(e => e.event === 'SUBSCRIBED')
  const ttfs   = [] // time-to-first-subscribe per session
  let lastConnecting = null
  entries.forEach(e => {
    if (e.event === 'CONNECTING') lastConnecting = e.ms
    if (e.event === 'SUBSCRIBED' && lastConnecting) {
      ttfs.push(e.ms - lastConnecting)
      lastConnecting = null
    }
  })
  const avgTTF = ttfs.length ? Math.round(ttfs.reduce((a, b) => a + b, 0) / ttfs.length) : null
  console.group('🔌 WS Diagnostic Summary')
  console.log(`Total events: ${entries.length}`)
  console.log(`SUBSCRIBED: ${subs.length}, ERRORS: ${errors.length}`)
  console.log(`Avg time-to-subscribe: ${avgTTF != null ? avgTTF + 'ms' : 'N/A'}`)
  console.log(`Last 5 errors:`, errors.slice(-5).map(e => `${e.t} | attempt=${e.attempt} | online=${e.online} | visible=${e.visible}`))
  console.log(`Full log:`, entries)
  console.groupEnd()
  return { entries, errors, subs, avgTTF }
}

export function wsClearLog() {
  sessionStorage.removeItem(STORAGE_KEY)
  console.log('[WS] Log cleared.')
}

// Expose as window.ZVOO.wsLog, .wsSummary, .wsClear for DevTools access
if (typeof window !== 'undefined') {
  window.ZVOO = window.ZVOO || {}
  window.ZVOO.wsLog     = () => wsLogSummary()
  window.ZVOO.wsClear   = () => wsClearLog()
  window.ZVOO.wsEntries = () => getEntries()
}
