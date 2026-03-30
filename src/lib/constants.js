export const APP_NAME = 'ZVOO'

export const ROOM_STATUS = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  FINISHED: 'finished'
}

export const GAME_EVENTS = {
  GAME_STARTED:       'GAME_STARTED',
  PLAYER_RECORDING:   'PLAYER_RECORDING',
  AUDIO_READY:        'AUDIO_READY',
  MIMIC_RECORDING:    'MIMIC_RECORDING',
  MIMIC_DONE:         'MIMIC_DONE',
  GUEST_GUESSING:     'GUEST_GUESSING',
  GUESS_SUBMITTED:    'GUESS_SUBMITTED',
  SHOW_RESULT:        'SHOW_RESULT',
  MANUAL_SCORE_SET:   'MANUAL_SCORE_SET',
  NEXT_ROUND:         'NEXT_ROUND',
  REMATCH_REQUESTED:  'REMATCH_REQUESTED',
  REMATCH_ACCEPTED:   'REMATCH_ACCEPTED',
  HOST_START:         'HOST_START',
  IMAG_GENERATE:      'IMAG_GENERATE', // Imaginarium: host started generating image (guest now waiting)
  IMAG_READY:         'IMAG_READY',  // Imaginarium: host sends image+choices to guest
  FINAL_STATS:        'FINAL_STATS',
  GUEST_PROFILE_UPDATE: 'GUEST_PROFILE_UPDATE',
}

export const GAME_TYPES = {
  CLASSIC:      'classic',
  IMAGINARIUM:  'imaginarium',
}

export const IMAGINARIUM_STYLES = [
  {
    id: 'crazy_dreams',
    name: 'Сумасшедшие сны',
    icon: '😴',
    description: 'Сюрреалистичный сон, в котором угадывается слово',
    color: '#8B5CF6',
    promptHint: 'surreal dream',
  },
  {
    id: 'abstractionism',
    name: 'Абстракционизм',
    icon: '🎨',
    description: 'Как нарисовал бы художник-абстракционист',
    color: '#F59E0B',
    promptHint: 'abstract art',
  },
  {
    id: 'kids_doodles',
    name: 'Детские каляки-маляки',
    icon: '✏️',
    description: 'Рисунок ребёнка, описывающего фразу',
    color: '#10B981',
    promptHint: 'child drawing',
  },
]

export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''

// XP & Rank system
export const XP_PER_GAME = 10
export const XP_PER_SCORE_POINT = 1 // score/100 * XP_PER_SCORE_POINT bonus

export const RANKS = [
  { name: 'Новичок',       emoji: '🐣', minXP: 0 },
  { name: 'Ученик',        emoji: '📖', minXP: 50 },
  { name: 'Подмастерье',   emoji: '🎵', minXP: 150 },
  { name: 'Мастер звуков', emoji: '🎧', minXP: 350 },
  { name: 'Виртуоз',       emoji: '🎤', minXP: 600 },
  { name: 'Эхо-легенда',   emoji: '👑', minXP: 1000 },
  { name: 'Мифический',    emoji: '🏆', minXP: 2000 },
]

export function getRank(xp) {
  let rank = RANKS[0]
  for (const r of RANKS) {
    if (xp >= r.minXP) rank = r
  }
  return rank
}

export function getNextRank(xp) {
  for (const r of RANKS) {
    if (xp < r.minXP) return r
  }
  return null // max rank
}

export function getXPForGame(score) {
  return XP_PER_GAME + Math.round((score / 100) * 50)
}

// Achievement definitions
export const ACHIEVEMENTS = [
  { id: 'first_game',    name: 'Первая игра',     emoji: '🎮', desc: 'Сыграйте первую игру', check: (stats) => stats.games_played >= 1 },
  { id: 'five_games',    name: 'Пятёрочка',       emoji: '✋', desc: 'Сыграйте 5 игр',       check: (stats) => stats.games_played >= 5 },
  { id: 'ten_games',     name: 'Десяточка',       emoji: '🔟', desc: 'Сыграйте 10 игр',      check: (stats) => stats.games_played >= 10 },
  { id: 'first_win',     name: 'Первая победа',   emoji: '🏅', desc: 'Выиграйте первую игру', check: (stats) => stats.games_won >= 1 },
  { id: 'five_wins',     name: 'Пять побед',      emoji: '⭐', desc: 'Выиграйте 5 игр',      check: (stats) => stats.games_won >= 5 },
  { id: 'high_scorer',   name: 'Мастер',          emoji: '🎯', desc: 'Получите 80+ баллов',   check: (stats) => stats.best_score >= 80 },
  { id: 'perfect',       name: 'Перфекционист',   emoji: '💎', desc: 'Получите 95+ баллов',   check: (stats) => stats.best_score >= 95 },
  { id: 'streak_3',      name: 'Серия побед',     emoji: '🔥', desc: 'Выиграйте 3 подряд',   check: (stats) => stats.win_streak >= 3 },
]

export function getUnlockedAchievements(stats) {
  return ACHIEVEMENTS.filter(a => a.check(stats))
}
