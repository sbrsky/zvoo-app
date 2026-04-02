/**
 * gamePhases.test.js
 *
 * Unit tests for:
 *   - inferPhaseFromSession — DB-to-phase mapping
 *   - PHASE_ORDER — monotonic ordering guarantees
 */
import { describe, it, expect } from 'vitest'
import { inferPhaseFromSession, PHASE_ORDER, PHASES, ACTIVE_GAME_PHASES } from '../gamePhases.js'

// ─── inferPhaseFromSession ────────────────────────────────────────────────────

describe('inferPhaseFromSession', () => {
  it('returns null for null session', () => {
    expect(inferPhaseFromSession(null)).toBeNull()
  })

  it('returns null for undefined session', () => {
    expect(inferPhaseFromSession(undefined)).toBeNull()
  })

  it('HOST_RECORD: no fields set', () => {
    expect(inferPhaseFromSession({})).toBe(PHASES.HOST_RECORD)
  })

  it('HOST_RECORD: empty strings are falsy', () => {
    expect(inferPhaseFromSession({ reversed_audio_url: '', ai_actual_transcription: '' })).toBe(PHASES.HOST_RECORD)
  })

  it('GUEST_LISTEN: reversed_audio_url set', () => {
    expect(inferPhaseFromSession({ reversed_audio_url: 'audio/room/rev.webm' })).toBe(PHASES.GUEST_LISTEN)
  })

  it('GUEST_LISTEN: ai_actual_transcription takes priority over reversed_audio_url', () => {
    const session = { reversed_audio_url: 'audio/rev.webm', ai_actual_transcription: 'слон' }
    expect(inferPhaseFromSession(session)).toBe(PHASES.GUEST_LISTEN)
  })

  it('GUEST_GUESS: mimic_audio_url set', () => {
    const session = { reversed_audio_url: 'r', ai_actual_transcription: 't', mimic_audio_url: 'm' }
    expect(inferPhaseFromSession(session)).toBe(PHASES.GUEST_GUESS)
  })

  it('SCORING: guest_guess_text set (no score yet)', () => {
    const session = {
      reversed_audio_url: 'r',
      ai_actual_transcription: 't',
      mimic_audio_url: 'm',
      guest_guess_text: 'слон',
    }
    expect(inferPhaseFromSession(session)).toBe(PHASES.SCORING)
  })

  it('ROUND_RESULTS: ai_score set, not last round', () => {
    const session = {
      ai_score: 72, ai_comment: 'Nice', round_number: 1,
      guest_guess_text: 'слон',
    }
    expect(inferPhaseFromSession(session, 3, 1)).toBe(PHASES.ROUND_RESULTS)
  })

  it('FINAL_RESULTS: ai_score set, last round', () => {
    const session = {
      ai_score: 55, ai_comment: 'OK', round_number: 3,
    }
    expect(inferPhaseFromSession(session, 3, 3)).toBe(PHASES.FINAL_RESULTS)
  })

  it('FINAL_RESULTS: round_number >= totalRounds defaults correctly', () => {
    expect(inferPhaseFromSession({ ai_score: 80, round_number: 5 }, 3, 5)).toBe(PHASES.FINAL_RESULTS)
  })
})

// ─── PHASE_ORDER ──────────────────────────────────────────────────────────────

describe('PHASE_ORDER monotonic ordering', () => {
  it('HOST_RECORD < GUEST_LISTEN', () => {
    expect(PHASE_ORDER[PHASES.HOST_RECORD]).toBeLessThan(PHASE_ORDER[PHASES.GUEST_LISTEN])
  })

  it('GUEST_LISTEN < GUEST_MIMIC', () => {
    expect(PHASE_ORDER[PHASES.GUEST_LISTEN]).toBeLessThan(PHASE_ORDER[PHASES.GUEST_MIMIC])
  })

  it('GUEST_MIMIC < GUEST_GUESS', () => {
    expect(PHASE_ORDER[PHASES.GUEST_MIMIC]).toBeLessThan(PHASE_ORDER[PHASES.GUEST_GUESS])
  })

  it('GUEST_GUESS < SCORING', () => {
    expect(PHASE_ORDER[PHASES.GUEST_GUESS]).toBeLessThan(PHASE_ORDER[PHASES.SCORING])
  })

  it('SCORING < ROUND_RESULTS', () => {
    expect(PHASE_ORDER[PHASES.SCORING]).toBeLessThan(PHASE_ORDER[PHASES.ROUND_RESULTS])
  })

  it('ROUND_RESULTS < FINAL_RESULTS', () => {
    expect(PHASE_ORDER[PHASES.ROUND_RESULTS]).toBeLessThan(PHASE_ORDER[PHASES.FINAL_RESULTS])
  })

  it('WAITING < HOST_RECORD (recovery precondition)', () => {
    expect(PHASE_ORDER[PHASES.WAITING]).toBeLessThan(PHASE_ORDER[PHASES.HOST_RECORD])
  })
})

