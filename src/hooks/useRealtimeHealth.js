/**
 * useRealtimeHealth.js
 *
 * Lightweight hook that tracks the WebSocket health of a Supabase Realtime
 * channel. Designed to be composed on top of useRoom's wsStatus output.
 *
 * Usage:
 *   const { wsStatus } = useRoom(roomId, userId)
 *   const health = useRealtimeHealth(wsStatus)
 *   // pass health to NetworkBanner
 */
import { useMemo } from 'react'

/**
 * @param {string} wsStatus  — value from useRoom().wsStatus
 * @returns {{ isHealthy: boolean, isConnecting: boolean, isError: boolean, label: string }}
 */
export function useRealtimeHealth(wsStatus) {
  return useMemo(() => {
    const isHealthy    = wsStatus === 'SUBSCRIBED'
    const isConnecting = wsStatus === 'CONNECTING' || wsStatus === 'JOINING'
    const isError      = wsStatus === 'CHANNEL_ERROR' || wsStatus === 'TIMED_OUT' || wsStatus === 'CLOSED'

    let label = ''
    if (isConnecting) label = 'Подключение...'
    else if (isError)  label = 'Соединение прервано — reconnecting...'
    else if (isHealthy) label = ''

    return { isHealthy, isConnecting, isError, label, wsStatus }
  }, [wsStatus])
}
