/**
 * EventBus — lightweight pub/sub for cross-component communication.
 */

class EventBus {
  constructor() {
    this._handlers = new Map()
  }

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set())
    this._handlers.get(event).add(handler)
    return () => this.off(event, handler) // return unsubscribe fn
  }

  off(event, handler) {
    this._handlers.get(event)?.delete(handler)
  }

  emit(event, data) {
    this._handlers.get(event)?.forEach(h => {
      try { h(data) } catch (e) { console.error(`[EventBus] Error in handler for "${event}":`, e) }
    })
    // Also emit to wildcard listeners
    this._handlers.get('*')?.forEach(h => {
      try { h({ event, data }) } catch (e) { console.error(`[EventBus] Error in wildcard handler:`, e) }
    })
  }

  /** Remove all handlers (useful for tests) */
  clear() { this._handlers.clear() }
}

const eventBus = new EventBus()

if (typeof window !== 'undefined') {
  window.__ECHOFLIP_EVENTBUS = eventBus
}

export default eventBus
