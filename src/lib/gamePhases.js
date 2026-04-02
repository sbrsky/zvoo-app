/**
 * gamePhases.js — Shared game-phase logic
 *
 * Extracted so it can be:
 *  • imported by Game.jsx (runtime)
 *  • imported by unit tests without pulling in React / JSX
 */

// ─── Phase constants (mirrors Game.jsx PHASES) ───────────────────────────────
export const PHASES = {
  WAITING:       'waiting',
  READY:         'ready',
  HOST_RECORD:   'host_record',
  HOST_VERIFY:   'host_verify',
  GUEST_LISTEN:  'guest_listen',
  GUEST_MIMIC:   'guest_mimic',
  GUEST_GUESS:   'guest_guess',
  IMAG_GENERATE: 'imag_generate',
  IMAG_GUESS:    'imag_guess',
  SCORING:       'scoring',
  RESULTS:       'results',
  ROUND_RESULTS: 'round_results',
  FINAL_RESULTS: 'final_results',
}

// ─── Monotonic ordering (higher index = further in game) ────────────────────
// Only active in-round phases are ordered here.
// WAITING / READY / RESULTS variants are not part of monotonic progression.
export const PHASE_ORDER = {
  [PHASES.WAITING]:        0,
  [PHASES.READY]:          1,
  [PHASES.HOST_RECORD]:    2,
  [PHASES.HOST_VERIFY]:    3,
  [PHASES.IMAG_GENERATE]:  3,  // same slot as HOST_VERIFY for Imaginarium
  [PHASES.GUEST_LISTEN]:   4,
  [PHASES.GUEST_MIMIC]:    5,
  [PHASES.GUEST_GUESS]:    6,
  [PHASES.IMAG_GUESS]:     6,  // same slot as GUEST_GUESS for Imaginarium
  [PHASES.SCORING]:        7,
  [PHASES.RESULTS]:        8,
  [PHASES.ROUND_RESULTS]:  8,
  [PHASES.FINAL_RESULTS]:  9,
}

// ─── Phases where universal polling fallback is active ────────────────────────
export const ACTIVE_GAME_PHASES = new Set([
  PHASES.HOST_RECORD,
  PHASES.HOST_VERIFY,
  PHASES.GUEST_LISTEN,
  PHASES.GUEST_MIMIC,
  PHASES.GUEST_GUESS,
  PHASES.IMAG_GENERATE,
  PHASES.IMAG_GUESS,
  PHASES.SCORING,
])

/**
 * Infer what phase the DB says we should be in, based on game_sessions fields.
 *
 * @param {object} session   — row from game_sessions (may be null)
 * @param {number} totalRounds
 * @param {number} currentRound
 * @returns {string|null}    — a PHASES value, or null if session is falsy
 */
export function inferPhaseFromSession(session, totalRounds = 3, currentRound = 1) {
  if (!session) return null

  // Final score set → results
  if (session.ai_score != null) {
    const isLast = (session.round_number || currentRound) >= totalRounds
    return isLast ? PHASES.FINAL_RESULTS : PHASES.ROUND_RESULTS
  }

  // Guest submitted guess → scoring in progress
  if (session.guest_guess_text) return PHASES.SCORING

  // Guest mimic uploaded → guest types guess
  if (session.mimic_audio_url) return PHASES.GUEST_GUESS

  // Host verified transcription → guest listens
  if (session.ai_actual_transcription) return PHASES.GUEST_LISTEN

  // Reversed audio ready (but not yet verified) → guest listens
  if (session.reversed_audio_url) return PHASES.GUEST_LISTEN

  // Nothing yet → host records
  return PHASES.HOST_RECORD
}
