import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { APP_NAME } from '../lib/constants'

export default function Navbar() {
  const { user, profile, signOut } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const handleSignOut = async () => {
    setMenuOpen(false)
    await signOut()
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isActive = (path) => location.pathname === path

  const linkStyle = (path) => ({
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '14px', padding: '8px 16px', borderRadius: '12px',
    color: isActive(path) ? 'white' : 'rgba(255,255,255,0.55)',
    background: isActive(path) ? 'rgba(124,58,237,0.18)' : 'transparent',
    textDecoration: 'none', fontWeight: 500, transition: 'all 0.2s',
  })

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      background: 'rgba(10,10,26,0.75)',
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>

          {/* Logo */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '12px',
              background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, color: 'white', fontSize: '14px',
              transition: 'transform 0.2s',
            }}>↩</div>
            <span style={{
              fontWeight: 700, fontSize: '18px', letterSpacing: '-0.01em',
              background: 'linear-gradient(135deg, #A78BFA, #67E8F9)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>{APP_NAME}</span>
          </Link>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {user ? (
              <>
                {/* Lobby link */}
                <Link to="/lobby" style={linkStyle('/lobby')}>
                  <span>🎮</span> Лобби
                </Link>
                <Link to="/practice" style={linkStyle('/practice')}>
                  <span>🎯</span> Тренировка
                </Link>

                {/* Avatar dropdown */}
                <div style={{ position: 'relative' }} ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '4px 12px 4px 4px', borderRadius: '16px',
                      background: menuOpen ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'white', fontSize: '12px', fontWeight: 700, overflow: 'hidden',
                    }}>
                      {profile?.avatar_url
                        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (profile?.username?.[0]?.toUpperCase() || '?')}
                    </div>
                    <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile?.username || 'Player'}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
                      <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {/* Dropdown */}
                  {menuOpen && (
                    <div style={{
                      position: 'absolute', right: 0, top: '100%', marginTop: '8px',
                      width: '208px', borderRadius: '16px', overflow: 'hidden',
                      background: 'rgba(18,18,42,0.95)',
                      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                    }}>
                      {/* Profile header */}
                      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Вошёл как</p>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: 'white', margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {profile?.username || user?.email}
                        </p>
                      </div>

                      {/* Menu items */}
                      <div style={{ padding: '6px' }}>
                        <Link
                          to="/dashboard"
                          onClick={() => setMenuOpen(false)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '10px 12px', borderRadius: '12px',
                            fontSize: '14px', color: 'rgba(255,255,255,0.7)',
                            textDecoration: 'none', transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <span>👤</span> Профиль
                        </Link>

                        <Link
                          to="/admin"
                          onClick={() => setMenuOpen(false)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '10px 12px', borderRadius: '12px',
                            fontSize: '14px', color: 'rgba(255,255,255,0.7)',
                            textDecoration: 'none', transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <span>🛠</span> Админ-панель
                        </Link>

                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '4px 8px' }} />

                        <button
                          onClick={handleSignOut}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
                            padding: '10px 12px', borderRadius: '12px', border: 'none',
                            background: 'transparent',
                            fontSize: '14px', color: 'rgba(239,68,68,0.8)',
                            cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#EF4444' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(239,68,68,0.8)' }}
                        >
                          <span>🚪</span> Выйти из аккаунта
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <Link to="/login" style={{
                fontSize: '14px', padding: '10px 20px', borderRadius: '12px',
                fontWeight: 600, color: 'white', textDecoration: 'none',
                background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
                transition: 'all 0.2s',
              }}>Войти</Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
