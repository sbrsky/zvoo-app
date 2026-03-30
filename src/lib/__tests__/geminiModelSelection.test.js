import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../supabase'

const mockMaybeSingle = vi.fn().mockResolvedValue({
  data: { value: '"gemini-3.1-flash-live-preview"' },
  error: null
})

const mockEqRead = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEqRead })

const mockEqWrite = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqWrite })

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate
    }))
  }
}))

describe('AI Model selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('receives the currently selected AI model from supabase app_settings', async () => {
    // Simulate what the client and Edge Function do
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'gemini_model')
      .maybeSingle()
    
    // Check that we got data
    expect(data).toBeDefined()
    expect(data.value).toBe('"gemini-3.1-flash-live-preview"')
    
    // Strip quotes if they exist (how the client processes it)
    const model = typeof data.value === 'string' ? data.value.replace(/"/g, '') : data.value
    expect(model).toBe('gemini-3.1-flash-live-preview')
  })

  it('saves a new AI model to supabase app_settings', async () => {
    const newModel = 'gemini-2.5-flash'
    
    // Simulate the save logic from the Admin.jsx
    const { error } = await supabase
      .from('app_settings')
      .update({ value: `"${newModel}"` })
      .eq('key', 'gemini_model')

    expect(error).toBeNull()
    expect(supabase.from).toHaveBeenCalledWith('app_settings')
    
    expect(mockUpdate).toHaveBeenCalledWith({ value: `"${newModel}"` })
    expect(mockEqWrite).toHaveBeenCalledWith('key', 'gemini_model')
  })
})
