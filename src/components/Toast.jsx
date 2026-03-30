import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastContext = createContext(null)

let _nextId = 1

/**
 * Toast provider — mount once in App root, then call useToast() anywhere
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  // Remove a toast gracefully (trigger exit animation first)
  const remove = useCallback((id) => {
    setToasts(prev =>
      prev.map(t => t.id === id ? { ...t, exiting: true } : t)
    )
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 240)
  }, [])

  const show = useCallback(({ message, type = 'info', duration = 3000, icon }) => {
    const id = _nextId++
    setToasts(prev => [...prev, { id, message, type, icon, exiting: false }])
    if (duration > 0) {
      setTimeout(() => remove(id), duration)
    }
    return id
  }, [remove])

  return (
    <ToastContext.Provider value={{ show, remove }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const TYPE_ICONS = {
  success: '✅',
  error:   '❌',
  info:    '💬',
}

function ToastItem({ toast, onDismiss }) {
  return (
    <div
      className={`toast toast-${toast.type} ${toast.exiting ? 'toast-exit' : ''}`}
      onClick={onDismiss}
      role="alert"
    >
      <span style={{ fontSize: '16px', flexShrink: 0 }}>
        {toast.icon || TYPE_ICONS[toast.type] || '💬'}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer', fontSize: '16px', padding: '0 0 0 4px', lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label="Закрыть"
      >×</button>
    </div>
  )
}

/**
 * useToast — call anywhere inside ToastProvider:
 *   const toast = useToast()
 *   toast.success('Комната создана!')
 *   toast.error('Ошибка соединения')
 *   toast.info('Ждём игрока...')
 */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')

  return {
    success: (message, opts) => ctx.show({ message, type: 'success', ...opts }),
    error:   (message, opts) => ctx.show({ message, type: 'error',   ...opts }),
    info:    (message, opts) => ctx.show({ message, type: 'info',    ...opts }),
    show:    ctx.show,
    remove:  ctx.remove,
  }
}
