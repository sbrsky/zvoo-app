import { useState, useEffect, useCallback } from 'react'

/**
 * Hook to manage the "Add to Home Screen" install prompt.
 * Captures the `beforeinstallprompt` event and provides a way to trigger it.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isInstallable, setIsInstallable] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Check if already installed (display-mode: standalone)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    setIsInstalled(isStandalone)

    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setIsInstallable(true)
      console.log('[PWA] Install prompt captured')
    }

    const installedHandler = () => {
      setIsInstalled(true)
      setIsInstallable(false)
      setDeferredPrompt(null)
      console.log('[PWA] App was installed')
    }

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    console.log('[PWA] Install outcome:', outcome)
    setDeferredPrompt(null)
    setIsInstallable(false)
    return outcome === 'accepted'
  }, [deferredPrompt])

  const dismissInstall = useCallback(() => {
    setIsInstallable(false)
    setDeferredPrompt(null)
    // Remember dismissal for 7 days
    localStorage.setItem('zvoo_install_dismissed', Date.now().toString())
  }, [])

  // Check if recently dismissed
  const wasDismissed = (() => {
    const ts = localStorage.getItem('zvoo_install_dismissed')
    if (!ts) return false
    return Date.now() - parseInt(ts, 10) < 7 * 24 * 60 * 60 * 1000
  })()

  return {
    isInstallable: isInstallable && !isInstalled && !wasDismissed,
    isInstalled,
    promptInstall,
    dismissInstall,
  }
}
