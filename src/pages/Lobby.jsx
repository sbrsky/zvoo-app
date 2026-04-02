import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePresence } from '../hooks/usePresence'
import { supabase } from '../lib/supabase'
import { useAsyncButton } from '../hooks/useAsyncButton'
import { useToast } from '../components/Toast'
import { BtnSpinner } from '../components/BtnSpinner'
import { LANGUAGES, DEFAULT_LANGUAGE_ID } from '../lib/languages'
import { SUPERPOWERS } from '../lib/superpowers'
import { UserProfileDrawer } from '../components/UserProfileDrawer'
import { GAME_TYPES, IMAGINARIUM_STYLES } from '../lib/constants'

// ── Module-level debug helpers — always reflect current localStorage ──
function isDebug() {
  return typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    localStorage.getItem('ZVOO_DEBUG') === 'true'
  )
}
const devLog   = (...a) => { if (isDebug()) console.log('[Lobby]', ...a) }
const devWarn  = (...a) => { if (isDebug()) console.warn('[Lobby]', ...a) }
const devError = (...a) => { if (isDebug()) console.error('[Lobby]', ...a) }

export default function Lobby() {
  const { user, profile } = useAuth()
  const { onlineUsers } = usePresence('lobby', { id: user?.id, username: profile?.username, avatar_url: profile?.avatar_url })
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [copied, setCopied] = useState(null)
  // Set of room IDs where it's the current user's turn to act (round in progress, no score yet)
  const [myTurnRooms, setMyTurnRooms] = useState(new Set())
  // Map of roomId → latest session data (for status labels)
  const [sessionMap, setSessionMap] = useState({})
  const [showRoundPicker, setShowRoundPicker] = useState(false)
  const [pendingRounds, setPendingRounds] = useState(null)
  const [selectedLang, setSelectedLang] = useState(DEFAULT_LANGUAGE_ID)
  // Superpower caps: { slow: 1, choices: 1, vision: 1 }
  const [spConfig, setSpConfig] = useState({ slow: 1, choices: 1, vision: 1 })
  // Game type
  const [selectedGameType, setSelectedGameType] = useState(GAME_TYPES.CLASSIC)
  const [selectedImagStyle, setSelectedImagStyle] = useState(IMAGINARIUM_STYLES[0].id)
  const [pickerStep, setPickerStep] = useState(1) // 1 = game type, 2 = style (imaginarium only), 3 = rounds
  const navigate = useNavigate()
  const toast = useToast()
  const [drawerUserId, setDrawerUserId] = useState(null)

  // Sync selectedLang with profile's preferred_language once it loads
  useEffect(() => {
    if (profile?.preferred_language) setSelectedLang(profile.preferred_language)
  }, [profile?.preferred_language])

  useEffect(() => {
    if (profile && profile.has_completed_onboarding === false) {
      navigate('/onboarding')
    }
  }, [profile, navigate])

  // ── stable refs so closures never go stale ──
  const userRef = useRef(user)
  const fetchRoomsRef = useRef(null)
  const fetchedUserIdRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])

  // Unique channel name per mount avoids Supabase client returning a stale/broken channel
  const channelNameRef = useRef(`lobby_rooms_${Date.now()}`)

  // Ref to track the refresh timeout so we can cancel it on success
  const refreshTimeoutRef = useRef(null)

  const fetchRooms = useCallback(async (manual = false) => {
    const currentUser = userRef.current
    fetchedUserIdRef.current = currentUser?.id || null
    devLog(`fetchRooms called — manual=${manual}, user=${currentUser?.id ?? 'null'}`)

    if (manual) {
      setRefreshing(true)

      // Safety: if refresh takes more than 5s — force full page reload
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
      refreshTimeoutRef.current = setTimeout(() => {
        devWarn('[Lobby] Refresh timed out after 5s — forcing page reload')
        window.location.reload()
      }, 5000)

      devLog('Manual refresh: refreshing Supabase auth session...')
      try {
        const { data, error } = await supabase.auth.refreshSession()
        devLog('Auth session refreshed:', data?.session?.expires_at, error ?? 'ok')
      } catch (e) {
        devWarn('Auth refresh threw:', e)
      }
    }

    try {
      devLog('Fetching rooms from DB...')
      const startTs = Date.now()

      // Race the DB query against an 8-second timeout so we never hang forever
      const fetchPromise = supabase
        .from('rooms')
        .select('*, host:profiles!rooms_host_id_fkey(*), guest:profiles!rooms_guest_id_fkey(*)')
        .in('status', ['waiting', 'playing'])
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('FETCH_TIMEOUT')), 8000)
      )

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])
      devLog(`DB response in ${Date.now() - startTs}ms — rooms=${data?.length ?? 'err'}, error=${error?.message ?? 'none'}`)

      if (error) throw error

      setFetchError(null)
      setRooms(data || [])
      devLog('setRooms called with', data?.length, 'rooms')

      // Determine turn state for playing rooms current user is in
      if (currentUser?.id && data?.length) {
        const myPlayingRooms = data.filter(
          r => r.status === 'playing' && (r.host_id === currentUser.id || r.guest_id === currentUser.id)
        )
        if (myPlayingRooms.length) {
          const { data: sessions, error: sessionsErr } = await supabase
            .from('game_sessions')
            .select('room_id, recorder_id, ai_score, round_number')
            .in('room_id', myPlayingRooms.map(r => r.id))
            .order('created_at', { ascending: false })
          if (sessionsErr) throw sessionsErr

          const map = {}
          ;(sessions || []).forEach(s => {
            if (!map[s.room_id]) map[s.room_id] = s
          })
          setSessionMap(map)
          const turnSet = new Set()
          Object.values(map).forEach(s => {
            if (s.recorder_id && s.ai_score == null) turnSet.add(s.room_id)
          })
          setMyTurnRooms(turnSet)
          devLog('myTurnRooms updated:', [...turnSet])
        } else {
          setMyTurnRooms(new Set())
          setSessionMap({})
        }
      }
    } catch (e) {
      if (e.message === 'FETCH_TIMEOUT') {
        devWarn('[Lobby] DB query timed out after 8s — forcing page reload')
        window.location.reload()
        return // stop execution, page is reloading
      }
      devError('Caught unhandled error in fetchRooms:', e)
      setFetchError(e.message || 'Ошибка загрузки комнат')
    } finally {
      setLoading(false)
      if (manual) {
        // Cancel the 5s safety timeout — we finished in time
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current)
          refreshTimeoutRef.current = null
        }
        setTimeout(() => setRefreshing(false), 400)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // empty deps — reads user via userRef to avoid stale-closure / useEffect re-runs

  // Refetch if user transitions from null to logged in (fixes RLS race condition)
  useEffect(() => {
    if (user?.id && fetchedUserIdRef.current !== user.id) {
      devLog('User auth detected — triggering fast refetch')
      fetchRoomsRef.current?.()
    }
  }, [user?.id])

  // Keep ref in sync
  useEffect(() => { fetchRoomsRef.current = fetchRooms }, [fetchRooms])

  // ── Watchdog: if loading is still true after 10s, force a page reload ──
  useEffect(() => {
    if (!loading) return
    const watchdog = setTimeout(() => {
      devWarn('[Lobby] Stuck loading after 10s — forcing page reload')
      window.location.reload()
    }, 10_000)
    return () => clearTimeout(watchdog)
  }, [loading])

  useEffect(() => {
    devLog('Channel useEffect mounting, channelName=', channelNameRef.current)
    fetchRooms()

    const channel = supabase
      .channel(channelNameRef.current)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms' }, (payload) => {
        devLog('Realtime INSERT:', payload.new?.id)
        fetchRoomsRef.current?.()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, (payload) => {
        devLog('Realtime UPDATE:', payload.new?.id, payload.new?.status)
        fetchRoomsRef.current?.()
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, (payload) => {
        devLog('Realtime DELETE:', payload.old?.id)
        fetchRoomsRef.current?.()
      })
      .subscribe((status) => {
        devLog('Channel status:', status)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          devWarn('Realtime channel error, relying on polling:', status)
        }
      })

    // Safety-net: poll every 10s in case Realtime misses an event
    const poll = setInterval(() => {
      devLog('Poll tick — refetching')
      fetchRoomsRef.current?.()
    }, 10_000)

    // Refetch whenever user returns to this tab
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        devLog('Tab became visible — refetching')
        fetchRoomsRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      devLog('Channel useEffect unmounting')
      supabase.removeChannel(channel)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', handleVisibility)
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
    }
  }, []) // runs exactly once — channel is stable for the lifetime of this Lobby mount

  const createRoom = useCallback(async (totalRounds = 3) => {
    setPendingRounds(totalRounds)
    const isImag = selectedGameType === GAME_TYPES.IMAGINARIUM
    try {
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          host_id: user.id,
          total_rounds: totalRounds,
          game_language: selectedLang,
          game_type: selectedGameType,
          imag_style: isImag ? selectedImagStyle : null,
          sp_slow_max:    isImag ? 0 : spConfig.slow,
          sp_choices_max: isImag ? 0 : spConfig.choices,
          sp_vision_max:  isImag ? 0 : spConfig.vision,
        })
        .select()
        .single()
      if (error) throw error
      setShowRoundPicker(false)
      setPickerStep(1)
      fetchRoomsRef.current?.()
      toast.success('Комната создана! Ждём соперника...')
      navigate(`/game/${data.id}`)
    } catch (err) {
      toast.error(`Не удалось создать комнату: ${err.message}`)
      throw err
    } finally {
      setPendingRounds(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, navigate, selectedLang, spConfig, selectedGameType, selectedImagStyle])

  // useAsyncButton for the "+ Создать комнату" header button (opens picker)
  const openPickerBtn = useAsyncButton(() => {
    setShowRoundPicker(true)
    return Promise.resolve()
  }, { successDuration: 300 })

  function copyLink(roomId) {
    navigator.clipboard.writeText(`${window.location.origin}/game/${roomId}`)
    setCopied(roomId)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <div style={{ minHeight: '100vh', padding: '96px 20px 60px', maxWidth: '1140px', margin: '0 auto' }}>

      {/* Ambient */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '20%', right: '10%',
          width: '400px', height: '400px',
          background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(60px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', left: '5%',
          width: '350px', height: '350px',
          background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(60px)',
        }} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '40px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: '#10B981',
              boxShadow: '0 0 10px rgba(16,185,129,0.6)',
              animation: 'pulse-glow 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: '13px', color: 'rgba(16,185,129,0.9)', fontWeight: 600 }}>
              {onlineUsers.length} онлайн
            </span>
          </div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900, color: 'white', margin: 0, letterSpacing: '-0.02em' }}>
            Лобби
          </h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: '6px 0 0' }}>
            Создай комнату или присоединись к игре
          </p>
        </div>
        <button
          onClick={openPickerBtn.trigger}
          className={openPickerBtn.className}
          style={{
            padding: '14px 28px',
            borderRadius: '16px', border: 'none',
            background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
            color: 'white', fontWeight: 700, fontSize: '15px',
            boxShadow: '0 8px 30px rgba(124,58,237,0.4)',
            whiteSpace: 'nowrap',
          }}
        >
          + Создать комнату
        </button>
        <button
          onClick={() => navigate('/practice')}
          className="btn-game"
          style={{
            padding: '14px 28px', borderRadius: '16px',
            border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.08)',
            color: '#4DD9C8', fontWeight: 700, fontSize: '15px',
            whiteSpace: 'nowrap',
          }}
        >
          🎯 Тренировка
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 260px)', gap: '24px', alignItems: 'start' }}
        className="lobby-grid"
      >

        {/* Rooms list */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', margin: 0, textTransform: 'uppercase' }}>
              Доступные комнаты
            </p>
            <button
              onClick={() => fetchRooms(true)}
              disabled={refreshing}
              title="Обновить список комнат"
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', padding: '6px 10px', cursor: 'pointer',
                color: 'rgba(255,255,255,0.5)', fontSize: '15px', lineHeight: 1,
                transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px',
              }}
              onMouseOver={e => { if (!refreshing) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            >
              <span style={{
                display: 'inline-block',
                animation: refreshing ? 'spin 0.6s linear infinite' : 'none',
                fontSize: '14px',
              }}>🔄</span>
              <span style={{ fontSize: '11px', fontWeight: 600 }}>Обновить</span>
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  padding: '20px', borderRadius: '18px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  animation: 'pulse-glow 1.5s ease-in-out infinite',
                  height: '76px',
                }} />
              ))}
            </div>
          ) : fetchError ? (
            <div style={{
              padding: '48px 32px', borderRadius: '24px',
              background: 'rgba(239,68,68,0.05)',
              border: '1px dashed rgba(239,68,68,0.2)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
              <p style={{ fontSize: '15px', color: 'rgba(239,68,68,0.8)', margin: '0 0 8px', fontWeight: 600 }}>Не удалось загрузить комнаты</p>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', margin: '0 0 16px' }}>{fetchError}</p>
              <button
                onClick={() => fetchRooms(true)}
                style={{
                  padding: '8px 20px', borderRadius: '10px', border: 'none',
                  background: 'rgba(239,68,68,0.15)', color: '#F87171',
                  fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                }}
              >🔄 Повторить</button>
            </div>
          ) : rooms.length === 0 ? (
            <div style={{
              padding: '64px 32px', borderRadius: '24px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px dashed rgba(255,255,255,0.1)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>🎧</div>
              <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px', margin: '0 0 6px', fontWeight: 600 }}>Комнат пока нет</p>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.25)', margin: 0 }}>Создай первую и жди соперника!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {rooms.map(room => {
                const isMyRoom = room.host_id === user.id || room.guest_id === user.id
                const canJoin = room.status === 'waiting' && room.host_id !== user.id && !room.guest_id
                const isMyTurn = isMyRoom && myTurnRooms.has(room.id)
                return (
                  <div
                    key={room.id}
                    style={{
                      padding: '20px 24px',
                      borderRadius: '20px',
                      background: isMyTurn
                        ? 'rgba(124,58,237,0.13)'
                        : isMyRoom
                          ? 'rgba(124,58,237,0.08)'
                          : 'rgba(255,255,255,0.04)',
                      border: isMyTurn
                        ? '2px solid #4DD9C8'
                        : `1px solid ${isMyRoom ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.08)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
                      cursor: isMyRoom || canJoin ? 'pointer' : 'default',
                      transition: 'background 0.2s',
                      animation: isMyTurn ? 'pulse-border 1.8s ease-in-out infinite' : 'none',
                      boxShadow: isMyTurn ? '0 0 0 0 rgba(167,139,250,0.5)' : 'none',
                      position: 'relative',
                    }}
                    onClick={() => {
                      if (canJoin || isMyRoom) navigate(`/game/${room.id}`)
                    }}
                    onMouseEnter={e => {
                      if (canJoin || isMyRoom) e.currentTarget.style.background = isMyTurn ? 'rgba(124,58,237,0.18)' : isMyRoom ? 'rgba(124,58,237,0.13)' : 'rgba(255,255,255,0.07)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = isMyTurn ? 'rgba(124,58,237,0.13)' : isMyRoom ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.04)'
                    }}
                  >
                    {/* Host avatar + info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{
                        width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
                        background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontWeight: 800, fontSize: '16px',
                      }}>
                        {room.host?.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {/* Game type badge */}
                          {room.game_type === GAME_TYPES.IMAGINARIUM ? (
                            <span style={{
                              fontSize: '11px', padding: '2px 8px', borderRadius: '100px',
                              background: 'rgba(139,92,246,0.2)', color: '#C4B5FD',
                              fontWeight: 700, border: '1px solid rgba(139,92,246,0.35)',
                            }}>
                              🎨 Imaginarium
                            </span>
                          ) : (
                            <span style={{
                              fontSize: '11px', padding: '2px 8px', borderRadius: '100px',
                              background: 'rgba(20,122,138,0.2)', color: '#4DD9C8',
                              fontWeight: 700, border: '1px solid rgba(20,122,138,0.35)',
                            }}>
                              🎧 Classic
                            </span>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); room.host_id && setDrawerUserId(room.host_id) }}
                            style={{
                              background: 'none', border: 'none', padding: 0,
                              fontWeight: 700, color: 'white', fontSize: '15px',
                              cursor: 'pointer',
                            }}
                          >
                            {room.host?.username || 'Unknown'}
                          </button>
                          {isMyTurn && (
                            <span style={{
                              fontSize: '11px', padding: '2px 10px', borderRadius: '100px',
                              background: 'rgba(167,139,250,0.25)', color: '#C4B5FD', fontWeight: 700,
                              animation: 'pulse-glow 1s ease-in-out infinite',
                              border: '1px solid rgba(167,139,250,0.4)',
                            }}>
                              ⚡ ВАШ ХОД!
                            </span>
                          )}
                          {!isMyTurn && isMyRoom && (
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '100px', background: 'rgba(124,58,237,0.2)', color: '#4DD9C8', fontWeight: 600 }}>
                              Моя
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                          {(() => {
                            const sess = sessionMap[room.id]
                            if (room.status === 'waiting') {
                              return (
                                <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '100px', fontWeight: 600, background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
                                  ⏳ Ожидание игрока
                                </span>
                              )
                            }
                            if (isMyRoom && sess) {
                              const roundNum = sess.round_number ?? room.current_round ?? 1
                              const totalRounds = room.total_rounds ?? 3
                              if (sess.ai_score != null) {
                                // Round complete — host needs to start next
                                const nextRound = roundNum < totalRounds ? roundNum + 1 : null
                                return (
                                  <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '100px', fontWeight: 600, background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
                                    {nextRound ? `⏸ Ожидание раунда ${nextRound}` : '🏆 Финальный результат'}
                                  </span>
                                )
                              }
                              return (
                                <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '100px', fontWeight: 600, background: 'rgba(16,185,129,0.15)', color: '#10B981' }}>
                                  🎮 Раунд {roundNum} / {totalRounds}
                                </span>
                              )
                            }
                            return (
                              <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '100px', fontWeight: 600, background: 'rgba(16,185,129,0.15)', color: '#10B981' }}>
                                🎮 В игре
                              </span>
                            )
                          })()}
                          {room.guest && (
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                              vs{' '}
                              <button
                                onClick={e => { e.stopPropagation(); room.guest_id && setDrawerUserId(room.guest_id) }}
                                style={{
                                  background: 'none', border: 'none', padding: 0,
                                  color: '#4DD9C8', fontSize: '12px', fontWeight: 600,
                                  cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted',
                                  textUnderlineOffset: '2px',
                                }}
                              >
                                {room.guest.username}
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                      {/* Copy link */}
                      <button
                        onClick={e => { e.stopPropagation(); copyLink(room.id) }}
                        style={{
                          padding: '8px 12px', borderRadius: '10px', border: 'none',
                          background: 'rgba(255,255,255,0.07)',
                          color: copied === room.id ? '#10B981' : 'rgba(255,255,255,0.5)',
                          fontSize: '13px', cursor: 'pointer', fontWeight: 500,
                          transition: 'all 0.2s',
                        }}
                        title="Скопировать ссылку"
                      >
                        {copied === room.id ? '✅' : '🔗'}
                      </button>

                      {canJoin && (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/game/${room.id}`) }}
                          className="btn-game"
                          style={{
                            padding: '8px 18px', borderRadius: '12px', border: 'none',
                            background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
                            color: 'white', fontWeight: 700, fontSize: '13px',
                            boxShadow: '0 4px 16px rgba(124,58,237,0.35)',
                          }}
                        >
                          Войти →
                        </button>
                      )}
                      {isMyRoom && (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/game/${room.id}`) }}
                          className="btn-game"
                          style={{
                            padding: '8px 18px', borderRadius: '12px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.06)',
                            color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: '13px',
                          }}
                        >
                          Открыть →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Online sidebar */}
        <div style={{ position: 'sticky', top: '90px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: '16px', textTransform: 'uppercase' }}>
            Онлайн — {onlineUsers.length}
          </p>
          <div style={{
            padding: '16px',
            borderRadius: '20px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            {onlineUsers.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '13px', padding: '16px 0', margin: 0 }}>
                Никого нет онлайн
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {onlineUsers.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '12px',
                        background: 'linear-gradient(135deg, rgba(124,58,237,0.5), rgba(6,182,212,0.5))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontSize: '13px', fontWeight: 700,
                      }}>
                        {u.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div style={{
                        position: 'absolute', bottom: '-2px', right: '-2px',
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: '#10B981',
                        border: '2px solid #0A0A1A',
                      }} />
                    </div>
                    <div>
                      <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', margin: 0, fontWeight: 600 }}>
                        {u.username}
                      </p>
                      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: 0 }}>онлайн</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Round picker modal */}
    {showRoundPicker && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}>
        <div style={{
          background: 'rgba(18,18,28,0.97)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '24px', padding: '32px', textAlign: 'center', maxWidth: '460px', width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.9)',
        }}>

          {/* Step indicator */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '24px' }}>
            {[1, 2, 3].map(step => (
              <div key={step} style={{
                height: '4px', borderRadius: '2px', flex: 1,
                background: step <= pickerStep ? 'linear-gradient(90deg, #147A8A, #2DC4B2)' : 'rgba(255,255,255,0.1)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>

          {/* ── STEP 1: Game type ── */}
          {pickerStep === 1 && (
            <>
              <h3 style={{ margin: '0 0 6px', fontSize: '22px', color: '#fff' }}>🎮 Тип игры</h3>
              <p style={{ margin: '0 0 24px', fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>Выбери формат</p>
              <div style={{ display: 'flex', gap: '14px', marginBottom: '28px' }}>
                {[
                  { type: GAME_TYPES.CLASSIC, icon: '🎧', label: 'Classic', desc: 'Запись голоса → реверс → угадай' },
                  { type: GAME_TYPES.IMAGINARIUM, icon: '🎨', label: 'Imaginarium', desc: 'AI рисует по фразе → угадай что нарисовано' },
                ].map(({ type, icon, label, desc }) => (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedGameType(type)
                      setPickerStep(type === GAME_TYPES.IMAGINARIUM ? 2 : 3)
                    }}
                    style={{
                      flex: 1, padding: '20px 14px', borderRadius: '18px', border: 'none',
                      cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                      background: selectedGameType === type
                        ? type === GAME_TYPES.IMAGINARIUM
                          ? 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(124,58,237,0.15))'
                          : 'linear-gradient(135deg, rgba(20,122,138,0.35), rgba(45,196,178,0.15))'
                        : 'rgba(255,255,255,0.04)',
                      border: `2px solid ${
                        selectedGameType === type
                          ? type === GAME_TYPES.IMAGINARIUM ? 'rgba(139,92,246,0.6)' : 'rgba(45,196,178,0.6)'
                          : 'rgba(255,255,255,0.08)'
                      }`,
                      boxShadow: selectedGameType === type ? '0 8px 24px rgba(0,0,0,0.3)' : 'none',
                    }}
                  >
                    <div style={{ fontSize: '36px', marginBottom: '10px' }}>{icon}</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: 'white', marginBottom: '6px' }}>{label}</div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>{desc}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setShowRoundPicker(false); setPickerStep(1) }}
                style={{
                  padding: '10px 24px', borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                  color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                }}
              >Отмена</button>
            </>
          )}

          {/* ── STEP 2: Imaginarium style ── */}
          {pickerStep === 2 && (
            <>
              <h3 style={{ margin: '0 0 6px', fontSize: '22px', color: '#fff' }}>🎨 Стиль Imaginarium</h3>
              <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>В каком стиле AI нарисует картинку?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                {IMAGINARIUM_STYLES.map(style => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedImagStyle(style.id)}
                    style={{
                      padding: '16px 20px', borderRadius: '16px', border: 'none',
                      cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', gap: '16px',
                      background: selectedImagStyle === style.id
                        ? `linear-gradient(135deg, ${style.color}30, ${style.color}10)`
                        : 'rgba(255,255,255,0.04)',
                      border: `2px solid ${selectedImagStyle === style.id ? style.color + '80' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    <span style={{ fontSize: '32px', flexShrink: 0 }}>{style.icon}</span>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'white', marginBottom: '3px' }}>{style.name}</div>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{style.description}</div>
                    </div>
                    {selectedImagStyle === style.id && (
                      <span style={{ marginLeft: 'auto', color: style.color, fontSize: '18px' }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setPickerStep(1)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                  }}
                >← Назад</button>
                <button
                  onClick={() => setPickerStep(3)}
                  style={{
                    flex: 2, padding: '12px', borderRadius: '12px', border: 'none',
                    background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                    color: 'white', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(139,92,246,0.4)',
                  }}
                >Далее →</button>
              </div>
            </>
          )}

          {/* ── STEP 3: Language + (if Classic) Superpowers + Rounds ── */}
          {pickerStep === 3 && (
            <>
              <h3 style={{ margin: '0 0 6px', fontSize: '22px', color: '#fff' }}>⚙️ Настройки</h3>
              <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>Язык и количество раундов</p>

              {/* Language */}
              <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 10px' }}>Язык игры</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {LANGUAGES.map(lang => (
                    <button key={lang.id} onClick={() => setSelectedLang(lang.id)} style={{
                      padding: '10px 18px', borderRadius: '14px', border: 'none',
                      cursor: 'pointer', fontWeight: 700, fontSize: '14px',
                      display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.18s',
                      background: selectedLang === lang.id ? 'linear-gradient(135deg, #147A8A, #2DC4B2)' : 'rgba(255,255,255,0.07)',
                      color: selectedLang === lang.id ? 'white' : 'rgba(255,255,255,0.55)',
                      boxShadow: selectedLang === lang.id ? '0 4px 16px rgba(124,58,237,0.35)' : 'none',
                    }}>
                      <span style={{ fontSize: '18px' }}>{lang.flag}</span>
                      {lang.nativeName}
                    </button>
                  ))}
                </div>
              </div>

              {/* Superpowers — Classic only */}
              {selectedGameType === GAME_TYPES.CLASSIC && (
                <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                  <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 12px' }}>⚡ Супер Силы (зарядов на игру)</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {SUPERPOWERS.map(sp => (
                      <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <span style={{ fontSize: '20px', flexShrink: 0 }}>{sp.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{sp.name}</div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.shortDesc}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <button onClick={() => setSpConfig(p => ({ ...p, [sp.id]: Math.max(0, p[sp.id] - 1) }))} style={{ width: '28px', height: '28px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: '16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                          <span style={{ width: '24px', textAlign: 'center', fontSize: '16px', fontWeight: 800, color: spConfig[sp.id] === 0 ? 'rgba(255,255,255,0.2)' : sp.color }}>{spConfig[sp.id]}</span>
                          <button onClick={() => setSpConfig(p => ({ ...p, [sp.id]: Math.min(3, p[sp.id] + 1) }))} style={{ width: '28px', height: '28px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: '16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rounds */}
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Количество раундов</p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '24px' }}>
                {[2, 4, 6].map(n => {
                  const isPending = pendingRounds === n
                  const isOtherPending = pendingRounds !== null && pendingRounds !== n
                  return (
                    <button key={n} onClick={() => createRoom(n)} disabled={pendingRounds !== null}
                      className={`btn-game ${isPending ? 'btn-pending' : ''}`}
                      style={{
                        width: '90px', padding: '20px 0', borderRadius: '18px', border: 'none',
                        background: isPending
                          ? 'linear-gradient(135deg, #147A8A, #2DC4B2)'
                          : 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.2))',
                        boxShadow: isPending ? '0 8px 30px rgba(124,58,237,0.4)' : 'none',
                        opacity: isOtherPending ? 0.4 : 1,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                      }}
                    >
                      {isPending
                        ? <><BtnSpinner size={22} /><span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Создаём...</span></>
                        : <><span style={{ fontSize: '28px', fontWeight: 900, color: '#fff' }}>{n}</span><span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>раунд{n === 2 ? 'а' : 'ов'}</span></>}
                    </button>
                  )
                })}
              </div>

              <button onClick={() => setPickerStep(selectedGameType === GAME_TYPES.IMAGINARIUM ? 2 : 1)}
                style={{
                  padding: '10px 24px', borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                  color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                }}
              >← Назад</button>
            </>
          )}
        </div>
      </div>
    )}
    {drawerUserId && (
      <UserProfileDrawer
        userId={drawerUserId}
        onClose={() => setDrawerUserId(null)}
      />
    )}
  </>
  )
}
