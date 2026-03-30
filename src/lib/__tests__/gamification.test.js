import { describe, it, expect } from 'vitest'
import {
  getRank, getNextRank, getXPForGame,
  getUnlockedAchievements, ACHIEVEMENTS, RANKS,
  XP_PER_GAME, XP_PER_SCORE_POINT,
} from '../constants'

// ── Rank System ─────────────────────────────────────────
describe('Rank System', () => {
  it('has 7 ranks', () => {
    expect(RANKS).toHaveLength(7)
  })

  it('ranks are sorted by minXP ascending', () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].minXP).toBeGreaterThan(RANKS[i - 1].minXP)
    }
  })

  it('first rank starts at 0 XP', () => {
    expect(RANKS[0].minXP).toBe(0)
  })

  it('each rank has name and emoji', () => {
    for (const rank of RANKS) {
      expect(rank.name).toBeTruthy()
      expect(rank.emoji).toBeTruthy()
    }
  })

  it('getRank returns Новичок for 0 XP', () => {
    const rank = getRank(0)
    expect(rank.name).toBe('Новичок')
    expect(rank.emoji).toBe('🐣')
  })

  it('getRank returns correct rank for 200 XP', () => {
    const rank = getRank(200)
    expect(rank.name).toBe('Подмастерье')
  })

  it('getRank returns max rank for 5000 XP', () => {
    const rank = getRank(5000)
    expect(rank.name).toBe('Мифический')
    expect(rank.emoji).toBe('🏆')
  })

  it('getNextRank returns next for 0 XP', () => {
    const next = getNextRank(0)
    expect(next.name).toBe('Ученик')
    expect(next.minXP).toBe(50)
  })

  it('getNextRank returns null at max', () => {
    const next = getNextRank(9999)
    expect(next).toBeNull()
  })
})

// ── XP Calculation ─────────────────────────────────────
describe('XP Calculation', () => {
  it('XP_PER_GAME is 10', () => {
    expect(XP_PER_GAME).toBe(10)
  })

  it('getXPForGame returns base + bonus for score 0', () => {
    const xp = getXPForGame(0)
    expect(xp).toBe(10) // 10 base + 0 bonus
  })

  it('getXPForGame returns base + bonus for score 100', () => {
    const xp = getXPForGame(100)
    expect(xp).toBe(60) // 10 base + 50 bonus
  })

  it('getXPForGame returns base + bonus for score 50', () => {
    const xp = getXPForGame(50)
    expect(xp).toBe(35) // 10 base + 25 bonus
  })

  it('getXPForGame always returns positive', () => {
    for (let s = 0; s <= 100; s += 10) {
      expect(getXPForGame(s)).toBeGreaterThan(0)
    }
  })

  it('higher score = more XP', () => {
    expect(getXPForGame(80)).toBeGreaterThan(getXPForGame(30))
  })
})

// ── Achievements ──────────────────────────────────────
describe('Achievements', () => {
  it('has 8 achievements defined', () => {
    expect(ACHIEVEMENTS).toHaveLength(8)
  })

  it('each achievement has required fields', () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.id).toBeTruthy()
      expect(ach.name).toBeTruthy()
      expect(ach.emoji).toBeTruthy()
      expect(ach.desc).toBeTruthy()
      expect(typeof ach.check).toBe('function')
    }
  })

  it('all achievement IDs are unique', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no achievements unlocked for fresh player', () => {
    const stats = {
      games_played: 0, games_won: 0,
      best_score: 0, win_streak: 0,
    }
    const unlocked = getUnlockedAchievements(stats)
    expect(unlocked).toHaveLength(0)
  })

  it('first_game unlocked after 1 game', () => {
    const stats = {
      games_played: 1, games_won: 0,
      best_score: 30, win_streak: 0,
    }
    const unlocked = getUnlockedAchievements(stats)
    expect(unlocked.some(a => a.id === 'first_game')).toBe(true)
  })

  it('multiple achievements can unlock at once', () => {
    const stats = {
      games_played: 10, games_won: 5,
      best_score: 85, win_streak: 3,
    }
    const unlocked = getUnlockedAchievements(stats)
    expect(unlocked.length).toBeGreaterThanOrEqual(5)
    expect(unlocked.some(a => a.id === 'first_game')).toBe(true)
    expect(unlocked.some(a => a.id === 'ten_games')).toBe(true)
    expect(unlocked.some(a => a.id === 'five_wins')).toBe(true)
    expect(unlocked.some(a => a.id === 'high_scorer')).toBe(true)
    expect(unlocked.some(a => a.id === 'streak_3')).toBe(true)
  })

  it('perfect achievement requires 95+', () => {
    const low = getUnlockedAchievements({ games_played: 10, games_won: 5, best_score: 94, win_streak: 0 })
    const high = getUnlockedAchievements({ games_played: 10, games_won: 5, best_score: 95, win_streak: 0 })
    expect(low.some(a => a.id === 'perfect')).toBe(false)
    expect(high.some(a => a.id === 'perfect')).toBe(true)
  })

  it('all 8 achievements can be unlocked by a legendary player', () => {
    const stats = {
      games_played: 100, games_won: 50,
      best_score: 99, win_streak: 10,
    }
    const unlocked = getUnlockedAchievements(stats)
    expect(unlocked).toHaveLength(8)
  })
})
