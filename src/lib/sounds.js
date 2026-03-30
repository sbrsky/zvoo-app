/**
 * Sound notification system for turn changes.
 * Uses Web Audio API to generate simple notification tones
 * without requiring external audio files.
 */

let audioCtx = null

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return audioCtx
}

/**
 * Play a short notification tone.
 * @param {'turnStart' | 'turnEnd' | 'gameOver' | 'error'} type
 */
export function playNotification(type = 'turnStart') {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()

    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    const now = ctx.currentTime

    switch (type) {
      case 'turnStart':
        // Rising two-tone beep (your turn!)
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(440, now)
        oscillator.frequency.setValueAtTime(587, now + 0.12)
        gainNode.gain.setValueAtTime(0.15, now)
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
        oscillator.start(now)
        oscillator.stop(now + 0.3)
        break

      case 'turnEnd':
        // Falling tone (waiting...)
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(523, now)
        oscillator.frequency.setValueAtTime(392, now + 0.1)
        gainNode.gain.setValueAtTime(0.1, now)
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
        oscillator.start(now)
        oscillator.stop(now + 0.2)
        break

      case 'gameOver':
        // Victory fanfare: three rising tones
        oscillator.type = 'square'
        oscillator.frequency.setValueAtTime(523, now)
        oscillator.frequency.setValueAtTime(659, now + 0.15)
        oscillator.frequency.setValueAtTime(784, now + 0.3)
        gainNode.gain.setValueAtTime(0.1, now)
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
        oscillator.start(now)
        oscillator.stop(now + 0.5)
        break

      case 'error':
        // Low boop
        oscillator.type = 'sawtooth'
        oscillator.frequency.setValueAtTime(220, now)
        gainNode.gain.setValueAtTime(0.08, now)
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
        oscillator.start(now)
        oscillator.stop(now + 0.15)
        break

      default:
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(440, now)
        gainNode.gain.setValueAtTime(0.1, now)
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
        oscillator.start(now)
        oscillator.stop(now + 0.2)
    }
  } catch (err) {
    // Silent fail — audio notifications are non-critical
    console.debug('Sound notification unavailable:', err.message)
  }
}
