import { describe, it, expect } from 'vitest'

describe('useAudioEngine recording timer', () => {
  let engineContent

  beforeAll(async () => {
    const fs = await import('fs')
    const path = await import('path')
    engineContent = fs.readFileSync(path.resolve(__dirname, '../../hooks/useAudioEngine.js'), 'utf-8')
  })

  it('exports MAX_RECORDING_SECONDS constant', () => {
    expect(engineContent).toMatch(/export\s+const\s+MAX_RECORDING_SECONDS\s*=\s*30/)
  })

  it('maintains recordingElapsed state', () => {
    expect(engineContent).toContain('recordingElapsed')
    expect(engineContent).toContain('setRecordingElapsed')
  })

  it('starts a timer interval in startRecording', () => {
    expect(engineContent).toContain('setInterval')
    expect(engineContent).toContain('recordingTimerRef.current')
  })

  it('auto-stops when max recording reached', () => {
    expect(engineContent).toContain('elapsed >= MAX_RECORDING_SECONDS')
    expect(engineContent).toContain('stopRecordingRef.current()')
  })

  it('clears timer in stopRecording', () => {
    expect(engineContent).toContain('clearInterval(recordingTimerRef.current)')
  })

  it('returns recordingElapsed and MAX_RECORDING_SECONDS', () => {
    expect(engineContent).toMatch(/return\s*\{[^}]*recordingElapsed/)
    expect(engineContent).toMatch(/return\s*\{[^}]*MAX_RECORDING_SECONDS/)
  })
})
