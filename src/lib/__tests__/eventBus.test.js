import { describe, it, expect, vi, beforeEach } from 'vitest'

let eventBus

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('../../lib/eventBus.js')
  eventBus = mod.default
  eventBus.clear()
})

describe('EventBus', () => {
  it('emits and receives events', () => {
    const handler = vi.fn()
    eventBus.on('test', handler)
    eventBus.emit('test', { value: 42 })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ value: 42 })
  })

  it('supports multiple handlers for same event', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    eventBus.on('multi', h1)
    eventBus.on('multi', h2)
    eventBus.emit('multi', 'data')

    expect(h1).toHaveBeenCalledWith('data')
    expect(h2).toHaveBeenCalledWith('data')
  })

  it('unsubscribes via off', () => {
    const handler = vi.fn()
    eventBus.on('unsub', handler)
    eventBus.off('unsub', handler)
    eventBus.emit('unsub', 'data')

    expect(handler).not.toHaveBeenCalled()
  })

  it('returns unsubscribe function from on()', () => {
    const handler = vi.fn()
    const unsub = eventBus.on('auto-unsub', handler)
    unsub()
    eventBus.emit('auto-unsub', 'data')

    expect(handler).not.toHaveBeenCalled()
  })

  it('wildcard listener receives all events', () => {
    const handler = vi.fn()
    eventBus.on('*', handler)

    eventBus.emit('eventA', 'dataA')
    eventBus.emit('eventB', 'dataB')

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith({ event: 'eventA', data: 'dataA' })
    expect(handler).toHaveBeenCalledWith({ event: 'eventB', data: 'dataB' })
  })

  it('clear removes all handlers', () => {
    const handler = vi.fn()
    eventBus.on('test', handler)
    eventBus.clear()
    eventBus.emit('test', 'data')

    expect(handler).not.toHaveBeenCalled()
  })

  it('handler error does not break other handlers', () => {
    const h1 = vi.fn(() => { throw new Error('oops') })
    const h2 = vi.fn()
    eventBus.on('err', h1)
    eventBus.on('err', h2)

    // Suppress console.error from eventBus
    const origError = console.error
    console.error = vi.fn()
    
    eventBus.emit('err', 'data')
    
    console.error = origError

    expect(h1).toHaveBeenCalled()
    expect(h2).toHaveBeenCalled()
  })
})
