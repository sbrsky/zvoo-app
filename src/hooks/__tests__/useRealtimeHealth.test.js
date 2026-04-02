/**
 * useRealtimeHealth.test.js
 *
 * Unit tests for the useRealtimeHealth hook.
 * Tests the classification logic with different wsStatus values.
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRealtimeHealth } from '../useRealtimeHealth.js'

describe('useRealtimeHealth', () => {
  it('healthy when wsStatus is SUBSCRIBED', () => {
    const { result } = renderHook(() => useRealtimeHealth('SUBSCRIBED'))
    expect(result.current.isHealthy).toBe(true)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.label).toBe('')
  })

  it('connecting when wsStatus is CONNECTING', () => {
    const { result } = renderHook(() => useRealtimeHealth('CONNECTING'))
    expect(result.current.isHealthy).toBe(false)
    expect(result.current.isConnecting).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.label).toBeTruthy()
  })

  it('connecting when wsStatus is JOINING', () => {
    const { result } = renderHook(() => useRealtimeHealth('JOINING'))
    expect(result.current.isConnecting).toBe(true)
    expect(result.current.isError).toBe(false)
  })

  it('error when wsStatus is CHANNEL_ERROR', () => {
    const { result } = renderHook(() => useRealtimeHealth('CHANNEL_ERROR'))
    expect(result.current.isHealthy).toBe(false)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.label).toBeTruthy()
  })

  it('error when wsStatus is TIMED_OUT', () => {
    const { result } = renderHook(() => useRealtimeHealth('TIMED_OUT'))
    expect(result.current.isError).toBe(true)
  })

  it('error when wsStatus is CLOSED', () => {
    const { result } = renderHook(() => useRealtimeHealth('CLOSED'))
    expect(result.current.isError).toBe(true)
  })

  it('passes wsStatus through on result', () => {
    const { result } = renderHook(() => useRealtimeHealth('CHANNEL_ERROR'))
    expect(result.current.wsStatus).toBe('CHANNEL_ERROR')
  })

  it('recomputes on wsStatus change', () => {
    let ws = 'CHANNEL_ERROR'
    const { result, rerender } = renderHook(() => useRealtimeHealth(ws))
    expect(result.current.isError).toBe(true)

    ws = 'SUBSCRIBED'
    rerender()
    expect(result.current.isHealthy).toBe(true)
    expect(result.current.isError).toBe(false)
  })
})
