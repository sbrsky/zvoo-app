import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function Onboarding() {
  const navigate = useNavigate()
  const { user, updateProfile } = useAuth()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)

  const slides = [
    {
      title: "Добро пожаловать в EchoFlip! 🪞",
      desc: "Это игра, где тебе придётся вывихнуть мозг, чтобы говорить задом наперёд.",
      icon: "🤯",
      bg: "linear-gradient(135deg, #7C3AED, #06B6D4)"
    },
    {
      title: "Как это работает?",
      desc: "1. Хост записывает любую фразу.\n2. Приложение переворачивает её.\n3. Гость пытается в точности повторить перевёрнутые звуки.",
      icon: "🔄",
      bg: "linear-gradient(135deg, #EC4899, #8B5CF6)"
    },
    {
      title: "Магия AI 🤖",
      desc: "В конце раунда нейросеть (Gemini) оценивает, насколько точно Гость скопировал оригинал, и ставит оценку до 100 баллов! Прокачивай ранг и бей рекорды.",
      icon: "🏆",
      bg: "linear-gradient(135deg, #F59E0B, #EF4444)"
    }
  ]

  const completeOnboarding = async () => {
    if (!user) {
      navigate('/login')
      return
    }
    setLoading(true)
    try {
      await updateProfile({ has_completed_onboarding: true })
      navigate('/lobby')
    } catch (err) {
      console.error('Error saving onboarding state:', err)
      navigate('/lobby')
    } finally {
      setLoading(false)
    }
  }

  const nextStep = () => {
    if (step < slides.length - 1) {
      setStep(step + 1)
    } else {
      completeOnboarding()
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0A0A1A',
      padding: '24px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '32px',
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <div style={{
          height: '200px',
          background: slides[step].bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '80px',
          transition: 'background 0.5s ease',
        }}>
          {slides[step].icon}
        </div>

        <div style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' }}>
            {slides.map((_, i) => (
              <div key={i} style={{
                height: '6px',
                width: i === step ? '24px' : '6px',
                borderRadius: '3px',
                background: i === step ? '#fff' : 'rgba(255,255,255,0.2)',
                transition: 'all 0.3s ease'
              }} />
            ))}
          </div>

          <h2 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 12px 0', color: '#fff' }}>
            {slides[step].title}
          </h2>
          
          <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: '0 0 32px 0', minHeight: '72px', whiteSpace: 'pre-line' }}>
            {slides[step].desc}
          </p>

          <button 
            onClick={nextStep}
            disabled={loading}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '16px',
              border: 'none',
              background: '#fff',
              color: '#0A0A1A',
              fontSize: '16px',
              fontWeight: 800,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'transform 0.1s',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {loading ? 'Секунду...' : (step === slides.length - 1 ? 'Начать играть 🚀' : 'Дальше')}
          </button>
        </div>
      </div>
    </div>
  )
}
