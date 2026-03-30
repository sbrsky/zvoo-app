/**
 * Centralized Logger — ring buffer, console interception, event dispatch.
 * All logs (console, network, custom) flow through here.
 */

const MAX_LOGS = 500
let _id = 0

class Logger extends EventTarget {
  constructor() {
    super()
    this.logs = []
    this._intercepted = false
  }

  /** Add a log entry */
  _push(level, source, message, data = null) {
    const entry = {
      id: ++_id,
      timestamp: new Date().toISOString(),
      level,
      source,
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      data,
      stack: level === 'ERROR' ? new Error().stack : null,
    }
    this.logs.push(entry)
    if (this.logs.length > MAX_LOGS) this.logs.shift()
    this.dispatchEvent(new CustomEvent('log', { detail: entry }))
    return entry
  }

  debug(source, msg, data) { return this._push('DEBUG', source, msg, data) }
  info(source, msg, data)  { return this._push('INFO', source, msg, data) }
  warn(source, msg, data)  { return this._push('WARN', source, msg, data) }
  error(source, msg, data) { return this._push('ERROR', source, msg, data) }
  network(msg, data)       { return this._push('NETWORK', 'fetch', msg, data) }

  /** Get all logs, optionally filtered */
  getLogs(filter = {}) {
    let result = [...this.logs]
    if (filter.level) result = result.filter(l => l.level === filter.level)
    if (filter.source) result = result.filter(l => l.source.includes(filter.source))
    if (filter.search) {
      const q = filter.search.toLowerCase()
      result = result.filter(l => l.message.toLowerCase().includes(q))
    }
    return result
  }

  /** Clear all logs */
  clear() { this.logs = []; this.dispatchEvent(new CustomEvent('clear')) }

  /** Intercept native console methods */
  interceptConsole() {
    if (this._intercepted) return
    this._intercepted = true

    const original = {
      log:   console.log.bind(console),
      info:  console.info.bind(console),
      warn:  console.warn.bind(console),
      error: console.error.bind(console),
    }

    console.log = (...args) => {
      original.log(...args)
      this.debug('console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    }
    console.info = (...args) => {
      original.info(...args)
      this.info('console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    }
    console.warn = (...args) => {
      original.warn(...args)
      this.warn('console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    }
    console.error = (...args) => {
      original.error(...args)
      this.error('console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    }

    // Global error handler
    window.addEventListener('error', (e) => {
      this.error('window', e.message, { filename: e.filename, lineno: e.lineno, colno: e.colno })
    })

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (e) => {
      this.error('promise', String(e.reason), { reason: e.reason?.stack || String(e.reason) })
    })
  }
}

/** Singleton */
const logger = new Logger()

// Expose globally for DevTools access
if (typeof window !== 'undefined') {
  window.__ECHOFLIP_LOGGER = logger
}

export default logger
