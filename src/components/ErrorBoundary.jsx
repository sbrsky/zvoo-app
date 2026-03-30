import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '24px',
          background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1628 100%)',
          padding: '24px',
        }}>
          <div style={{ fontSize: '72px' }}>💥</div>
          <h2 style={{
            fontSize: '24px', fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #EF4444, #F59E0B)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Что-то пошло не так
          </h2>
          <p style={{
            fontSize: '14px', color: 'rgba(255,255,255,0.5)',
            textAlign: 'center', maxWidth: '400px', lineHeight: 1.6,
          }}>
            Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '14px 28px', borderRadius: '14px', border: 'none',
                background: 'linear-gradient(135deg, #7C3AED, #06B6D4)',
                color: '#fff', fontSize: '15px', fontWeight: 600,
                cursor: 'pointer', transition: 'transform 0.2s',
              }}
              onMouseOver={e => e.target.style.transform = 'scale(1.05)'}
              onMouseOut={e => e.target.style.transform = 'scale(1)'}
            >
              🔄 Перезагрузить
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              style={{
                padding: '14px 28px', borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff', fontSize: '15px', fontWeight: 600,
                cursor: 'pointer', transition: 'transform 0.2s',
              }}
              onMouseOver={e => e.target.style.transform = 'scale(1.05)'}
              onMouseOut={e => e.target.style.transform = 'scale(1)'}
            >
              🏠 На главную
            </button>
          </div>
          {this.state.error && (
            <details style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', maxWidth: '600px' }}>
              <summary style={{ cursor: 'pointer' }}>Детали ошибки</summary>
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>
                {this.state.error.toString()}
              </pre>
            </details>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
