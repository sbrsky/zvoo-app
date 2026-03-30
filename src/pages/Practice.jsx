import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAudioEngine, MAX_RECORDING_SECONDS } from '../hooks/useAudioEngine'
import AudioVisualizer from '../components/AudioVisualizer'
import ScoreDisplay from '../components/ScoreDisplay'
import { scoreWithGemini } from '../lib/geminiScoring'

const PRACTICE_PHASES = {
  RECORD: 'RECORD',
  PROCESSING: 'PROCESSING',
  LISTEN: 'LISTEN',
  MIMIC: 'MIMIC',
  SCORING: 'SCORING',
  RESULTS: 'RESULTS',
}

const CHALLENGES = [
  { id: 1, text: 'Привет, меня зовут...', difficulty: '🟢 Легко', desc: 'Скажи своё имя' },
  { id: 2, text: 'Съешь ещё этих мягких французских булок', difficulty: '🟡 Средне', desc: 'Классическая скороговорка' },
  { id: 3, text: 'Шла Саша по шоссе и сосала сушку', difficulty: '🟡 Средне', desc: 'Аллитерация' },
  { id: 4, text: 'Карл у Клары украл кораллы', difficulty: '🔴 Сложно', desc: 'Сложная скороговорка' },
  { id: 5, text: 'На дворе трава, на траве дрова', difficulty: '🔴 Сложно', desc: 'Быстрая скороговорка' },
  { id: 6, text: 'Любую фразу на выбор!', difficulty: '✨ Свободно', desc: 'Скажи что хочешь' },
]

const Btn = ({ children, onClick, variant = 'primary', disabled = false, pulse = false }) => {
  const colors = {
    primary: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
    secondary: 'rgba(255,255,255,0.06)',
    danger: 'linear-gradient(135deg, #EF4444, #DC2626)',
    cyan: 'linear-gradient(135deg, #2DC4B2, #10B981)',
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '14px 28px', borderRadius: '14px',
      border: variant === 'secondary' ? '1px solid rgba(255,255,255,0.1)' : 'none',
      background: disabled ? 'rgba(255,255,255,0.04)' : colors[variant],
      color: disabled ? 'rgba(255,255,255,0.25)' : '#fff',
      fontSize: '15px', fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s', flex: '1 1 auto', minWidth: '140px',
      animation: pulse ? 'recordPulse 1.5s ease-in-out infinite' : 'none',
    }}>{children}</button>
  )
}

