import { useState, useRef, useCallback } from 'react'
import { haptic } from '../lib/haptic'

/**
 * useAsyncButton — wraps any async action with:
 *  - instant visual pending state (blocks re-click)
 *  - success / error outcome state (for CSS animations)
 *  - haptic feedback at each stage
 *
 * @param {() => Promise<void>} asyncFn  The async action to run
 * @param {object} opts
 * @param {number}  opts.successDuration   ms to show 'success' state (default 700)
 * @param {number}  opts.errorDuration     ms to show 'error' state (default 900)
 * @param {boolean} opts.hapticOnPress     fire haptic on click (default true)
 *
 * @returns {{ pending, status, trigger, className }}
 *   - pending:   boolean — is action running?
 *   - status:    'idle' | 'pending' | 'success' | 'error'
 *   - trigger:   safe onClick handler (guards double-click)
 *   - className: CSS class string to spread on button element
 */
export function useAsyncButton(asyncFn, {
  successDuration = 700,
  errorDuration   = 900,
  hapticOnPress   = true,
} = {}) {
  const [status, setStatus] = useState('idle')
  const running = useRef(false)

  const trigger = useCallback(async (e) => {
    if (running.current) return          // guard double-click
    running.current = true
    if (hapticOnPress) haptic('medium')

    setStatus('pending')
    try {
      await asyncFn(e)
      setStatus('success')
      haptic('success')
      setTimeout(() => { setStatus('idle'); running.current = false }, successDuration)
    } catch {
      setStatus('error')
      haptic('error')
      setTimeout(() => { setStatus('idle'); running.current = false }, errorDuration)
    }
  }, [asyncFn, successDuration, errorDuration, hapticOnPress])

  const className = [
    'btn-game',
    status === 'pending' ? 'btn-pending' : '',
    status === 'success' ? 'btn-success' : '',
    status === 'error'   ? 'btn-error'   : '',
  ].filter(Boolean).join(' ')

  return {
    pending:   status === 'pending',
    status,
    trigger,
    className,
  }
}
