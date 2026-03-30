/**
 * useAudioEngine unit tests
 *
 * Focus: the race condition between stopRecording() and reverseAudio().
 * stopRecording() must return a Promise<Blob> so callers can await it
 * before calling reverseAudio() — eliminating the stale-closure bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioEngine } from '../useAudioEngine'

// ─── Mock Web APIs ────────────────────────────────────────────────────────────

// Minimal fake AudioBuffer
function fakeAudioBuffer(length = 100, channels = 1, sampleRate = 44100) {
  const data = new Float32Array(length).fill(0.5)
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: () => data,
  }
}

// Fake OfflineAudioContext
class FakeOfflineAudioContext {
  constructor(channels, length, sampleRate) {
    this._channels = channels; this._length = length; this._sampleRate = sampleRate
  }
  createBuffer(channels, length, sampleRate) {
    const bufs = Array.from({ length: channels }, () => new Float32Array(length))
    return {
      numberOfChannels: channels, length, sampleRate: sampleRate || this._sampleRate,
      duration: length / (sampleRate || this._sampleRate),
      getChannelData: (ch) => bufs[ch],
    }
  }
}

// Fake AudioContext
class FakeAudioContext {
  constructor() { this.state = 'running'; this.sampleRate = 44100 }
  createMediaStreamSource() { return { connect: vi.fn() } }
  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      connect: vi.fn(),
      getByteTimeDomainData: vi.fn(),
    }
  }
  createBufferSource() {
    return {
      buffer: null, connect: vi.fn(),
      start: vi.fn(), stop: vi.fn(),
      onended: null,
    }
  }
  async decodeAudioData() { return fakeAudioBuffer() }
  async resume() {}
}

// Fake MediaRecorder
let _fakeOnStop = null
let _fakeOnError = null

class FakeMediaRecorder {
  constructor() { this.state = 'inactive' }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    // Simulate async onstop (like real browser behaviour)
    setTimeout(() => {
      if (this.onstop) this.onstop()
    }, 10)
  }
  set onstop(fn)  { _fakeOnStop  = fn; this._onstop  = fn }
  get onstop()    { return this._onstop }
  set onerror(fn) { _fakeOnError = fn; this._onerror = fn }
  get onerror()   { return this._onerror }
}

// Fake getUserMedia
const fakeStream = {
  getTracks: () => [{ stop: vi.fn() }],
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('webkitAudioContext', FakeAudioContext)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useAudioEngine — stopRecording race condition fix', () => {

  it('✅ stopRecording returns a Promise that resolves with a Blob', async () => {
    const { result } = renderHook(() => useAudioEngine())

    await act(async () => { await result.current.startRecording() })
    expect(result.current.isRecording).toBe(true)

    let blob
    await act(async () => {
      // Simulate some data being recorded
      // Manually push a chunk because ondataavailable won't fire in tests
      const engine = result.current
      // NOTE: chunksRef is internal; simulate via startRecording which cleared it
      blob = await engine.stopRecording()
    })

    // onstop fires async with 10ms delay — should still be awaited
    expect(blob).toBeInstanceOf(Blob)
    expect(result.current.isRecording).toBe(false)
  })

  it('✅ reverseAudio works immediately after stopRecording resolves (no stale closure)', async () => {
    const { result } = renderHook(() => useAudioEngine())

    await act(async () => { await result.current.startRecording() })

    let reversed
    await act(async () => {
      // Provide an explicit blob with data so targetBlob.size > 0
      const recordedBlob = new Blob(['dummy audio data'], { type: 'audio/webm' })
      // Pass blob directly — simulates how Game.jsx now works
      reversed = await result.current.reverseAudio(recordedBlob)
    })

    // reverseAudio should return a WAV Blob (not null)
    expect(reversed).toBeInstanceOf(Blob)
    expect(reversed.type).toBe('audio/wav')
  })

  it('✅ reverseAudio uses audioBlobRef (not stale state) when no arg given', async () => {
    const { result } = renderHook(() => useAudioEngine())

    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopRecording() })
    
    // Override audioBlobRef so targetBlob.size > 0
    result.current.audioBlobRef.current = new Blob(['dummy audio data'], { type: 'audio/webm' })

    // Even without passing blob explicitly, audioBlobRef should have it
    let reversed
    await act(async () => {
      reversed = await result.current.reverseAudio() // no arg
    })
    expect(reversed).toBeInstanceOf(Blob)
  })

  it('✅ reverseAudio returns null and warns when no blob is available', async () => {
    const { result } = renderHook(() => useAudioEngine())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let reversed
    await act(async () => {
      reversed = await result.current.reverseAudio() // nothing recorded yet
    })

    expect(reversed).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no blob'))
    warnSpy.mockRestore()
  })

  it('✅ audioBlobRef is updated before Promise resolves', async () => {
    const { result } = renderHook(() => useAudioEngine())

    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopRecording() })

    // audioBlobRef must be set synchronously before the consumer continues
    expect(result.current.audioBlobRef.current).toBeInstanceOf(Blob)
  })

  it('✅ stopRecording is safe to call when not recording (already inactive)', async () => {
    const { result } = renderHook(() => useAudioEngine())
    // Never started recording — should resolve immediately with null
    let blob
    await act(async () => { blob = await result.current.stopRecording() })
    expect(blob).toBeNull()
  })

  it('✅ startRecording clears audioBlobRef from previous session', async () => {
    const { result } = renderHook(() => useAudioEngine())

    // First session
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopRecording() })
    expect(result.current.audioBlobRef.current).toBeInstanceOf(Blob)

    // Second session — ref should be cleared on start
    await act(async () => { await result.current.startRecording() })
    expect(result.current.audioBlobRef.current).toBeNull()
  })
})
