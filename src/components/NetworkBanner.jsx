import { useState, useEffect } from 'react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

/**
 * NetworkBanner — shows a sticky top banner when:
 *  - Browser goes offline (navigator.onLine = false)
 *  - Supabase WebSocket disconnects (passes wsConnected=false)
 *
 * Props:
 *   wsConnected  boolean   whether the realtime WS is connected (optional)
 *   onReload     fn        called when user clicks "Обновить" button
 */
export function NetworkBanner({ wsConnected = true, onReload }) {
  const { isOnline } = useNetworkStatus()
  const [visible, setVisible] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const browserDown = !isOnline
    const wsDown = !wsConnected

    if (browserDown || wsDown) {
      // Wait 3s before showing — avoids false positives from brief blips
      const showTimer = setTimeout(() => {
        // Re-check: only show if still down after the delay
        if (!navigator.onLine) {
          setOffline(true)
          setVisible(true)
        }
      }, 3000)
      return () => clearTimeout(showTimer)
    } else {
      if (visible) {
        // Show "reconnected" briefly then hide
        setVisible(true)
        const t = setTimeout(() => setVisible(false), 2000)
        return () => clearTimeout(t)
      }
    }
  }, [isOnline, wsConnected])

  const reconnected = visible && isOnline && wsConnected


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
        background: reconnected
          ? 'linear-gradient(90deg, #065f46, #047857)'
          : 'linear-gradient(90deg, #7f1d1d, #991b1b)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        fontSize: '13px',
        fontWeight: 600,
        color: 'white',
        transition: 'background 0.4s',
      }}>
        {reconnected ? (
          <>
            <span style={{ fontSize: '16px' }}>✅</span>
            <span>Соединение восстановлено</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '16px', animation: 'pulse-glow 1s infinite' }}>📡</span>
            <span>
              {offline ? 'Нет интернета' : 'Потеря соединения с сервером'}
            </span>
            <button
              onClick={onReload ?? (() => window.location.reload())}
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
          </>
        )}
      </div>
    </div>
  )
}
