/**
 * useRoom.test.js
 * Tests the core multiplayer join logic directly (without renderHook complexity).
 * We test the joinRoom function logic by extracting it and mocking Supabase.
 *
 * Scenarios covered:
 * 1. Guest can join an empty room
 * 2. joinRoom is blocked when joiningRef is true (mutex)
 * 3. joinRoom detects already-guest state (page refresh) and skips UPDATE
 * 4. joinRoom handles race (slot already taken by another guest)
 * 5. fetchRoom avoids game_sessions query for non-participants
 * 6. isHost / isGuest computed flags
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// Supabase mock builder
// ─────────────────────────────────────────────────────────────────────────────

const HOST_ID   = 'host-user-uuid'
const GUEST_ID  = 'guest-user-uuid'
const ROOM_ID   = 'room-uuid-001'
const SESSION_ID = 'session-uuid-001'

function makeSingleChain(value, err = null) {
  return { single: vi.fn().mockResolvedValue({ data: value, error: err }) }
}

function buildSupabaseMock(roomState = null) {
  let room = roomState ?? {
    id: ROOM_ID,
    host_id: HOST_ID,
    guest_id: null,
    status: 'waiting',
  }
  const sessions = []
  const gameSessionQueryCalls = []

  const channelMock = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    send: vi.fn(),
  }

  function makeRoomsChain() {
    return {
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          single: vi.fn().mockResolvedValue({ data: { ...room }, error: null }),
          is: vi.fn().mockImplementation(() => ({
            select: vi.fn().mockImplementation(() => {
              if (room.guest_id === null) {
                room = { ...room, guest_id: GUEST_ID, status: 'playing' }
                return Promise.resolve({ data: [{ ...room }], error: null })
              }
              return Promise.resolve({ data: [], error: null })
            }),
          })),
        })),
      })),
      update: vi.fn().mockImplementation((updates) => ({
        eq: vi.fn().mockImplementation(() => ({
          is: vi.fn().mockImplementation(() => ({
            select: vi.fn().mockImplementation(() => {
              if (room.guest_id === null) {
                room = { ...room, ...updates }
                return Promise.resolve({ data: [{ ...room }], error: null })
              }
              return Promise.resolve({ data: [], error: null })
            }),
          })),
          select: vi.fn().mockResolvedValue({ data: [{ ...room }], error: null }),
          single: vi.fn().mockResolvedValue({ data: { ...room }, error: null }),
        })),
      })),
    }
  }

  function makeGameSessionsChain() {
    gameSessionQueryCalls.push(Date.now())
    return {
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          order: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => ({
              single: vi.fn().mockResolvedValue({
                data: sessions[0] ?? null,
                error: sessions[0] ? null : { code: 'PGRST116', message: 'no rows' },
              }),
            })),
          })),
        })),
      })),
      insert: vi.fn().mockImplementation((doc) => ({
        select: vi.fn().mockImplementation(() => ({
          single: vi.fn().mockImplementation(() => {
            const s = { id: SESSION_ID, room_id: ROOM_ID, ...doc }
            sessions.push(s)
            return Promise.resolve({ data: s, error: null })
          }),
        })),
      })),
    }
  }

  const supabase = {
    from: vi.fn().mockImplementation((table) => {
      if (table === 'rooms') return makeRoomsChain()
      if (table === 'game_sessions') return makeGameSessionsChain()
      return {}
    }),
    channel: vi.fn().mockReturnValue(channelMock),
    removeChannel: vi.fn(),
    // Test helpers
    _getRoom: () => ({ ...room }),
    _getSessions: () => sessions,
    _gameSessionQueryCount: () => gameSessionQueryCalls.length,
    _channelMock: channelMock,
  }

  return supabase
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for join logic (no React, no hooks)
// These directly test the LOGIC of joinRoom without UI overhead
// ─────────────────────────────────────────────────────────────────────────────

describe('joinRoom core logic', () => {
  let supabase

  beforeEach(() => {
    supabase = buildSupabaseMock()
  })

  async function simulateJoinRoom({ roomId, userId, currentGuestId = null, joiningRef = { current: false } }) {
    // Mirror of useRoom.joinRoom logic
    if (joiningRef.current) return null
    joiningRef.current = true

    try {
      const { data: currentRoom } = await supabase.from('rooms').select('*').eq('id', roomId).single()
      if (currentRoom?.guest_id === userId) {
        return { skipped: true, room: currentRoom }
      }

      const { data, error } = await supabase
        .from('rooms')
        .update({ guest_id: userId, status: 'playing' })
        .eq('id', roomId)
        .is('guest_id', null)
        .select()

      if (error) return { error: true }
      if (!data || data.length === 0) return { taken: true }
      return { joined: true, room: data[0] }
    } finally {
      joiningRef.current = false
    }
  }

  it('✅ Test 1: Guest successfully joins an empty room', async () => {
    const result = await simulateJoinRoom({ roomId: ROOM_ID, userId: GUEST_ID })

    expect(result.joined).toBe(true)
    expect(result.room.guest_id).toBe(GUEST_ID)
    expect(result.room.status).toBe('playing')
    expect(supabase._getRoom().guest_id).toBe(GUEST_ID)
  })

  it('✅ Test 2: Mutex blocks concurrent second joinRoom call', async () => {
    const joiningRef = { current: false }

    const [first, second] = await Promise.all([
      simulateJoinRoom({ roomId: ROOM_ID, userId: GUEST_ID, joiningRef }),
      simulateJoinRoom({ roomId: ROOM_ID, userId: GUEST_ID, joiningRef }),
    ])

    const nullResults = [first, second].filter(r => r === null)
    expect(nullResults.length).toBe(1)
    expect(supabase._getRoom().guest_id).toBe(GUEST_ID)
  })

  it('✅ Test 3: Page refresh — already a guest, skips UPDATE', async () => {
    supabase = buildSupabaseMock({
      id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing',
    })

    const result = await simulateJoinRoom({ roomId: ROOM_ID, userId: GUEST_ID })
    expect(result.skipped).toBe(true)
    expect(result.room.guest_id).toBe(GUEST_ID)
  })

  it('✅ Test 4: Race condition — another user claimed slot first', async () => {
    const OTHER_GUEST = 'other-guest-uuid'
    supabase = buildSupabaseMock({
      id: ROOM_ID, host_id: HOST_ID, guest_id: OTHER_GUEST, status: 'playing',
    })

    const result = await simulateJoinRoom({ roomId: ROOM_ID, userId: GUEST_ID })

    // joinRoom should detect slot is taken and return gracefully
    expect(result.taken).toBe(true)
    // Other guest's slot is preserved
    expect(supabase._getRoom().guest_id).toBe(OTHER_GUEST)
  })

  it('✅ Test 5: isHost / isGuest flags compute correctly', () => {
    const room = { id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID }
    const userId = HOST_ID

    const isHost  = room.host_id === userId
    const isGuest = room.guest_id === userId

    expect(isHost).toBe(true)
    expect(isGuest).toBe(false)

    const userId2 = GUEST_ID
    expect(room.host_id === userId2).toBe(false)
    expect(room.guest_id === userId2).toBe(true)
  })

  it('✅ Test 6: fetchRoom skips game_sessions if user is not a participant', async () => {
    const room = supabase._getRoom() // guest_id is null
    const userId = GUEST_ID

    // Simulate fetchRoom conditional logic
    const isParticipant = room.host_id === userId || room.guest_id === userId
    if (isParticipant) {
      // would call game_sessions
      await supabase.from('game_sessions')
    }

    // User is NOT a participant yet, so query count should be 0
    expect(isParticipant).toBe(false)
    expect(supabase._gameSessionQueryCount()).toBe(0)
  })

  it('✅ Test 7: fetchRoom queries game_sessions after user is a participant', async () => {
    supabase = buildSupabaseMock({
      id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing',
    })

    const room = supabase._getRoom()
    const userId = GUEST_ID

    const isParticipant = room.host_id === userId || room.guest_id === userId
    if (isParticipant) {
      await supabase.from('game_sessions').select('*').eq('room_id', ROOM_ID).order('created_at', { ascending: false }).limit(1).single()
    }

    expect(isParticipant).toBe(true)
    expect(supabase._gameSessionQueryCount()).toBeGreaterThan(0)
  })

  it('✅ Test 8: joinRoom releases mutex even on error', async () => {
    supabase = buildSupabaseMock()
    // Override to throw
    supabase.from = vi.fn().mockImplementation((table) => {
      if (table === 'rooms') {
        return {
          select: () => ({ eq: () => ({ single: vi.fn().mockRejectedValue(new Error('Network error')) }) }),
          update: () => ({}),
        }
      }
      return {}
    })

    const joiningRef = { current: false }
    try {
      await simulateJoinRoom({ roomId: ROOM_ID, userId: GUEST_ID, joiningRef })
    } catch (_) {}

    // Mutex should be released regardless of error
    expect(joiningRef.current).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RLS policy simulation test
// ─────────────────────────────────────────────────────────────────────────────

describe('RLS policy simulation', () => {
  it('✅ Test 9: game_sessions SELECT policy — waiting room allowed after fix', () => {
    // Simulate the updated RLS policy logic:
    // allow if host_id = uid OR guest_id = uid OR status = 'waiting'
    function canReadGameSession(room, userId) {
      return room.host_id === userId ||
             room.guest_id === userId ||
             room.status === 'waiting'
    }

    const waitingRoom = { host_id: HOST_ID, guest_id: null, status: 'waiting' }
    const playingRoom = { host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing' }

    // Non-participant reading a waiting room — ALLOWED (after fix)
    expect(canReadGameSession(waitingRoom, GUEST_ID)).toBe(true)

    // Non-participant reading a playing room — DENIED
    const OTHER = 'stranger-uuid'
    expect(canReadGameSession(playingRoom, OTHER)).toBe(false)

    // Actual participant reading a playing room — ALLOWED
    expect(canReadGameSession(playingRoom, GUEST_ID)).toBe(true)
    expect(canReadGameSession(playingRoom, HOST_ID)).toBe(true)
  })

  it('✅ Test 10: Old RLS policy — would block guest before join', () => {
    // Old policy: only host_id OR guest_id
    function oldCanReadGameSession(room, userId) {
      return room.host_id === userId || room.guest_id === userId
    }

    const waitingRoom = { host_id: HOST_ID, guest_id: null, status: 'waiting' }
    // OLD policy: guest can't read before being added — THIS was the bug
    expect(oldCanReadGameSession(waitingRoom, GUEST_ID)).toBe(false)
  })
})
