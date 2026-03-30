import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { GAME_EVENTS, ROOM_STATUS } from '../lib/constants'
import offlineQueue from '../lib/offlineQueue'

export function useRoom(roomId, userId) {
  const [room, setRoom] = useState(null)
  const [gameSession, setGameSession] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [error, setError] = useState(null)
  const channelRef = useRef(null)
  const channelStatusRef = useRef('CLOSED') // track live channel status
  const joiningRef = useRef(false)
  const sessionCreatedRef = useRef(false)
  const roomIdRef = useRef(roomId)
  const userIdRef = useRef(userId)

  useEffect(() => { roomIdRef.current = roomId }, [roomId])
  useEffect(() => { userIdRef.current = userId }, [userId])

  useEffect(() => {
    if (!roomId || !userId) return

    fetchRoom()

    // Clean up previous channel before creating new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    subscribeToRoom()

    // Re-subscribe when the user returns to this tab (prevents stale channel after idle)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const status = channelStatusRef.current
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.log('[useRoom] Tab became visible, reconnecting channel...')
          if (channelRef.current) supabase.removeChannel(channelRef.current)
          subscribeToRoom()
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
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
    // Only fetch game_sessions if we are a participant (avoids 406 before guest joins)
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
    const channel = supabase.channel(`room:${roomIdRef.current}`, {
      config: { broadcast: { self: true } }
    })

    channel
      // ✅ Real-time DB changes: host detects guest joining, guest detects room updates
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomIdRef.current}` },
        ({ new: updatedRoom }) => {
          setRoom(updatedRoom)
          // Load game session if we are now a confirmed participant
          if (updatedRoom.host_id === userIdRef.current || updatedRoom.guest_id === userIdRef.current) {
            fetchGameSession(roomIdRef.current)
          }
        }
      )
      // ✅ Both players sync game_sessions in real-time (mimic_audio_url, scores, etc.)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_sessions', filter: `room_id=eq.${roomIdRef.current}` },
        ({ new: newSession }) => {
          setGameSession(newSession)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `room_id=eq.${roomIdRef.current}` },
        ({ new: updatedSession }) => {
          setGameSession(updatedSession)
        }
      )
      // Game-state broadcast events (recording, scoring, etc.)
      .on('broadcast', { event: 'game_state' }, ({ payload }) => {
        setGameState(payload)
      })
      .subscribe((status) => {
        channelStatusRef.current = status
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[useRoom] Channel error, will reconnect on next send or tab focus:', status)
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

  // Ensure channel is live; reconnect if needed
  const ensureChannel = useCallback(() => {
    const status = channelStatusRef.current
    if (status !== 'SUBSCRIBED') {
      console.log('[useRoom] Channel not ready (status=%s), reconnecting...', status)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      subscribeToRoom()
      return false // not ready yet — caller should retry
    }
    return true
  }, [])

  const broadcastState = useCallback((event, data = {}) => {
    const payload = { event, ...data, senderId: userIdRef.current, timestamp: Date.now() }

    // If channel isn't subscribed, try to restore it then retry once with delay
    if (!ensureChannel()) {
      setTimeout(() => {
        if (channelRef.current) {
          channelRef.current.send({ type: 'broadcast', event: 'game_state', payload })
        }
      }, 800)
      return
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'game_state', payload })
    }
  }, [userId, ensureChannel])



  const joinRoom = useCallback(async () => {
    // Prevent concurrent join attempts (useEffect can fire multiple times)
    if (joiningRef.current) return null
    joiningRef.current = true
    try {
      // First check: am I already a guest? (page refresh case)
      const { data: currentRoom } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .maybeSingle()

      if (currentRoom?.guest_id === userId) {
        // Already joined — just set state and return
        console.log('Join: already a guest, skipping update')
        setRoom(currentRoom)
        await fetchGameSession(roomId)
        return currentRoom
      }

      // Attempt to claim the guest slot atomically (do NOT change status yet — host will start)
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
        // Another guest claimed the slot — fetch who it is now
        console.warn('Join: room already has a guest, refreshing state')
        await fetchRoom()
        return room
      }

      // Successfully joined!
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
      .from('rooms')
      .update(updates)
      .eq('id', roomId)
      .select()
      .single()
    if (error) throw error
    setRoom(data)
    return data
  }, [roomId])

  const updateSession = useCallback(async (updates, { retry } = {}) => {
    if (!gameSession) return
    try {
      const { data, error } = await supabase
        .from('game_sessions')
        .update(updates)
        .eq('id', gameSession.id)
        .select()
        .single()
      if (error) throw error
      setGameSession(data)
      return data
    } catch (err) {
      // On first failure, refresh auth and retry once
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
      .from('rooms')
      .update({ status })
      .eq('id', roomId)
      .select()
      .single()
    if (error) throw error
    setRoom(data)
    return data
  }, [roomId])

  // Close the room (host leaves) — best-effort, never throws
  const closeRoom = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .update({ status: 'finished', guest_id: null })
        .eq('id', roomId)
        .select()
        .maybeSingle()
      if (error) {
        console.warn('closeRoom error (non-fatal):', error.message)
        // Still update local state so UI reacts
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
    broadcastState, joinRoom, closeRoom, createSession, updateSession, updateRoom, updateRoomStatus, fetchRoom, fetchGameSession
  }
}
