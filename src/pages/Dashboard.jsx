import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { getRank, getNextRank, getXPForGame, getUnlockedAchievements, ACHIEVEMENTS } from '../lib/constants'
import { LANGUAGES, DEFAULT_LANGUAGE_ID } from '../lib/languages'

export default function Dashboard() {
  const { user, profile, updateProfile, signOut } = useAuth()
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(profile?.username || '')
  const [saving, setSaving] = useState(false)
  const [recentGames, setRecentGames] = useState([])
  const [loadingGames, setLoadingGames] = useState(true)
  const [prefLang, setPrefLang] = useState(profile?.preferred_language || DEFAULT_LANGUAGE_ID)
  const [savingLang, setSavingLang] = useState(false)

  // Sync prefLang when profile loads
  useEffect(() => {
    if (profile?.preferred_language) setPrefLang(profile.preferred_language)
  }, [profile?.preferred_language])


  const handleSignOut = () => signOut()

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateProfile({ username })
      setEditing(false)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLangChange = async (langId) => {
    if (langId === prefLang || savingLang) return
    setSavingLang(true)
    setPrefLang(langId)
    try {
      await updateProfile({ preferred_language: langId })
    } catch (err) {
      console.error('Failed to save preferred language:', err)
      setPrefLang(prefLang) // revert on error
    } finally {
      setSavingLang(false)
    }
  }

  // Fetch recent game sessions
  useEffect(() => {
    if (!user) return
    const fetchGames = async () => {
      setLoadingGames(true)
      try {
        const { data: rooms } = await supabase
          .from('rooms')
          .select('id, host_id, guest_id, status, created_at')
          .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
          .eq('status', 'finished')
          .order('created_at', { ascending: false })
          .limit(10)

        if (!rooms || rooms.length === 0) { setRecentGames([]); return }

        const roomIds = rooms.map(r => r.id)
        const { data: sessions } = await supabase
          .from('game_sessions')
          .select('id, room_id, ai_score, ai_comment, created_at')
          .in('room_id', roomIds)
          .order('created_at', { ascending: false })

        const opponentIds = [...new Set(rooms.map(r => r.host_id === user.id ? r.guest_id : r.host_id).filter(Boolean))]
        const { data: opponents } = opponentIds.length > 0
          ? await supabase.from('profiles').select('id, username, avatar_url').in('id', opponentIds)
          : { data: [] }

        const opponentMap = Object.fromEntries((opponents || []).map(o => [o.id, o]))

        const games = rooms.map(room => {
          const session = sessions?.find(s => s.room_id === room.id)
          const isUserHost = room.host_id === user.id
          const opponentId = isUserHost ? room.guest_id : room.host_id
          const opponent = opponentMap[opponentId]
          return {
            id: room.id,
            score: session?.ai_score ?? null,
            comment: session?.ai_comment || '',
            date: room.created_at,
            opponent: opponent?.username || 'Неизвестный',
            opponentAvatar: opponent?.avatar_url,
            isUserHost,
          }
        })
        setRecentGames(games)
      } catch (err) {
        console.warn('fetchGames error:', err)
      } finally {
        setLoadingGames(false)
      }
    }
    fetchGames()
  }, [user])

  if (!profile) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '15px' }}>
      Загрузка профиля...
    </div>
  )

  // Calculate XP and rank
  const totalXP = (profile.games_played || 0) * 10 + Math.round((profile.avg_score || 0) * (profile.games_played || 0) * 0.5)
  const currentRank = getRank(totalXP)
  const nextRank = getNextRank(totalXP)
  const progressToNext = nextRank ? ((totalXP - currentRank.minXP) / (nextRank.minXP - currentRank.minXP)) * 100 : 100

  // Calculate stats for achievements
  const statsForAchievements = {
    games_played: profile.games_played || 0,
    games_won: profile.games_won || 0,
    best_score: profile.best_score || 0,
    win_streak: profile.win_streak || 0,
  }
  const unlocked = getUnlockedAchievements(statsForAchievements)
  const unlockedIds = new Set(unlocked.map(a => a.id))

  const winRate = profile.games_played > 0
    ? ((profile.games_won / profile.games_played) * 100).toFixed(0)
    : 0

  const stats = [
    { label: 'Игр сыграно', value: profile.games_played ?? 0, icon: '🎮', accent: '#A78BFA' },
    { label: 'Победы', value: profile.games_won ?? 0, icon: '🏆', accent: '#67E8F9' },
    { label: 'Средний балл', value: profile.avg_score?.toFixed(0) ?? 0, icon: '⭐', accent: '#A78BFA' },
    { label: 'Лучший балл', value: profile.best_score ?? 0, icon: '💎', accent: '#10B981' },
    { label: 'Win Rate', value: `${winRate}%`, icon: '📊', accent: '#67E8F9' },
    { label: 'Серия побед', value: profile.win_streak ?? 0, icon: '🔥', accent: '#F59E0B' },
  ]

  return (
    <div style={{ minHeight: '100vh', padding: '96px 20px 48px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, color: 'white', margin: '0 0 6px' }}>Профиль</h1>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Статистика, ранг и достижения</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
        {/* Profile Card with Rank */}
        <div style={{
          padding: '36px 28px', borderRadius: '24px',
          background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
          boxShadow: '0 8px 40px rgba(124,58,237,0.12)',
        }}>
          {/* Avatar */}
          <div style={{
            width: '88px', height: '88px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '36px', fontWeight: 800, color: 'white', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(124,58,237,0.35)',
          }}>
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (profile.username?.[0]?.toUpperCase() || '?')
            }
          </div>

          {editing ? (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input value={username} onChange={e => setUsername(e.target.value)} style={{
                padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(124,58,237,0.4)', color: 'white', fontSize: '14px',
                outline: 'none', textAlign: 'center', boxSizing: 'border-box', width: '100%',
              }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleSave} disabled={saving} style={{
                  flex: 1, padding: '9px', borderRadius: '10px', border: 'none',
                  background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
                  color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}>{saving ? '...' : 'Сохранить'}</button>
                <button onClick={() => setEditing(false)} style={{
                  flex: 1, padding: '9px', borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
                  color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer',
                }}>Отмена</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'white', margin: '0 0 4px' }}>{profile.username}</h2>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', margin: 0 }}>{profile.email || ''}</p>
              </div>
              <button onClick={() => { setEditing(true); setUsername(profile.username) }} style={{
                padding: '8px 20px', borderRadius: '10px', border: 'none',
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)',
                fontSize: '13px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              >✏️ Редактировать</button>
            </>
          )}

          {/* Rank Badge */}
          <div style={{
            width: '100%', padding: '16px', borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(6,182,212,0.1))',
            border: '1px solid rgba(124,58,237,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px' }}>{currentRank.emoji}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'white' }}>{currentRank.name}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{totalXP} XP</div>
                </div>
              </div>
              {nextRank && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>До «{nextRank.name}»</div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#A78BFA' }}>{nextRank.minXP - totalXP} XP</div>
                </div>
              )}
            </div>
            {/* XP Progress bar */}
            <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '3px',
                width: `${Math.min(100, progressToNext)}%`,
                background: 'linear-gradient(90deg, #7C3AED, #06B6D4)',
                transition: 'width 0.6s ease-out',
              }} />
            </div>
          </div>

          <button onClick={handleSignOut} style={{
            padding: '10px 24px', borderRadius: '12px',
            border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)',
            color: 'rgba(239,68,68,0.8)', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s', width: '100%',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#EF4444' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = 'rgba(239,68,68,0.8)' }}
          >🚪 Выйти из аккаунта</button>

          {/* Language preference */}
          <div style={{
            width: '100%', padding: '16px', borderRadius: '16px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <p style={{
              fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)',
              margin: '0 0 12px',
            }}>🌐 Дефолтный язык игры</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {LANGUAGES.map(lang => (
                <button
                  key={lang.id}
                  onClick={() => handleLangChange(lang.id)}
                  disabled={savingLang}
                  style={{
                    padding: '8px 16px', borderRadius: '12px', border: 'none',
                    cursor: savingLang ? 'wait' : 'pointer',
                    fontWeight: 700, fontSize: '13px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    transition: 'all 0.18s',
                    opacity: savingLang && lang.id !== prefLang ? 0.5 : 1,
                    background: prefLang === lang.id
                      ? 'linear-gradient(135deg, #7C3AED, #06B6D4)'
                      : 'rgba(255,255,255,0.07)',
                    color: prefLang === lang.id ? 'white' : 'rgba(255,255,255,0.55)',
                    boxShadow: prefLang === lang.id ? '0 4px 12px rgba(124,58,237,0.3)' : 'none',
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{lang.flag}</span>
                  {lang.nativeName}
                  {prefLang === lang.id && savingLang && <span style={{ fontSize: '10px', opacity: 0.7 }}>···</span>}
                </button>
              ))}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>
              Будет подставляться по умолчанию при создании комнаты
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {stats.map((stat, i) => (
            <div key={i} style={{
              padding: '24px 20px', borderRadius: '20px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              transition: 'all 0.25s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            >
              <div style={{ fontSize: '22px', marginBottom: '10px' }}>{stat.icon}</div>
              <div style={{ fontSize: '30px', fontWeight: 800, color: stat.accent, marginBottom: '4px' }}>{stat.value}</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Achievements */}
      <div style={{
        marginTop: '24px', padding: '32px', borderRadius: '24px',
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'white', margin: '0 0 6px' }}>
          🏅 Достижения
        </h3>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: '0 0 20px' }}>
          {unlocked.length} / {ACHIEVEMENTS.length} разблокировано
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {ACHIEVEMENTS.map(ach => {
            const isUnlocked = unlockedIds.has(ach.id)
            return (
              <div key={ach.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '14px 16px', borderRadius: '14px',
                background: isUnlocked ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isUnlocked ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)'}`,
                opacity: isUnlocked ? 1 : 0.4,
                transition: 'all 0.2s',
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
                  background: isUnlocked
                    ? 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(6,182,212,0.2))'
                    : 'rgba(255,255,255,0.04)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px',
                  filter: isUnlocked ? 'none' : 'grayscale(1)',
                }}>
                  {ach.emoji}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: isUnlocked ? 'white' : 'rgba(255,255,255,0.4)' }}>
                    {ach.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                    {ach.desc}
                  </div>
                </div>
                {isUnlocked && <span style={{ fontSize: '14px', marginLeft: 'auto' }}>✅</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent games — real data */}
      <div style={{
        marginTop: '24px', padding: '32px', borderRadius: '24px',
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'white', margin: '0 0 20px' }}>
          📋 Последние игры
        </h3>

        {loadingGames ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.3)', fontSize: '14px' }}>
            ⏳ Загрузка...
          </div>
        ) : recentGames.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.25)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎵</div>
            <p style={{ margin: 0, fontSize: '14px' }}>Пока нет завершённых игр · <a href="/lobby" style={{ color: '#A78BFA', textDecoration: 'none' }}>Перейти в лобби →</a></p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recentGames.map(game => (
              <div key={game.id} style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '14px 18px', borderRadius: '14px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                transition: 'all 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                <div style={{
                  width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
                  background: game.score >= 70 ? 'rgba(16,185,129,0.15)' : game.score >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${game.score >= 70 ? 'rgba(16,185,129,0.3)' : game.score >= 40 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', fontWeight: 800,
                  color: game.score >= 70 ? '#10B981' : game.score >= 40 ? '#F59E0B' : '#EF4444',
                }}>
                  {game.score ?? '—'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: '2px' }}>
                    vs {game.opponent}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                    {game.isUserHost ? '🎙️ Хост' : '🎧 Гость'} · +{getXPForGame(game.score || 0)} XP · {new Date(game.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ fontSize: '18px' }}>
                  {game.score >= 70 ? '🏆' : game.score >= 40 ? '👍' : '😅'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


    </div>
  )
}
