/**
 * Offline Queue — enqueues Supabase writes when offline,
 * flushes when connectivity is restored.
 */
import logger from './logger.js'

const STORAGE_KEY = 'zvoo_offline_queue'

class OfflineQueue {
  constructor() {
    this.queue = this._load()
    this._flushing = false

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        logger.info('offline-queue', 'Connection restored — flushing queue')
        this.flush()
      })
      window.addEventListener('offline', () => {
        logger.warn('offline-queue', 'Connection lost — queueing writes')
      })
    }
  }

  /** Load queue from localStorage */
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  /** Save queue to localStorage */
  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue)) } catch {}
  }

  /** Enqueue an operation for later execution */
  enqueue(operation) {
    this.queue.push({ ...operation, enqueuedAt: Date.now() })
    this._save()
    logger.info('offline-queue', `Enqueued: ${operation.type}`, operation)
  }

  /** Execute a function — if offline, enqueue it instead */
  async tryOrQueue(type, fn, fallbackData = {}) {
    if (navigator.onLine) {
      return await fn()
    }
    this.enqueue({ type, data: fallbackData })
    return null
  }

  /** Flush all queued operations */
  async flush() {
    if (this._flushing || this.queue.length === 0) return
    this._flushing = true

    const pending = [...this.queue]
    this.queue = []
    this._save()

    let failed = []
    for (const op of pending) {
      try {
        logger.info('offline-queue', `Flushing: ${op.type}`, op.data)
        // Operations are stored as serializable data — the consumer must handle replay
        // For now, we emit an event for each queued operation
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('zvoo:replay', { detail: op }))
        }
      } catch (err) {
        logger.error('offline-queue', `Flush failed: ${op.type}`, { error: err.message })
        failed.push(op)
      }
    }

    if (failed.length > 0) {
      this.queue.push(...failed)
      this._save()
    }

    this._flushing = false
    logger.info('offline-queue', `Flush complete. ${pending.length - failed.length} succeeded, ${failed.length} failed.`)
  }

  /** Get current queue size */
  get size() { return this.queue.length }
}

const offlineQueue = new OfflineQueue()

if (typeof window !== 'undefined') {
  window.__ECHOFLIP_OFFLINE_QUEUE = offlineQueue
}

export default offlineQueue
