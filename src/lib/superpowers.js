/**
 * EchoFlip Superpower System
 *
 * To add a new superpower:
 *  1. Add an entry to SUPERPOWERS array
 *  2. Add the matching DB columns: sp_<id>_max in rooms, sp_<id>_used in game_sessions
 *  3. Implement the action in Game.jsx and the edge function (if AI-based)
 */

export const SUPERPOWERS = [
  {
    id: 'slow',
    icon: '🐢',
    name: 'Slow Mo',
    shortDesc: 'Замедлить в 2×',
    fullDesc: 'Воспроизводит реверсную фразу в два раза медленнее',
    color: '#10B981',       // emerald
    glowColor: 'rgba(16,185,129,0.35)',
    dbMaxKey: 'sp_slow_max',    // column in rooms
    dbUsedKey: 'sp_slow_used',  // column in game_sessions
    phase: 'listen',            // available during: listen (GUEST_MIMIC) and guess
    requiresAI: false,
    requiresPlaybackRate: true, // needs HTML audio.playbackRate support
  },
  {
    id: 'choices',
    icon: '🎯',
    name: 'AI Choices',
    shortDesc: '4 варианта',
    fullDesc: 'ИИ предложит 4 варианта — выбери правильный',
    color: '#F59E0B',       // amber
    glowColor: 'rgba(245,158,11,0.35)',
    dbMaxKey: 'sp_choices_max',
    dbUsedKey: 'sp_choices_used',
    phase: 'guess',             // available during GUEST_GUESS
    requiresAI: true,
    requiresPlaybackRate: false,
  },
  {
    id: 'vision',
    icon: '🎨',
    name: 'AI Vision',
    shortDesc: 'ИИ-подсказка',
    fullDesc: 'ИИ нарисует визуальную подсказку о загаданной фразе',
    color: '#A78BFA',       // violet
    glowColor: 'rgba(167,139,250,0.35)',
    dbMaxKey: 'sp_vision_max',
    dbUsedKey: 'sp_vision_used',
    phase: 'guess',             // available during GUEST_GUESS
    requiresAI: true,
    requiresPlaybackRate: false,
  },
]

/** Map id → superpower for O(1) access */
export const SUPERPOWER_MAP = Object.fromEntries(SUPERPOWERS.map(sp => [sp.id, sp]))

/** Default max uses per game for each superpower */
export const SUPERPOWER_DEFAULTS = Object.fromEntries(
  SUPERPOWERS.map(sp => [sp.id, 1])
)

/**
 * Check if browser supports audio.playbackRate.
 * Returns true on modern browsers; false on very old WebViews.
 */
export function supportsPlaybackRate() {
  try {
    const a = document.createElement('audio')
    return typeof a.playbackRate === 'number'
  } catch {
    return false
  }
}
