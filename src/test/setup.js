import '@testing-library/jest-dom'

// Mock AudioContext
class MockAudioContext {
  constructor() {
    this.state = 'suspended'
    this.sampleRate = 44100
  }
  createOscillator() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { value: 440 } } }
  createGain() { return { connect: vi.fn(), gain: { value: 1 } } }
  createAnalyser() { return { connect: vi.fn(), fftSize: 256, getByteFrequencyData: vi.fn() } }
  createMediaStreamSource() { return { connect: vi.fn() } }
  async resume() { this.state = 'running' }
  async close() { this.state = 'closed' }
}

globalThis.AudioContext = MockAudioContext
globalThis.webkitAudioContext = MockAudioContext

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  },
  writable: true,
})

// Mock performance.now for network interceptor
if (!globalThis.performance) {
  globalThis.performance = { now: vi.fn(() => Date.now()) }
}

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val) }),
    removeItem: vi.fn(key => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Suppress console noise during tests
// (logger intercepts console, so we reset after each test)
afterEach(() => {
  localStorageMock.clear()
})
