import { describe, it, expect } from 'vitest'

describe('Dashboard game history', () => {
  let dashContent

  beforeAll(async () => {
    const fs = await import('fs')
    const path = await import('path')
    dashContent = fs.readFileSync(path.resolve(__dirname, '../../pages/Dashboard.jsx'), 'utf-8')
  })

  it('imports supabase for data fetching', () => {
    expect(dashContent).toContain("from '../lib/supabase'")
  })

  it('fetches finished rooms for current user', () => {
    expect(dashContent).toContain("eq('status', 'finished')")
    expect(dashContent).toContain('host_id')
    expect(dashContent).toContain('guest_id')
  })

  it('fetches game_sessions with ai_score', () => {
    expect(dashContent).toContain('game_sessions')
    expect(dashContent).toContain('ai_score')
  })

  it('resolves opponent profiles', () => {
    expect(dashContent).toContain('opponentMap')
    expect(dashContent).toContain('opponent')
  })

  it('renders game list items with score badges', () => {
    expect(dashContent).toContain('game.score')
    expect(dashContent).toContain('vs {game.opponent}')
  })

  it('shows loading state', () => {
    expect(dashContent).toContain('loadingGames')
    expect(dashContent).toContain('⏳ Загрузка...')
  })

  it('shows empty state with lobby link', () => {
    expect(dashContent).toContain('Пока нет завершённых игр')
    expect(dashContent).toContain('/lobby')
  })
})
