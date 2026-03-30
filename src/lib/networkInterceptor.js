/**
 * Network Interceptor — monkey-patches fetch and XMLHttpRequest
 * to log all network activity through the centralized logger.
 */
import logger from './logger.js'

let _intercepted = false

export function interceptNetwork() {
  if (_intercepted) return
  _intercepted = true

  // --- Fetch ---
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    const method = init?.method || (typeof input === 'object' ? input?.method : 'GET') || 'GET'
    const startTime = performance.now()

    try {
      const response = await originalFetch(input, init)
      const duration = Math.round(performance.now() - startTime)

      logger.network(`${method.toUpperCase()} ${url}`, {
        method: method.toUpperCase(),
        url,
        status: response.status,
        statusText: response.statusText,
        duration,
        ok: response.ok,
      })

      return response
    } catch (error) {
      const duration = Math.round(performance.now() - startTime)
      logger.network(`${method.toUpperCase()} ${url} — FAILED`, {
        method: method.toUpperCase(),
        url,
        status: 0,
        error: error.message,
        duration,
        ok: false,
      })
      throw error
    }
  }

  // --- XMLHttpRequest ---
  const OrigXHR = window.XMLHttpRequest
  const origOpen = OrigXHR.prototype.open
  const origSend = OrigXHR.prototype.send

  OrigXHR.prototype.open = function (method, url, ...rest) {
    this._logMeta = { method: method.toUpperCase(), url: String(url), startTime: 0 }
    return origOpen.call(this, method, url, ...rest)
  }

  OrigXHR.prototype.send = function (body) {
    if (this._logMeta) {
      this._logMeta.startTime = performance.now()

      this.addEventListener('loadend', () => {
        const duration = Math.round(performance.now() - this._logMeta.startTime)
        logger.network(`${this._logMeta.method} ${this._logMeta.url}`, {
          method: this._logMeta.method,
          url: this._logMeta.url,
          status: this.status,
          statusText: this.statusText,
          duration,
          ok: this.status >= 200 && this.status < 400,
        })
      })
    }
    return origSend.call(this, body)
  }
}
