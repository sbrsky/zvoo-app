import { describe, it, expect, vi, beforeEach } from 'vitest'

let offlineQueue

beforeEach(async () => {
  vi.resetModules()
  window.localStorage.clear()
  const mod = await import('../../lib/offlineQueue.js')
  offlineQueue = mod.default
})

describe('OfflineQueue', () => {
  it('initializes with empty queue', () => {
    expect(offlineQueue.size).toBe(0)
  })

  it('enqueues operations', () => {
    offlineQueue.enqueue({ type: 'joinRoom', data: { roomId: 'abc' } })

    expect(offlineQueue.size).toBe(1)
  })

  it('persists to localStorage', () => {
    offlineQueue.enqueue({ type: 'updateSession', data: { score: 10 } })

    expect(window.localStorage.setItem).toHaveBeenCalled()
  })

  it('tryOrQueue executes online immediately', async () => {
    // navigator.onLine defaults to true in jsdom
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true })

    const fn = vi.fn().mockResolvedValue('result')
    const result = await offlineQueue.tryOrQueue('test', fn)

    expect(fn).toHaveBeenCalled()
    expect(result).toBe('result')
    expect(offlineQueue.size).toBe(0)
  })

  it('tryOrQueue enqueues when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true })

    const fn = vi.fn()
    const result = await offlineQueue.tryOrQueue('test', fn, { id: 1 })

    expect(fn).not.toHaveBeenCalled()
    expect(result).toBeNull()
    expect(offlineQueue.size).toBe(1)

    // Restore
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true })
  })

  it('flush dispatches replay events', async () => {
    const replayHandler = vi.fn()
    window.addEventListener('echoflip:replay', replayHandler)

    offlineQueue.enqueue({ type: 'joinRoom', data: { roomId: '123' } })
    await offlineQueue.flush()

    expect(replayHandler).toHaveBeenCalledTimes(1)
    expect(offlineQueue.size).toBe(0)

    window.removeEventListener('echoflip:replay', replayHandler)
  })
})
