import { useState, useEffect, useCallback } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/**
 * PWA UI layer — renders:
 * 1. Update toast when a new Service Worker is available
 * 2. Install banner when the app can be added to home screen
 * 3. Offline indicator bar when connection is lost
 */
export default function PWAManager() {
  return (
    <>
      <UpdateToast />
      <InstallBanner />
      <OfflineBar />
    </>
  )
}

/* ─── Update Toast ─────────────────────────────────────────── */
function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      console.log('[PWA] Service Worker registered:', swUrl)
      // Check for updates every 60 minutes
      if (r) {
        setInterval(() => {
          r.update()
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('[PWA] SW registration error:', error)
    },
  })

  if (!needRefresh) return null

  return (
    <div style={{
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, padding: '14px 20px', borderRadius: '16px',
      background: 'rgba(18,18,42,0.95)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(124,58,237,0.3)',
      boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(124,58,237,0.15)',
      display: 'flex', alignItems: 'center', gap: '14px', maxWidth: '400px', width: 'calc(100% - 48px)',
      animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}>
      <span style={{ fontSize: '24px', flexShrink: 0 }}>🔄</span>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#E2E8F0' }}>
          Доступно обновление
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
          Нажмите для обновления
        </p>
      </div>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          padding: '8px 16px', borderRadius: '10px', border: 'none',
          background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
          color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
          transition: 'transform 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        Обновить
      </button>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(30px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ─── Install Banner ───────────────────────────────────────── */
function InstallBanner() {
  const { isInstallable, isIosInstallable, promptInstall, dismissInstall } = useInstallPrompt()
  const [visible, setVisible] = useState(false)
  const [showIos, setShowIos] = useState(false)

  // Show Android/Desktop banner 5s after it becomes installable
  useEffect(() => {
    if (!isInstallable) { setVisible(false); return }
    const t = setTimeout(() => setVisible(true), 5000)
    return () => clearTimeout(t)
  }, [isInstallable])

  // Show iOS banner after 8s (user has had time to look around)
  useEffect(() => {
    if (!isIosInstallable) { setShowIos(false); return }
    const t = setTimeout(() => setShowIos(true), 8000)
    return () => clearTimeout(t)
  }, [isIosInstallable])

  // iOS install instructions banner
  if (showIos) {
    return (
      <div style={{
        position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, padding: '16px 20px', borderRadius: '18px',
        background: 'rgba(18,18,42,0.97)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(6,182,212,0.3)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.7), 0 0 30px rgba(6,182,212,0.12)',
        maxWidth: '360px', width: 'calc(100% - 48px)',
        animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
            background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
          }}>📱</div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#E2E8F0' }}>
              Добавить ZVOO на экран
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: '1.5' }}>
              Нажми{' '}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '2px',
                padding: '1px 6px', borderRadius: '6px',
                background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)',
                fontSize: '11px', fontWeight: 600, color: '#2DC4B2',
              }}>
                <svg width="11" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
                Поделиться
              </span>
              {' '}→{' '}
              <strong style={{ color: '#E2E8F0' }}>«На экран "Домой"»</strong>
            </p>
          </div>
          <button
            onClick={dismissInstall}
            style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
              fontSize: '18px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>
        {/* Arrow pointing down to toolbar */}
        <div style={{
          display: 'flex', justifyContent: 'center', marginTop: '10px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '11px', color: 'rgba(255,255,255,0.3)',
          }}>
            <div style={{ animation: 'bounce 1.5s infinite' }}>↓</div>
            <span>Кнопка в нижней панели браузера</span>
            <div style={{ animation: 'bounce 1.5s infinite' }}>↓</div>
          </div>
        </div>
        <style>{`
          @keyframes slideUp {
            from { opacity: 0; transform: translateX(-50%) translateY(30px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(4px); }
          }
        `}</style>
      </div>
    )
  }

  // Android / Desktop Chrome banner
  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, padding: '16px 20px', borderRadius: '18px',
      background: 'rgba(18,18,42,0.95)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(6,182,212,0.3)',
      boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(6,182,212,0.12)',
      display: 'flex', alignItems: 'center', gap: '14px', maxWidth: '420px', width: 'calc(100% - 48px)',
      animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
        background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '20px',
      }}>📱</div>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#E2E8F0' }}>
          Установить ZVOO
        </p>
        <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
          Быстрый доступ прямо с рабочего стола
        </p>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={dismissInstall}
          style={{
            padding: '8px 12px', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >Нет</button>
        <button
          onClick={promptInstall}
          style={{
            padding: '8px 16px', borderRadius: '10px', border: 'none',
            background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
            color: 'white', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >Установить</button>
      </div>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(30px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  )
}


/* ─── Offline Bar ──────────────────────────────────────────── */
function OfflineBar() {
  const isOnline = useOnlineStatus()
  const [show, setShow] = useState(false)
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    if (!isOnline) {
      setShow(true)
      setJustReconnected(false)
    } else if (show) {
      // Was offline, now back online — show green "connected" for 3s
      setJustReconnected(true)
      const t = setTimeout(() => {
        setShow(false)
        setJustReconnected(false)
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [isOnline])

  if (!show) return null

  return (
    <div style={{
      position: 'fixed', top: '64px', left: 0, right: 0, zIndex: 9998,
      padding: '8px 24px', textAlign: 'center',
      fontSize: '13px', fontWeight: 600,
      background: justReconnected
        ? 'linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.25))'
        : 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.25))',
      color: justReconnected ? '#10B981' : '#FCA5A5',
      borderBottom: `1px solid ${justReconnected ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
      animation: 'offlineSlideDown 0.3s ease-out',
    }}>
      {justReconnected ? '✅ Соединение восстановлено' : '📡 Нет подключения к интернету'}
      <style>{`
        @keyframes offlineSlideDown {
          from { opacity: 0; transform: translateY(-100%); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
