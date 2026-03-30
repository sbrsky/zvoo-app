import { useEffect, useState } from 'react'
import { getXPForGame, getRank } from '../lib/constants'

export default function ScoreDisplay({ score, comment, breakdown, actualTranscription, attemptTranscription, guestGuessText, isLoading = false }) {
  const [animatedScore, setAnimatedScore] = useState(0)

  useEffect(() => {
    if (!isLoading && score !== null && score !== undefined) {
      let start = 0
      const step = score / 40
      const timer = setInterval(() => {
        start += step
        if (start >= score) { setAnimatedScore(score); clearInterval(timer) }
        else setAnimatedScore(Math.floor(start))
      }, 25)
      return () => clearInterval(timer)
    }
  }, [score, isLoading])

  if (isLoading) {
    return (
      <div style={{
        padding: '40px', borderRadius: '24px',
        background: 'rgba(124,58,237,0.08)',
        border: '1px solid rgba(124,58,237,0.2)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
        boxShadow: '0 16px 48px rgba(124,58,237,0.12)',
      }}>
        <div style={{
          width: '80px', height: '80px', borderRadius: '50%',
          border: '3px solid rgba(124,58,237,0.2)',
          borderTopColor: '#7C3AED',
          animation: 'spin 1s linear infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '28px' }}>🤖</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'white', fontWeight: 700, fontSize: '16px', margin: '0 0 6px' }}>Gemini AI транскрибирует аудио...</p>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0 }}>Сравниваем фразы и считаем результат</p>
        </div>
        <div style={{
          display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {['Оригинал', 'Попытка гостя', 'Точность догадки'].map(label => (
            <div key={label} style={{
              padding: '8px 14px', borderRadius: '12px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: '11px', color: 'rgba(255,255,255,0.25)', fontWeight: 600,
              animation: 'pulse-glow 2s ease-in-out infinite',
            }}>{label}</div>
          ))}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (score === null || score === undefined) return null

  const getEmoji = (s) => s >= 96 ? '🏆' : s >= 81 ? '⭐' : s >= 66 ? '🔥' : s >= 51 ? '👍' : s >= 31 ? '🤔' : s >= 16 ? '😅' : '💀'
  const getLabel = (s) => s >= 96 ? 'ЛЕГЕНДА!' : s >= 81 ? 'Отлично!' : s >= 66 ? 'Впечатляюще!' : s >= 51 ? 'Неплохо!' : s >= 31 ? 'Средненько' : s >= 16 ? 'Слабовато' : 'Полный провал'
  const getGlow = (s) => s >= 66 ? 'rgba(6,182,212,0.25)' : s >= 31 ? 'rgba(124,58,237,0.2)' : 'rgba(239,68,68,0.15)'
  const circumference = 2 * Math.PI * 42
  const dashOffset = circumference - (animatedScore / 100) * circumference
  const xpEarned = getXPForGame(score)

  return (
    <div style={{
      padding: '40px 32px', borderRadius: '24px',
      background: score >= 66 ? 'rgba(6,182,212,0.06)' : score >= 31 ? 'rgba(124,58,237,0.06)' : 'rgba(239,68,68,0.05)',
      border: `1px solid ${score >= 66 ? 'rgba(6,182,212,0.2)' : score >= 31 ? 'rgba(124,58,237,0.2)' : 'rgba(239,68,68,0.15)'}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px',
      boxShadow: `0 20px 60px ${getGlow(score)}`,
    }}>
      {/* Emoji + Label */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '52px', marginBottom: '8px' }}>{getEmoji(score)}</div>
        <h3 style={{ fontSize: '24px', fontWeight: 900, color: 'white', margin: 0 }}>{getLabel(score)}</h3>
      </div>

      {/* Score ring */}
      <div style={{ position: 'relative', width: '160px', height: '160px' }}>
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={score >= 66 ? '#06B6D4' : '#7C3AED'} />
              <stop offset="100%" stopColor={score >= 66 ? '#10B981' : '#06B6D4'} />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r="42" fill="none"
            stroke="url(#scoreGrad)" strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            filter="url(#glow)"
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontSize: '42px', fontWeight: 900, lineHeight: 1,
            background: 'linear-gradient(135deg, #A78BFA, #67E8F9)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>{animatedScore}</span>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, marginTop: '2px' }}>/ 100</span>
        </div>
      </div>

      {/* XP earned badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '8px 18px', borderRadius: '100px',
        background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.15))',
        border: '1px solid rgba(124,58,237,0.25)',
      }}>
        <span style={{ fontSize: '16px' }}>✨</span>
        <span style={{
          fontSize: '14px', fontWeight: 800,
          background: 'linear-gradient(135deg, #A78BFA, #67E8F9)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>+{xpEarned} XP</span>
      </div>

      {/* Actual Transcription & Attempt & Guess */}
      {(actualTranscription || attemptTranscription || guestGuessText) && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {actualTranscription && (
            <div style={{ padding: '12px', background: 'rgba(16,185,129,0.08)', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.2)' }}>
              <span style={{ fontSize: '10px', color: 'rgba(16,185,129,0.8)', fontWeight: 700, letterSpacing: '0.05em' }}>🟢 ОРИГИНАЛЬНАЯ ФРАЗА (ХОСТ):</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>"{actualTranscription}"</p>
            </div>
          )}
          {attemptTranscription && (
            <div style={{ padding: '12px', background: 'rgba(6,182,212,0.08)', borderRadius: '12px', border: '1px solid rgba(6,182,212,0.2)' }}>
              <span style={{ fontSize: '10px', color: 'rgba(6,182,212,0.8)', fontWeight: 700, letterSpacing: '0.05em' }}>🔵 ПОПЫТКА ГОСТЯ (транскрипция):</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>"{attemptTranscription}"</p>
            </div>
          )}
          {guestGuessText && (
            <div style={{ padding: '12px', background: 'rgba(124,58,237,0.08)', borderRadius: '12px', border: '1px solid rgba(124,58,237,0.2)' }}>
              <span style={{ fontSize: '10px', color: 'rgba(124,58,237,0.8)', fontWeight: 700, letterSpacing: '0.05em' }}>✏️ ДОГАДКА ГОСТЯ:</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>"{guestGuessText}"</p>
            </div>
          )}
        </div>
      )}

      {breakdown && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.1em', margin: '0 0 4px' }}>
            📊 ДЕТАЛИ ОЦЕНКИ
          </p>
          {[
            { label: '🔤 Схожесть', value: breakdown.similarity ?? breakdown.intonation },
            { label: '🤔 Догадка', value: breakdown.guessAccuracy },
            { label: '✨ Впечатление', value: breakdown.impression },
          ].filter(item => item.value !== undefined && item.value !== null).map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, minWidth: '120px' }}>{label}</span>
              <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '4px',
                  width: `${value || 0}%`,
                  background: value >= 70
                    ? 'linear-gradient(90deg, #06B6D4, #10B981)'
                    : value >= 40
                      ? 'linear-gradient(90deg, #7C3AED, #06B6D4)'
                      : 'linear-gradient(90deg, #EF4444, #F59E0B)',
                  transition: 'width 1s ease-out',
                }} />
              </div>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>
                {value ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* AI comment */}
      {comment && (
        <div style={{
          padding: '16px 20px', borderRadius: '16px', width: '100%', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '8px', margin: '0 0 8px' }}>
            🤖 КОММЕНТАРИЙ AI
          </p>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, margin: 0 }}>{comment}</p>
        </div>
      )}
    </div>
  )
}
