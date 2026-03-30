import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function usePresence(channelName = 'lobby', userInfo = {}) {
  const [onlineUsers, setOnlineUsers] = useState([])
  const channelRef = useRef(null)
  // Stabilise userInfo fields so the effect doesn't re-run on every re-render
  // (callers often pass a new object literal each time)
  const userInfoRef = useRef(userInfo)
  useEffect(() => { userInfoRef.current = userInfo })

  useEffect(() => {
    if (!userInfoRef.current.id) return

    const channel = supabase.channel(channelName, {
      config: { presence: { key: userInfoRef.current.id } }
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()

        // flat() handles multi-tab entries, then deduplicate by userId (keep latest)
        const seen = new Map()
        Object.values(state).flat().forEach(p => {
          const existing = seen.get(p.id)
          if (!existing || p.online_at > existing.online_at) {
            seen.set(p.id, {
              id: p.id,
              username: p.username,
              avatar_url: p.avatar_url,
              online_at: p.online_at,
            })
          }
        })
        setOnlineUsers([...seen.values()])
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            id: userInfoRef.current.id,
            username: userInfoRef.current.username || 'Anonymous',
            avatar_url: userInfoRef.current.avatar_url || '',
            online_at: new Date().toISOString(),
          })
        }
      })

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  // Only re-run if channelName or the actual userId changes
  }, [channelName, userInfo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return { onlineUsers }
}
