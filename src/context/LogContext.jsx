import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import logger from '../lib/logger'

const LogContext = createContext({ logs: [], clear: () => {} })

export function LogProvider({ children }) {
  const [logs, setLogs] = useState(() => [...logger.logs])

  useEffect(() => {
    const onLog = (e) => {
      setLogs(prev => {
        const next = [...prev, e.detail]
        return next.length > 500 ? next.slice(-500) : next
      })
    }
    const onClear = () => setLogs([])

    logger.addEventListener('log', onLog)
    logger.addEventListener('clear', onClear)
    return () => {
      logger.removeEventListener('log', onLog)
      logger.removeEventListener('clear', onClear)
    }
  }, [])

  const clear = useCallback(() => logger.clear(), [])

  return (
    <LogContext.Provider value={{ logs, clear }}>
      {children}
    </LogContext.Provider>
  )
}

export function useLogs() {
  return useContext(LogContext)
}
