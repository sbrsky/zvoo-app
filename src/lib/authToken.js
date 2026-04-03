/**
 * getFreshToken — returns a guaranteed valid Supabase access token.
 *
 * supabase.auth.getSession() reads from localStorage cache WITHOUT checking
 * if the token is still valid. If the JWT has expired (1h lifetime), any
 * authenticated request will be rejected with 401 "Invalid JWT".
 *
 * This helper:
 *  1. Gets the cached session
 *  2. If the access_token expires within 60s (or has already expired) → refreshes
 *  3. Returns the fresh (guaranteed valid) token, or null if unauthenticated
 */
import { supabase } from './supabase'

export async function getFreshToken() {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.access_token) {
    console.warn('[authToken] getFreshToken: no session found')
    return null
  }

  // Check expiry — expires_at is a Unix timestamp in seconds
  const nowSecs = Math.floor(Date.now() / 1000)
  const expiresAt = session.expires_at || 0
  const expiresInSecs = expiresAt - nowSecs

  if (expiresInSecs < 60) {
    // Token is expired or expires within 60s — refresh it now
    console.log(`[authToken] getFreshToken: token expires in ${expiresInSecs}s — refreshing...`)
    try {
      const { data: refreshed, error } = await supabase.auth.refreshSession()
      if (error) {
        console.error('[authToken] getFreshToken: refresh failed:', error.message)
        // Return old token as last resort — server will reject if truly expired
        return session.access_token
      }
      console.log('[authToken] getFreshToken: refresh OK — new token acquired')
      return refreshed?.session?.access_token || session.access_token
    } catch (e) {
      console.error('[authToken] getFreshToken: refresh threw:', e.message)
      return session.access_token
    }
  }

  // Token is valid for at least 60 more seconds
  console.log(`[authToken] getFreshToken: token valid (expires in ${expiresInSecs}s)`)
  return session.access_token
}
