import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

/**
 * Safe in-memory lock for Supabase Auth.
 * Prevents "Lock was released because another request stole it" errors.
 * Supports proper queuing and robust timeout handling without deadlocks.
 */
const locks = new Map()

async function safeLock(name, acquireTimeout, fn) {
  const start = Date.now()
  const timeoutMs = acquireTimeout || 10000

  while (locks.has(name)) {
    if (Date.now() - start > timeoutMs) {
      console.warn(`[supabase-lock] Timeout acquiring lock "${name}", breaking queue`)
      break
    }
    await new Promise(r => setTimeout(r, 20))
  }

  locks.set(name, true)
  try {
    return await fn()
  } finally {
    locks.delete(name)
  }
}

const fetchWithTimeout = async (url, options) => {
  const timeoutMs = 15000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      // If Supabase passes a signal, we use it. Otherwise, use our timeout signal.
      signal: options?.signal || controller.signal,
    });
    return res;
  } catch (err) {
    // Treat AbortError as a forced timeout error to unblock the UI
    if (err.name === 'AbortError') {
      console.warn(`⏳ Network timeout to Supabase (${url}) - forcing failure to unblock app.`);
      throw new Error(`[Network] Supabase Request Timeout (${timeoutMs}ms) for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: safeLock,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: fetchWithTimeout,
  }
})
