import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { getRank, getNextRank, getXPForGame, getUnlockedAchievements, ACHIEVEMENTS } from '../lib/constants'
import { LANGUAGES, DEFAULT_LANGUAGE_ID } from '../lib/languages'
import { UserProfileDrawer } from '../components/UserProfileDrawer'

export default function Dashboard() {
  const { user, profile, updateProfile, signOut } = useAuth()
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(profile?.username || '')
  const [saving, setSaving] = useState(false)
  const [recentGames, setRecentGames] = useState([])
  const [loadingGames, setLoadingGames] = useState(true)
  const [prefLang, setPrefLang] = useState(profile?.preferred_language || DEFAULT_LANGUAGE_ID)
  const [savingLang, setSavingLang] = useState(false)
  const [drawerUserId, setDrawerUserId] = useState(null)

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

  // Fetch recent finished games from finished_games table
  useEffect(() => {
    if (!user) return
    const fetchGames = async () => {
      setLoadingGames(true)
      try {
        const { data: fg } = await supabase
          .from('finished_games')
          .select('*')
          .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(10)

        if (!fg || fg.length === 0) { setRecentGames([]); setLoadingGames(false); return }

        const opponentIds = [...new Set(fg.map(g => g.host_id === user.id ? g.guest_id : g.host_id).filter(Boolean))]
        const { data: opponents } = opponentIds.length > 0
          ? await supabase.from('profiles').select('id, username, avatar_url').in('id', opponentIds)
          : { data: [] }
        const opponentMap = Object.fromEntries((opponents || []).map(o => [o.id, o]))

        const games = fg.map(g => {
          const isUserHost = g.host_id === user.id
          const opponentId = isUserHost ? g.guest_id : g.host_id
          const opponent = opponentMap[opponentId]
          const myScore = isUserHost ? g.host_score : g.guest_score
          const theirScore = isUserHost ? g.guest_score : g.host_score
          const won = g.winner_id === user.id
          const tie = !g.winner_id
          return {
            id: g.id,
            score: myScore,
            theirScore,
            comment: '',
            date: g.created_at,
            opponent: opponent?.username || 'Неизвестный',
            opponentId,
            opponentAvatar: opponent?.avatar_url,
            won, tie,
            ratingChange: isUserHost ? g.host_rating_change : g.guest_rating_change,
            totalRounds: g.total_rounds,
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
    { label: 'Игр сыграно', value: profile.games_played ?? 0, icon: '🎮', accent: '#4DD9C8' },
    { label: 'Победы', value: profile.games_won ?? 0, icon: '🏆', accent: '#7EEEE4' },
    { label: 'Средний балл', value: profile.avg_score?.toFixed(0) ?? 0, icon: '⭐', accent: '#4DD9C8' },
    { label: 'Лучший балл', value: profile.best_score ?? 0, icon: '💎', accent: '#10B981' },
    { label: 'Win Rate', value: `${winRate}%`, icon: '📊', accent: '#7EEEE4' },
    { label: 'Серия побед', value: profile.win_streak ?? 0, icon: '🔥', accent: '#F59E0B' },
  ]

  return (
    <>
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
            background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
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
                  background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
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
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#4DD9C8' }}>{nextRank.minXP - totalXP} XP</div>
                </div>
              )}
            </div>
            {/* XP Progress bar */}
            <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '3px',
                width: `${Math.min(100, progressToNext)}%`,
                background: 'linear-gradient(90deg, #147A8A, #2DC4B2)',
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
                      ? 'linear-gradient(135deg, #147A8A, #2DC4B2)'
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

      {/* Recent games — from finished_games table */}
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
            <p style={{ margin: 0, fontSize: '14px' }}>Пока нет завершённых игр · <a href="/lobby" style={{ color: '#4DD9C8', textDecoration: 'none' }}>Перейти в лобби →</a></p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recentGames.map(game => (
              <div key={game.id} style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '14px 18px', borderRadius: '14px',
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${game.won ? 'rgba(16,185,129,0.2)' : game.tie ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'}`,
                transition: 'all 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                {/* Result badge */}
                <div style={{
                  width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
                  background: game.won ? 'rgba(16,185,129,0.15)' : game.tie ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '22px',
                }}>
                  {game.won ? '🏆' : game.tie ? '🤝' : '💪'}
                </div>
                {/* Score info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 800, color: game.won ? '#10B981' : game.tie ? '#F59E0B' : '#EF4444' }}>
                      {game.score} — {game.theirScore}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>vs</span>
                    <button
                      onClick={() => game.opponentId && setDrawerUserId(game.opponentId)}
                      style={{
                        background: 'none', border: 'none', padding: '0',
                        color: '#4DD9C8', fontSize: '13px', fontWeight: 700,
                        cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted',
                        textUnderlineOffset: '2px',
                      }}
                    >
                      {game.opponent}
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span>{new Date(game.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                    <span>·</span>
                    <span>{game.totalRounds} раунд{game.totalRounds === 1 ? '' : 'а'}</span>
                    {game.ratingChange != null && (
                      <>
                        <span>·</span>
                        <span style={{ color: game.ratingChange >= 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                          {game.ratingChange >= 0 ? '▲' : '▼'}{Math.abs(game.ratingChange)} pts
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


    </div>

    {/* Profile drawer */}
    {drawerUserId && (
      <UserProfileDrawer
        userId={drawerUserId}
        onClose={() => setDrawerUserId(null)}
      />
    )}
    </>
  )
}

