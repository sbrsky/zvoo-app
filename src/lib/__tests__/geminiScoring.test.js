import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  scoreWithGemini, isGeminiAvailable, checkGeminiHealth,
} from '../geminiScoring'
import { supabase } from '../supabase'

// Mock Supabase to test Edge Function invocation
vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn()
    }
  }
}))

// ── isGeminiAvailable ──────────────────────────────────────
describe('isGeminiAvailable', () => {
  it('returns boolean value', () => {
    const result = isGeminiAvailable()
    expect(typeof result).toBe('boolean')
  })
})

// ── scoreWithGemini ──────────────────────────────────────
describe('scoreWithGemini', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    supabase.functions.invoke.mockReset()
  })

  it('invokes edge function and returns its data', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: { score: 85, comment: 'Отлично!', breakdown: { intonation: 90 }, model: 'gemini-3.1-flash-lite-preview' },
      error: null
    })

    const blob = new Blob(['test'], { type: 'audio/webm' })
    const result = await scoreWithGemini(blob, blob, "hello")

    expect(supabase.functions.invoke).toHaveBeenCalledWith('gemini-scoring', expect.objectContaining({
      body: expect.objectContaining({
        originalMimeType: 'audio/webm',
        guestGuessText: 'hello'
      })
    }))
    expect(result.score).toBe(85)
    expect(result.comment).toBe('Отлично!')
  })

  it('handles edge function error by returning fallback score', async () => {
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: new Error('Network Error')
    })

    const blob = new Blob(['test'], { type: 'audio/webm' })
    const result = await scoreWithGemini(blob, blob)

    expect(result.model).toBe('fallback')
    expect(result.score).toBeGreaterThanOrEqual(35)
    expect(result.score).toBeLessThanOrEqual(65) // 35 + 30
    expect(result.comment).toContain('Ошибка AI')
  })
})

// ── checkGeminiHealth ──────────────────────────────────────
describe('checkGeminiHealth', () => {
  it('returns availability status', async () => {
    const health = await checkGeminiHealth()
    expect(health).toHaveProperty('available')
    expect(health).toHaveProperty('models')
  })
})
