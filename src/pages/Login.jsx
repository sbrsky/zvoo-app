import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, signUp, signInWithGoogle, user } = useAuth()
  const navigate = useNavigate()

  // Already logged in — bounce to lobby
  if (user) return <Navigate to="/lobby" replace />


  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isSignUp) {
        if (!username.trim()) throw new Error('Введите имя пользователя')
        await signUp(email, password, username.trim())
      } else {
        await signIn(email, password)
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ paddingTop: '72px' }}>
      {/* Ambient orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div style={{
          position: 'absolute', top: '25%', left: '30%',
          width: '400px', height: '400px',
          background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(40px)',
          animation: 'pulse-glow 4s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', right: '25%',
          width: '350px', height: '350px',
          background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(40px)',
          animation: 'pulse-glow 4s ease-in-out infinite 2s',
        }} />
      </div>

      <div className="relative w-full max-w-md" style={{ zIndex: 10 }}>
        {/* Card */}
        <div style={{
          background: 'rgba(18, 18, 42, 0.8)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: '24px',
          padding: '40px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{
              width: '64px', height: '64px', margin: '0 auto 16px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 10px 30px rgba(124,58,237,0.35)',
            }}>↩</div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'white', margin: '0 0 8px' }}>
              {isSignUp ? 'Создать аккаунт' : 'Добро пожаловать'}
            </h1>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              {isSignUp ? 'Присоединяйся к ZVOO' : 'Войди, чтобы начать играть'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              marginBottom: '20px', padding: '12px 16px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#FCA5A5', fontSize: '14px',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Google button */}
          <button
            onClick={handleGoogle}
            style={{
              width: '100%', padding: '13px', marginBottom: '24px',
              borderRadius: '14px', border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)',
              color: 'white', fontSize: '14px', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.09)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Продолжить с Google
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>или email</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {isSignUp && (
              <InputField
                label="Имя пользователя"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="echomaster"
                required
              />
            )}
            <InputField
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <InputField
              label="Пароль"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '14px',
                borderRadius: '14px', border: 'none',
                background: loading ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #147A8A, #2DC4B2)',
                color: 'white', fontSize: '15px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 8px 24px rgba(124,58,237,0.35)',
                marginTop: '4px',
              }}
            >
              {loading ? '⟳ Загрузка...' : isSignUp ? 'Создать аккаунт' : 'Войти'}
            </button>
          </form>

          {/* Toggle */}
          <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'rgba(255,255,255,0.4)' }}>
            {isSignUp ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}{' '}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError('') }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#4DD9C8', fontWeight: 600, fontSize: '14px', padding: 0,
              }}
            >
              {isSignUp ? 'Войти' : 'Регистрация'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

function InputField({ label, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '6px', letterSpacing: '0.05em' }}>
        {label}
      </label>
      <input
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', padding: '12px 16px',
          borderRadius: '12px',
          background: focused ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${focused ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.08)'}`,
          color: 'white', fontSize: '15px', outline: 'none',
          transition: 'all 0.2s',
          boxSizing: 'border-box',
          boxShadow: focused ? '0 0 0 3px rgba(124,58,237,0.12)' : 'none',
        }}
      />
    </div>
  )
}