export default function Practice() {
  const navigate = useNavigate()
  useAuth() // keep auth context alive
  const audio = useAudioEngine()

  const [phase, setPhase]               = useState(PRACTICE_PHASES.RECORD)
  const [selectedChallenge, setSelectedChallenge] = useState(null)
  const [countdown, setCountdown]       = useState(null)
  const [score, setScore]               = useState(null)
  const [comment, setComment]           = useState('')
  const [breakdown, setBreakdown]       = useState(null)
  const [scoring, setScoring]           = useState(false)
  const [originalBlob, setOriginalBlob] = useState(null)
  const [reversedBlob, setReversedBlob] = useState(null)
  const [mimicBlob, setMimicBlob]       = useState(null)

  // Track which phase triggered the recording so we know what to do on stop
  const activeHandlerRef = useRef(null) // 'record' | 'mimic' | null
  const originalBlobRef  = useRef(null) // sync ref so mimic closure can read it
  const wasRecordingRef  = useRef(false)

  // When audio.isRecording flips true→false, auto-trigger the right handler
  useEffect(() => {
    const wasRecording = wasRecordingRef.current
    wasRecordingRef.current = audio.isRecording

    if (wasRecording && !audio.isRecording && activeHandlerRef.current) {
      const handler = activeHandlerRef.current
      activeHandlerRef.current = null
      
      const latestBlob = audio.audioBlobRef.current
      if (handler === 'record') doProcessRecord(latestBlob)
      if (handler === 'mimic')  doProcessMimic(latestBlob)
    }
  }, [audio.isRecording]) // eslint-disable-line


  const doProcessRecord = async (blob) => {
    if (!blob || blob.size === 0) {
      alert('Запись не удалась, попробуйте еще раз')
      setPhase(PRACTICE_PHASES.RECORD)
      return
    }
    setPhase(PRACTICE_PHASES.PROCESSING)
    setOriginalBlob(blob)
    originalBlobRef.current = blob
    const reversed = await audio.reverseAudio(blob)
    if (!reversed) {
      alert('Ошибка обработки аудио. Возможно, браузер не поддерживает формат.')
      setPhase(PRACTICE_PHASES.RECORD)
      return
    }
    setReversedBlob(reversed)
    setPhase(PRACTICE_PHASES.LISTEN)
  }

  const doProcessMimic = async (blob) => {
    if (!blob || blob.size === 0) {
      alert('Запись не удалась, попробуйте еще раз.')
      setPhase(PRACTICE_PHASES.MIMIC)
      return
    }
    setPhase(PRACTICE_PHASES.SCORING)
    setScoring(true)
    setMimicBlob(blob)
    const mimicReversed = await audio.reverseAudio(blob)
    if (!mimicReversed) {
      alert('Ошибка обработки аудио.')
      setScoring(false)
      setPhase(PRACTICE_PHASES.MIMIC)
      return
    }
    const origBlob = originalBlobRef.current
    if (mimicReversed && origBlob) {
      try {
        const result = await scoreWithGemini(origBlob, mimicReversed)
        setScore(result.score)
        setComment(result.comment)
        setBreakdown(result.breakdown)
      } catch (err) {
        console.error('Scoring error:', err)
        setComment('Не удалось оценить. Попробуй ещё раз!')
      }
    }
    setScoring(false)
    setPhase(PRACTICE_PHASES.RESULTS)
  }

  const startCountdown = useCallback((onComplete) => {
    setCountdown(3)
    if (navigator.vibrate) navigator.vibrate(50)
    setTimeout(() => { setCountdown(2); if (navigator.vibrate) navigator.vibrate(50) }, 1000)
    setTimeout(() => { setCountdown(1); if (navigator.vibrate) navigator.vibrate(50) }, 2000)
    setTimeout(() => {
      setCountdown(null)
      if (navigator.vibrate) navigator.vibrate([100, 50, 100])
      onComplete()
    }, 3000)
  }, [])

  const handleToggleRecord = async () => {
    if (!audio.isRecording) {
      startCountdown(async () => {
        activeHandlerRef.current = 'record'
        await audio.startRecording()
      })
    } else {
      activeHandlerRef.current = null
      const blob = await audio.stopRecording()
      await doProcessRecord(blob)
    }
  }

  const handleListen = async () => {
    if (reversedBlob) await audio.playAudio(reversedBlob)
  }

  const handleToggleMimic = async () => {
    if (!audio.isRecording) {
      setPhase(PRACTICE_PHASES.MIMIC)
      startCountdown(async () => {
        activeHandlerRef.current = 'mimic'
        await audio.startRecording()
      })
    } else {
      activeHandlerRef.current = null
      const blob = await audio.stopRecording()
      await doProcessMimic(blob)
    }
  }

  const handleReset = () => {
    setPhase(PRACTICE_PHASES.RECORD)
    setScore(null)
    setComment('')
    setBreakdown(null)
    setOriginalBlob(null)
    originalBlobRef.current = null
    setReversedBlob(null)
    setMimicBlob(null)
    setSelectedChallenge(null)
    setCountdown(null)
    setScoring(false)
    activeHandlerRef.current = null
  }


  return (
    <div style={{ minHeight: '100vh', padding: '80px 16px 24px', background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1628 100%)' }}>
      <div style={{ maxWidth: '520px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 800, margin: 0, background: 'linear-gradient(135deg, #147A8A, #2DC4B2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            🎯 Тренировка
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px', marginTop: '8px' }}>
            Тренируйся один — запиши фразу и повтори её задом наперёд
          </p>
        </div>

        {/* Challenge Selection */}
        {phase === PRACTICE_PHASES.RECORD && !selectedChallenge && (
          <div style={{ padding: '20px', borderRadius: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Выбери задание:</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {CHALLENGES.map(c => (
                <button key={c.id} onClick={() => setSelectedChallenge(c)} style={{
                  padding: '14px 18px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)', color: '#fff', textAlign: 'left',
                  cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '14px',
                }}
                  onMouseOver={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.3)' }}
                  onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                >
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>{c.difficulty}</span>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>{c.text}</div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{c.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Progress bar */}
        {selectedChallenge && (
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '4px 0' }}>
            {['RECORD','LISTEN','MIMIC','RESULTS'].map(p => (
              <div key={p} style={{
                width: '36px', height: '4px', borderRadius: '2px', transition: 'background 0.4s',
                background: ['RECORD','LISTEN','MIMIC','RESULTS'].indexOf(phase) >= ['RECORD','LISTEN','MIMIC','RESULTS'].indexOf(p)
                  ? 'linear-gradient(90deg, #147A8A, #2DC4B2)' : 'rgba(255,255,255,0.08)',
              }} />
            ))}
          </div>
        )}

        {/* Challenge label */}
        {selectedChallenge && phase === PRACTICE_PHASES.RECORD && (
          <div style={{ padding: '18px', borderRadius: '16px', textAlign: 'center', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Задание: {selectedChallenge.difficulty}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginTop: '6px' }}>«{selectedChallenge.text}»</div>
          </div>
        )}

        {/* Audio visualizer */}
        {selectedChallenge && (
          <div style={{ padding: '20px', borderRadius: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <AudioVisualizer analyserData={audio.analyserData} isActive={audio.isRecording || audio.isPlaying} height={100} />
            {audio.isRecording && (
              <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '13px', color: '#EF4444' }}>
                🔴 Запись... {audio.recordingElapsed}с / {MAX_RECORDING_SECONDS}с
              </div>
            )}
          </div>
        )}

        {/* Countdown */}
        {countdown !== null && (
          <div style={{
            padding: '48px 24px', borderRadius: '24px',
            background: countdown === 1 ? 'rgba(239,68,68,0.12)' : countdown === 2 ? 'rgba(245,158,11,0.12)' : 'rgba(124,58,237,0.12)',
            border: `1px solid ${countdown === 1 ? 'rgba(239,68,68,0.3)' : countdown === 2 ? 'rgba(245,158,11,0.3)' : 'rgba(124,58,237,0.3)'}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
          }}>
            <div key={countdown} style={{
              fontSize: '96px', fontWeight: 900, lineHeight: 1,
              background: countdown === 1 ? 'linear-gradient(135deg, #EF4444, #F59E0B)' : countdown === 2 ? 'linear-gradient(135deg, #F59E0B, #2DC4B2)' : 'linear-gradient(135deg, #147A8A, #2DC4B2)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              animation: 'countdown-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}>{countdown}</div>
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Приготовься...</span>
          </div>
        )}

        {/* Controls */}
        {selectedChallenge && countdown === null && (
          <div style={{ padding: '24px', borderRadius: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>

            {/* RECORD */}
            {phase === PRACTICE_PHASES.RECORD && (
              <>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', textAlign: 'center', margin: 0 }}>
                  📢 Запиши фразу голосом — система перевернёт её
                </p>
                {audio.isRecording ? (
                  <Btn onClick={handleToggleRecord} variant="danger" pulse>
                    ⏹️ Стоп ({MAX_RECORDING_SECONDS - audio.recordingElapsed}с)
                  </Btn>
                ) : (
                  <Btn onClick={handleToggleRecord}>🎙️ Начать запись</Btn>
                )}
              </>
            )}

            {/* PROCESSING */}
            {phase === PRACTICE_PHASES.PROCESSING && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }}>🔄</div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>Переворачиваю аудио...</span>
              </div>
            )}

            {/* LISTEN */}
            {phase === PRACTICE_PHASES.LISTEN && (
              <>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', textAlign: 'center', margin: 0 }}>
                  🎧 Послушай перевёрнутую версию, потом повтори!
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                  <Btn onClick={handleListen} disabled={audio.isPlaying} variant="cyan">
                    {audio.isPlaying ? '🔊 Играет...' : '🔊 Послушать'}
                  </Btn>
                  <Btn onClick={handleToggleMimic}>🎯 Повторить</Btn>
                </div>
              </>
            )}

            {/* MIMIC */}
            {phase === PRACTICE_PHASES.MIMIC && (
              <>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', textAlign: 'center', margin: 0 }}>
                  🎤 Повтори перевёрнутые звуки как можно точнее!
                </p>
                {audio.isRecording ? (
                  <Btn onClick={handleToggleMimic} variant="danger" pulse>
                    ⏹️ Стоп ({MAX_RECORDING_SECONDS - audio.recordingElapsed}с)
                  </Btn>
                ) : (
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>Подготовка...</div>
                )}
              </>
            )}

            {/* SCORING */}
            {phase === PRACTICE_PHASES.SCORING && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }}>🤖</div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>AI оценивает...</span>
              </div>
            )}

            {/* RESULTS */}
            {phase === PRACTICE_PHASES.RESULTS && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                  <Btn onClick={() => originalBlob && audio.playAudio(originalBlob)} disabled={audio.isPlaying} variant="secondary">
                    🔊 Оригинал
                  </Btn>
                  <Btn onClick={() => mimicBlob && audio.playAudio(mimicBlob)} disabled={audio.isPlaying} variant="secondary">
                    🎧 Попытка
                  </Btn>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                  <Btn onClick={handleReset}>🔄 Ещё раз</Btn>
                  <Btn onClick={() => navigate('/lobby')} variant="secondary">← Назад</Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Score */}
        {(phase === PRACTICE_PHASES.SCORING || phase === PRACTICE_PHASES.RESULTS) && (
          <ScoreDisplay score={score} comment={comment} breakdown={breakdown} isLoading={scoring} />
        )}

        <style>{`
          @keyframes recordPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
            50%       { box-shadow: 0 0 0 12px rgba(239,68,68,0); }
          }
          @keyframes countdown-pop {
            0% { transform: scale(0.3); opacity: 0; }
            50% { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}
