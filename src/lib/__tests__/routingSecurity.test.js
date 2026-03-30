import { describe, it, expect } from 'vitest'

describe('App routing security', () => {
  it('App.jsx should wrap /admin with AdminRoute', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../App.jsx'), 'utf-8')

    // Admin route must be protected
    expect(content).toContain('<AdminRoute>')
    expect(content).toContain('</AdminRoute>')
    // Should NOT have bare <Admin /> without wrapper
    expect(content).not.toMatch(/element=\{<Admin\s*\/>\}/)
  })

  it('App.jsx should have a catch-all 404 route', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../App.jsx'), 'utf-8')

    expect(content).toContain('path="*"')
    expect(content).toContain('NotFound')
  })

  it('NotFound.jsx should exist and render 404', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../pages/NotFound.jsx'), 'utf-8')

    expect(content).toContain('404')
    expect(content).toContain('Страница не найдена')
  })

  it('AdminRoute should require VITE_ADMIN_EMAILS', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const content = fs.readFileSync(path.resolve(__dirname, '../../App.jsx'), 'utf-8')

    expect(content).toContain('VITE_ADMIN_EMAILS')
    expect(content).toContain('ADMIN_EMAILS.includes(user.email)')
  })
})
