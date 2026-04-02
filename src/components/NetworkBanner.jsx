import { useState, useEffect, useRef } from 'react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

/**
 * NetworkBanner — shows a sticky top banner ONLY when a real problem occurs:
 *  - Browser goes offline (navigator.onLine = false)  → shows immediately
 *  - WebSocket was healthy, then broken for > 8 seconds → shows warning
 *
 * Does NOT show during the initial connection phase to avoid false positives.
 *
 * Props:
 *   wsStatus   string   value from useRoom().wsStatus ('SUBSCRIBED', 'CHANNEL_ERROR', etc.)
 *   onReload   fn       optional callback for "Обновить" button
 */
export function NetworkBanner({ wsStatus = 'SUBSCRIBED', onReload }) {
  const { isOnline } = useNetworkStatus()
  const [visible, setVisible]               = useState(false)
  const [showReconnected, setShowReconnected] = useState(false)

  // Track whether we've established a healthy connection this session
  const wasSubscribedRef = useRef(false)
  // Keep latest wsStatus in a ref so async timers can read fresh value
  const wsStatusRef      = useRef(wsStatus)
  const wsTimerRef       = useRef(null)

  useEffect(() => { wsStatusRef.current = wsStatus }, [wsStatus])

  const wsHealthy = wsStatus === 'SUBSCRIBED'

  // Once we reach SUBSCRIBED for the first time, mark session as "was healthy"
  useEffect(() => {
    if (wsHealthy) wasSubscribedRef.current = true
  }, [wsHealthy])

  // ── Browser offline: show immediately ──────────────────────────────────────
  useEffect(() => {
    if (!isOnline) {
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current)
      setShowReconnected(false)
      setVisible(true)
    } else {
      // Came back online — hide if it was an offline banner (ws may still be reconnecting)
      if (visible && wsHealthy) {
        setShowReconnected(true)
        wsTimerRef.current = setTimeout(() => {
          setVisible(false)
          setShowReconnected(false)
        }, 2000)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  // ── WS health: only show if we were previously healthy and now broken for 8s ──
  useEffect(() => {
    if (wsTimerRef.current) clearTimeout(wsTimerRef.current)

    if (!wsHealthy && isOnline) {
      if (!wasSubscribedRef.current) {
        // Still on initial connect — DON'T show banner, give it time
        return
      }
      // Was healthy before, now broken — wait 8s then show
      wsTimerRef.current = setTimeout(() => {
        if (wsStatusRef.current !== 'SUBSCRIBED') {
          setShowReconnected(false)
          setVisible(true)
        }
      }, 8000)
    } else if (wsHealthy && visible) {
      // Recovered — flash green then hide
      setShowReconnected(true)
      wsTimerRef.current = setTimeout(() => {
        setVisible(false)
        setShowReconnected(false)
      }, 2000)
    }

    return () => { if (wsTimerRef.current) clearTimeout(wsTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsHealthy, isOnline])

  const wsConnecting = wsStatus === 'CONNECTING' || wsStatus === 'JOINING'
  const wsLabel = !isOnline
    ? 'Нет интернета'
    : wsConnecting
    ? 'Переподключение...'
    : 'Потеря соединения — reconnecting...'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        padding: '10px 20px',
        background: showReconnected
          ? 'linear-gradient(90deg, #065f46, #047857)'
          : 'linear-gradient(90deg, #7f1d1d, #991b1b)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        fontSize: '13px',
        fontWeight: 600,
        color: 'white',
        transition: 'background 0.4s',
      }}>
        {showReconnected ? (
          <>
            <span style={{ fontSize: '16px' }}>✅</span>
            <span>Соединение восстановлено</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '16px' }}>📡</span>
            <span>{wsLabel}</span>
            {onReload && (
              <button
                onClick={onReload}
                style={{
                  marginLeft: '8px',
                  padding: '4px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.15)',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              >
                Обновить
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
