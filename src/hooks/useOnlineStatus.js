import { useState, useEffect } from 'react'

/**
 * Hook to detect online/offline status. Provides a reactive `isOnline` boolean.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true)
      console.log('[PWA] Back online')
    }
    const goOffline = () => {
      setIsOnline(false)
      console.log('[PWA] Went offline')
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return isOnline
}
