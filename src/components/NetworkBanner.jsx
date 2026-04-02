import { useState, useEffect } from 'react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

/**
 * NetworkBanner — shows a sticky top banner when:
 *  - Browser goes offline (navigator.onLine = false)
 *  - Supabase WebSocket disconnects (wsStatus !== 'SUBSCRIBED')
 *
 * Props:
 *   wsStatus   string   value from useRoom().wsStatus (e.g. 'SUBSCRIBED', 'CHANNEL_ERROR')
 *   onReload   fn       called when user clicks "Обновить" button (optional, defaults to nothing)
 */
export function NetworkBanner({ wsStatus = 'SUBSCRIBED', onReload }) {
  const { isOnline } = useNetworkStatus()
  const [visible, setVisible]           = useState(false)
  const [offline, setOffline]           = useState(false)
  const [showReconnected, setShowReconnected] = useState(false)

  const wsHealthy = wsStatus === 'SUBSCRIBED'

  useEffect(() => {
    const browserDown = !isOnline
    const wsDown = !wsHealthy

    if (browserDown || wsDown) {
      // Wait 3s before showing — avoids false positives from brief blips
      const showTimer = setTimeout(() => {
        // Re-check: only show if still down after the delay
        if (!navigator.onLine || !wsHealthy) {
          setOffline(!navigator.onLine)
          setVisible(true)
          setShowReconnected(false)
        }
      }, 3000)
      return () => clearTimeout(showTimer)
    } else {
      if (visible) {
        // Flash "reconnected" then hide
        setShowReconnected(true)
        const t = setTimeout(() => {
          setVisible(false)
          setShowReconnected(false)
        }, 2000)
        return () => clearTimeout(t)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, wsHealthy])

  // Derive message
  const wsConnecting = wsStatus === 'CONNECTING' || wsStatus === 'JOINING'
  const wsLabel = offline
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
            <span style={{ fontSize: '16px', animation: 'pulse-glow 1s infinite' }}>📡</span>
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
