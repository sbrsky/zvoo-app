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
  const joiningRef = useRef(false)
  const sessionCreatedRef = useRef(false)

  useEffect(() => {
    if (!roomId || !userId) return

    fetchRoom()

    // Clean up previous channel before creating new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    subscribeToRoom()

    return () => {
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
    const channel = supabase.channel(`room:${roomId}`, {
      config: { broadcast: { self: true } }
    })

    channel
      // ✅ Real-time DB changes: host detects guest joining, guest detects room updates
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        ({ new: updatedRoom }) => {
          setRoom(updatedRoom)
          // Load game session if we are now a confirmed participant
          if (updatedRoom.host_id === userId || updatedRoom.guest_id === userId) {
            fetchGameSession(roomId)
          }
        }
      )
      // ✅ Both players sync game_sessions in real-time (mimic_audio_url, scores, etc.)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_sessions', filter: `room_id=eq.${roomId}` },
        ({ new: newSession }) => {
          setGameSession(newSession)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `room_id=eq.${roomId}` },
        ({ new: updatedSession }) => {
          setGameSession(updatedSession)
        }
      )
      // Game-state broadcast events (recording, scoring, etc.)
      .on('broadcast', { event: 'game_state' }, ({ payload }) => {
        setGameState(payload)
      })
      .subscribe()

    channelRef.current = channel
  }

  // Flush offline queue when coming back online
  useEffect(() => {
    const handleOnline = () => offlineQueue.flush()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  const broadcastState = useCallback((event, data = {}) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'game_state',
        payload: { event, ...data, senderId: userId, timestamp: Date.now() }
      })
    }
  }, [userId])

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

  const updateSession = useCallback(async (updates) => {
    if (!gameSession) return
    const { data, error } = await supabase
      .from('game_sessions')
      .update(updates)
      .eq('id', gameSession.id)
      .select()
      .single()
    if (error) throw error
    setGameSession(data)
    return data
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
