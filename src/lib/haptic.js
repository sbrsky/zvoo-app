/**
 * haptic.js — Cross-platform tactile feedback
 *
 * Android: navigator.vibrate (true haptic)
 * iOS:     Web Audio API — short sine burst that brain perceives as "click"
 */

let _audioCtx = null

function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return _audioCtx
}

/**
 * Play a very short sine-wave "click" — works on iOS (after first user gesture)
 * Duration ~30ms, barely audible but perceptible as tactile-like feedback.
 */
function iosClick(type = 'light') {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    const configs = {
      light:  { freq: 1200, vol: 0.04, dur: 0.025 },
      medium: { freq:  900, vol: 0.07, dur: 0.04  },
      heavy:  { freq:  600, vol: 0.10, dur: 0.06  },
      success:{ freq: 1400, vol: 0.06, dur: 0.06  },
      error:  { freq:  300, vol: 0.08, dur: 0.08  },
    }
    const cfg = configs[type] || configs.light

    osc.type = 'sine'
    osc.frequency.setValueAtTime(cfg.freq, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(cfg.freq * 0.5, ctx.currentTime + cfg.dur)

    gain.gain.setValueAtTime(cfg.vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cfg.dur)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + cfg.dur)
  } catch {
    // Silently fail if AudioContext not available
  }
}

/**
 * Main haptic function — uses vibrate on Android, audio-click on iOS
 * @param {'light'|'medium'|'heavy'|'success'|'error'} type
 */
export function haptic(type = 'light') {
  const vibrateDurations = {
    light:   [10],
    medium:  [20],
    heavy:   [30],
    success: [10, 50, 10],
    error:   [30, 40, 30],
  }

  // Android & some desktop browsers
  if (navigator.vibrate) {
    navigator.vibrate(vibrateDurations[type] || [10])
  }

  // iOS (and as additional feedback on Android)
  iosClick(type)
}

/** Convenience shortcuts */
export const hapticLight   = () => haptic('light')
export const hapticMedium  = () => haptic('medium')
export const hapticHeavy   = () => haptic('heavy')
export const hapticSuccess = () => haptic('success')
export const hapticError   = () => haptic('error')
