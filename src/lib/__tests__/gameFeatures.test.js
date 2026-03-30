import { describe, it, expect } from 'vitest'

describe('Game.jsx feature completeness', () => {
  let gameContent
  
  beforeAll(async () => {
    const fs = await import('fs')
    const path = await import('path')
    gameContent = fs.readFileSync(path.resolve(__dirname, '../../pages/Game.jsx'), 'utf-8')
  })

  it('imports MAX_RECORDING_SECONDS from useAudioEngine', () => {
    expect(gameContent).toContain('MAX_RECORDING_SECONDS')
    expect(gameContent).toMatch(/import\s.*MAX_RECORDING_SECONDS/)
  })

  it('shows recording countdown timer', () => {
    // Timer display: MAX_RECORDING_SECONDS - audio.recordingElapsed
    expect(gameContent).toContain('MAX_RECORDING_SECONDS - audio.recordingElapsed')
  })

  it('has hasListened state for listen-before-mimic guard', () => {
    expect(gameContent).toContain('hasListened')
    expect(gameContent).toContain("setHasListened(true)")
    expect(gameContent).toContain('disabled={!hasListened}')
  })

  it('shows warning when user has not listened yet', () => {
    expect(gameContent).toContain('Сначала послушайте реверс')
  })

  it('has updateProfileStats function', () => {
    expect(gameContent).toContain('updateProfileStats')
    expect(gameContent).toContain('games_played')
    expect(gameContent).toContain('games_won')
    expect(gameContent).toContain('avg_score')
  })

  it('has rematch button for host', () => {
    expect(gameContent).toContain('handleRematch')
    expect(gameContent).toContain('Реванш')
  })

  it('has fallback polling for guest SCORING→RESULTS', () => {
    expect(gameContent).toContain('Fallback: if guest is stuck on SCORING')
    expect(gameContent).toContain('pollInterval')
  })
})
