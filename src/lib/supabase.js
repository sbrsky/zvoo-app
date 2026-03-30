import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

/**
 * In-memory mutex lock to replace navigator.locks.
 * navigator.locks causes "Lock was released because another request stole it"
 * when many concurrent Supabase requests fire on page mount
 * (Realtime channels + REST queries + auth state checks).
 *
 * This serializes access to the auth token properly without
 * the browser-level lock timeout issues.
 */
const locks = new Map()

async function inMemoryLock(name, acquireTimeout, fn) {
  const start = Date.now()

  while (locks.has(name)) {
    if (Date.now() - start > acquireTimeout) {
      // Timed out waiting — still execute to avoid deadlock
      console.warn(`[supabase-lock] acquire timeout for "${name}", executing anyway`)
      break
    }
    // Wait a tick and retry
    await new Promise(resolve => setTimeout(resolve, 30))
  }

  locks.set(name, true)
  try {
    return await fn()
  } finally {
    locks.delete(name)
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: inMemoryLock,
    persistSession: true,
    detectSessionInUrl: true,
  },
})
