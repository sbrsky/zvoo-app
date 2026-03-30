import { describe, it, expect, vi, beforeEach } from 'vitest'

// We import a fresh logger for each test
let logger

beforeEach(async () => {
  // Fresh module for each test
  vi.resetModules()
  const mod = await import('../../lib/logger.js')
  logger = mod.default
  logger.clear()
})

describe('Logger', () => {
  it('logs entries at different levels', () => {
    logger.debug('test', 'debug message')
    logger.info('test', 'info message')
    logger.warn('test', 'warn message')
    logger.error('test', 'error message')

    const logs = logger.getLogs()
    expect(logs).toHaveLength(4)
    expect(logs[0].level).toBe('DEBUG')
    expect(logs[1].level).toBe('INFO')
    expect(logs[2].level).toBe('WARN')
    expect(logs[3].level).toBe('ERROR')
  })

  it('includes timestamp, source, and message', () => {
    logger.info('auth', 'User logged in')
    const [log] = logger.getLogs()

    expect(log.timestamp).toBeTruthy()
    expect(log.source).toBe('auth')
    expect(log.message).toBe('User logged in')
    expect(log.id).toBeGreaterThan(0)
  })

  it('stores data payload', () => {
    logger.info('room', 'Joined', { roomId: 'abc123' })
    const [log] = logger.getLogs()

    expect(log.data).toEqual({ roomId: 'abc123' })
  })

  it('includes stack trace for ERROR level', () => {
    logger.error('crash', 'Something failed')
    const [log] = logger.getLogs()

    expect(log.stack).toBeTruthy()
    expect(typeof log.stack).toBe('string')
  })

  it('does not include stack for non-ERROR levels', () => {
    logger.info('test', 'Hello')
    const [log] = logger.getLogs()

    expect(log.stack).toBeNull()
  })

  it('filters by level', () => {
    logger.info('a', 'one')
    logger.warn('a', 'two')
    logger.info('a', 'three')

    const warns = logger.getLogs({ level: 'WARN' })
    expect(warns).toHaveLength(1)
    expect(warns[0].message).toBe('two')
  })

  it('filters by search query', () => {
    logger.info('a', 'Hello world')
    logger.info('b', 'Goodbye moon')

    const results = logger.getLogs({ search: 'hello' })
    expect(results).toHaveLength(1)
    expect(results[0].message).toBe('Hello world')
  })

  it('dispatches log event', () => {
    const handler = vi.fn()
    logger.addEventListener('log', handler)

    logger.info('test', 'event test')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].detail.message).toBe('event test')

    logger.removeEventListener('log', handler)
  })

  it('clears all logs', () => {
    logger.info('a', '1')
    logger.info('a', '2')
    logger.info('a', '3')
    expect(logger.getLogs()).toHaveLength(3)

    logger.clear()
    expect(logger.getLogs()).toHaveLength(0)
  })

  it('network level logs', () => {
    logger.network('GET /api/rooms', { status: 200 })
    const [log] = logger.getLogs()

    expect(log.level).toBe('NETWORK')
    expect(log.source).toBe('fetch')
  })
})
