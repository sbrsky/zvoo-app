import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const features = [
  {
    icon: '🎙️',
    title: 'Запись и реверс',
    desc: 'Записывай фразу — система мгновенно переворачивает звук в нечитаемую «тарабарщину»',
    gradient: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(124,58,237,0.05))',
    border: 'rgba(124,58,237,0.25)',
    glow: 'rgba(124,58,237,0.15)',
  },
  {
    icon: '🌐',
    title: 'Мультиплеер',
    desc: 'Бросай вызов другу дистанционно. Суперфаст Realtime через Supabase',
    gradient: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(6,182,212,0.05))',
    border: 'rgba(6,182,212,0.25)',
    glow: 'rgba(6,182,212,0.15)',
  },
  {
    icon: '🤖',
    title: 'AI Судья',
    desc: 'Gemini AI оценивает точность имитации и даёт развёрнутый комментарий',
    gradient: 'linear-gradient(135deg, rgba(167,139,250,0.2), rgba(103,232,249,0.05))',
    border: 'rgba(167,139,250,0.2)',
    glow: 'rgba(167,139,250,0.12)',
  },
]

const steps = [
  { step: '01', label: 'Хост записывает фразу', icon: '🎤' },
  { step: '02', label: 'Система переворачивает аудио', icon: '↩️' },
  { step: '03', label: 'Гость повторяет «тарабарщину»', icon: '🎧' },
  { step: '04', label: 'AI выставляет оценку точности', icon: '⭐' },
]

export default function Landing() {
  const { user } = useAuth()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Hero */}
      <section style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingTop: '96px', paddingBottom: '80px', paddingLeft: '16px', paddingRight: '16px' }}>
        {/* Background orbs */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', top: '20%', left: '15%',
            width: '500px', height: '500px',
            background: 'radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 70%)',
            borderRadius: '50%', filter: 'blur(60px)',
            animation: 'pulse-glow 5s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', bottom: '15%', right: '10%',
            width: '450px', height: '450px',
            background: 'radial-gradient(circle, rgba(6,182,212,0.15) 0%, transparent 70%)',
            borderRadius: '50%', filter: 'blur(60px)',
            animation: 'pulse-glow 5s ease-in-out infinite 2.5s',
          }} />
          {/* Subtle grid */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }} />
        </div>

        <div style={{ position: 'relative', zIndex: 10, maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '6px 16px', marginBottom: '32px',
            borderRadius: '100px',
            background: 'rgba(124,58,237,0.12)',
            border: '1px solid rgba(124,58,237,0.3)',
            fontSize: '13px', color: '#4DD9C8', fontWeight: 600,
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4DD9C8', display: 'inline-block', animation: 'pulse-glow 2s ease-in-out infinite' }} />
            AI-мультиплеерная аудио игра
          </div>

          {/* Logo icon */}
          <div style={{ marginBottom: '28px', animation: 'float 4s ease-in-out infinite' }}>
            <div style={{
              width: '96px', height: '96px', margin: '0 auto',
              borderRadius: '28px',
              background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '44px',
              boxShadow: '0 20px 60px rgba(124,58,237,0.4), 0 0 100px rgba(124,58,237,0.15)',
            }}>↩</div>
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(48px, 8vw, 88px)',
            fontWeight: 900, lineHeight: 1.05,
            margin: '0 0 20px', letterSpacing: '-0.03em',
          }}>
            <span style={{
              background: 'linear-gradient(135deg, #4DD9C8 0%, #7EEEE4 60%, #4DD9C8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              backgroundSize: '200%',
            }}>ZVOO</span>
            <span style={{ color: 'white' }}> AI</span>
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: 'clamp(16px, 2.5vw, 20px)',
            color: 'rgba(255,255,255,0.55)',
            maxWidth: '580px', margin: '0 auto 48px',
            lineHeight: 1.7,
          }}>
            Запиши фразу, переверни звук задом наперёд и брось вызов другу — 
            пусть попробует его повторить. AI оценит точность!
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }}>
            <Link
              to={user ? '/lobby' : '/login'}
              style={{
                padding: '16px 36px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
                color: 'white', fontWeight: 700, fontSize: '16px',
                textDecoration: 'none',
                boxShadow: '0 12px 40px rgba(124,58,237,0.4)',
                transition: 'all 0.25s',
                display: 'inline-block',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 16px 50px rgba(124,58,237,0.5)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(124,58,237,0.4)' }}
            >
              {user ? '🎮 Перейти в лобби' : '🎮 Начать играть'}
            </Link>
            {!user && (
              <Link
                to="/login"
                style={{
                  padding: '16px 36px',
                  borderRadius: '16px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.8)', fontWeight: 600, fontSize: '16px',
                  textDecoration: 'none',
                  transition: 'all 0.25s',
                  display: 'inline-block',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              >
                Уже есть аккаунт →
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '80px 24px', maxWidth: '1100px', margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '64px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.15em', color: '#4DD9C8', marginBottom: '12px' }}>КАК ЭТО РАБОТАЕТ</p>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, color: 'white', margin: 0 }}>
            4 шага до победы
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              padding: '28px 24px',
              borderRadius: '20px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              transition: 'all 0.3s',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, right: 0, left: 0,
                height: '2px',
                background: 'linear-gradient(90deg, #147A8A, #2DC4B2)',
                opacity: 0.6,
              }} />
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#147A8A', marginBottom: '12px', letterSpacing: '0.05em' }}>
                {s.step}
              </div>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>{s.icon}</div>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', fontWeight: 500, margin: 0, lineHeight: 1.5 }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature cards */}
      <section style={{ padding: '0 24px 100px', maxWidth: '1100px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
          {features.map((f, i) => (
            <div key={i} style={{
              padding: '32px',
              borderRadius: '24px',
              background: f.gradient,
              border: `1px solid ${f.border}`,
              boxShadow: `0 8px 32px ${f.glow}`,
              transition: 'all 0.3s',
            }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <div style={{ fontSize: '36px', marginBottom: '16px' }}>{f.icon}</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'white', marginBottom: '10px' }}>{f.title}</h3>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '24px',
        textAlign: 'center',
        fontSize: '13px',
        color: 'rgba(255,255,255,0.25)',
      }}>
        ZVOO © 2026 · Powered by Supabase & Gemini AI
      </footer>
    </div>
  )
}