// ─── ACTIVE_GAME_PHASES ───────────────────────────────────────────────────────

describe('ACTIVE_GAME_PHASES set', () => {
  it('includes HOST_RECORD', () => expect(ACTIVE_GAME_PHASES.has(PHASES.HOST_RECORD)).toBe(true))
  it('includes GUEST_LISTEN', () => expect(ACTIVE_GAME_PHASES.has(PHASES.GUEST_LISTEN)).toBe(true))
  it('includes GUEST_GUESS', () => expect(ACTIVE_GAME_PHASES.has(PHASES.GUEST_GUESS)).toBe(true))
  it('includes SCORING', () => expect(ACTIVE_GAME_PHASES.has(PHASES.SCORING)).toBe(true))

  it('excludes WAITING (no polling during pre-game)', () => {
    expect(ACTIVE_GAME_PHASES.has(PHASES.WAITING)).toBe(false)
  })
  it('excludes READY (no polling in ready screen)', () => {
    expect(ACTIVE_GAME_PHASES.has(PHASES.READY)).toBe(false)
  })
  it('excludes ROUND_RESULTS (no polling on results screen)', () => {
    expect(ACTIVE_GAME_PHASES.has(PHASES.ROUND_RESULTS)).toBe(false)
  })
  it('excludes FINAL_RESULTS (no polling on final screen)', () => {
    expect(ACTIVE_GAME_PHASES.has(PHASES.FINAL_RESULTS)).toBe(false)
  })
})

// ─── Monotonic progression simulation (as used in Universal Polling) ─────────

describe('Monotonic phase advancement simulation', () => {
  function shouldAdvance(dbSession, localPhase, totalRounds = 3, currentRound = 1) {
    const dbPhase = inferPhaseFromSession(dbSession, totalRounds, currentRound)
    if (!dbPhase) return false
    return (PHASE_ORDER[dbPhase] ?? -1) > (PHASE_ORDER[localPhase] ?? -1)
  }

  it('does NOT roll back: local=GUEST_LISTEN, DB has no reversed_audio_url', () => {
    expect(shouldAdvance({}, PHASES.GUEST_LISTEN)).toBe(false)
  })

  it('does NOT roll back: local=SCORING, DB has guest_guess_text (same phase)', () => {
    const session = { reversed_audio_url: 'r', ai_actual_transcription: 't', mimic_audio_url: 'm', guest_guess_text: 'слон' }
    expect(shouldAdvance(session, PHASES.SCORING)).toBe(false)
  })

  it('DOES advance: local=HOST_RECORD, DB has reversed_audio_url', () => {
    expect(shouldAdvance({ reversed_audio_url: 'audio/r.webm' }, PHASES.HOST_RECORD)).toBe(true)
  })

  it('DOES advance: local=GUEST_GUESS, DB has guest_guess_text → SCORING', () => {
    const session = {
      reversed_audio_url: 'r', ai_actual_transcription: 't',
      mimic_audio_url: 'm', guest_guess_text: 'слон',
    }
    expect(shouldAdvance(session, PHASES.GUEST_GUESS)).toBe(true)
  })

  it('DOES advance: local=SCORING, DB has ai_score → ROUND_RESULTS', () => {
    const session = { ai_score: 72, ai_comment: 'Good', round_number: 1, guest_guess_text: 'слон' }
    expect(shouldAdvance(session, PHASES.SCORING, 3, 1)).toBe(true)
  })

  it('handles null session — no advancement', () => {
    expect(shouldAdvance(null, PHASES.HOST_RECORD)).toBe(false)
  })
})
