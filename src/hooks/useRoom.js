import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { GAME_EVENTS, ROOM_STATUS } from '../lib/constants'
import offlineQueue from '../lib/offlineQueue'

// Max reconnect attempts before we give up (show banner, let user decide)
const MAX_RECONNECT_ATTEMPTS = 5
// Minimum time the channel must have been SUBSCRIBED before we trust it's healthy
const HEALTHY_THRESHOLD_MS = 2000

export function useRoom(roomId, userId) {
  const [room, setRoom] = useState(null)
  const [gameSession, setGameSession] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [error, setError] = useState(null)
  const [wsStatus, setWsStatus] = useState('CONNECTING')
  const channelRef = useRef(null)
  const channelStatusRef = useRef('CLOSED')
  const joiningRef = useRef(false)
  const sessionCreatedRef = useRef(false)
  const roomIdRef = useRef(roomId)
  const userIdRef = useRef(userId)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const subscribedAtRef = useRef(null) // timestamp when SUBSCRIBED first achieved

  useEffect(() => { roomIdRef.current = roomId }, [roomId])
  useEffect(() => { userIdRef.current = userId }, [userId])

  useEffect(() => {
    if (!roomId || !userId) return

    fetchRoom()
    subscribeToRoom()

    // Re-subscribe on tab visibility — with a 2s debounce to avoid race with backoff
    let visibilityTimer = null
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const status = channelStatusRef.current
        // Only reconnect if genuinely errored — NOT during normal CONNECTING phase
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          if (visibilityTimer) clearTimeout(visibilityTimer)
          visibilityTimer = setTimeout(() => {
            // Double-check status hasn't recovered on its own
            if (channelStatusRef.current !== 'SUBSCRIBED') {
              console.log('[useRoom] Tab visible, channel still down — reconnecting')
              // Cancel any in-flight backoff timer first
              if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current)
                reconnectTimerRef.current = null
              }
              if (channelRef.current) supabase.removeChannel(channelRef.current)
              subscribeToRoom()
            }
          }, 2000)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (visibilityTimer) clearTimeout(visibilityTimer)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [roomId, userId])

  async function fetchRoom() {
    const { data, error } = await supabase.from('rooms').select('*').eq('id', roomId).maybeSingle()
    if (error) { setError(error.message); return }
    setRoom(data)
    if (data && (data.host_id === userId || data.guest_id === userId)) {
      await fetchGameSession(roomId)
    }
  }

  async function fetchGameSession(rid) {
    const { data: session, error } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('room_id', rid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && session) setGameSession(session)
  }

  function subscribeToRoom() {
    // Defensive: never create a second channel if one is connecting
    if (channelRef.current && channelStatusRef.current === 'CONNECTING') {
      console.log('[useRoom] Already connecting — skipping duplicate subscribe')
      return
    }

    const channel = supabase.channel(`room:${roomIdRef.current}`, {
      config: { broadcast: { self: true } }
    })

    channel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomIdRef.current}` },
        ({ new: updatedRoom }) => {
          setRoom(updatedRoom)
          if (updatedRoom.host_id === userIdRef.current || updatedRoom.guest_id === userIdRef.current) {
            fetchGameSession(roomIdRef.current)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_sessions', filter: `room_id=eq.${roomIdRef.current}` },
        ({ new: newSession }) => { setGameSession(newSession) }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `room_id=eq.${roomIdRef.current}` },
        ({ new: updatedSession }) => { setGameSession(updatedSession) }
      )
      .on('broadcast', { event: 'game_state' }, ({ payload }) => {
        setGameState(payload)
      })
      .subscribe((status) => {
        channelStatusRef.current = status
        setWsStatus(status)

        if (status === 'SUBSCRIBED') {
          reconnectAttemptsRef.current = 0
          subscribedAtRef.current = Date.now()
          fetchRoom()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const attempt = reconnectAttemptsRef.current

          // Give up after MAX attempts — show banner, let user act
          if (attempt >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`[useRoom] Channel failed after ${attempt} attempts — giving up. User may need to reload.`)
            return
          }

          // Exponential backoff: 3s, 6s, 12s, 24s, 30s cap
          const delay = Math.min(3000 * Math.pow(2, attempt), 30000)
          reconnectAttemptsRef.current = attempt + 1
          console.warn(`[useRoom] Channel ${status} — reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`)

          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null
            if (channelRef.current) supabase.removeChannel(channelRef.current)
            subscribeToRoom()
          }, delay)
        }
      })

    channelRef.current = channel
  }

  // Flush offline queue when coming back online
  useEffect(() => {
    const handleOnline = () => offlineQueue.flush()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  const ensureChannel = useCallback(() => {
    const status = channelStatusRef.current
    if (status !== 'SUBSCRIBED') {
      console.log('[useRoom] Channel not ready (status=%s), will rely on polling fallback', status)
      return false
    }
    return true
  }, [])

  const broadcastState = useCallback((event, data = {}) => {
    const payload = { event, ...data, senderId: userIdRef.current, timestamp: Date.now() }

    if (!ensureChannel()) {
      // Don't trigger another reconnect here — let the backoff handle it
      // Just retry once after 1s if channel comes up
      setTimeout(() => {
        if (channelRef.current && channelStatusRef.current === 'SUBSCRIBED') {
          channelRef.current.send({ type: 'broadcast', event: 'game_state', payload })
        }
      }, 1000)
      return
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'game_state', payload })
    }
  }, [userId, ensureChannel])



  const joinRoom = useCallback(async () => {
    if (joiningRef.current) return null
    joiningRef.current = true
    try {
      const { data: currentRoom } = await supabase
        .from('rooms').select('*').eq('id', roomId).maybeSingle()

      if (currentRoom?.guest_id === userId) {
        console.log('Join: already a guest, skipping update')
        setRoom(currentRoom)
        await fetchGameSession(roomId)
        return currentRoom
      }

      const { data, error } = await supabase
        .from('rooms')
        .update({ guest_id: userId })
        .eq('id', roomId)
        .is('guest_id', null)
        .select()

      if (error) {
        console.warn('Join: update error, fetching current state:', error.message)
        await fetchRoom()
        return room
      }

      if (!data || data.length === 0) {
        console.warn('Join: room already has a guest, refreshing state')
        await fetchRoom()
        return room
      }

      const joined = data[0]
      setRoom(joined)
      await fetchGameSession(roomId)
      return joined
    } finally {
      joiningRef.current = false
    }
  }, [roomId, userId])

  const createSession = useCallback(async (extra = {}) => {
    const { data, error } = await supabase
      .from('game_sessions')
      .insert({ room_id: roomId, ...extra })
      .select()
      .single()
    if (error) throw error
    setGameSession(data)
    return data
  }, [roomId])

  const updateRoom = useCallback(async (updates) => {
    const { data, error } = await supabase
      .from('rooms').update(updates).eq('id', roomId).select().single()
    if (error) throw error
    setRoom(data)
    return data
  }, [roomId])

  const updateSession = useCallback(async (updates, { retry } = {}) => {
    if (!gameSession) return
    try {
      const { data, error } = await supabase
        .from('game_sessions').update(updates).eq('id', gameSession.id).select().single()
      if (error) throw error
      setGameSession(data)
      return data
    } catch (err) {
      if (!retry) {
        console.warn('[updateSession] Request failed, refreshing session and retrying...', err.message)
        try { await supabase.auth.refreshSession() } catch { /* ignore */ }
        return updateSession(updates, { retry: true })
      }
      throw err
    }
  }, [gameSession])

  const updateRoomStatus = useCallback(async (status) => {
    const { data, error } = await supabase
      .from('rooms').update({ status }).eq('id', roomId).select().single()
    if (error) throw error
    setRoom(data)
    return data
  }, [roomId])

  const closeRoom = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .update({ status: 'finished', guest_id: null })
        .eq('id', roomId).select().maybeSingle()
      if (error) {
        console.warn('closeRoom error (non-fatal):', error.message)
        setRoom(prev => prev ? { ...prev, status: 'finished', guest_id: null } : prev)
        return null
      }
      if (data) setRoom(data)
      else setRoom(prev => prev ? { ...prev, status: 'finished', guest_id: null } : prev)
      return data
    } catch (err) {
      console.warn('closeRoom threw (non-fatal):', err.message)
      setRoom(prev => prev ? { ...prev, status: 'finished', guest_id: null } : prev)
      return null
    }
  }, [roomId, userId])

  const isHost = room?.host_id === userId
  const isGuest = room?.guest_id === userId

  return {
    room, gameSession, gameState, error, isHost, isGuest, sessionCreatedRef,
    wsStatus, reconnectAttempts: reconnectAttemptsRef.current,
    broadcastState, joinRoom, closeRoom, createSession, updateSession,
    updateRoom, updateRoomStatus, fetchRoom, fetchGameSession
  }
}
