import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// XP level thresholds
const XP_LEVELS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000]
const LEVEL_NAMES = ['Новичок', 'Любитель', 'Игрок', 'Эксперт', 'Мастер', 'Виртуоз', 'Чемпион', 'Легенда', 'Мифический', 'Абсолютный']

function getLevel(xp = 0) {
  let lv = 1
  XP_LEVELS.forEach((t, i) => { if (xp >= t) lv = i + 1 })
  return Math.min(lv, XP_LEVELS.length)
}

function xpForLevel(lv) { return XP_LEVELS[Math.min(lv - 1, XP_LEVELS.length - 1)] }
function xpNextLevel(lv) { return XP_LEVELS[Math.min(lv, XP_LEVELS.length - 1)] }

export function UserProfileDrawer({ userId, onClose }) {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [recentGames, setRecentGames] = useState([])
  const [h2h, setH2H] = useState(null)  // { myWins, theirWins, ties }
  const [loading, setLoading] = useState(true)
  const drawerRef = useRef(null)

  const isMe = userId === user?.id

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase
        .from('finished_games')
        .select('*')
        .or(`host_id.eq.${userId},guest_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(10),
    ]).then(([{ data: p }, { data: games }]) => {
      setProfile(p)
      setRecentGames(games || [])
      // head-to-head: games between current user and target user
      if (!isMe && user?.id) {
        const h2hGames = (games || []).filter(g =>
          (g.host_id === userId && g.guest_id === user.id) ||
          (g.guest_id === userId && g.host_id === user.id)
        )
        let myWins = 0, theirWins = 0, ties = 0
        h2hGames.forEach(g => {
          if (!g.winner_id) ties++
          else if (g.winner_id === user.id) myWins++
          else theirWins++
        })
        setH2H({ myWins, theirWins, ties, total: h2hGames.length })
      }
      setLoading(false)
    })
  }, [userId, user?.id])

  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (drawerRef.current && !drawerRef.current.contains(e.target)) onClose()
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!userId) return null

  const level = getLevel(profile?.xp || 0)
  const xpCur = (profile?.xp || 0) - xpForLevel(level)
  const xpNeeded = xpNextLevel(level) - xpForLevel(level)
  const xpPct = Math.min(100, xpNeeded > 0 ? Math.round((xpCur / xpNeeded) * 100) : 100)
  const winRate = profile?.games_played ? Math.round((profile.games_won / profile.games_played) * 100) : 0

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'flex-end',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        ref={drawerRef}
        style={{
          width: 'min(380px, 92vw)',
          height: '100%',
          background: 'linear-gradient(180deg, #0f0a1a 0%, #13101f 100%)',
          borderLeft: '1px solid rgba(167,139,250,0.15)',
          overflowY: 'auto',
          animation: 'slideInRight 0.28s cubic-bezier(0.34, 1.2, 0.64, 1)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 20px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 2,
          background: 'linear-gradient(180deg, #0f0a1a 80%, transparent)',
          paddingBottom: '12px',
        }}>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {isMe ? 'Мой профиль' : 'Профиль игрока'}
          </span>
          <button
            onClick={onClose}
            style={{
              width: '32px', height: '32px', borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer', fontSize: '16px', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'rgba(255,255,255,0.3)' }}>
            <div style={{ width: '32px', height: '32px', border: '2px solid rgba(167,139,250,0.3)', borderTopColor: '#4DD9C8', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <span style={{ fontSize: '13px' }}>Загрузка...</span>
          </div>
        ) : (
          <div style={{ flex: 1, padding: '8px 20px 32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Avatar + Name */}
            <div style={{ textAlign: 'center', paddingTop: '8px' }}>
              <div style={{
                width: '80px', height: '80px', borderRadius: '50%',
                margin: '0 auto 12px',
                background: profile?.avatar_url ? 'transparent' : 'linear-gradient(135deg, #147A8A, #4F46E5)',
                border: '3px solid rgba(167,139,250,0.3)',
                overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '32px',
              }}>
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (profile?.username?.[0]?.toUpperCase() || '?')}
              </div>
              <div style={{ fontSize: '19px', fontWeight: 800, color: 'white', marginBottom: '3px' }}>
                {profile?.username || 'Игрок'}
              </div>
              <div style={{ fontSize: '12px', color: '#4DD9C8', fontWeight: 600 }}>
                {LEVEL_NAMES[level - 1]} · Ур. {level}
              </div>
            </div>

            {/* XP Bar */}
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '14px', padding: '14px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>XP</span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{profile?.xp || 0} / {xpForLevel(level) + xpNeeded}</span>
              </div>
              <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{
                  width: `${xpPct}%`, height: '100%', borderRadius: '3px',
                  background: 'linear-gradient(90deg, #147A8A, #4DD9C8)',
                  transition: 'width 0.8s ease',
                }} />
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Рейтинг', value: `⭐ ${profile?.rating || 1000}` },
                { label: 'W/R', value: `${winRate}%` },
                { label: 'Игр', value: profile?.games_played || 0 },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  padding: '12px 8px', borderRadius: '12px', textAlign: 'center',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'white', lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '4px', fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Additional stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Лучший счёт', value: profile?.best_score || 0 },
                { label: 'Серия побед', value: `${profile?.win_streak || 0} 🔥` },
                { label: 'Ср. счёт', value: profile?.avg_score || '—' },
                { label: 'Побед', value: profile?.games_won || 0 },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  padding: '10px 12px', borderRadius: '12px',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Head-to-head (only when viewing another player) */}
            {!isMe && h2h && h2h.total > 0 && (
              <div style={{
                padding: '16px', borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(6,182,212,0.05))',
                border: '1px solid rgba(124,58,237,0.2)',
              }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '12px' }}>
                  Личные встречи ({h2h.total} {h2h.total === 1 ? 'игра' : h2h.total < 5 ? 'игры' : 'игр'})
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 900, color: '#10B981', lineHeight: 1 }}>{h2h.myWins}</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>Мои</div>
                  </div>
                  {h2h.ties > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 900, color: '#F59E0B', lineHeight: 1 }}>{h2h.ties}</div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>Ничьи</div>
                    </div>
                  )}
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 900, color: '#EF4444', lineHeight: 1 }}>{h2h.theirWins}</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>{profile?.username || 'Игрок'}</div>
                  </div>
                </div>
              </div>
            )}
            {!isMe && h2h && h2h.total === 0 && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px', textAlign: 'center',
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                fontSize: '13px', color: 'rgba(255,255,255,0.3)',
              }}>
                🎮 Вы ещё не играли друг с другом
              </div>
            )}

            {/* Recent games */}
            {recentGames.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>
                  Последние игры
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {recentGames.map((g, i) => {
                    const isHost = g.host_id === userId
                    const myScore = isHost ? g.host_score : g.guest_score
                    const theirScore = isHost ? g.guest_score : g.host_score
                    const won = g.winner_id === userId
                    const tie = !g.winner_id
                    return (
                      <div key={g.id || i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 12px', borderRadius: '12px',
                        background: 'rgba(255,255,255,0.02)',
                        border: `1px solid ${won ? 'rgba(16,185,129,0.2)' : tie ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '14px' }}>{won ? '🏆' : tie ? '🤝' : '💪'}</span>
                          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
                            {new Date(g.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: won ? '#10B981' : tie ? '#F59E0B' : '#EF4444' }}>
                            {myScore} — {theirScore}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
