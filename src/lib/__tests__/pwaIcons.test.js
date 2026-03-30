import { describe, it, expect } from 'vitest'

describe('PWA icons', () => {
  it('icon-192.png should exist', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const iconPath = path.resolve(__dirname, '../../../public/icons/icon-192.png')
    expect(fs.existsSync(iconPath)).toBe(true)
    const stat = fs.statSync(iconPath)
    expect(stat.size).toBeGreaterThan(100) // real PNG, not empty
  })

  it('icon-512.png should exist', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const iconPath = path.resolve(__dirname, '../../../public/icons/icon-512.png')
    expect(fs.existsSync(iconPath)).toBe(true)
    const stat = fs.statSync(iconPath)
    expect(stat.size).toBeGreaterThan(100)
  })

  it('vite.config manifest should reference the icons', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../../vite.config.js'), 'utf-8')
    expect(content).toContain('icon-192.png')
    expect(content).toContain('icon-512.png')
  })
})
