import { describe, it, expect, vi } from 'vitest'

describe('supabase.js env config', () => {
  it('should use import.meta.env for Supabase URL', async () => {
    // The module throws if env vars are missing, so we test that env vars
    // are properly referenced by checking the import.meta.env values exist at build time
    const envUrl = import.meta.env.VITE_SUPABASE_URL
    const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    // In test env these will be undefined, but the module references them correctly
    // We're testing that no hardcoded values exist in the source file
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '../../lib/supabase.js')
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).not.toContain('bsttwhchqkhwwasjvngs')
    expect(content).not.toContain('eyJhbGciOiJIUzI1N')
    expect(content).toContain('import.meta.env.VITE_SUPABASE_URL')
    expect(content).toContain('import.meta.env.VITE_SUPABASE_ANON_KEY')
  })

  it('.env.example should exist as a template', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const envExample = path.resolve(__dirname, '../../../.env.example')
    expect(fs.existsSync(envExample)).toBe(true)
    const content = fs.readFileSync(envExample, 'utf-8')
    expect(content).toContain('VITE_SUPABASE_URL')
    expect(content).toContain('VITE_SUPABASE_ANON_KEY')
    // Should not contain real keys
    expect(content).not.toContain('bsttwhchqkhwwasjvngs')
  })

  it('.gitignore should include .env', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const gitignore = path.resolve(__dirname, '../../../.gitignore')
    const content = fs.readFileSync(gitignore, 'utf-8')
    expect(content).toContain('.env')
  })
})
