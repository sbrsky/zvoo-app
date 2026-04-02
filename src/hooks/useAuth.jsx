import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Safety-net: if auth never resolves (network down, Supabase unreachable), unblock UI after 5s
    const safetyTimer = setTimeout(() => {
      console.warn('[useAuth] Safety timeout 5s — forcing loading=false. Supabase getSession() may be hanging.')
      setLoading(false)
    }, 5000)

    console.log('[useAuth] calling getSession()...')
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        console.log('[useAuth] getSession() resolved, user=', session?.user?.id ?? 'null')
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchProfile(session.user.id) // fetchProfile does setLoading(false) in finally
        } else {
          setLoading(false)
        }
        clearTimeout(safetyTimer)
      })
      .catch((err) => {
        console.error('[useAuth] getSession failed:', err.message)
        clearTimeout(safetyTimer)
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('[useAuth] onAuthStateChange:', _event, session?.user?.id ?? 'null')
      setUser(session?.user ?? null)
      if (session?.user) {
        await fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [])


  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (!error && data) setProfile(data)
      else if (error) console.warn('[useAuth] fetchProfile error:', error.message)
    } catch (err) {
      // e.g. network timeout from fetchWithTimeout — must NOT leave loading=true
      console.error('[useAuth] fetchProfile threw (network issue?):', err.message)
    } finally {
      // ALWAYS unblock the app, even on errors
      setLoading(false)
    }
  }

  async function signUp(email, password, username) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { username } }
    })
    if (error) throw error
    return data
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single()
    if (error) throw error
    setProfile(data)
    return data
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, signInWithGoogle, signOut, updateProfile, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
