import { describe, it, expect } from 'vitest'

describe('Mobile responsiveness', () => {
  it('lobby grid uses responsive classes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const lobbyContent = fs.readFileSync(path.resolve(__dirname, '../../pages/Lobby.jsx'), 'utf-8')
    expect(lobbyContent).toContain('lobby-grid')
  })

  it('CSS has mobile media query for lobby-grid', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const cssContent = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf-8')
    expect(cssContent).toContain('@media (max-width: 640px)')
    expect(cssContent).toContain('.lobby-grid')
    expect(cssContent).toContain('grid-template-columns: 1fr')
  })
})

describe('NotFound page', () => {
  it('renders 404 content', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../pages/NotFound.jsx'), 'utf-8')
    expect(content).toContain('404')
    expect(content).toContain('Страница не найдена')
    expect(content).toContain('На главную')
  })
})
