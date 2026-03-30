import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '24px', padding: '20px',
    }}>
      {/* Ambient */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '30%', left: '40%',
          width: '400px', height: '400px',
          background: 'radial-gradient(circle, rgba(239,68,68,0.12) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(60px)',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '480px' }}>
        <div style={{
          width: '96px', height: '96px', margin: '0 auto 24px',
          borderRadius: '28px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(124,58,237,0.1))',
          border: '1px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '44px',
        }}>
          🔍
        </div>

        <h1 style={{
          fontSize: '72px', fontWeight: 900,
          background: 'linear-gradient(135deg, #EF4444, #F59E0B)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text', margin: '0 0 8px',
        }}>
          404
        </h1>

        <p style={{ fontSize: '18px', fontWeight: 700, color: 'white', margin: '0 0 8px' }}>
          Страница не найдена
        </p>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: '0 0 32px', lineHeight: 1.6 }}>
          Похоже, эта страница была перевёрнута задом наперёд и исчезла. Попробуй вернуться в лобби!
        </p>

        <Link
          to="/"
          style={{
            display: 'inline-block',
            padding: '14px 32px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
            color: 'white', fontWeight: 700, fontSize: '15px',
            textDecoration: 'none',
            boxShadow: '0 10px 32px rgba(124,58,237,0.4)',
            transition: 'all 0.2s',
          }}
        >
          ← На главную
        </Link>
      </div>
    </div>
  )
}
