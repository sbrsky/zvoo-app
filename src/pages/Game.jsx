import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRoom } from '../hooks/useRoom'
import { useAudioEngine, MAX_RECORDING_SECONDS } from '../hooks/useAudioEngine'
import { supabase } from '../lib/supabase'
import { GAME_EVENTS, ROOM_STATUS, GAME_TYPES } from '../lib/constants'
import { scoreWithGemini, isGeminiAvailable, transcribeHostAudio } from '../lib/geminiScoring'
import PlayerCard from '../components/PlayerCard'
import AudioVisualizer from '../components/AudioVisualizer'
import ScoreDisplay from '../components/ScoreDisplay'
import { BtnSpinner } from '../components/BtnSpinner'
import { useToast } from '../components/Toast'
import { playNotification } from '../lib/sounds'
import { launchConfetti } from '../lib/confetti'
import { hapticLight, hapticHeavy, hapticSuccess, hapticError } from '../lib/haptic'
import { SUPERPOWERS, SUPERPOWER_MAP, supportsPlaybackRate } from '../lib/superpowers'

// AI Thinking quips — rotated every 2.5s during scoring
const AI_QUIPS = [
  '🧠 анализирую частотный спектр...',
  '📊 сравниваю тембр звука...',
  '🔍 ищу догадку...',
  '🎵 распознаю слоги...',
  '⚡️ просчитываю звуковую волну...',
  '🤔 сопоставляю фонемы...',
]

const PHASES = {
  WAITING:        'waiting',
  READY:          'ready',          // guest joined, host can press Start
  HOST_RECORD:    'host_record',    // recorder records a phrase
  HOST_VERIFY:    'host_verify',    // recorder verifies the AI transcription
  GUEST_LISTEN:   'guest_listen',   // guesser listens to reversed audio
  GUEST_MIMIC:    'guest_mimic',    // guesser mimics the reversed audio
  GUEST_GUESS:    'guest_guess',    // guesser types their guess
  IMAG_GENERATE:  'imag_generate',  // [Imaginarium] host generating image
  IMAG_GUESS:     'imag_guess',     // [Imaginarium] guest sees image + 4 choices
  SCORING:        'scoring',        // AI scoring in progress
  RESULTS:        'results',        // single-round results (legacy compat)
  ROUND_RESULTS:  'round_results',  // between-round score display
  FINAL_RESULTS:  'final_results',  // game over, cumulative scores
}

const PHASE_STEPS = [
  { key: PHASES.HOST_RECORD,  label: 'Запись',    icon: '🎙️' },
  { key: PHASES.HOST_VERIFY,  label: 'ИИ',         icon: '🤖' },
  { key: PHASES.GUEST_LISTEN, label: 'Слушай',    icon: '🎧' },
  { key: PHASES.GUEST_MIMIC,  label: 'Повтори',   icon: '🗣️' },
  { key: PHASES.GUEST_GUESS,  label: 'Угадай',    icon: '🤔' },
  { key: PHASES.SCORING,      label: 'Оценка',     icon: '⚖️' },
  { key: PHASES.ROUND_RESULTS, label: 'Итог',     icon: '🏆' },
]

const IMAG_PHASE_STEPS = [
  { key: PHASES.HOST_RECORD,   label: 'Фраза',   icon: '✍️' },
  { key: PHASES.IMAG_GENERATE, label: 'ИИ',      icon: '🎨' },
  { key: PHASES.IMAG_GUESS,    label: 'Угадай',  icon: '🖼️' },
  { key: PHASES.SCORING,       label: 'Оценка',  icon: '⚖️' },
  { key: PHASES.ROUND_RESULTS, label: 'Итог',    icon: '🏆' },
]

function PhaseBar({ phase, isImaginarium = false }) {
  const steps = isImaginarium ? IMAG_PHASE_STEPS : PHASE_STEPS
  const currentIdx = steps.findIndex(s => s.key === phase)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, width: '100%' }}>
      {steps.map((step, i) => {
        const done    = i < currentIdx
        const active  = i === currentIdx
        const pending = i > currentIdx
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              flex: 1,
            }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: active ? '16px' : '14px',
                background: done
                  ? 'linear-gradient(135deg, #147A8A, #2DC4B2)'
                  : active
                    ? 'rgba(124,58,237,0.25)'
                    : 'rgba(255,255,255,0.05)',
                border: active
                  ? '2px solid rgba(124,58,237,0.7)'
                  : done
                    ? 'none'
                    : '2px solid rgba(255,255,255,0.1)',
                boxShadow: active ? '0 0 16px rgba(124,58,237,0.4)' : 'none',
                transition: 'all 0.4s',
              }}>
                {done ? '✓' : step.icon}
              </div>
              <span style={{
                fontSize: '10px', fontWeight: 600,
                color: active ? 'rgba(167,139,250,1)' : done ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {i < PHASE_STEPS.length - 1 && (
              <div style={{
                height: '2px', width: '100%', maxWidth: '40px',
                background: done
                  ? 'linear-gradient(90deg, #147A8A, #2DC4B2)'
                  : 'rgba(255,255,255,0.08)',
                borderRadius: '2px', transition: 'all 0.4s',
                marginBottom: '20px',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * ActionButton — all game action buttons go through this component.
 * Supports: variant styles, disabled, loading/pending state with spinner, pulse animation.
 */
function ActionButton({ onClick, disabled, children, variant = 'primary', pulse = false, pending = false, pendingLabel }) {
  const base = {
    padding: '14px 32px', borderRadius: '16px', border: 'none',
    fontWeight: 700, fontSize: '15px',
    cursor: (disabled || pending) ? 'not-allowed' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
    opacity: disabled ? 0.45 : 1,
    position: 'relative', overflow: 'hidden',
    transition: 'transform 0.08s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s ease, opacity 0.15s ease',
  }
  const styles = {
    primary: {
      ...base,
      background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
      color: 'white',
      boxShadow: disabled ? 'none' : '0 10px 32px rgba(124,58,237,0.4)',
    },
    success: {
      ...base,
      background: 'linear-gradient(135deg, #059669, #10B981)',
      color: 'white',
      boxShadow: disabled ? 'none' : '0 10px 32px rgba(16,185,129,0.4)',
    },
    danger: {
      ...base,
      background: 'rgba(239,68,68,0.18)',
      border: '1px solid rgba(239,68,68,0.4)',
      color: '#FCA5A5',
      boxShadow: pulse ? '0 0 0 0 rgba(239,68,68,0.4)' : 'none',
      animation: pulse ? 'recordPulse 1.5s ease-in-out infinite' : 'none',
    },
    secondary: {
      ...base,
      background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(255,255,255,0.12)',
      color: 'rgba(255,255,255,0.8)',
    },
    cyan: {
      ...base,
      background: 'linear-gradient(135deg, #2DC4B2, #147A8A)',
      color: 'white',
      boxShadow: disabled ? 'none' : '0 10px 32px rgba(6,182,212,0.35)',
    },
  }

  const className = ['btn-game', pending ? 'btn-pending' : ''].filter(Boolean).join(' ')

  return (
    <button
      onClick={onClick}
      disabled={disabled || pending}
      style={styles[variant] || styles.primary}
      className={className}
    >
      {pending ? (
        <><BtnSpinner size={16} />{pendingLabel || children}</>
      ) : children}
    </button>
  )
}

/** Animated count-up from 0 to target over `duration` ms */
function useCountUp(target, duration = 1200, active = true) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!active || target == null) return
    setDisplay(0)
    const start = performance.now()
    const tick = () => {
      const elapsed = performance.now() - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration, active])
  return display
}
function FakeProgressBar({ active, duration = 6000, label = 'Загрузка...' }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!active) {
      setProgress(0)
      return
    }
    const interval = setInterval(() => {
      setProgress(p => {
        // slow down as it gets closer to 95%
        const remaining = 95 - p
        const increment = Math.max(0.5, remaining * 0.05)
        return p + increment > 95 ? 95 : p + increment
      })
    }, duration / 50)
    return () => clearInterval(interval)
  }, [active, duration])

  if (!active) return null

  return (
    <div style={{ width: '100%', maxWidth: '300px', margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          width: `${progress}%`, height: '100%', background: '#4DD9C8',
          transition: 'width 0.1s linear',
          boxShadow: '0 0 10px rgba(167,139,250,0.5)',
        }} />
      </div>
    </div>
  )
}

