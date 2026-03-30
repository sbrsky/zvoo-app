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

  it('has applyProfileUpdate call', () => {
    expect(gameContent).toContain('applyProfileUpdate')
  })

  it('has rematch button for host', () => {
    expect(gameContent).toContain('handleRematch')
    expect(gameContent).toContain('Реванш')
  })

  it('handles scoring through ScoreDisplay or Edge Function', () => {
    expect(gameContent).toContain('ScoreDisplay')
    expect(gameContent).toContain('SCORING')
  })
})
