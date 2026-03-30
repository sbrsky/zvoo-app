import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePresence } from '../hooks/usePresence'
import { supabase } from '../lib/supabase'
import { useAsyncButton } from '../hooks/useAsyncButton'
import { useToast } from '../components/Toast'
import { BtnSpinner } from '../components/BtnSpinner'
import { LANGUAGES, DEFAULT_LANGUAGE_ID } from '../lib/languages'
import { SUPERPOWERS } from '../lib/superpowers'

export default function Lobby() {
  const { user, profile } = useAuth()
  const { onlineUsers } = usePresence('lobby', { id: user?.id, username: profile?.username, avatar_url: profile?.avatar_url })
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(null)
  // Set of room IDs where it's the current user's turn to act
  const [myTurnRooms, setMyTurnRooms] = useState(new Set())
  const [showRoundPicker, setShowRoundPicker] = useState(false)
  const [pendingRounds, setPendingRounds] = useState(null)
  const [selectedLang, setSelectedLang] = useState(DEFAULT_LANGUAGE_ID)
  // Superpower caps: { slow: 1, choices: 1, vision: 1 }
  const [spConfig, setSpConfig] = useState({ slow: 1, choices: 1, vision: 1 })
  const navigate = useNavigate()
  const toast = useToast()

  // Sync selectedLang with profile's preferred_language once it loads
  useEffect(() => {
    if (profile?.preferred_language) setSelectedLang(profile.preferred_language)
  }, [profile?.preferred_language])

  useEffect(() => {
    if (profile && profile.has_completed_onboarding === false) {
      navigate('/onboarding')
    }
  }, [profile, navigate])

  useEffect(() => {
    fetchRooms()
    const channel = supabase
      .channel('rooms_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchRooms())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function fetchRooms(manual = false) {
    if (manual) setRefreshing(true)
    const { data } = await supabase
      .from('rooms')
      .select('*, host:profiles!rooms_host_id_fkey(*), guest:profiles!rooms_guest_id_fkey(*)')
      .in('status', ['waiting', 'playing'])
      .order('created_at', { ascending: false })
    setRooms(data || [])
    setLoading(false)
    if (manual) setTimeout(() => setRefreshing(false), 400)

    // Determine whose turn it is for playing rooms I'm in
    if (user?.id && data?.length) {
      const myPlayingRooms = data.filter(
        r => r.status === 'playing' && (r.host_id === user.id || r.guest_id === user.id)
      )
      if (myPlayingRooms.length) {
        const { data: sessions } = await supabase
          .from('game_sessions')
          .select('room_id, recorder_id')
          .in('room_id', myPlayingRooms.map(r => r.id))
        const turnSet = new Set()
        ;(sessions || []).forEach(s => {
          // If I'm NOT the recorder → it's my turn to guess
          // If I AM the recorder and mimic not yet done → my turn to record
          // Simple heuristic: session exists and I'm the recorder → my turn to record
          // session exists and I'm NOT the recorder → my turn to guess
          if (s.recorder_id) {
            // If recorder hasn't uploaded the audio yet or guesser hasn't guessed yet
            // Either way, one of us needs to act — flag both cases as "your turn"
            turnSet.add(s.room_id)
          }
        })
        setMyTurnRooms(turnSet)
      } else {
        setMyTurnRooms(new Set())
      }
    }
  }

  const createRoom = useCallback(async (totalRounds = 3) => {
    setPendingRounds(totalRounds)
    try {
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          host_id: user.id,
          total_rounds: totalRounds,
          game_language: selectedLang,
          sp_slow_max:    spConfig.slow,
          sp_choices_max: spConfig.choices,
          sp_vision_max:  spConfig.vision,
        })
        .select()
        .single()
      if (error) throw error
      setShowRoundPicker(false)
      toast.success('Комната создана! Ждём соперника...')
      navigate(`/game/${data.id}`)
    } catch (err) {
      toast.error(`Не удалось создать комнату: ${err.message}`)
      throw err
    } finally {
      setPendingRounds(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, navigate, selectedLang, spConfig])

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
            background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
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
            color: '#A78BFA', fontWeight: 700, fontSize: '15px',
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
                        ? '2px solid #A78BFA'
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
                        background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontWeight: 800, fontSize: '16px',
                      }}>
                        {room.host?.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 700, color: 'white', fontSize: '15px' }}>
                            {room.host?.username || 'Unknown'}
                          </span>
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
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '100px', background: 'rgba(124,58,237,0.2)', color: '#A78BFA', fontWeight: 600 }}>
                              Моя
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                          <span style={{
                            fontSize: '12px', padding: '2px 10px', borderRadius: '100px', fontWeight: 600,
                            background: room.status === 'waiting' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                            color: room.status === 'waiting' ? '#F59E0B' : '#10B981',
                          }}>
                            {room.status === 'waiting' ? '⏳ Ожидание' : '🎮 В игре'}
                          </span>
                          {room.guest && (
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                              vs {room.guest.username}
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
                            background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
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
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}>
        <div style={{
          background: 'rgba(30,30,40,0.95)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '24px', padding: '32px', textAlign: 'center', maxWidth: '420px', width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
        }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '22px', color: '#fff' }}>🎮 Новая игра</h3>
          <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>
            Настрой параметры и начни!
          </p>

          {/* Language picker */}
          <div style={{ marginBottom: '24px', textAlign: 'left' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 10px' }}>
              Язык игры
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {LANGUAGES.map(lang => (
                <button
                  key={lang.id}
                  onClick={() => setSelectedLang(lang.id)}
                  style={{
                    padding: '10px 18px', borderRadius: '14px', border: 'none',
                    cursor: 'pointer', fontWeight: 700, fontSize: '14px',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    transition: 'all 0.18s',
                    background: selectedLang === lang.id
                      ? 'linear-gradient(135deg, #7C3AED, #06B6D4)'
                      : 'rgba(255,255,255,0.07)',
                    color: selectedLang === lang.id ? 'white' : 'rgba(255,255,255,0.55)',
                    boxShadow: selectedLang === lang.id ? '0 4px 16px rgba(124,58,237,0.35)' : 'none',
                    outline: selectedLang === lang.id ? '2px solid rgba(124,58,237,0.4)' : '2px solid transparent',
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{lang.flag}</span>
                  {lang.nativeName}
                </button>
              ))}
            </div>
          </div>

          {/* Superpower config */}
          <div style={{ marginBottom: '24px', textAlign: 'left' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 12px' }}>
              ⚡ Супер Силы (зарядов на игру)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {SUPERPOWERS.map(sp => (
                <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ fontSize: '20px', flexShrink: 0 }}>{sp.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{sp.name}</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sp.shortDesc}</div>
                  </div>
                  {/* Counter buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <button
                      onClick={() => setSpConfig(p => ({ ...p, [sp.id]: Math.max(0, p[sp.id] - 1) }))}
                      style={{ width: '28px', height: '28px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: '16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                    >−</button>
                    <span style={{ width: '24px', textAlign: 'center', fontSize: '16px', fontWeight: 800,
                      color: spConfig[sp.id] === 0 ? 'rgba(255,255,255,0.2)' : sp.color
                    }}>{spConfig[sp.id]}</span>
                    <button
                      onClick={() => setSpConfig(p => ({ ...p, [sp.id]: Math.min(3, p[sp.id] + 1) }))}
                      style={{ width: '28px', height: '28px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: '16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
            Выбери количество раундов
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '24px' }}>
            {[3, 5, 7].map(n => {
              const isPending = pendingRounds === n
              const isOtherPending = pendingRounds !== null && pendingRounds !== n
              return (
                <button
                  key={n}
                  onClick={() => createRoom(n)}
                  disabled={pendingRounds !== null}
                  className={`btn-game ${isPending ? 'btn-pending' : ''}`}
                  style={{
                    width: '90px', padding: '20px 0', borderRadius: '18px', border: 'none',
                    background: isPending
                      ? 'linear-gradient(135deg, #7C3AED, #06B6D4)'
                      : 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.2))',
                    boxShadow: isPending ? '0 8px 30px rgba(124,58,237,0.4)' : 'none',
                    opacity: isOtherPending ? 0.4 : 1,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  {isPending ? (
                    <><BtnSpinner size={22} /><span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Создаём...</span></>
                  ) : (
                    <><span style={{ fontSize: '28px', fontWeight: 900, color: '#fff' }}>{n}</span><span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>раунд{n === 3 ? 'а' : 'ов'}</span></>
                  )}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setShowRoundPicker(false)}
            style={{
              padding: '10px 24px', borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: '14px',
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            Отмена
          </button>
        </div>
      </div>
    )}
  </>
  )
}