export default function Game() {
  const { id: roomId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const {
    room, gameSession, gameState, isHost, isGuest, sessionCreatedRef,
    broadcastState, joinRoom, closeRoom, createSession, updateSession,
    updateRoom, updateRoomStatus, fetchRoom, fetchGameSession,
  } = useRoom(roomId, user?.id)
  const audio = useAudioEngine()

  const [phase, setPhase]               = useState(PHASES.WAITING)
  const [hostProfile, setHostProfile]   = useState(null)
  const [guestProfile, setGuestProfile] = useState(null)
  const [scoring, setScoring]           = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [score, setScore]               = useState(null)
  const [comment, setComment]           = useState('')
  const [breakdown, setBreakdown]       = useState(null)
  const [copied, setCopied]             = useState(false)
  const [hasListened, setHasListened]         = useState(false)
  const [reversedAudioReady, setReversedAudioReady] = useState(false)
  const [countdown, setCountdown]             = useState(null)
  const [guestGuessText, setGuestGuessText] = useState('')
  const [actualTranscription, setActualTranscription] = useState(null)
  const [attemptTranscription, setAttemptTranscription] = useState(null)
  const [manualScore, setManualScore] = useState(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [uploadTimedOut, setUploadTimedOut] = useState(false)

  // Button pending states (prevent double-click, show spinner)
  const [pendingHostStart, setPendingHostStart] = useState(false)
  const [pendingNextRound, setPendingNextRound] = useState(false)
  const [pendingRematch, setPendingRematch]     = useState(false)
  const [pendingSubmit, setPendingSubmit]       = useState(false)
  const [pendingCopy, setPendingCopy]           = useState(false)

  const toast = useToast()

  // Multi-round state
  const [currentRound, setCurrentRound] = useState(1)
  const [totalRounds, setTotalRounds]   = useState(3)
  const [roundScores, setRoundScores]   = useState([]) // [{round, score, comment, recorder}]
  const [rematchRequested, setRematchRequested] = useState(false) // did I click rematch?
  const [rematchPending, setRematchPending]     = useState(false) // did the other player click?
  const [finalized, setFinalized]               = useState(false) // prevent double finalize
  const [finalStats, setFinalStats]             = useState(null)  // { hostScore, guestScore, winnerId, ratingChange }

  // ─── Superpower state ─────────────────────────────────────────────────────
  // usedPowers: how many times each power was used THIS game (guest's tracker)
  const [usedPowers, setUsedPowers] = useState({ slow: 0, choices: 0, vision: 0 })
  // maxPowers: limits set by host (from room row)
  const [maxPowers, setMaxPowers]   = useState({ slow: 1, choices: 1, vision: 1 })
  // activation state
  const [slowMoActive, setSlowMoActive]         = useState(false)
  const [choicesOptions, setChoicesOptions]     = useState(null)   // string[] | null
  const [choicesLoading, setChoicesLoading]     = useState(false)
  const [visionImage, setVisionImage]           = useState(null)   // base64 data URL | null
  const [visionLoading, setVisionLoading]       = useState(false)
  const [slowMoSupported]                       = useState(() => supportsPlaybackRate())
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Imaginarium state ────────────────────────────────────────────────────
  const [hostPhraseText, setHostPhraseText]   = useState('')       // host types phrase here
  const [imagGenerating, setImagGenerating]   = useState(false)    // loading: host generating image
  const [imagImage, setImagImage]             = useState(null)     // base64 data URL
  const [imagChoices, setImagChoices]         = useState(null)     // string[4] | null
  const [imagSelected, setImagSelected]       = useState(null)     // guest's selected choice
  const [imagPhrase, setImagPhrase]           = useState('')       // correct phrase (known to host)
  // ─────────────────────────────────────────────────────────────────────────

  const [aiQuipIdx, setAiQuipIdx] = useState(0)
  useEffect(() => {
    if (phase !== PHASES.SCORING) return
    setAiQuipIdx(0)
    const t = setInterval(() => setAiQuipIdx(i => (i + 1) % AI_QUIPS.length), 2500)
    return () => clearInterval(t)
  }, [phase])

  // Round transition flash
  const [showRoundFlash, setShowRoundFlash] = useState(false)
  const [roundFlashLabel, setRoundFlashLabel] = useState('')

  // Score count-up (triggers when score is set)
  const [scoreRevealed, setScoreRevealed] = useState(false)
  useEffect(() => {
    if (score != null) { setScoreRevealed(false); setTimeout(() => setScoreRevealed(true), 50) }
  }, [score])
  const animatedScore = useCountUp(score, 1200, scoreRevealed)

  // Phase-aware ambient background class
  const phaseBgClass = {
    [PHASES.HOST_RECORD]:  'game-bg-record',
    [PHASES.GUEST_MIMIC]:  'game-bg-mimic',
    [PHASES.GUEST_LISTEN]:   'game-bg-listen',
    [PHASES.GUEST_GUESS]:     'game-bg-listen',
    [PHASES.IMAG_GENERATE]:   'game-bg-scoring',
    [PHASES.IMAG_GUESS]:      'game-bg-listen',
    [PHASES.SCORING]:         'game-bg-scoring',
    [PHASES.RESULTS]:         'game-bg-results',
    [PHASES.ROUND_RESULTS]:   'game-bg-results',
    [PHASES.FINAL_RESULTS]:   'game-bg-results',
  }[phase] || 'game-bg-default'

  // Is this an Imaginarium game?
  const isImaginarium = room?.game_type === GAME_TYPES.IMAGINARIUM

  // Who records this round? In Imaginarium host always "records" (types the phrase), guest always guesses
  const isRecorder = isImaginarium ? isHost : (currentRound % 2 === 1 ? isHost : isGuest)
  const isGuesser  = isImaginarium ? isGuest : (currentRound % 2 === 1 ? isGuest : isHost)

  // Fetch player profiles
  useEffect(() => {
    if (room?.host_id)
      supabase.from('profiles').select('*').eq('id', room.host_id).maybeSingle().then(({ data }) => setHostProfile(data))
    if (room?.guest_id)
      supabase.from('profiles').select('*').eq('id', room.guest_id).maybeSingle().then(({ data }) => setGuestProfile(data))
  }, [room?.host_id, room?.guest_id])

  // Auto-join as guest (one-shot guard)
  const joinAttemptedRef = useRef(false)
  useEffect(() => {
    if (!room || isHost || isGuest) return
    // Allow join if guest slot is empty (regardless of status - host may have changed it)
    if (room.guest_id === null && !joinAttemptedRef.current) {
      joinAttemptedRef.current = true
      joinRoom().catch(err => console.error('Join failed:', err))
    }
  }, [room, isHost, isGuest, joinRoom])

  // Sync totalRounds + superpower limits from room
  useEffect(() => {
    if (room?.total_rounds) setTotalRounds(room.total_rounds)
    if (room?.current_round) setCurrentRound(room.current_round)
    if (room) {
      setMaxPowers({
        slow:    room.sp_slow_max    ?? 1,
        choices: room.sp_choices_max ?? 1,
        vision:  room.sp_vision_max  ?? 1,
      })
    }
  }, [room?.total_rounds, room?.current_round, room?.sp_slow_max, room?.sp_choices_max, room?.sp_vision_max])

  // Restore SP usage from DB (survives page refresh)
  useEffect(() => {
    if (!gameSession || !isGuesser) return
    setUsedPowers({
      slow:    gameSession.sp_slow_used    ?? 0,
      choices: gameSession.sp_choices_used ?? 0,
      vision:  gameSession.sp_vision_used  ?? 0,
    })
  }, [gameSession?.id, isGuesser])

  // Detect guest joined → move host to READY phase
  useEffect(() => {
    if (!room || !isHost) return
    if (room.guest_id && room.status === 'waiting' && phase === PHASES.WAITING) {
      setPhase(PHASES.READY)
    }
  }, [room?.guest_id, room?.status, isHost, phase])

  // Guest: if room has guest_id = me and status = waiting, show READY
  useEffect(() => {
    if (!room || !isGuest) return
    if (room.status === 'waiting' && phase === PHASES.WAITING) {
      setPhase(PHASES.READY)
    }
  }, [room?.status, isGuest, phase])

  // Reconnection: recover phase from room/session state (e.g. after page refresh)
  useEffect(() => {
    if (!room || (phase !== PHASES.WAITING && phase !== PHASES.READY)) return
    if (room.status === 'finished') {
      // Game already finished — load final results (works for both host and guest on reload)
      const loadResults = async () => {
        const { data: sessions } = await supabase
          .from('game_sessions').select('ai_score, ai_comment, ai_actual_transcription, guest_guess_text, manual_score, round_number, recorder_id')
          .eq('room_id', roomId).order('round_number', { ascending: true })
        if (sessions?.length) {
          const scores = sessions.filter(s => s.ai_score != null).map(s => ({
            round: s.round_number, score: s.ai_score, comment: s.ai_comment || '', recorder: s.recorder_id
          }))
          setRoundScores(scores)
          const last = sessions[sessions.length - 1]
          if (last.ai_score != null) setScore(last.ai_score)
          if (last.ai_comment) setComment(last.ai_comment)
          if (last.ai_actual_transcription) setActualTranscription(last.ai_actual_transcription)
          if (last.guest_guess_text) setGuestGuessText(last.guest_guess_text)
          if (last.manual_score) setManualScore(last.manual_score)
          setPhase(PHASES.FINAL_RESULTS)
        }

        // Load finalStats from finished_games so both players see the scoreboard
        const { data: fg } = await supabase
          .from('finished_games').select('*').eq('room_id', roomId).maybeSingle()
        if (fg) {
          const stats = {
            hostScore: fg.host_score,
            guestScore: fg.guest_score,
            winnerId: fg.winner_id,
            ratingChange: Math.abs(fg.host_rating_change || fg.guest_rating_change || 0),
            hostRoundsWon: fg.host_rounds_won,
            guestRoundsWon: fg.guest_rounds_won,
            roundDetails: fg.round_details || [],
          }
          setFinalStats(stats)
          // Winner confetti on reload
          const iWon = fg.winner_id === user?.id || fg.winner_id === null
          if (iWon) setTimeout(() => launchConfetti(), 600)
        }
      }
      loadResults()

    } else if (room.status === 'playing' && (isHost || isGuest)) {
      const recoverPhase = async () => {
        const { data: session } = await supabase
          .from('game_sessions').select('*').eq('room_id', roomId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!session) return
        setCurrentRound(session.round_number || 1)
        if (session.ai_score != null) {
          setScore(session.ai_score)
          setComment(session.ai_comment || '')
          setActualTranscription(session.ai_actual_transcription || '')
          if (session.guest_guess_text) setGuestGuessText(session.guest_guess_text)
          if (session.manual_score) setManualScore(session.manual_score)
          const isLastRound = (session.round_number || 1) >= (room.total_rounds || 3)
          setPhase(isLastRound ? PHASES.FINAL_RESULTS : PHASES.ROUND_RESULTS)
        } else if (session.guest_guess_text) {
          setActualTranscription(session.ai_actual_transcription || '')
          setPhase(PHASES.SCORING)
        } else if (session.mimic_audio_url) {
          setActualTranscription(session.ai_actual_transcription || '')
          setPhase(PHASES.GUEST_GUESS)
        } else if (session.ai_actual_transcription) {
          // Already verified by host
          setActualTranscription(session.ai_actual_transcription)
          setPhase(PHASES.GUEST_LISTEN)
        } else if (session.reversed_audio_url) {
          // Not verified yet, but audio is ready (or transcript failed but we fallback to LISTEN)
          setPhase(PHASES.GUEST_LISTEN) 
        } else {
          setPhase(PHASES.HOST_RECORD)
        }
      }
      recoverPhase()
    }
  }, [room?.status, isHost, isGuest, phase])

  // React to broadcast events
  useEffect(() => {
    if (!gameState) return
    switch (gameState.event) {
      case GAME_EVENTS.HOST_START:
        // Host pressed Start — both players begin round 1
        setCurrentRound(gameState.currentRound || 1)
        setTotalRounds(gameState.totalRounds || 3)
        fetchGameSession(roomId)
        setPhase(PHASES.HOST_RECORD)
        playNotification('turnStart')
        break
      case GAME_EVENTS.GAME_STARTED:
        fetchGameSession(roomId)
        setPhase(PHASES.HOST_RECORD)
        if (isRecorder) playNotification('turnStart')
        break
      case GAME_EVENTS.PLAYER_RECORDING:
        if (!isRecorder) { setPhase(PHASES.HOST_RECORD); playNotification('turnEnd') }
        break
      case GAME_EVENTS.AUDIO_READY:
        if (gameState.actualTranscription) {
          setActualTranscription(gameState.actualTranscription)
          setPhase(PHASES.HOST_VERIFY)
        } else {
          setPhase(PHASES.GUEST_LISTEN)
          if (isGuesser) playNotification('turnStart')
        }
        break
      case 'HOST_VERIFIED':
        setPhase(PHASES.GUEST_LISTEN)
        if (isGuesser) playNotification('turnStart')
        break
      case 'HOST_REJECTED':
        setPhase(PHASES.HOST_RECORD)
        setActualTranscription(null)
        break
      case GAME_EVENTS.MIMIC_RECORDING:
        if (isRecorder) { setPhase(PHASES.GUEST_MIMIC); playNotification('turnEnd') }
        break
      case GAME_EVENTS.MIMIC_DONE:
        if (isRecorder) setPhase(PHASES.GUEST_GUESS)
        break
      case GAME_EVENTS.GUEST_GUESSING:
        break
      case GAME_EVENTS.GUESS_SUBMITTED:
        if (isRecorder) setPhase(PHASES.SCORING)
        break
      // Imaginarium: host started generating — guest transitions to waiting screen
      case GAME_EVENTS.IMAG_GENERATE:
        if (isGuesser) setPhase(PHASES.IMAG_GENERATE)
        break
      // Imaginarium: host finished generating, sends image+choices to guest
      case GAME_EVENTS.IMAG_READY:
        if (isGuesser) {
          if (gameState.imagImage) setImagImage(`data:${gameState.mimeType || 'image/png'};base64,${gameState.imagImage}`)
          if (gameState.choices?.length) setImagChoices(gameState.choices)
          if (gameState.phrase) setImagPhrase(gameState.phrase)
          setPhase(PHASES.IMAG_GUESS)
          playNotification('turnStart')
        }
        break
      case GAME_EVENTS.SHOW_RESULT: {
        setScore(gameState.score)
        setComment(gameState.comment)
        setBreakdown(gameState.breakdown || null)
        setActualTranscription(gameState.actualTranscription || null)
        setAttemptTranscription(gameState.attemptTranscription || null)
        if (gameState.guestGuessText) setGuestGuessText(gameState.guestGuessText)
        const newScoreEntry = { round: gameState.roundNumber || currentRound, score: gameState.score, comment: gameState.comment }
        setRoundScores(prev => [...prev, newScoreEntry])
        const isLastRound = (gameState.roundNumber || currentRound) >= totalRounds
        setPhase(isLastRound ? PHASES.FINAL_RESULTS : PHASES.ROUND_RESULTS)
        playNotification('gameOver')
        // Only confetti for non-final rounds (final confetti handled by FINAL_STATS)
        if (!isLastRound && gameState.score >= 60) setTimeout(() => launchConfetti(), 300)
        break
      }
      case GAME_EVENTS.MANUAL_SCORE_SET:
        setManualScore(gameState.manualScore)
        break
      case GAME_EVENTS.NEXT_ROUND: {
        const nextRound = gameState.nextRound
        setCurrentRound(nextRound)
        fetchGameSession(roomId)
        // Reset per-round state
        setScore(null); setComment(''); setBreakdown(null)
        setActualTranscription(null); setAttemptTranscription(null)
        setGuestGuessText(''); setManualScore(null)
        setHasListened(false); setReversedAudioReady(false); setUploadTimedOut(false)
        audio.setAudioBlob?.(null); audio.setReversedBlob?.(null)
        // Reset per-round superpower UI
        setSlowMoActive(false)
        setChoicesOptions(null)
        setVisionImage(null)
        // Reset Imaginarium per-round state
        setHostPhraseText('')
        setImagGenerating(false)
        setImagImage(null)
        setImagChoices(null)
        setImagSelected(null)
        setImagPhrase('')
        setPhase(PHASES.HOST_RECORD)
        playNotification('turnStart')
        break
      }
      case GAME_EVENTS.REMATCH_REQUESTED:
        if (gameState.senderId !== user?.id) {
          setRematchPending(true)
        }
        break
      case GAME_EVENTS.REMATCH_ACCEPTED:
        if (gameState.newRoomId) {
          navigate(`/game/${gameState.newRoomId}`)
        }
        break
      case 'FINAL_STATS': {
        // Guest receives final scoreboard from host
        if (gameState.finalStats) {
          setFinalStats(gameState.finalStats)
          // Trigger confetti for the winner
          const { winnerId: wId } = gameState.finalStats
          const iWon = wId === user?.id || wId === null  // null = tie -> both get confetti
          if (iWon) setTimeout(() => launchConfetti(), 400)
        }
        // Guest updates their OWN profile using their auth token (bypasses RLS correctly)
        if (gameState.guestProfileUpdate && !isHost) {
          const { myScore, won, winnerId: wId, ratingChange: rc } = gameState.guestProfileUpdate
          applyProfileUpdate(myScore, won, wId, rc)
        }
        break
      }
      case 'GAME_CANCELLED':
        // Host cancelled — redirect everyone to lobby
        navigate('/lobby')
        break
    }
  }, [gameState, isHost, isRecorder, isGuesser])

  // Fallback: if stuck on SCORING phase, poll DB for results
  useEffect(() => {
    if (phase !== PHASES.SCORING || !roomId) return
    const pollInterval = setInterval(async () => {
      try {
        const { data: session } = await supabase
          .from('game_sessions').select('ai_score, ai_comment, ai_actual_transcription, guest_guess_text, manual_score, round_number').eq('room_id', roomId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (session?.ai_score != null) {
          setScore(session.ai_score)
          setComment(session.ai_comment || '')
          setActualTranscription(session.ai_actual_transcription || '')
          if (session.guest_guess_text) setGuestGuessText(session.guest_guess_text)
          if (session.manual_score) setManualScore(session.manual_score)
          const newEntry = { round: session.round_number || currentRound, score: session.ai_score, comment: session.ai_comment || '' }
          setRoundScores(prev => [...prev, newEntry])
          const isLastRound = (session.round_number || currentRound) >= totalRounds
          setPhase(isLastRound ? PHASES.FINAL_RESULTS : PHASES.ROUND_RESULTS)
          clearInterval(pollInterval)
        }
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(pollInterval)
  }, [phase, roomId, currentRound, totalRounds])

  // Host starts game — triggered by handleHostStart button press
  const handleHostStart = async () => {
    if (!isHost || !room?.guest_id) return
    setPendingHostStart(true)
    sessionCreatedRef.current = true
    const recorderId = room.host_id // round 1 = host records
    try {
      await createSession({ round_number: 1, recorder_id: recorderId })
      await updateRoom({ status: ROOM_STATUS.PLAYING, current_round: 1 })
      setCurrentRound(1)
      setPhase(PHASES.HOST_RECORD)
      broadcastState(GAME_EVENTS.HOST_START, { 
        currentRound: 1, 
        totalRounds: room?.total_rounds || 3 
      })
      hapticHeavy()
    } catch (err) {
      console.error('handleHostStart failed:', err)
      sessionCreatedRef.current = false
      toast.error('Не удалось начать игру. Попробуй ещё раз.')
      hapticError()
    } finally {
      setPendingHostStart(false)
    }
  }

  // Move to next round (called by recorder after ROUND_RESULTS)
  const handleNextRound = async () => {
    const nextRound = currentRound + 1
    const nextRecorderId = nextRound % 2 === 1 ? room.host_id : room.guest_id
    setPendingNextRound(true)
    try {
      sessionCreatedRef.current = true
      await createSession({ round_number: nextRound, recorder_id: nextRecorderId })
      await updateRoom({ current_round: nextRound })
      setCurrentRound(nextRound)
      // Reset per-round state
      setScore(null); setComment(''); setBreakdown(null)
      setActualTranscription(null); setAttemptTranscription(null)
      setGuestGuessText(''); setManualScore(null)
      setSlowMoActive(false)
      setChoicesOptions(null)
      setVisionImage(null)
      setHasListened(false); setReversedAudioReady(false); setUploadTimedOut(false)
      audio.setAudioBlob?.(null); audio.setReversedBlob?.(null)
      broadcastState(GAME_EVENTS.NEXT_ROUND, { nextRound })
      hapticHeavy()
      // Round flash ceremony
      setRoundFlashLabel(`Раунд ${nextRound}`)
      setShowRoundFlash(true)
      setTimeout(() => { setShowRoundFlash(false); setPhase(PHASES.HOST_RECORD) }, 950)

    } catch (err) {
      console.error('handleNextRound failed:', err)
      toast.error('Не удалось начать следующий раунд.')
      hapticError()
    } finally {
      setPendingNextRound(false)
    }
  }

  const uploadAudio = useCallback(async (blob, name) => {
    const ext = blob.type?.includes('webm') ? 'webm' : 'wav'
    const contentType = blob.type || 'audio/webm'
    const fileName = `${roomId}/${name}_${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('audio').upload(fileName, blob, { contentType })
    if (error) throw error
    return fileName
  }, [roomId])

  const startCountdown = useCallback((onComplete) => {
    setCountdown(3)
    hapticLight()
    setTimeout(() => { setCountdown(2); hapticLight() }, 1000)
    setTimeout(() => { setCountdown(1); hapticLight() }, 2000)
    setTimeout(() => {
      setCountdown(null)
      hapticHeavy()
      onComplete()
    }, 3000)
  }, [])

  // ─── Play reversed audio (used by button + SlowMo) ─────────────────────────
  const handlePlayReversed = useCallback(async (playbackRate = 1.0) => {
    const { data: session } = await supabase
      .from('game_sessions').select('reversed_audio_url').eq('room_id', roomId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const url = session?.reversed_audio_url || gameSession?.reversed_audio_url
    if (url) {
      const { data: fileData } = await supabase.storage.from('audio').download(url)
      if (fileData) {
        audio.playAudio(fileData, playbackRate)
        setHasListened(true)
      }
    }
  }, [roomId, gameSession?.reversed_audio_url, audio])

  // ─── Superpower handlers ──────────────────────────────────────────────────
  const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = import.meta.env

  const activateSlowMo = useCallback(async () => {
    if (!slowMoSupported) {
      toast.error('⚠️ Ваше устройство не поддерживает Slow Mo. Обновите браузер или устройство.')
      return
    }
    if (usedPowers.slow >= maxPowers.slow) { toast.error('Зарядов Slow Mo не осталось'); return }
    const newCount = usedPowers.slow + 1
    setSlowMoActive(true)
    setUsedPowers(p => ({ ...p, slow: newCount }))
    updateSession({ sp_slow_used: newCount }).catch(() => {})
    hapticLight()
    toast.success('🐢 Slow Mo — прослушивание замедлено!')
    await handlePlayReversed(0.7)
    setSlowMoActive(false)
  }, [slowMoSupported, usedPowers.slow, maxPowers.slow, handlePlayReversed, updateSession, toast])

  const activateChoices = useCallback(async () => {
    if (usedPowers.choices >= maxPowers.choices) { toast.error('Зарядов AI Choices не осталось'); return }
    if (choicesLoading || choicesOptions) return
    if (!actualTranscription) { toast.error('Транскрипция ещё не готова, подожди...'); return }
    const newCount = usedPowers.choices + 1
    setChoicesLoading(true)
    setUsedPowers(p => ({ ...p, choices: newCount }))
    updateSession({ sp_choices_used: newCount }).catch(() => {})
    try {
      const fnUrl = `${VITE_SUPABASE_URL}/functions/v1/gemini-scoring`
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: 'generate_choices', transcription: actualTranscription, language: room?.game_language || 'ru' }),
      })
      const data = await res.json()
      if (!data.choices?.length) throw new Error('No choices returned')
      setChoicesOptions(data.choices)
      hapticLight()
      toast.success('🎯 AI предложил варианты!')
    } catch (e) {
      toast.error(`AI Choices: ${e.message}`)
      setUsedPowers(p => ({ ...p, choices: Math.max(0, p.choices - 1) }))
      updateSession({ sp_choices_used: Math.max(0, newCount - 1) }).catch(() => {})
    } finally {
      setChoicesLoading(false)
    }
  }, [usedPowers.choices, maxPowers.choices, choicesLoading, choicesOptions, actualTranscription, room?.game_language, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, updateSession, toast])

  const activateVision = useCallback(async () => {
    if (usedPowers.vision >= maxPowers.vision) { toast.error('Зарядов AI Vision не осталось'); return }
    if (visionLoading || visionImage) return
    if (!actualTranscription) { toast.error('Транскрипция ещё не готова, подожди...'); return }
    const newCount = usedPowers.vision + 1
    setVisionLoading(true)
    setUsedPowers(p => ({ ...p, vision: newCount }))
    updateSession({ sp_vision_used: newCount }).catch(() => {})
    try {
      const fnUrl = `${VITE_SUPABASE_URL}/functions/v1/gemini-scoring`
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: 'generate_vision', transcription: actualTranscription, language: room?.game_language || 'ru' }),
      })
      const data = await res.json()
      if (!data.imageBase64) throw new Error('No image returned')
      setVisionImage(`data:${data.mimeType};base64,${data.imageBase64}`)
      hapticSuccess()
      toast.success('🎨 AI Vision готов!')
    } catch (e) {
      toast.error(`AI Vision: ${e.message}`)
      setUsedPowers(p => ({ ...p, vision: Math.max(0, p.vision - 1) }))
      updateSession({ sp_vision_used: Math.max(0, newCount - 1) }).catch(() => {})
    } finally {
      setVisionLoading(false)
    }
  }, [usedPowers.vision, maxPowers.vision, visionLoading, visionImage, actualTranscription, room?.game_language, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, updateSession, toast])
  // ─────────────────────────────────────────────────────────────────────────

  const wasRecordingRef = useRef(false)

  // Watch audio.isRecording for auto-stop by timer
  useEffect(() => {
    const wasRecording = wasRecordingRef.current
    wasRecordingRef.current = audio.isRecording

    if (wasRecording && !audio.isRecording && activeHandlerRef.current) {
      const handler = activeHandlerRef.current
      activeHandlerRef.current = null
      if (handler === 'host') doProcessHost(audio.audioBlob)
      if (handler === 'mimic') doProcessMimic(audio.audioBlob)
    }
  }, [audio.isRecording]) // eslint-disable-line

  const AUDIO_TIMEOUT_MS = 30_000

  const withTimeout = (promise, ms = AUDIO_TIMEOUT_MS) => {
    let timer
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('TIMEOUT')), ms)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
  }

  const doProcessHost = async (recordedBlob) => {
    if (!recordedBlob || recordedBlob.size === 0) {
      setPhase(PHASES.HOST_RECORD)
      return
    }
    setUploading(true)
    setUploadTimedOut(false)
    try {
      const reversedBlob = await withTimeout(audio.reverseAudio(recordedBlob))
      if (reversedBlob) {
        const originalUrl = await withTimeout(uploadAudio(recordedBlob, 'original'))
        const reversedUrl = await withTimeout(uploadAudio(reversedBlob, 'reversed'))
        await withTimeout(updateSession({ original_audio_url: originalUrl, reversed_audio_url: reversedUrl }))
        
        // Transcribe original audio
        setPhase(PHASES.SCORING) // show some loading state
        const transcription = await withTimeout(transcribeHostAudio(recordedBlob, room?.game_language || 'ru'))
        
        if (transcription) {
          setActualTranscription(transcription)
          broadcastState(GAME_EVENTS.AUDIO_READY, { reversedUrl, actualTranscription: transcription })
          setPhase(PHASES.HOST_VERIFY)
        } else {
          // Fallback if AI fails, just skip verification
          broadcastState(GAME_EVENTS.AUDIO_READY, { reversedUrl })
          setPhase(PHASES.GUEST_LISTEN)
        }
      } else {
        setUploadTimedOut(true) // treat decode failure same as timeout — show retry UI
      }
    } catch (err) {
      console.error('doProcessHost error:', err)
      setUploadTimedOut(true) // catches both real errors and our TIMEOUT sentinel
    } finally {
      setUploading(false)
    }
  }

  const handleVerifyAccept = async () => {
    // Host accepts AI transcription
    try {
      await updateSession({ ai_actual_transcription: actualTranscription })
    } catch (e) { console.error('Failed to save transcription:', e) }
    
    broadcastState('HOST_VERIFIED') // Tell guest to start listening phase
    setPhase(PHASES.GUEST_LISTEN)
  }

  const handleVerifyReject = async () => {
    // Host rejects AI transcription, start over
    setActualTranscription(null)
    setPhase(PHASES.HOST_RECORD)
    broadcastState('HOST_REJECTED')
  }

  const handleHostRecord = async () => {
    broadcastState(GAME_EVENTS.PLAYER_RECORDING)
    startCountdown(async () => {
      activeHandlerRef.current = 'host'
      await audio.startRecording()
    })
  }

  const handleHostStop = async () => {
    activeHandlerRef.current = null
    const recordedBlob = await audio.stopRecording()
    await doProcessHost(recordedBlob)
  }

  const handleHostCancel = async () => {
    activeHandlerRef.current = null
    await audio.stopRecording() // Let it stop naturally, do not upload
  }

  const handleCancelGame = async () => {
    setShowCancelModal(true)
  }

  // ─── Imaginarium: Host generates image from typed phrase ─────────────────
  const handleImagGenerate = async () => {
    const phrase = hostPhraseText.trim()
    if (!phrase) return
    setImagGenerating(true)
    setImagPhrase(phrase)

    // Transition host AND guest to generating phase
    setPhase(PHASES.IMAG_GENERATE)
    broadcastState(GAME_EVENTS.IMAG_GENERATE, {})

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.access_token
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const res = await fetch(`${supabaseUrl}/functions/v1/gemini-scoring`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          action: 'generate_imaginarium',
          phrase,
          style: room?.imag_style || 'crazy_dreams',
          language: room?.game_language || 'ru',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { imageBase64, mimeType, choices } = await res.json()

      // Host stores phrase in DB (for scoring reference)
      await updateSession({ ai_actual_transcription: phrase })

      // Set local state for host to see (optional preview)
      if (imageBase64) setImagImage(`data:${mimeType || 'image/png'};base64,${imageBase64}`)
      if (choices?.length) setImagChoices(choices)

      // Broadcast to guest: send image + 4 choices
      broadcastState(GAME_EVENTS.IMAG_READY, {
        imagImage: imageBase64,
        mimeType: mimeType || 'image/png',
        choices: choices || [],
        phrase: phrase,
      })

      setPhase(PHASES.IMAG_GUESS) // Host waits while guest guesses
    } catch (err) {
      console.error('handleImagGenerate error:', err)
      toast.error('Не удалось сгенерировать картинку. Попробуй ещё раз.')
      setPhase(PHASES.HOST_RECORD) // Go back to input on error
    } finally {
      setImagGenerating(false)
    }
  }

  // ─── Imaginarium: Guest submits their guess (binary scoring) ─────────────
  const submitImagGuess = async () => {
    if (!imagSelected) return
    setPendingSubmit(true)
    try {
      await updateSession({ guest_guess_text: imagSelected })
      broadcastState(GAME_EVENTS.GUESS_SUBMITTED)
      setPhase(PHASES.SCORING)

      // Binary scoring: correct = 100, wrong = 0
      const correct = imagSelected.trim().toLowerCase() === imagPhrase.trim().toLowerCase()
      const score = correct ? 100 : 0
      const comment = correct
        ? '🎉 Правильно! Ты угадал образ!'
        : `❌ Неверно. Правильный ответ: «${imagPhrase}»`

      await updateSession({ ai_score: score, ai_comment: comment, ai_actual_transcription: imagPhrase })

      const isLastRound = currentRound >= totalRounds
      broadcastState(GAME_EVENTS.SHOW_RESULT, {
        score,
        comment,
        breakdown: null,
        actualTranscription: imagPhrase,
        attemptTranscription: imagSelected,
        guestGuessText: imagSelected,
        roundNumber: currentRound,
      })
      setScore(score)
      setComment(comment)
      setActualTranscription(imagPhrase)
      setAttemptTranscription(imagSelected)
      setGuestGuessText(imagSelected)
      const newEntry = { round: currentRound, score, comment }
      setRoundScores(prev => [...prev, newEntry])

      if (isLastRound) {
        await updateRoomStatus(ROOM_STATUS.FINISHED)
        await finalizeGame(score)
      }

      setPhase(isLastRound ? PHASES.FINAL_RESULTS : PHASES.ROUND_RESULTS)
      if (score >= 60) setTimeout(() => launchConfetti(), 300)
      playNotification('gameOver')
    } catch (err) {
      console.error('submitImagGuess error:', err)
      toast.error('Ошибка при отправке ответа.')
    } finally {
      setPendingSubmit(false)
      setScoring(false)
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const confirmCancelGame = async () => {
    setShowCancelModal(false)
    // Stop any ongoing recording first (best-effort)
    try {
      if (audio.isRecording) {
        activeHandlerRef.current = null
        await audio.stopRecording()
      }
    } catch { /* ignore */ }
    // Broadcast cancellation so the guest is also redirected
    try { broadcastState('GAME_CANCELLED', {}) } catch { /* ignore */ }
    // Close room (best-effort)
    try { await closeRoom() } catch { /* ignore */ }
    navigate('/lobby')
  }

  // Poll until reversed_audio_url is available in DB, then mark ready
  useEffect(() => {
    if (!isGuesser || phase !== PHASES.GUEST_LISTEN) return
    setReversedAudioReady(false)
    let cancelled = false
    const poll = async () => {
      for (let i = 0; i < 30; i++) {
        if (cancelled) return
        try {
          const { data: session } = await supabase
            .from('game_sessions').select('reversed_audio_url').eq('room_id', roomId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          if (session?.reversed_audio_url) {
            if (!cancelled) setReversedAudioReady(true)
            return
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 1500))
      }
    }
    poll()
    return () => { cancelled = true }
  }, [phase, isGuesser, roomId])


  const doProcessMimic = async (mimicBlob) => {
    if (!mimicBlob || mimicBlob.size === 0) {
      setPhase(PHASES.GUEST_MIMIC)
      return
    }
    setUploading(true)
    setUploadTimedOut(false)
    try {
      const mimicReversedBlob = await withTimeout(audio.reverseAudio(mimicBlob))
      if (mimicReversedBlob) {
        const mimicUrl = await withTimeout(uploadAudio(mimicBlob, 'mimic'))
        const mimicReversedUrl = await withTimeout(uploadAudio(mimicReversedBlob, 'mimic_reversed'))
        await withTimeout(updateSession({ mimic_audio_url: mimicUrl, mimic_reversed_url: mimicReversedUrl }))
        broadcastState(GAME_EVENTS.MIMIC_DONE)
        setPhase(PHASES.GUEST_GUESS)
      } else {
        setUploadTimedOut(true)
      }
    } catch (err) {
      console.error('doProcessMimic error:', err)
      setUploadTimedOut(true)
    } finally {
      setUploading(false)
    }
  }

  const handleMimicStart = async () => {
    broadcastState(GAME_EVENTS.MIMIC_RECORDING)
    setPhase(PHASES.GUEST_MIMIC)
    startCountdown(async () => {
      activeHandlerRef.current = 'mimic'
      await audio.startRecording()
    })
  }

  const handleMimicStop = async () => {
    activeHandlerRef.current = null
    const mimicBlob = await audio.stopRecording()
    await doProcessMimic(mimicBlob)
  }

  const handleMimicCancel = async () => {
    activeHandlerRef.current = null
    await audio.stopRecording() // Let it stop naturally, do not upload
  }

  const handlePlayMimicReversed = async () => {
    if (audio.reversedBlob) {
      audio.playAudio(audio.reversedBlob)
      return
    }
    const { data: session } = await supabase
      .from('game_sessions').select('mimic_reversed_url').eq('room_id', roomId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (session?.mimic_reversed_url) {
      const { data } = await supabase.storage.from('audio').download(session.mimic_reversed_url)
      if (data) audio.playAudio(data)
    }
  }

  const submitGuestGuess = async () => {
    if (!guestGuessText.trim()) return
    setPendingSubmit(true)

    // Only race the DB write against a timeout — triggerScoring (AI) can be slow (20-40s)
    const dbWriteTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 10_000)
    )

    try {
      // 1. Write to DB with timeout
      await Promise.race([
        updateSession({ guest_guess_text: guestGuessText.trim() }),
        dbWriteTimeout,
      ])
      // 2. Unlock button immediately — scoring runs in background
      setPendingSubmit(false)
      broadcastState(GAME_EVENTS.GUESS_SUBMITTED)
      setPhase(PHASES.SCORING)
      hapticSuccess()
      // 3. AI scoring — no timeout (Gemini takes 20-40s)
      await triggerScoring()
    } catch (err) {
      if (err.message === 'TIMEOUT') {
        toast.error('⚡ Сервер не отвечает. Проверь соединение и попробуй снова.')
      } else {
        toast.error('Ошибка при сохранении ответа. Попробуй ещё раз.')
      }
      console.error('submitGuestGuess err:', err)
      hapticError()
      setPendingSubmit(false)
    }
  }



  const triggerScoring = async () => {
    setScoring(true)
    let finalScore = 50
    try {
      const { data: session } = await supabase
        .from('game_sessions').select('*').eq('room_id', roomId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!session) return

      // Download original and mimic_reversed audio for comparison
      let originalBlob = null
      let mimicReversedBlob = null

      if (session.original_audio_url) {
        const { data } = await supabase.storage.from('audio').download(session.original_audio_url)
        if (data) originalBlob = data
      }
      if (session.mimic_reversed_url) {
        const { data } = await supabase.storage.from('audio').download(session.mimic_reversed_url)
        if (data) mimicReversedBlob = data
      }

      if (originalBlob && mimicReversedBlob && isGeminiAvailable()) {
        // Real Gemini AI scoring
        const result = await scoreWithGemini(originalBlob, mimicReversedBlob, session.guest_guess_text, session.ai_actual_transcription, room?.game_language || 'ru')
        finalScore = result.score
        await updateSession({ 
          ai_score: result.score, 
          ai_comment: result.comment,
          ai_actual_transcription: result.actual_transcription
        })
        broadcastState(GAME_EVENTS.SHOW_RESULT, { 
          score: result.score, 
          comment: result.comment, 
          breakdown: result.breakdown,
          actualTranscription: result.actual_transcription,
          attemptTranscription: result.attempt_transcription,
          guestGuessText: session.guest_guess_text,
          roundNumber: currentRound
        })
        setScore(result.score); 
        setComment(result.comment); 
        setBreakdown(result.breakdown);
        setActualTranscription(result.actual_transcription || null);
        setAttemptTranscription(result.attempt_transcription || null);
        if (session.guest_guess_text) setGuestGuessText(session.guest_guess_text);
      } else {
        // Demo fallback
        finalScore = Math.floor(Math.random() * 60) + 40
        const reason = !isGeminiAvailable()
          ? 'Демо-режим: Gemini API ключ не настроен.'
          : 'Не удалось загрузить аудио для сравнения.'
        await updateSession({ ai_score: finalScore, ai_comment: reason })
        broadcastState(GAME_EVENTS.SHOW_RESULT, { 
          score: finalScore, 
          comment: reason,
          guestGuessText: session.guest_guess_text,
          roundNumber: currentRound
        })
        setScore(finalScore); 
        setComment(reason);
        if (session.guest_guess_text) setGuestGuessText(session.guest_guess_text);
      }

      // Only finish game after the last round
      const isLastRound = currentRound >= totalRounds
      if (isLastRound) {
        await updateRoomStatus(ROOM_STATUS.FINISHED)
        await finalizeGame(finalScore)
      }
       // Profile stats updated at game end only (finalizeGame called above)
    } catch (err) {
      console.error('Scoring failed:', err)
      const fb = 50
      broadcastState(GAME_EVENTS.SHOW_RESULT, { score: fb, comment: `Ошибка AI: ${err.message}`, roundNumber: currentRound })
      setScore(fb); setComment(`Ошибка AI: ${err.message}`)
    } finally {
      setScoring(false)
      const newEntry = { round: currentRound, score: finalScore, comment: comment }
      setRoundScores(prev => [...prev, newEntry])
      const isLastRound = currentRound >= totalRounds
      setPhase(isLastRound ? PHASES.FINAL_RESULTS : PHASES.ROUND_RESULTS)
      if (finalScore >= 60) {
        setTimeout(() => launchConfetti(), 300)
      }
    }
  }

  // XP level thresholds (client copy — matches UserProfileDrawer)
  const XP_LEVELS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000]
  const calcLevel = (xp) => {
    let lv = 1
    XP_LEVELS.forEach((t, i) => { if (xp >= t) lv = i + 1 })
    return Math.min(lv, XP_LEVELS.length)
  }

  /**
   * Applies XP/rating/stats update to the CURRENT USER's profile.
   * Must be called with the auth token of the user whose profile is being updated.
   * @param {number} myScore - the player's cumulative score this game
   * @param {boolean} won - whether this player won
   * @param {string|null} winnerId - id of winner (null = tie)
   * @param {number} ratingChange - magnitude of rating delta
   */
  const applyProfileUpdate = async (myScore, won, winnerId, ratingChange) => {
    try {
      const { data: p, error: fetchErr } = await supabase
        .from('profiles')
        .select('games_played, games_won, xp, level, rating, avg_score, best_score, win_streak')
        .eq('id', user.id).maybeSingle()
      if (fetchErr) throw fetchErr
      if (!p) return
      const xpEarned = Math.round(myScore / 5)
      const newXP = (p.xp || 0) + xpEarned
      const newLevel = calcLevel(newXP)
      const newRating = Math.max(0, (p.rating || 1000) + (won ? ratingChange : winnerId ? -ratingChange : 0))
      const gamesPlayed = (p.games_played || 0) + 1
      const gamesWon = (p.games_won || 0) + (won ? 1 : 0)
      const avgScore = Math.round(((p.avg_score || 0) * (gamesPlayed - 1) + myScore) / gamesPlayed)
      const bestScore = Math.max(p.best_score || 0, myScore)
      const winStreak = won ? (p.win_streak || 0) + 1 : 0
      const { error: updateErr } = await supabase.from('profiles').update({
        xp: newXP, level: newLevel, rating: newRating,
        games_played: gamesPlayed, games_won: gamesWon,
        avg_score: avgScore, best_score: bestScore, win_streak: winStreak,
      }).eq('id', user.id)
      if (updateErr) console.warn('applyProfileUpdate error:', updateErr)
    } catch (err) {
      console.warn('applyProfileUpdate failed:', err)
    }
  }

  /**
   * finalizeGame — called ONCE when the last round score is saved.
   * - Computes per-player cumulative scores
   * - Inserts finished_games row
   * - Updates both profiles: xp, level, rating, games_played, games_won, avg_score, best_score, win_streak
   * Rating formula: ratingChange = clamp(4, 20, round(|hostScore - guestScore| / 5))
   */
  const finalizeGame = async (allRoundScores) => {
    if (finalized || !room?.host_id || !room?.guest_id) return
    setFinalized(true)
    try {
      // Load all sessions for this room to get recorder_id per round
      const { data: sessions } = await supabase
        .from('game_sessions')
        .select('round_number, recorder_id, ai_score')
        .eq('room_id', roomId)
        .order('round_number', { ascending: true })

      // Compute scores: guesser earns the ai_score (recorder_id is who RECORDED, guesser is the other)
      let hostScore = 0, guestScore = 0
      let hostRoundsGuessed = 0, guestRoundsGuessed = 0
      let hostRoundsWon = 0, guestRoundsWon = 0
      const roundDetails = []

      ;(sessions || []).forEach(s => {
        if (s.ai_score == null) return
        const guesserIsHost = s.recorder_id === room.guest_id  // host guessed
        if (guesserIsHost) {
          hostScore += s.ai_score
          hostRoundsGuessed++
          if (s.ai_score >= 60) hostRoundsWon++
        } else {
          guestScore += s.ai_score
          guestRoundsGuessed++
          if (s.ai_score >= 60) guestRoundsWon++
        }
        roundDetails.push({ round: s.round_number, recorder_id: s.recorder_id, score: s.ai_score })
      })

      // Winner
      const winnerId = hostScore > guestScore ? room.host_id
        : guestScore > hostScore ? room.guest_id : null  // null = tie

      // Rating change based on score difference
      const scoreDiff = Math.abs(hostScore - guestScore)
      const ratingChange = Math.max(4, Math.min(20, Math.round(scoreDiff / 5)))

      // Insert finished_games (idempotent check via room_id)
      const { error: fgError } = await supabase.from('finished_games').insert({
        room_id: roomId,
        host_id: room.host_id,
        guest_id: room.guest_id,
        host_score: hostScore,
        guest_score: guestScore,
        host_rounds_guessed: hostRoundsGuessed,
        guest_rounds_guessed: guestRoundsGuessed,
        host_rounds_won: hostRoundsWon,
        guest_rounds_won: guestRoundsWon,
        winner_id: winnerId,
        round_details: roundDetails,
        total_rounds: totalRounds,
        host_rating_change: winnerId === room.host_id ? ratingChange : winnerId === room.guest_id ? -ratingChange : 0,
        guest_rating_change: winnerId === room.guest_id ? ratingChange : winnerId === room.host_id ? -ratingChange : 0,
      })
      if (fgError) console.warn('finished_games insert error:', fgError)

      // ⚠️ RLS: host can only update their OWN profile row.
      // Guest profile is updated by the guest themselves via FINAL_STATS broadcast.
      const hostWon = winnerId === room.host_id
      await applyProfileUpdate(hostScore, hostWon, winnerId, ratingChange)

      // Store for UI display (host)
      const stats = { hostScore, guestScore, winnerId, ratingChange,
        hostRoundsWon, guestRoundsWon, roundDetails }
      setFinalStats(stats)

      // Broadcast finalStats + guest's computed profile payload so guest can update themselves
      broadcastState('FINAL_STATS', {
        finalStats: stats,
        guestProfileUpdate: {
          myScore: guestScore,
          won: winnerId === room.guest_id,
          winnerId,
          ratingChange,
        },
      })

      // Confetti for host if they won or it's a tie
      if (hostWon || winnerId === null) setTimeout(() => launchConfetti(), 400)
    } catch (err) {
      console.warn('finalizeGame error:', err)
    }
  }

  const handleManualScore = async (scoreOption) => {
    try {
      setManualScore(scoreOption)
      const { error } = await supabase
        .from('game_sessions')
        .update({ manual_score: scoreOption })
        .eq('room_id', roomId)
      if (error) throw error
      
      broadcastState(GAME_EVENTS.MANUAL_SCORE_SET, { manualScore: scoreOption })
    } catch (err) {
      console.error('Failed to set manual score:', err)
    }
  }

  const handleRematch = async () => {
    if (pendingRematch) return
    setPendingRematch(true)
    setRematchRequested(true)
    broadcastState(GAME_EVENTS.REMATCH_REQUESTED, { senderId: user?.id })
    hapticLight()

    // If the OTHER player already requested, create a new room
    if (rematchPending) {
      try {
        // The player creating the rematch room must be host_id (RLS requires auth.uid() = host_id)
        const myId = user?.id
        const otherId = myId === room.host_id ? room.guest_id : room.host_id
        const { data: newRoom, error } = await supabase.from('rooms').insert({
          host_id: myId,
          guest_id: otherId,
          status: ROOM_STATUS.WAITING,
          total_rounds: totalRounds,
          current_round: 0,
        }).select().single()
        if (error) throw error
        hapticSuccess()
        broadcastState(GAME_EVENTS.REMATCH_ACCEPTED, { newRoomId: newRoom.id })
        navigate(`/game/${newRoom.id}`)
      } catch (err) {
        console.error('Rematch room creation failed:', err)
        toast.error('Не удалось создать реванш. Попробуй ещё раз.')
        hapticError()
        setPendingRematch(false)
      }
    } else {
      // Waiting for other player — show toast
      toast.info('Запрос реванша отправлен! Ждём второго игрока...', { icon: '⚔️' })
      setPendingRematch(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Update browser tab title based on phase
  useEffect(() => {
    const titles = {
      [PHASES.WAITING]:        '⏳ Ожидание — ZVOO',
      [PHASES.READY]:          '✅ Готовы — ZVOO',
      [PHASES.HOST_RECORD]:    isRecorder ? (isImaginarium ? '✍️ Введи фразу! — ZVOO' : '🎙️ Твой ход! — ZVOO') : '⏳ Ход записывающего — ZVOO',
      [PHASES.IMAG_GENERATE]:  isRecorder ? '🎨 Генерирую... — ZVOO' : '⏳ Ожидание картинки — ZVOO',
      [PHASES.IMAG_GUESS]:     isGuesser ? '🖼️ Угадай! — ZVOO' : '⏳ Гость угадывает — ZVOO',
      [PHASES.GUEST_LISTEN]:   isGuesser ? '🎧 Слушай! — ZVOO' : '⏳ Ход угадывающего — ZVOO',
      [PHASES.GUEST_MIMIC]:    isGuesser ? '🗣️ Повторяй! — ZVOO' : '⏳ Ход угадывающего — ZVOO',
      [PHASES.SCORING]:        '🤖 AI думает — ZVOO',
      [PHASES.ROUND_RESULTS]:  `🏆 Раунд ${currentRound}/${totalRounds} — ZVOO`,
      [PHASES.FINAL_RESULTS]:  '🏆 Финал — ZVOO',
      [PHASES.RESULTS]:        '🏆 Результат — ZVOO',
    }
    document.title = titles[phase] || 'ZVOO'
    return () => { document.title = 'ZVOO' }
  }, [phase, isHost, isGuest])

  // Loading state
  if (!room) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '24px', margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #147A8A, #2DC4B2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '32px', animation: 'pulse-glow 1.5s ease-in-out infinite',
            boxShadow: '0 16px 48px rgba(124,58,237,0.4)',
          }}>↩</div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '15px' }}>Подключение к комнате...</p>
        </div>
      </div>
    )
  }

  // Rich per-player status messages
  const roundLabel = totalRounds > 1 ? ` (${currentRound}/${totalRounds})` : ''
  const myStatus = {
    [PHASES.WAITING]:        isHost ? '📤 Отправь ссылку другу и жди подключения' : '⏳ Ждём начала игры...',
    [PHASES.READY]:          isHost ? '✅ Игрок подключён — нажми Начать' : '⏳ Ожидание хоста...',
    [PHASES.HOST_RECORD]:    isRecorder ? (isImaginarium ? `✍️ Твой ход — введи фразу${roundLabel}` : `🎙️ Твой ход — запиши фразу${roundLabel}`) : `⏳ Другой игрок записывает${roundLabel}`,
    [PHASES.IMAG_GENERATE]:  isRecorder ? `🎨 ИИ создаёт картинку...` : `⏳ Ждём картинку от ИИ…`,
    [PHASES.IMAG_GUESS]:     isGuesser ? `🖼️ Я угадываю — выбери вариант${roundLabel}` : `⏳ Гость угадывает фразу…`,
    [PHASES.GUEST_LISTEN]:   isGuesser ? `🎧 Твой ход — послушай реверс${roundLabel}` : `⏳ Угадывающий слушает${roundLabel}`,
    [PHASES.GUEST_MIMIC]:    isGuesser ? `🗣️ Твой ход — повтори звук!${roundLabel}` : `⏳ Угадывающий повторяет${roundLabel}`,
    [PHASES.GUEST_GUESS]:    isGuesser ? `🤔 Угадай что было сказано${roundLabel}` : `⏳ Угадывающий вводит ответ${roundLabel}`,
    [PHASES.SCORING]:        '🤖 AI анализирует результат...',
    [PHASES.ROUND_RESULTS]:  `🏆 Раунд ${currentRound} завершён!`,
    [PHASES.FINAL_RESULTS]:  '🏆 Игра завершена!',
    [PHASES.RESULTS]:        '🏆 Игра завершена!',
  }
  const theirStatus = {
    [PHASES.HOST_RECORD]:    isRecorder ? null : (isImaginarium ? '⏳ Хост вводит фразу...' : '⏳ Записывает фразу...'),
    [PHASES.IMAG_GENERATE]:  '⏳ ИИ рисует картинку...',
    [PHASES.IMAG_GUESS]:     isGuesser ? null : '⏳ Гость угадывает...',
    [PHASES.GUEST_LISTEN]:   isGuesser ? null : '⏳ Слушает реверс...',
    [PHASES.GUEST_MIMIC]:    isGuesser ? null : '⏳ Записывает повтор...',
    [PHASES.GUEST_GUESS]:    isGuesser ? null : '⏳ Вводит ответ...',
  }
  const statusText = myStatus

  return (
    <div style={{ minHeight: '100vh', padding: '88px 20px 60px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* ─── AI Vision fullscreen loader overlay ─── */}
      {visionLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9990,
          background: 'rgba(10,10,30,0.88)',
          backdropFilter: 'blur(16px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '24px',
        }}>
          {/* Animated magic circle */}
          <div style={{ position: 'relative', width: '100px', height: '100px' }}>
            <div style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              border: '3px solid transparent',
              borderTopColor: '#4DD9C8',
              borderRightColor: '#147A8A',
              animation: 'spin 1s linear infinite',
            }} />
            <div style={{
              position: 'absolute', inset: '14px',
              borderRadius: '50%',
              border: '2px solid transparent',
              borderTopColor: '#2DC4B2',
              animation: 'spin 1.4s linear infinite reverse',
            }} />
            <div style={{
              position: 'absolute', inset: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '22px',
            }}>🎨</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '18px', fontWeight: 700, color: '#4DD9C8', margin: '0 0 8px' }}>
              AI Vision создаёт подсказку...
            </p>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
              Gemini рисует визуальный хинт — секунду!
            </p>
          </div>
        </div>
      )}


      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        {/* Static base layer */}
        <div style={{
          position: 'absolute', bottom: '15%', right: '8%', width: '400px', height: '400px',
          background: 'radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(70px)',
        }} />
        {/* Dynamic phase tint */}
        <div
          id="game-ambient-overlay"
          className={phaseBgClass}
          style={{
            position: 'absolute', inset: 0,
            filter: 'blur(80px)',
            transition: 'background 1.2s ease',
          }}
        />
      </div>

      {/* Round flash overlay */}
      {showRoundFlash && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div className="round-flash" style={{
            padding: '24px 52px', borderRadius: '28px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.92), rgba(6,182,212,0.92))',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 24px 64px rgba(124,58,237,0.5)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '6px' }}>Начинается</div>
            <div style={{ fontSize: '36px', fontWeight: 900, color: '#fff' }}>{roundFlashLabel}</div>
          </div>
        </div>
      )}

      {/* ─── Imaginarium: image generating fullscreen loader ─── */}
      {imagGenerating && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9990,
          background: 'rgba(10,10,30,0.92)',
          backdropFilter: 'blur(18px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '24px',
        }}>
          <div style={{ position: 'relative', width: '110px', height: '110px' }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '3px solid transparent',
              borderTopColor: '#A78BFA', borderRightColor: '#7C3AED',
              animation: 'spin 1s linear infinite',
            }} />
            <div style={{
              position: 'absolute', inset: '14px', borderRadius: '50%',
              border: '2px solid transparent', borderTopColor: '#6D28D9',
              animation: 'spin 1.6s linear infinite reverse',
            }} />
            <div style={{
              position: 'absolute', inset: '32px', borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.4), rgba(167,139,250,0.2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
            }}>🎨</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '20px', fontWeight: 700, color: '#A78BFA', margin: '0 0 8px' }}>ИИ рисует картинку...</p>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Генерируем образ и варианты ответа — подождите!</p>
          </div>
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Phase progress bar */}
        <div style={{
          padding: '20px 28px',
          borderRadius: '20px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <PhaseBar phase={phase} isImaginarium={isImaginarium} />
        </div>

        {/* Status cards — my turn vs their turn */}
        <div style={{ display: 'grid', gridTemplateColumns: theirStatus[phase] ? '1fr 1fr' : '1fr', gap: '12px' }}>
          {/* My status */}
          <div style={{
            padding: '14px 20px',
            borderRadius: '16px',
            background: [PHASES.RESULTS, PHASES.ROUND_RESULTS, PHASES.FINAL_RESULTS].includes(phase)
              ? 'rgba(16,185,129,0.08)'
              : (isRecorder && [PHASES.HOST_RECORD, PHASES.IMAG_GENERATE].includes(phase)) || (isGuesser && [PHASES.GUEST_LISTEN, PHASES.GUEST_MIMIC, PHASES.IMAG_GUESS].includes(phase))
                ? 'rgba(124,58,237,0.12)'
                : 'rgba(255,255,255,0.03)',
            border: `1px solid ${
              [PHASES.RESULTS, PHASES.ROUND_RESULTS, PHASES.FINAL_RESULTS].includes(phase) ? 'rgba(16,185,129,0.25)'
              : (isRecorder && [PHASES.HOST_RECORD, PHASES.IMAG_GENERATE].includes(phase)) || (isGuesser && [PHASES.GUEST_LISTEN, PHASES.GUEST_MIMIC, PHASES.IMAG_GUESS].includes(phase))
                ? 'rgba(124,58,237,0.35)'
                : 'rgba(255,255,255,0.07)'
            }`,
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              background: phase === PHASES.RESULTS ? '#10B981' : audio.isRecording ? '#EF4444' : audio.isPlaying ? '#2DC4B2' : '#147A8A',
              boxShadow: `0 0 10px ${audio.isRecording ? 'rgba(239,68,68,0.6)' : 'rgba(124,58,237,0.5)'}`,
              animation: (audio.isRecording || audio.isPlaying || phase === PHASES.SCORING) ? 'pulse-glow 1.5s ease-in-out infinite' : 'none',
            }} />
            <div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>Вы</div>
              <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{myStatus[phase]}</span>
            </div>
          </div>
          {/* Their status */}
          {theirStatus[phase] && (
            <div style={{
              padding: '14px 20px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', gap: '10px',
              opacity: 0.8,
            }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                background: '#F59E0B',
                animation: 'pulse-glow 2s ease-in-out infinite',
              }} />
              <div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
                  {isHost ? (guestProfile?.username || 'Гость') : (hostProfile?.username || 'Хост')}
                </div>
                <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>{theirStatus[phase]}</span>
              </div>
            </div>
          )}
        </div>

        {/* Players + visualizer */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <PlayerCard player={hostProfile}  isHost={true}  isOnline={true}            isCurrentUser={isHost} />
          <PlayerCard player={guestProfile} isHost={false} isOnline={!!room.guest_id} isCurrentUser={isGuest} />
        </div>

        {/* Audio visualizer */}
        <div style={{
          padding: '20px 24px',
          borderRadius: '20px',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${audio.isRecording ? 'rgba(239,68,68,0.25)' : audio.isPlaying ? 'rgba(6,182,212,0.25)' : 'rgba(255,255,255,0.07)'}`,
          transition: 'border-color 0.3s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: audio.isRecording ? '#EF4444' : audio.isPlaying ? '#10B981' : 'rgba(255,255,255,0.2)',
              boxShadow: audio.isRecording ? '0 0 8px rgba(239,68,68,0.6)' : 'none',
              animation: audio.isRecording ? 'pulse-glow 1s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              {audio.isRecording ? 'Запись...' : audio.isPlaying ? 'Воспроизведение...' : 'Аудио визуализатор'}
            </span>
          </div>
          <AudioVisualizer analyserData={audio.analyserData} isActive={audio.isRecording || audio.isPlaying} height={120} />
        </div>

        {/* Countdown overlay */}
        {countdown !== null && (
          <div style={{
            padding: '48px 24px', borderRadius: '24px',
            background: countdown === 1
              ? 'rgba(239,68,68,0.12)' : countdown === 2
              ? 'rgba(245,158,11,0.12)' : 'rgba(124,58,237,0.12)',
            border: `1px solid ${countdown === 1
              ? 'rgba(239,68,68,0.3)' : countdown === 2
              ? 'rgba(245,158,11,0.3)' : 'rgba(124,58,237,0.3)'}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
            animation: 'countdown-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            <div key={countdown} style={{
              fontSize: '96px', fontWeight: 900, lineHeight: 1,
              background: countdown === 1
                ? 'linear-gradient(135deg, #EF4444, #F59E0B)'
                : countdown === 2
                ? 'linear-gradient(135deg, #F59E0B, #2DC4B2)'
                : 'linear-gradient(135deg, #147A8A, #2DC4B2)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              animation: 'countdown-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}>{countdown}</div>
            <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
              {countdown === 1 ? 'Приготовься!' : 'Приготовься...'}
            </span>
          </div>
        )}

        {/* Controls */}
        <div style={{
          padding: '28px 24px',
          borderRadius: '20px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
        }}>
          {/* WAITING — show invite link */}
          {phase === PHASES.WAITING && (
            <div style={{ textAlign: 'center', width: '100%' }}>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', marginBottom: '12px', margin: '0 0 12px' }}>
                {isHost ? '📤 Отправь ссылку другу:' : '⏳ Ожидание хоста...'}
              </p>
              {isHost && (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                    padding: '12px 16px', borderRadius: '14px', maxWidth: '520px', margin: '0 auto 16px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                    <code style={{ fontSize: '12px', color: '#7EEEE4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {window.location.href}
                    </code>
                    <button
                      onClick={copyLink}
                      style={{
                        padding: '6px 14px', borderRadius: '8px', border: 'none',
                        background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.09)',
                        color: copied ? '#10B981' : 'rgba(255,255,255,0.65)',
                        fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        transition: 'all 0.2s',
                      }}
                    >
                      {copied ? '✅ Скопировано' : '📋 Копировать'}
                    </button>
                  </div>
                  {/* Host leave / close room */}
                  <button
                    onClick={async () => {
                      try {
                        await closeRoom()
                      } catch (err) {
                        console.error('Не удалось закрыть комнату:', err.message)
                      }
                      navigate('/lobby')
                    }}
                    style={{
                      padding: '10px 22px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.25)',
                      background: 'rgba(239,68,68,0.08)',
                      color: 'rgba(239,68,68,0.7)', fontWeight: 600, fontSize: '13px',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#EF4444' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = 'rgba(239,68,68,0.7)' }}
                  >
                    🚪 Закрыть комнату
                  </button>
                </>
              )}
            </div>
          )}

          {/* READY — guest joined, host can start */}
          {phase === PHASES.READY && (
            <div style={{ textAlign: 'center', width: '100%' }}>
              <div style={{
                padding: '24px', borderRadius: '20px', maxWidth: '480px', margin: '0 auto 16px',
                background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
              }}>
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>✅</div>
                <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.85)', fontWeight: 600, margin: '0 0 4px' }}>
                  Игрок присоединился!
                </p>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 16px' }}>
                  Раундов: {totalRounds} • Ходы чередуются
                </p>
                {isHost ? (
                  <ActionButton
                    onClick={handleHostStart}
                    variant="primary"
                    pending={pendingHostStart}
                    pendingLabel="Запускаем..."
                  >
                    🚀 Начать игру
                  </ActionButton>
                ) : (
                  <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                    ⏳ Ожидание хоста...
                  </p>
                )}
              </div>
              {isHost && (
                <button
                  onClick={async () => {
                    try { await closeRoom() } catch {}
                    navigate('/lobby')
                  }}
                  style={{
                    padding: '8px 18px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)',
                    background: 'rgba(239,68,68,0.06)', color: 'rgba(239,68,68,0.6)',
                    fontWeight: 600, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s',
                    marginTop: '8px',
                  }}
                >
                  🚪 Отменить
                </button>
              )}
            </div>
          )}

          {/* RECORDER — record controls */}
          {isRecorder && phase === PHASES.HOST_RECORD && !audio.isRecording && !uploading && !isImaginarium && (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 8px' }}>
                Скажи любую фразу. Система перевернёт её задом наперёд.
              </p>
              <button className="btn-record-xl" onClick={handleHostRecord}>
                🎤
              </button>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>Нажми чтобы начать</span>
            </div>

          )}

          {/* IMAGINARIUM: host types phrase + Generate */}
          {isImaginarium && isRecorder && phase === PHASES.HOST_RECORD && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', margin: 0, textAlign: 'center' }}>
                Введи слово или фразу — ИИ нарисует картинку по ней в стиле <strong style={{ color: '#A78BFA' }}>{room?.imag_style?.replace('_', ' ') || '...'}</strong>
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  id="imag-phrase-input"
                  type="text"
                  placeholder="Например: закат в горах"
                  value={hostPhraseText}
                  onChange={e => setHostPhraseText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && hostPhraseText.trim()) handleImagGenerate() }}
                  maxLength={80}
                  style={{
                    flex: 1, padding: '14px 18px', borderRadius: '14px', fontSize: '16px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(124,58,237,0.35)',
                    color: 'white', outline: 'none',
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)',
                  }}
                />
                <ActionButton
                  onClick={handleImagGenerate}
                  disabled={!hostPhraseText.trim()}
                  variant="primary"
                >
                  🎨 Создать
                </ActionButton>
              </div>
            </div>
          )}

          {/* IMAGINARIUM: guest waiting while host generates */}
          {isImaginarium && isGuesser && phase === PHASES.IMAG_GENERATE && (
            <div style={{
              padding: '32px 24px', borderRadius: '20px', textAlign: 'center',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(6,182,212,0.06))',
              border: '1px solid rgba(124,58,237,0.2)',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px', animation: 'spin 2s linear infinite' }}>🎨</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'white', marginBottom: '8px' }}>ИИ рисует картинку...</div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>Скоро появятся варианты ответов</div>
            </div>
          )}

          {/* IMAGINARIUM: generating overlay indicator for host */}
          {isImaginarium && isRecorder && phase === PHASES.IMAG_GUESS && (
            <div style={{
              padding: '24px', borderRadius: '20px', textAlign: 'center',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(6,182,212,0.06))',
              border: '1px solid rgba(124,58,237,0.2)',
            }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🖼️</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>Гость угадывает</div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>Загаданная фраза: <span style={{ color: '#A78BFA', fontWeight: 700 }}>«{imagPhrase}»</span></div>
            </div>
          )}

          {/* IMAGINARIUM GUESSER: image + 4 choices */}
          {isImaginarium && isGuesser && phase === PHASES.IMAG_GUESS && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {imagImage && (
                <div style={{
                  borderRadius: '20px', overflow: 'hidden',
                  border: '1px solid rgba(124,58,237,0.3)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}>
                  <img
                    src={imagImage}
                    alt="Угадай фразу"
                    style={{ width: '100%', display: 'block', maxHeight: '320px', objectFit: 'cover' }}
                  />
                </div>
              )}
              {!imagImage && (
                <div style={{
                  height: '200px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)',
                }}>
                  <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)' }}>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎨</div>
                    <div>Изображение загружается...</div>
                  </div>
                </div>
              )}
              <p style={{ margin: 0, textAlign: 'center', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>
                Какая фраза изображена на картинке?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(imagChoices || []).map((choice, i) => (
                  <button
                    key={i}
                    id={`imag-choice-${i}`}
                    onClick={() => setImagSelected(choice)}
                    style={{
                      padding: '14px 20px', borderRadius: '14px', textAlign: 'left',
                      fontSize: '15px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                      border: imagSelected === choice
                        ? '2px solid #A78BFA'
                        : '1px solid rgba(255,255,255,0.1)',
                      background: imagSelected === choice
                        ? 'rgba(124,58,237,0.25)'
                        : 'rgba(255,255,255,0.04)',
                      color: imagSelected === choice ? '#E9D5FF' : 'rgba(255,255,255,0.75)',
                      boxShadow: imagSelected === choice ? '0 0 0 1px rgba(167,139,250,0.4)' : 'none',
                    }}
                  >
                    <span style={{ opacity: 0.5, marginRight: '10px' }}>{String.fromCharCode(65 + i)})</span>
                    {choice}
                  </button>
                ))}
              </div>
              <ActionButton
                onClick={submitImagGuess}
                disabled={!imagSelected}
                pending={pendingSubmit}
                pendingLabel="Отправляем..."
                variant="primary"
              >
                ✅ Подтвердить выбор
              </ActionButton>
            </div>
          )}

          {isRecorder && audio.isRecording && (

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div
                className={audio.recordingElapsed >= MAX_RECORDING_SECONDS - 5 ? 'timer-critical' : ''}
                style={{
                  fontSize: '40px', fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                  color: audio.recordingElapsed >= MAX_RECORDING_SECONDS - 5 ? '#EF4444' : '#4DD9C8',
                  transition: 'color 0.3s',
                }}
              >
                {MAX_RECORDING_SECONDS - audio.recordingElapsed}с
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <button className="btn-stop-xl" onClick={handleHostStop}>
                  ⏹️
                </button>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>Нажми чтобы завершить</span>
                <button
                  onClick={handleHostCancel}
                  className="btn-game"
                  style={{
                    padding: '8px 20px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  ❌ Отменить
                </button>
              </div>
            </div>

          )}
          {/* uploading spinner or timeout error — shown while host audio is being processed */}
          {isRecorder && (uploading || uploadTimedOut) && !audio.isRecording && (
            uploadTimedOut ? (
              <div style={{
                padding: '20px', borderRadius: '16px', textAlign: 'center',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              }}>
                <p style={{ fontSize: '15px', fontWeight: 700, color: '#FCA5A5', margin: '0 0 6px' }}>⏱️ Превышено время ожидания</p>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '0 0 16px' }}>
                  Загрузка и обработка аудио заняли больше 30 секунд.
                </p>
                <ActionButton onClick={() => { setUploadTimedOut(false); setPhase(PHASES.HOST_RECORD) }} variant="danger">
                  🎙️ Перезаписать
                </ActionButton>
              </div>
            ) : (
              <div style={{ marginTop: '20px' }}>
                <FakeProgressBar active={true} duration={4500} label="🧠 ИИ Gemini 3.1 Live распознаёт вашу фразу..." />
              </div>
            )
          )}
          {/* uploading / timeout for guest mimic */}
          {isGuesser && (uploading || uploadTimedOut) && !audio.isRecording && (
            uploadTimedOut ? (
              <div style={{
                padding: '20px', borderRadius: '16px', textAlign: 'center',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              }}>
                <p style={{ fontSize: '15px', fontWeight: 700, color: '#FCA5A5', margin: '0 0 6px' }}>⏱️ Превышено время ожидания</p>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '0 0 16px' }}>
                  Загрузка и обработка аудио заняли больше 30 секунд.
                </p>
                <ActionButton onClick={() => { setUploadTimedOut(false); setPhase(PHASES.GUEST_MIMIC) }} variant="danger">
                  🗣️ Перезаписать
                </ActionButton>
              </div>
            ) : (
              <div style={{ marginTop: '20px' }}>
                <FakeProgressBar active={true} duration={4500} label="⏳ Загрузка и подготовка аудио..." />
              </div>
            )
          )}
          {isRecorder && phase === PHASES.GUEST_LISTEN && (
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>🎧 Угадывающий слушает перевёрнутое аудио...</p>
          )}
          {isRecorder && phase === PHASES.GUEST_MIMIC && (
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>🗣️ Угадывающий повторяет звуки...</p>
          )}

          {/* GUEST — listen + mimic controls */}
          {isGuesser && phase === PHASES.GUEST_LISTEN && (
            <div style={{ textAlign: 'center' }}>
              {!reversedAudioReady ? (
                /* ─── Waiting for other player's audio to upload ─── */
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    border: '3px solid rgba(124,58,237,0.2)',
                    borderTop: '3px solid #4DD9C8',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                    Получаем аудио от другого игрока...
                  </p>
                </div>
              ) : (
                /* ─── Audio ready — show controls ─── */
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginBottom: '8px' }}>
                    <ActionButton onClick={() => handlePlayReversed(1.0)} disabled={audio.isPlaying} variant="cyan">
                      🎧 Послушать реверс
                    </ActionButton>
                    <ActionButton onClick={handleMimicStart} disabled={!hasListened} variant="primary">
                      🗣️ Начать повтор
                    </ActionButton>
                  </div>
                  {/* Slow Mo */}
                  {maxPowers.slow > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <button
                        onClick={activateSlowMo}
                        disabled={audio.isPlaying || slowMoActive || usedPowers.slow >= maxPowers.slow || !slowMoSupported}
                        style={{
                          padding: '10px 20px', borderRadius: '14px', cursor: 'pointer',
                          background: slowMoActive
                            ? 'linear-gradient(135deg, #059669, #10B981)'
                            : usedPowers.slow >= maxPowers.slow
                              ? 'rgba(255,255,255,0.04)'
                              : 'rgba(16,185,129,0.15)',
                          color: usedPowers.slow >= maxPowers.slow ? 'rgba(255,255,255,0.2)' : '#10B981',
                          fontWeight: 700, fontSize: '13px',
                          boxShadow: slowMoActive ? '0 0 20px rgba(16,185,129,0.4)' : 'none',
                          transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '8px',
                          border: `1px solid ${usedPowers.slow >= maxPowers.slow ? 'rgba(255,255,255,0.06)' : 'rgba(16,185,129,0.3)'}`,
                        }}
                      >
                        {slowMoActive ? <BtnSpinner size={13} /> : '🐢'} {slowMoActive ? 'Загружаем...' : 'Slow Mo'}
                        <span style={{ fontSize: '11px', opacity: 0.7 }}>{maxPowers.slow - usedPowers.slow}/{maxPowers.slow}</span>
                      </button>
                      {!slowMoSupported && <p style={{ fontSize: '11px', color: '#EF4444', marginTop: '6px' }}>⚠️ Недоступно на вашем устройстве</p>}
                    </div>
                  )}
                  {!hasListened && (
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: '8px 0 0' }}>
                      ⚠️ Сначала послушайте реверс
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {isGuesser && phase === PHASES.GUEST_MIMIC && audio.isRecording && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '28px', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                color: audio.recordingElapsed >= MAX_RECORDING_SECONDS - 5 ? '#EF4444' : '#4DD9C8',
                marginBottom: '12px', transition: 'color 0.3s',
              }}>
                {MAX_RECORDING_SECONDS - audio.recordingElapsed}с
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <ActionButton onClick={handleMimicStop} variant="danger" pulse>
                  ⏹ Завершить
                </ActionButton>
                <ActionButton onClick={handleMimicCancel} variant="secondary">
                  ❌ Отменить
                </ActionButton>
              </div>
            </div>
          )}

          {/* GUEST_GUESS — only for Classic mode */}
          {isGuesser && phase === PHASES.GUEST_GUESS && !isImaginarium && (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Теперь послушай, что получилось!</p>
              <ActionButton onClick={handlePlayMimicReversed} disabled={audio.isPlaying || uploading} variant="cyan">
                🔊 Послушать свой реверс
              </ActionButton>

              {/* ⚡ Superpower bar */}
              {(maxPowers.choices > 0 || maxPowers.vision > 0) && (
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {/* AI Choices */}
                  {maxPowers.choices > 0 && (
                    <button
                      onClick={activateChoices}
                      disabled={choicesLoading || !!choicesOptions || usedPowers.choices >= maxPowers.choices}
                      style={{
                        padding: '10px 18px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                        background: choicesOptions
                          ? 'rgba(245,158,11,0.08)'
                          : usedPowers.choices >= maxPowers.choices
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(245,158,11,0.15)',
                        color: usedPowers.choices >= maxPowers.choices ? 'rgba(255,255,255,0.2)' : '#F59E0B',
                        fontWeight: 700, fontSize: '13px',
                        border: `1px solid ${usedPowers.choices >= maxPowers.choices ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.3)'}`,
                        transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '8px',
                        opacity: choicesLoading ? 0.7 : 1,
                      }}
                    >
                      {choicesLoading ? <BtnSpinner size={14} /> : '🎯'}
                      {choicesOptions ? 'Варианты показаны' : 'AI Choices'}
                      <span style={{ fontSize: '11px', opacity: 0.7 }}>{maxPowers.choices - usedPowers.choices}/{maxPowers.choices}</span>
                    </button>
                  )}
                  {/* AI Vision */}
                  {maxPowers.vision > 0 && (
                    <button
                      onClick={activateVision}
                      disabled={visionLoading || !!visionImage || usedPowers.vision >= maxPowers.vision}
                      style={{
                        padding: '10px 18px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                        background: visionImage
                          ? 'rgba(167,139,250,0.08)'
                          : usedPowers.vision >= maxPowers.vision
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(167,139,250,0.15)',
                        color: usedPowers.vision >= maxPowers.vision ? 'rgba(255,255,255,0.2)' : '#4DD9C8',
                        fontWeight: 700, fontSize: '13px',
                        border: `1px solid ${usedPowers.vision >= maxPowers.vision ? 'rgba(255,255,255,0.06)' : 'rgba(167,139,250,0.3)'}`,
                        transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '8px',
                        opacity: visionLoading ? 0.7 : 1,
                      }}
                    >
                      {visionLoading ? <BtnSpinner size={14} /> : '🎨'}
                      {visionImage ? 'Vision готов' : 'AI Vision'}
                      <span style={{ fontSize: '11px', opacity: 0.7 }}>{maxPowers.vision - usedPowers.vision}/{maxPowers.vision}</span>
                    </button>
                  )}
                </div>
              )}

              {/* AI Choices options UI */}
              {choicesOptions && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', textAlign: 'left', margin: 0 }}>🎯 Выбери правильный вариант:</p>
                  {choicesOptions.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => setGuestGuessText(opt)}
                      style={{
                        padding: '12px 16px', borderRadius: '12px', border: 'none', textAlign: 'left',
                        background: guestGuessText === opt
                          ? 'linear-gradient(135deg, rgba(245,158,11,0.3), rgba(245,158,11,0.15))'
                          : 'rgba(245,158,11,0.07)',
                        color: 'white', fontWeight: guestGuessText === opt ? 700 : 500, fontSize: '14px',
                        cursor: 'pointer', transition: 'all 0.15s',
                        border: guestGuessText === opt ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(245,158,11,0.15)',
                        boxShadow: guestGuessText === opt ? '0 0 12px rgba(245,158,11,0.2)' : 'none',
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {/* AI Vision image */}
              {visionImage && (
                <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(167,139,250,0.3)', boxShadow: '0 0 24px rgba(167,139,250,0.2)' }}>
                  <img src={visionImage} alt="AI Vision" style={{ width: '100%', display: 'block' }} />
                  <div style={{ background: 'rgba(167,139,250,0.08)', padding: '8px', textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>🎨 AI Visual Hint</div>
                </div>
              )}

              <div style={{ marginTop: '4px' }}>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', marginBottom: '8px' }}>
                  Что изначально сказал(а) {(currentRound % 2 === 1 ? hostProfile : guestProfile)?.username || 'записывающий'}?
                </p>
                <input
                  type="text"
                  placeholder="Введи свою догадку..."
                  value={guestGuessText}
                  onChange={(e) => setGuestGuessText(e.target.value)}
                  disabled={uploading}
                  style={{
                    width: '100%', padding: '14px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff', fontSize: '14px', outline: 'none', transition: 'all 0.2s',
                  }}
                  onFocus={e => e.target.style.border = '1px solid rgba(124,58,237,0.5)'}
                  onBlur={e => e.target.style.border = '1px solid rgba(255,255,255,0.2)'}
                />
              </div>
              <ActionButton
                onClick={submitGuestGuess}
                disabled={!guestGuessText.trim() || audio.isPlaying}
                pending={pendingSubmit}
                pendingLabel="Отправляем..."
                variant="primary"
              >
                ✅ Завершить ход
              </ActionButton>
            </div>
          )}
          {isRecorder && phase === PHASES.GUEST_GUESS && (
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)' }}>🤔 Угадывающий вводит ответ...</p>
          )}

          {/* SCORING */}
          {phase === PHASES.SCORING && (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative', width: '72px', height: '72px' }}>
                <div style={{
                  width: '72px', height: '72px', borderRadius: '50%',
                  background: 'rgba(124,58,237,0.15)',
                  border: '2px solid rgba(124,58,237,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '32px',
                  animation: 'pulse-glow 1.5s ease-in-out infinite',
                }}>🤖</div>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#4DD9C8', minHeight: '20px', transition: 'opacity 0.4s' }}>
                {AI_QUIPS[aiQuipIdx]}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'rgba(167,139,250,0.6)',
                    animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* HOST VERIFY — shown in fullscreen popup below, not here */}
          {phase === PHASES.HOST_VERIFY && !isRecorder && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '14px 24px', borderRadius: '16px', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4DD9C8', animation: 'pulse-glow 1s ease-in-out infinite' }} />
                <span style={{ fontSize: '14px', color: '#4DD9C8', fontWeight: 600 }}>
                  {isHost ? 'Гость' : 'Хост'} проверяет фразу...
                </span>
              </div>
            </div>
          )}


          {/* ROUND RESULTS — between rounds */}
          {phase === PHASES.ROUND_RESULTS && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>
              <div style={{
                padding: '24px', borderRadius: '20px', textAlign: 'center', width: '100%',
                background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)',
              }}>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Раунд {currentRound} из {totalRounds}
                </div>
                <div className="score-reveal" style={{ fontSize: '52px', fontWeight: 900, color: '#4DD9C8', marginBottom: '4px', lineHeight: 1 }}>
                  {animatedScore ?? '—'}
                </div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)', marginBottom: '12px' }}>/ 100</div>
                {comment && <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', margin: '0 0 16px' }}>{comment}</p>}
                {/* Both players can listen to the guesser's attempt audio */}
                {gameSession?.mimic_audio_url && (
                  <button
                    onClick={async () => {
                      const { data } = await supabase.storage.from('audio').download(gameSession.mimic_audio_url)
                      if (data) audio.playAudio(data, 1.0)
                    }}
                    disabled={audio.isPlaying}
                    style={{
                      marginTop: '12px', padding: '10px 20px', borderRadius: '12px',
                      border: '1px solid rgba(167,139,250,0.3)',
                      background: 'rgba(167,139,250,0.08)',
                      color: '#4DD9C8', fontSize: '13px', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,0.18)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(167,139,250,0.08)'}
                  >
                    🎧 Послушать попытку угадывающего
                  </button>
                )}
                {/* Recorder can also hear the mimic reversed for fun */}
                {isRecorder && gameSession?.mimic_reversed_url && (
                  <button
                    onClick={async () => {
                      const { data } = await supabase.storage.from('audio').download(gameSession.mimic_reversed_url)
                      if (data) audio.playAudio(data, 1.0)
                    }}
                    disabled={audio.isPlaying}
                    style={{
                      marginTop: '8px', padding: '10px 20px', borderRadius: '12px',
                      border: '1px solid rgba(6,182,212,0.3)',
                      background: 'rgba(6,182,212,0.08)',
                      color: '#2DC4B2', fontSize: '13px', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(6,182,212,0.18)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(6,182,212,0.08)'}
                  >
                    🔄 Послушать реверс соперника
                  </button>
                )}
                {isHost ? (
                  <ActionButton
                    onClick={handleNextRound}
                    variant="primary"
                    pending={pendingNextRound}
                    pendingLabel="Переходим..."
                  >
                    ▶️ Следующий раунд
                  </ActionButton>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4DD9C8', animation: 'pulse-glow 1s ease-in-out infinite' }} />
                    <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Ожидание следующего раунда...</p>
                  </div>
                )}
              </div>
              {/* Round scores so far */}
              {roundScores.length > 0 && (
                <div style={{ width: '100%', padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginBottom: '8px', fontWeight: 700, textTransform: 'uppercase' }}>Счёт по раундам</div>
                  {roundScores.map((rs, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>Раунд {rs.round}</span>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: rs.score >= 70 ? '#10B981' : rs.score >= 40 ? '#F59E0B' : '#EF4444' }}>{rs.score}/100</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* FINAL RESULTS — game over */}
          {(phase === PHASES.FINAL_RESULTS || phase === PHASES.RESULTS) && (() => {
            const avgScore = roundScores.length > 0
              ? Math.round(roundScores.reduce((a, b) => a + b.score, 0) / roundScores.length)
              : (score ?? 0)
            const isTie = !finalStats?.winnerId
            const iAmWinner = finalStats?.winnerId === user?.id
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>

                {/* ── HEAD-TO-HEAD SCOREBOARD ───────────────────────── */}
                {finalStats ? (() => {
                  const myIsHost = isHost
                  const myScore = myIsHost ? finalStats.hostScore : finalStats.guestScore
                  const theirScore = myIsHost ? finalStats.guestScore : finalStats.hostScore
                  const myRoundsWon = myIsHost ? finalStats.hostRoundsWon : finalStats.guestRoundsWon
                  const theirRoundsWon = myIsHost ? finalStats.guestRoundsWon : finalStats.hostRoundsWon
                  const myProfile = myIsHost ? hostProfile : guestProfile
                  const theirProfile = myIsHost ? guestProfile : hostProfile
                  const xpEarned = Math.round(myScore / 5)
                  const ratingDelta = iAmWinner ? finalStats.ratingChange : isTie ? 0 : -finalStats.ratingChange

                  return (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* Winner banner */}
                      <div style={{
                        padding: '24px', borderRadius: '22px', textAlign: 'center',
                        background: isTie
                          ? 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(124,58,237,0.08))'
                          : iAmWinner
                          ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(124,58,237,0.1))'
                          : 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(124,58,237,0.06))',
                        border: `1px solid ${isTie ? 'rgba(245,158,11,0.3)' : iAmWinner ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                        <div style={{ fontSize: '44px', marginBottom: '6px' }}>{isTie ? '🤝' : iAmWinner ? '🏆' : '💪'}</div>
                        <div style={{ fontSize: '21px', fontWeight: 900, color: isTie ? '#F59E0B' : iAmWinner ? '#10B981' : '#EF4444' }}>
                          {isTie ? 'Ничья!' : iAmWinner
                            ? `${myProfile?.username || 'Вы'} победил!`
                            : `${theirProfile?.username || 'Соперник'} победил!`}
                        </div>
                      </div>

                      {/* Score vs Score */}
                      <div style={{
                        display: 'flex', alignItems: 'stretch', gap: '8px',
                        padding: '20px', borderRadius: '20px',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px', fontWeight: 600 }}>
                            {myProfile?.username || 'Вы'}
                          </div>
                          <div style={{ fontSize: '44px', fontWeight: 900, color: iAmWinner ? '#10B981' : isTie ? '#F59E0B' : '#EF4444', lineHeight: 1 }}>
                            {myScore}
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '5px' }}>
                            ✓ {myRoundsWon} отгадано
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 800, color: 'rgba(255,255,255,0.2)' }}>VS</span>
                        </div>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px', fontWeight: 600 }}>
                            {theirProfile?.username || 'Соперник'}
                          </div>
                          <div style={{ fontSize: '44px', fontWeight: 900, color: !iAmWinner && !isTie ? '#10B981' : isTie ? '#F59E0B' : '#EF4444', lineHeight: 1 }}>
                            {theirScore}
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '5px' }}>
                            ✓ {theirRoundsWon} отгадано
                          </div>
                        </div>
                      </div>

                      {/* XP + Rating badges */}
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{
                          flex: 1, padding: '12px', borderRadius: '14px', textAlign: 'center',
                          background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)',
                        }}>
                          <div style={{ fontSize: '20px', fontWeight: 900, color: '#4DD9C8' }}>+{xpEarned} XP</div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>заработано</div>
                        </div>
                        <div style={{
                          flex: 1, padding: '12px', borderRadius: '14px', textAlign: 'center',
                          background: ratingDelta >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                          border: `1px solid ${ratingDelta >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        }}>
                          <div style={{ fontSize: '20px', fontWeight: 900, color: ratingDelta >= 0 ? '#10B981' : '#EF4444' }}>
                            {ratingDelta >= 0 ? '▲' : '▼'}{Math.abs(ratingDelta)} pts
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>рейтинг</div>
                        </div>
                      </div>

                      {/* Round breakdown */}
                      {finalStats.roundDetails?.length > 0 && (
                        <div style={{ width: '100%', padding: '16px', borderRadius: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginBottom:'10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Детализация</div>
                          {finalStats.roundDetails.map((rd, i) => {
                            const guesserWasMe = myIsHost ? rd.recorder_id === room?.guest_id : rd.recorder_id === room?.host_id
                            return (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < finalStats.roundDetails.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                <div>
                                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>Раунд {rd.round}</span>
                                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginLeft: '8px' }}>
                                    {guesserWasMe ? '(вы угадывали)' : '(вы записывали)'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div style={{ width: '56px', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                    <div style={{ width: `${rd.score}%`, height: '100%', borderRadius: '3px', background: rd.score >= 70 ? '#10B981' : rd.score >= 40 ? '#F59E0B' : '#EF4444' }} />
                                  </div>
                                  <span style={{ fontSize: '13px', fontWeight: 700, color: rd.score >= 70 ? '#10B981' : rd.score >= 40 ? '#F59E0B' : '#EF4444', minWidth: '36px', textAlign: 'right' }}>{rd.score}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })() : (
                  /* Fallback: finalStats not yet loaded */
                  <div style={{ width: '100%', padding: '28px 24px', borderRadius: '24px', textAlign: 'center',
                    background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(6,182,212,0.05))',
                    border: '1px solid rgba(124,58,237,0.15)',
                  }}>
                    <div style={{ fontSize: '44px', marginBottom:'8px' }}>🏁</div>
                    <div style={{ fontSize: '20px', fontWeight: 900, color: 'white', marginBottom: '4px' }}>Игра завершена!</div>
                    <div className="score-reveal" style={{ fontSize: '60px', fontWeight: 900, color: '#4DD9C8', lineHeight: 1, margin: '10px 0 4px' }}>{animatedScore}</div>
                    <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.35)' }}>/ 100 среднее</div>
                  </div>
                )}

                {/* Both players: listen to guesser's attempt */}
                {gameSession?.mimic_audio_url && (
                  <button
                    onClick={async () => {
                      const { data } = await supabase.storage.from('audio').download(gameSession.mimic_audio_url)
                      if (data) audio.playAudio(data, 1.0)
                    }}
                    disabled={audio.isPlaying}
                    style={{
                      padding: '12px 24px', borderRadius: '14px',
                      border: '1px solid rgba(167,139,250,0.3)',
                      background: 'rgba(167,139,250,0.08)',
                      color: '#4DD9C8', fontSize: '14px', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,0.18)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(167,139,250,0.08)'}
                  >
                    🎧 Послушать попытку угадывающего
                  </button>
                )}
                {/* Recorder: listen to mimic reversed for fun */}
                {isRecorder && gameSession?.mimic_reversed_url && (
                  <button
                    onClick={async () => {
                      const { data } = await supabase.storage.from('audio').download(gameSession.mimic_reversed_url)
                      if (data) audio.playAudio(data, 1.0)
                    }}
                    disabled={audio.isPlaying}
                    style={{
                      padding: '12px 24px', borderRadius: '14px',
                      border: '1px solid rgba(6,182,212,0.3)',
                      background: 'rgba(6,182,212,0.08)',
                      color: '#2DC4B2', fontSize: '14px', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(6,182,212,0.18)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(6,182,212,0.08)'}
                  >
                    🔄 Послушать реверс соперника
                  </button>
                )}
                {/* Rematch buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
                  {!rematchRequested ? (
                    <ActionButton
                      onClick={handleRematch}
                      variant={rematchPending ? 'success' : 'primary'}
                      pending={pendingRematch}
                      pendingLabel="Отправляем..."
                    >
                      {rematchPending ? '🤝 Принять реванш!' : '🔄 Реванш'}
                    </ActionButton>
                  ) : (
                    <div style={{
                      padding: '10px 20px', borderRadius: '12px',
                      background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)',
                      color: '#4DD9C8', fontSize: '14px', fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4DD9C8', animation: 'pulse-glow 1s ease-in-out infinite' }} />
                      Ожидание ответа...
                    </div>
                  )}
                  <ActionButton onClick={() => navigate('/lobby')} variant="secondary">
                    ← В лобби
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      const myScoreForShare = finalStats ? (isHost ? finalStats.hostScore : finalStats.guestScore) : (score ?? '??')
                      const text = `🎮 ZVOO — Мой результат: ${myScoreForShare}!\n${window.location.href}`
                      if (navigator.share) {
                        navigator.share({ title: 'ZVOO', text }).catch(() => {})
                      } else {
                        navigator.clipboard.writeText(text)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }
                    }}
                    variant="cyan"
                  >
                    {copied ? '✅ Скопировано' : '📤 Поделиться'}
                  </ActionButton>
                </div>
              </div>
            )
          })()}

          {/* Cancel Game Button for Host during active game */}
          {isHost && (
            <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', width: '100%', textAlign: 'center' }}>
              <button
                onClick={handleCancelGame}
                style={{
                  padding: '8px 16px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.25)',
                  background: 'rgba(239,68,68,0.05)', color: 'rgba(239,68,68,0.8)',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#EF4444' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.05)'; e.currentTarget.style.color = 'rgba(239,68,68,0.8)' }}
              >
                🚪 Отменить игру
              </button>
            </div>
          )}
        </div>

        {/* Score result */}
        {(phase === PHASES.SCORING || phase === PHASES.ROUND_RESULTS || phase === PHASES.FINAL_RESULTS || phase === PHASES.RESULTS) && (
          <ScoreDisplay 
            score={score} 
            comment={comment} 
            breakdown={breakdown} 
            actualTranscription={actualTranscription}
            attemptTranscription={attemptTranscription}
            guestGuessText={guestGuessText}
            isLoading={scoring || phase === PHASES.SCORING} 
          />
        )}

        {/* CSS for record pulse */}
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
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>

      {/* Transcription Verification Popup — shown to recorder after AI transcribes their phrase */}
      {phase === PHASES.HOST_VERIFY && isRecorder && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{
            background: 'linear-gradient(145deg, rgba(20,15,35,0.98), rgba(15,20,40,0.98))',
            border: '1px solid rgba(124,58,237,0.35)',
            borderRadius: '28px', padding: '36px 32px', textAlign: 'center',
            maxWidth: '440px', width: '100%',
            boxShadow: '0 30px 60px -12px rgba(0,0,0,0.9), 0 0 0 1px rgba(124,58,237,0.1), inset 0 1px 0 rgba(255,255,255,0.06)'
          }}>
            {/* Icon */}
            <div style={{
              width: '64px', height: '64px', borderRadius: '20px', margin: '0 auto 20px',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(6,182,212,0.2))',
              border: '1px solid rgba(124,58,237,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 8px 24px rgba(124,58,237,0.25)',
            }}>🤖</div>

            {/* Title */}
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '8px' }}>
              ИИ распознал твою фразу
            </div>
            <h3 style={{ margin: '0 0 20px', fontSize: '18px', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
              Это правильная фраза?
            </h3>

            {/* Transcription bubble */}
            <div style={{
              padding: '20px 24px', borderRadius: '18px', marginBottom: '28px',
              background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)',
            }}>
              <div style={{ fontSize: '11px', color: 'rgba(167,139,250,0.6)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
                Загаданная фраза:
              </div>
              <div style={{
                fontSize: '26px', fontWeight: 800, color: '#4DD9C8',
                fontStyle: 'italic', lineHeight: 1.3,
                textShadow: '0 0 30px rgba(167,139,250,0.4)',
              }}>
                «{actualTranscription || '...'}»
              </div>
            </div>

            {/* Info note */}
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 24px', lineHeight: 1.5 }}>
              Эта фраза будет использована для оценки результата второго игрока.
              Если ИИ ошибся — перезапиши.
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <ActionButton onClick={handleVerifyReject} variant="danger">
                🔄 Перезаписать
              </ActionButton>
              <ActionButton onClick={handleVerifyAccept} variant="success">
                ✅ Верно!
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Custom Cancel Confirm Popup */}
      {showCancelModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{
            background: 'rgba(30,30,40,0.95)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '24px', padding: '32px', textAlign: 'center', maxWidth: '400px', width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '20px', color: '#fff' }}>Отменить игру?</h3>
            <p style={{ margin: '0 0 24px', fontSize: '15px', color: 'rgba(255,255,255,0.6)' }}>
              Текущая комната будет закрыта, и вы оба вернетесь в лобби. Эта игра не будет сохранена.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <ActionButton onClick={() => setShowCancelModal(false)} variant="secondary">
                Назад
              </ActionButton>
              <ActionButton onClick={confirmCancelGame} variant="danger">
                Отменить
              </ActionButton>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
