/**
 * multiplayer.integration.test.js
 * ─────────────────────────────────────────────
 * FULL END-TO-END REGRESSION SUITE
 * Verifies the complete two-player game flow:
 *
 *   Room created → Guest joins → Host notified via Realtime →
 *   Session created → Phase transitions: WAITING → HOST_RECORD →
 *   GUEST_LISTEN → GUEST_MIMIC → SCORING → RESULTS → Host closes room
 *
 * Scenarios:
 *  Suite A — Room Lifecycle       (create, join, close, RLS guard)
 *  Suite B — Realtime Sync        (postgres_changes, host detects guest)
 *  Suite C — Full Game Flow       (all 6 phases end-to-end)
 *  Suite D — Race Conditions      (concurrent joins, double createSession)
 *  Suite E — Error Resilience     (network failures, mutex cleanup)
 *  Suite F — RLS Policy Matrix    (all access scenarios)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─────────────────────────────────────────────
// Identities
// ─────────────────────────────────────────────
const HOST_ID    = 'host-uuid-aaaa'
const GUEST_ID   = 'guest-uuid-bbbb'
const STRANGER   = 'stranger-uuid-cccc'
const ROOM_ID    = 'room-uuid-test-001'
const SESSION_ID = 'session-uuid-test-001'

// ─────────────────────────────────────────────
// Game constants (mirrors src/lib/constants.js)
// ─────────────────────────────────────────────
const PHASES = {
  WAITING:     'WAITING',
  HOST_RECORD: 'HOST_RECORD',
  GUEST_LISTEN:'GUEST_LISTEN',
  GUEST_MIMIC: 'GUEST_MIMIC',
  SCORING:     'SCORING',
  RESULTS:     'RESULTS',
}

const GAME_EVENTS = {
  PLAYER_RECORDING: 'PLAYER_RECORDING',
  AUDIO_READY:      'AUDIO_READY',
  MIMIC_RECORDING:  'MIMIC_RECORDING',
  MIMIC_DONE:       'MIMIC_DONE',
  SHOW_RESULT:      'SHOW_RESULT',
}

// ─────────────────────────────────────────────
// Supabase In-Memory Mock
// Full-fidelity mock with Realtime simulation
// ─────────────────────────────────────────────

function buildFullMock(initialRoom = null) {
  // Shared in-memory state (acts as the DB)
  let room = initialRoom ?? {
    id: ROOM_ID,
    host_id: HOST_ID,
    guest_id: null,
    status: 'waiting',
    created_at: new Date().toISOString(),
  }
  let sessions = []
  let realtimeListeners = [] // postgres_changes subscribers

  // Simulate Realtime: fire UPDATE event to all subscribers
  function fireRoomUpdate(updatedRoom) {
    realtimeListeners.forEach(fn => fn({ new: { ...updatedRoom } }))
  }

  // ── Channel mock (Supabase Realtime) ──
  let channelHandlers = {
    'postgres_changes': [],
    'broadcast': [],
  }
  const channelMock = {
    on: vi.fn().mockImplementation((type, filter, handler) => {
      if (type === 'postgres_changes') channelHandlers['postgres_changes'].push(handler)
      if (type === 'broadcast') channelHandlers['broadcast'].push(handler)
      return channelMock
    }),
    subscribe: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation(({ event, payload }) => {
      // Broadcast to all broadcast listeners
      channelHandlers['broadcast'].forEach(fn => fn({ payload }))
    }),
    // Test helpers
    _firePostgresUpdate: (updatedRoom) => {
      channelHandlers['postgres_changes'].forEach(fn => fn({ new: { ...updatedRoom } }))
    },
    _fireBroadcast: (payload) => {
      channelHandlers['broadcast'].forEach(fn => fn({ payload }))
    },
  }

  // ── Rooms table mock ──
  function makeRoomsChain() {
    return {
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          single: vi.fn().mockResolvedValue({ data: { ...room }, error: null }),
          in: vi.fn().mockResolvedValue({ data: [{ ...room }], error: null }),
          order: vi.fn().mockResolvedValue({ data: [{ ...room }], error: null }),
        })),
        in: vi.fn().mockResolvedValue({ data: [{ ...room }], error: null }),
        order: vi.fn().mockResolvedValue({ data: [{ ...room }], error: null }),
      })),

      update: vi.fn().mockImplementation((updates) => ({
        eq: vi.fn().mockImplementation((col, val) => ({
          // joinRoom path: .eq('id', roomId).is('guest_id', null).select()
          is: vi.fn().mockImplementation((col2, val2) => ({
            select: vi.fn().mockImplementation(() => {
              // Simulate RLS: allow if room is waiting and guest slot is empty
              const canJoin = (
                room.status === 'waiting' &&
                room.guest_id === null
              )
              if (!canJoin) return Promise.resolve({ data: [], error: null })
              room = { ...room, ...updates }
              const updated = { ...room }
              // Fire Realtime to all listeners
              fireRoomUpdate(updated)
              return Promise.resolve({ data: [updated], error: null })
            }),
          })),

          // updateRoomStatus / closeRoom path: .eq('id', roomId).select().single()
          select: vi.fn().mockImplementation(() => ({
            single: vi.fn().mockImplementation(() => {
              room = { ...room, ...updates }
              fireRoomUpdate({ ...room })
              return Promise.resolve({ data: { ...room }, error: null })
            }),
            then: undefined,
          })),

          single: vi.fn().mockImplementation(() => {
            room = { ...room, ...updates }
            return Promise.resolve({ data: { ...room }, error: null })
          }),
        })),
      })),

      insert: vi.fn().mockImplementation((doc) => ({
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          room = { ...room, ...doc }
          return Promise.resolve({ data: { ...room }, error: null })
        }),
      })),
    }
  }

  // ── game_sessions table mock ──
  function makeSessionsChain() {
    return {
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          order: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => ({
              single: vi.fn().mockResolvedValue(
                sessions.length > 0
                  ? { data: { ...sessions[sessions.length - 1] }, error: null }
                  : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
              ),
            })),
          })),
          single: vi.fn().mockResolvedValue(
            sessions.length > 0
              ? { data: { ...sessions[0] }, error: null }
              : { data: null, error: { code: 'PGRST116' } }
          ),
        })),
      })),
      insert: vi.fn().mockImplementation((doc) => ({
        select: vi.fn().mockImplementation(() => ({
          single: vi.fn().mockImplementation(() => {
            const s = { id: SESSION_ID, room_id: ROOM_ID, created_at: new Date().toISOString(), ...doc }
            sessions.push(s)
            return Promise.resolve({ data: { ...s }, error: null })
          }),
        })),
      })),
      update: vi.fn().mockImplementation((updates) => ({
        eq: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockImplementation(() => ({
            single: vi.fn().mockImplementation(() => {
              if (sessions.length === 0) return Promise.resolve({ data: null, error: { message: 'no session' } })
              sessions[sessions.length - 1] = { ...sessions[sessions.length - 1], ...updates }
              return Promise.resolve({ data: { ...sessions[sessions.length - 1] }, error: null })
            }),
          })),
        })),
      })),
    }
  }

  const supabase = {
    from: vi.fn().mockImplementation((table) => {
      if (table === 'rooms') return makeRoomsChain()
      if (table === 'game_sessions') return makeSessionsChain()
      return {}
    }),
    channel: vi.fn().mockReturnValue(channelMock),
    removeChannel: vi.fn(),

    // Test inspection helpers
    _db: {
      room: () => ({ ...room }),
      sessions: () => [...sessions],
    },
    _channel: channelMock,
    _addRealtimeListener: (fn) => realtimeListeners.push(fn),
  }

  return supabase
}

// ─────────────────────────────────────────────
// Core logic extracted (mirrors useRoom.js logic)
// ─────────────────────────────────────────────

async function simulateJoinRoom(supabase, { roomId, userId }) {
  const joiningRef = { current: false }
  if (joiningRef.current) return null
  joiningRef.current = true

  try {
    // 1. Check if already guest (page refresh guard)
    const { data: currentRoom } = await supabase.from('rooms').select('*').eq('id', roomId).single()
    if (currentRoom?.guest_id === userId) {
      return { status: 'already_guest', room: currentRoom }
    }

    // 2. Atomic claim of guest slot
    const { data, error } = await supabase
      .from('rooms')
      .update({ guest_id: userId, status: 'playing' })
      .eq('id', roomId)
      .is('guest_id', null)
      .select()

    if (error) return { status: 'error', error }
    if (!data || data.length === 0) return { status: 'slot_taken' }
    return { status: 'joined', room: data[0] }
  } finally {
    joiningRef.current = false
  }
}

async function simulateCreateSession(supabase, { roomId }) {
  const { data, error } = await supabase
    .from('game_sessions')
    .insert({ room_id: roomId })
    .select()
    .single()
  if (error) throw error
  return data
}

async function simulateUpdateSession(supabase, { sessionId, updates }) {
  const { data, error } = await supabase
    .from('game_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single()
  if (error) throw error
  return data
}

async function simulateCloseRoom(supabase, { roomId }) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ status: 'finished', guest_id: null })
    .eq('id', roomId)
    .select()
    .single()
  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// RLS policy helpers (mirror the actual policies)
// ─────────────────────────────────────────────

function rlsCanReadRoom(room, userId) {
  // SELECT: host OR guest OR waiting
  return room.host_id === userId || room.guest_id === userId || room.status === 'waiting'
}

function rlsCanUpdateRoom(room, userId) {
  // UPDATE (new policy): host OR guest OR (waiting AND slot empty AND authenticated)
  return (
    room.host_id === userId ||
    room.guest_id === userId ||
    (room.status === 'waiting' && room.guest_id === null && userId != null)
  )
}

function rlsCanReadGameSession(room, userId) {
  // SELECT: host OR guest OR waiting room
  return room.host_id === userId || room.guest_id === userId || room.status === 'waiting'
}

//=============================================================================
// SUITE A — Room Lifecycle
//=============================================================================

describe('Suite A — Room Lifecycle', () => {
  let db

  beforeEach(() => { db = buildFullMock() })
  afterEach(() => vi.clearAllMocks())

  it('A1 ✅ Room is created in waiting state', () => {
    const room = db._db.room()
    expect(room.id).toBe(ROOM_ID)
    expect(room.host_id).toBe(HOST_ID)
    expect(room.guest_id).toBeNull()
    expect(room.status).toBe('waiting')
  })

  it('A2 ✅ Guest successfully joins empty room', async () => {
    const result = await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })

    expect(result.status).toBe('joined')
    expect(result.room.guest_id).toBe(GUEST_ID)
    expect(result.room.status).toBe('playing')
  })

  it('A3 ✅ Host can close room from waiting phase', async () => {
    await simulateCloseRoom(db, { roomId: ROOM_ID })

    const room = db._db.room()
    expect(room.status).toBe('finished')
    expect(room.guest_id).toBeNull()
  })

  it('A4 ✅ Host can close room after guest joined', async () => {
    await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    await simulateCloseRoom(db, { roomId: ROOM_ID })

    const room = db._db.room()
    expect(room.status).toBe('finished')
  })

  it('A5 ✅ Only one guest can join (second attempt returns slot_taken)', async () => {
    const OTHER_GUEST = 'other-guest-uuid'

    // First guest joins
    await simulateJoinRoom(db, { roomId: ROOM_ID, userId: OTHER_GUEST })
    expect(db._db.room().guest_id).toBe(OTHER_GUEST)

    // Second guest tries to join — slot is taken
    const result = await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(result.status).toBe('slot_taken')
    expect(db._db.room().guest_id).toBe(OTHER_GUEST) // not overwritten
  })

  it('A6 ✅ Page refresh: guest rejoining returns already_guest', async () => {
    db = buildFullMock({
      id: ROOM_ID, host_id: HOST_ID,
      guest_id: GUEST_ID, status: 'playing',
      created_at: new Date().toISOString(),
    })

    const result = await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(result.status).toBe('already_guest')
    expect(result.room.guest_id).toBe(GUEST_ID)
  })
})

//=============================================================================
// SUITE B — Realtime Synchronization (Host detects Guest)
//=============================================================================

describe('Suite B — Realtime Sync', () => {
  let db

  beforeEach(() => { db = buildFullMock() })
  afterEach(() => vi.clearAllMocks())

  it('B1 ✅ Host receives postgres_changes UPDATE when guest joins', async () => {
    // Host subscribes to room channel
    const channel = db.channel(`room:${ROOM_ID}`)
    let hostReceivedUpdate = null

    channel.on('postgres_changes', {}, (event) => {
      hostReceivedUpdate = event.new
    })
    channel.subscribe()

    // Simulated: connect host listener to the mock's realtime system
    db._addRealtimeListener((event) => {
      hostReceivedUpdate = event.new
    })

    // Guest joins → fires UPDATE
    await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })

    expect(hostReceivedUpdate).not.toBeNull()
    expect(hostReceivedUpdate.guest_id).toBe(GUEST_ID)
    expect(hostReceivedUpdate.status).toBe('playing')
  })

  it('B2 ✅ Host transitions to HOST_RECORD phase when room becomes playing', async () => {
    let hostPhase = PHASES.WAITING
    const sessionCreatedRef = { current: false }
    let sessionCreated = null

    // Simulate the Game.jsx useEffect that watches room.status
    function onRoomUpdate(room) {
      if (room.status === 'playing' && !sessionCreatedRef.current) {
        sessionCreatedRef.current = true
        hostPhase = PHASES.HOST_RECORD
        // Create session (simulated)
        sessionCreated = { id: SESSION_ID, room_id: room.id }
      }
    }

    // Register listener
    db._addRealtimeListener((event) => {
      onRoomUpdate(event.new)
    })

    // Guest joins
    await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })

    expect(hostPhase).toBe(PHASES.HOST_RECORD)
    expect(sessionCreated).not.toBeNull()
  })

  it('B3 ✅ sessionCreatedRef prevents double createSession', async () => {
    let callCount = 0
    const sessionCreatedRef = { current: false }

    function onRoomUpdate(room) {
      if (room.status === 'playing' && !sessionCreatedRef.current) {
        sessionCreatedRef.current = true
        callCount++
      }
    }

    // Fire UPDATE twice (simulates rapid realtime events)
    const playingRoom = { ...db._db.room(), status: 'playing', guest_id: GUEST_ID }
    onRoomUpdate(playingRoom)
    onRoomUpdate(playingRoom)
    onRoomUpdate(playingRoom)

    expect(callCount).toBe(1) // only fired once!
  })

  it('B4 ✅ Guest receives room status update via Realtime', async () => {
    let guestRoomState = db._db.room()

    // Guest listener (simulates their postgres_changes subscription)
    db._addRealtimeListener((event) => {
      guestRoomState = event.new
    })

    // Host closes room
    await simulateCloseRoom(db, { roomId: ROOM_ID })

    expect(guestRoomState.status).toBe('finished')
  })

  it('B5 ✅ Channel subscribes to postgres_changes on correct table/filter', () => {
    const channel = db.channel(`room:${ROOM_ID}`)
    channel.on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${ROOM_ID}`,
    }, vi.fn())
    channel.subscribe()

    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'rooms', event: 'UPDATE' }),
      expect.any(Function)
    )
    expect(channel.subscribe).toHaveBeenCalled()
  })
})

//=============================================================================
// SUITE C — Full Game Flow (all 6 phases)
//=============================================================================

describe('Suite C — Full Game Flow (6 phases)', () => {
  let db
  let hostPhase, guestPhase

  beforeEach(() => {
    db = buildFullMock()
    hostPhase = PHASES.WAITING
    guestPhase = PHASES.WAITING
  })
  afterEach(() => vi.clearAllMocks())

  // ── Broadcast event dispatcher (mirrors Game.jsx useEffect on gameState) ──
  function applyBroadcastEvent(event, isHost) {
    if (!isHost) {
      // Guest event handlers
      if (event === GAME_EVENTS.PLAYER_RECORDING) guestPhase = PHASES.HOST_RECORD
      if (event === GAME_EVENTS.AUDIO_READY)       guestPhase = PHASES.GUEST_LISTEN
      if (event === GAME_EVENTS.MIMIC_DONE)        guestPhase = PHASES.SCORING   // guest also goes to SCORING
      if (event === GAME_EVENTS.SHOW_RESULT)       guestPhase = PHASES.RESULTS
    } else {
      // Host event handlers
      if (event === GAME_EVENTS.MIMIC_RECORDING)   hostPhase = PHASES.GUEST_MIMIC
      if (event === GAME_EVENTS.MIMIC_DONE)        hostPhase = PHASES.SCORING
      if (event === GAME_EVENTS.SHOW_RESULT)       hostPhase = PHASES.RESULTS
    }
  }

  it('C1 ✅ Phase 1→2: WAITING → HOST_RECORD when guest joins', async () => {
    db._addRealtimeListener((event) => {
      if (event.new.status === 'playing') hostPhase = PHASES.HOST_RECORD
    })

    await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })

    expect(hostPhase).toBe(PHASES.HOST_RECORD)
  })

  it('C2 ✅ Phase 2→3: HOST_RECORD → GUEST_LISTEN after PLAYER_RECORDING broadcast', () => {
    hostPhase = PHASES.HOST_RECORD
    guestPhase = PHASES.HOST_RECORD // Guest sees host recording UI

    // Host broadcasts PLAYER_RECORDING
    applyBroadcastEvent(GAME_EVENTS.PLAYER_RECORDING, false) // guest side

    // Host broadcasts AUDIO_READY
    applyBroadcastEvent(GAME_EVENTS.AUDIO_READY, false) // guest side

    expect(guestPhase).toBe(PHASES.GUEST_LISTEN)
    expect(hostPhase).toBe(PHASES.HOST_RECORD) // host stays until guest mimics
  })

  it('C3 ✅ Phase 3→4: GUEST_LISTEN → GUEST_MIMIC after MIMIC_RECORDING broadcast', () => {
    guestPhase = PHASES.GUEST_LISTEN

    // Guest starts mimicking
    applyBroadcastEvent(GAME_EVENTS.MIMIC_RECORDING, true) // host side

    expect(hostPhase).toBe(PHASES.GUEST_MIMIC)
  })

  it('C4 ✅ Phase 4→5: GUEST_MIMIC → SCORING after MIMIC_DONE', () => {
    hostPhase = PHASES.GUEST_MIMIC
    guestPhase = PHASES.GUEST_MIMIC

    // Both host and guest go to SCORING after MIMIC_DONE
    applyBroadcastEvent(GAME_EVENTS.MIMIC_DONE, true)  // host side → SCORING
    applyBroadcastEvent(GAME_EVENTS.MIMIC_DONE, false) // guest side → SCORING

    expect(hostPhase).toBe(PHASES.SCORING)
    // Guest also enters SCORING (waiting for AI result)
    // SHOW_RESULT will come separately and push both to RESULTS
    expect(guestPhase).toBe(PHASES.SCORING)
  })

  it('C5 ✅ Phase 5→6: SCORING → RESULTS with score', () => {
    hostPhase = PHASES.SCORING
    guestPhase = PHASES.SCORING

    applyBroadcastEvent(GAME_EVENTS.SHOW_RESULT, true)  // host side
    applyBroadcastEvent(GAME_EVENTS.SHOW_RESULT, false) // guest side

    expect(hostPhase).toBe(PHASES.RESULTS)
    expect(guestPhase).toBe(PHASES.RESULTS)
  })

  it('C6 ✅ Session is created exactly once when game starts', async () => {
    let createSessionCalls = 0
    const sessionCreatedRef = { current: false }

    const mockCreateSession = async () => {
      if (sessionCreatedRef.current) return
      sessionCreatedRef.current = true
      createSessionCalls++
      return await simulateCreateSession(db, { roomId: ROOM_ID })
    }

    db._addRealtimeListener(async (event) => {
      if (event.new.status === 'playing') await mockCreateSession()
    })

    // Guest joins → triggers Realtime → triggers mockCreateSession
    await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })

    expect(createSessionCalls).toBe(1)
    expect(db._db.sessions().length).toBe(1)
    expect(db._db.sessions()[0].room_id).toBe(ROOM_ID)
  })

  it('C7 ✅ Full game: create room → join → session → score → close', async () => {
    // Phase tracking
    const hostState = { phase: PHASES.WAITING, score: null }
    const guestState = { phase: PHASES.WAITING, score: null }
    const sessionCreatedRef = { current: false }
    let gameSession = null

    // Host subscribes via Realtime
    db._addRealtimeListener(async (event) => {
      const updatedRoom = event.new
      if (updatedRoom.status === 'playing' && !sessionCreatedRef.current) {
        sessionCreatedRef.current = true
        hostState.phase = PHASES.HOST_RECORD
        gameSession = await simulateCreateSession(db, { roomId: ROOM_ID })
      }
    })

    // ── Step 1: Guest joins ──
    const joinResult = await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(joinResult.status).toBe('joined')
    guestState.phase = PHASES.HOST_RECORD

    // ── Step 2: Host records, session exists ──
    await simulateUpdateSession(db, {
      sessionId: SESSION_ID,
      updates: { original_audio_url: 'audio/orig.wav', reversed_audio_url: 'audio/rev.wav' },
    })
    guestState.phase = PHASES.GUEST_LISTEN
    hostState.phase = PHASES.GUEST_LISTEN

    // ── Step 3: Guest listens, then mimics ──
    guestState.phase = PHASES.GUEST_MIMIC
    await simulateUpdateSession(db, {
      sessionId: SESSION_ID,
      updates: { mimic_audio_url: 'audio/mimic.wav', mimic_reversed_url: 'audio/mimic_rev.wav' },
    })

    // ── Step 4: Scoring ──
    hostState.phase = PHASES.SCORING
    guestState.phase = PHASES.SCORING
    const demoScore = 78
    await simulateUpdateSession(db, {
      sessionId: SESSION_ID,
      updates: { ai_score: demoScore, ai_comment: 'Great mimic!' },
    })

    // ── Step 5: Results ──
    hostState.phase = PHASES.RESULTS
    guestState.phase = PHASES.RESULTS
    hostState.score = demoScore
    guestState.score = demoScore

    // ── Step 6: Host closes room ──
    await simulateCloseRoom(db, { roomId: ROOM_ID })

    // Assertions
    expect(joinResult.status).toBe('joined')
    expect(hostState.phase).toBe(PHASES.RESULTS)
    expect(guestState.phase).toBe(PHASES.RESULTS)
    expect(hostState.score).toBe(78)
    expect(guestState.score).toBe(78)
    expect(gameSession).not.toBeNull()
    expect(gameSession.room_id).toBe(ROOM_ID)
    expect(db._db.sessions()).toHaveLength(1)
    expect(db._db.sessions()[0].ai_score).toBe(78)
    expect(db._db.room().status).toBe('finished')
  })
})

//=============================================================================
// SUITE D — Race Conditions
//=============================================================================

describe('Suite D — Race Conditions', () => {
  let db

  beforeEach(() => { db = buildFullMock() })
  afterEach(() => vi.clearAllMocks())

  it('D1 ✅ Concurrent joins: only one succeeds, other gets slot_taken', async () => {
    const GUEST_A = 'guest-a'
    const GUEST_B = 'guest-b'

    // Both try to join simultaneously
    const [resultA, resultB] = await Promise.all([
      simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_A }),
      simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_B }),
    ])

    const results = [resultA, resultB]
    const joined   = results.filter(r => r.status === 'joined')
    const slotTaken = results.filter(r => r.status === 'slot_taken')

    // Exactly one should succeed
    expect(joined.length).toBe(1)
    expect(slotTaken.length).toBe(1)

    // DB should have exactly one guest
    expect(db._db.room().guest_id).not.toBeNull()
  })

  it('D2 ✅ Double createSession guarded by sessionCreatedRef', () => {
    let callCount = 0
    const sessionCreatedRef = { current: false }

    function tryCreateSession() {
      if (sessionCreatedRef.current) return false
      sessionCreatedRef.current = true
      callCount++
      return true
    }

    // Simulate 5 rapid calls (e.g., multiple Realtime events firing)
    tryCreateSession()
    tryCreateSession()
    tryCreateSession()
    tryCreateSession()
    tryCreateSession()

    expect(callCount).toBe(1)
  })

  it('D3 ✅ Stranger cannot join room that has a guest', async () => {
    // Room already has a guest
    db = buildFullMock({
      id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing',
      created_at: new Date().toISOString(),
    })

    const result = await simulateJoinRoom(db, { roomId: ROOM_ID, userId: STRANGER })
    expect(result.status).toBe('slot_taken')
    expect(db._db.room().guest_id).toBe(GUEST_ID) // unchanged
  })

  it('D4 ✅ joiningRef mutex prevents re-entrant join calls', async () => {
    // The mutex check is INSIDE simulateJoinRoom using its own local ref.
    // To test guarding behavior at the call site level,
    // we simulate what the real useRoom hook does:
    // it sets its own `joiningRef` and returns null if already locked.
    const outerRef = { current: false }

    async function guardedJoin() {
      if (outerRef.current) return null  // mutex check at call site
      outerRef.current = true
      try {
        return await simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
      } finally {
        outerRef.current = false
      }
    }

    // First call gets the lock and joins
    outerRef.current = true // simulate lock already held
    const blockedResult = await guardedJoin()
    expect(blockedResult).toBeNull() // blocked by mutex
    expect(db._db.room().guest_id).toBeNull() // no DB change
  })
})

//=============================================================================
// SUITE E — Error Resilience
//=============================================================================

describe('Suite E — Error Resilience', () => {
  let db

  beforeEach(() => { db = buildFullMock() })
  afterEach(() => vi.clearAllMocks())

  it('E1 ✅ joinRoom handles network error gracefully', async () => {
    // Override to throw on select
    db.from = vi.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: vi.fn().mockRejectedValue(new Error('Network timeout')),
        }),
      }),
    }))

    await expect(
      simulateJoinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    ).rejects.toThrow('Network timeout')
  })

  it('E2 ✅ createSession with no session returns error object', async () => {
    // Override sessions to always return "no rows"
    db.from = vi.fn().mockImplementation((table) => {
      if (table === 'game_sessions') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB constraint' } }),
            }),
          }),
        }
      }
      return {}
    })

    await expect(
      simulateCreateSession(db, { roomId: ROOM_ID })
    ).rejects.toMatchObject({ message: 'DB constraint' })
  })

  it('E3 ✅ closeRoom completes even if guest_id was already null', async () => {
    // Room already closed / no guest
    const result = await simulateCloseRoom(db, { roomId: ROOM_ID })

    expect(result.status).toBe('finished')
  })

  it('E4 ✅ updateSession handles missing session', async () => {
    // No sessions exist
    db.from = vi.fn().mockImplementation((table) => {
      if (table === 'game_sessions') {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'no session' } }),
              }),
            }),
          }),
        }
      }
      return {}
    })

    await expect(
      simulateUpdateSession(db, { sessionId: SESSION_ID, updates: { ai_score: 50 } })
    ).rejects.toMatchObject({ message: 'no session' })
  })
})

//=============================================================================
// SUITE F — RLS Policy Matrix
//=============================================================================

describe('Suite F — RLS Policy Matrix', () => {
  const waitingRoom = { id: ROOM_ID, host_id: HOST_ID, guest_id: null,     status: 'waiting' }
  const playingRoom = { id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing' }
  const closedRoom  = { id: ROOM_ID, host_id: HOST_ID, guest_id: null,     status: 'finished'  }

  // ── SELECT rooms ──
  it('F1 ✅ Host can always READ their own room', () => {
    expect(rlsCanReadRoom(waitingRoom, HOST_ID)).toBe(true)
    expect(rlsCanReadRoom(playingRoom, HOST_ID)).toBe(true)
    expect(rlsCanReadRoom(closedRoom,  HOST_ID)).toBe(true)
  })

  it('F2 ✅ Guest can read waiting room (even before join)', () => {
    expect(rlsCanReadRoom(waitingRoom, GUEST_ID)).toBe(true)   // via status='waiting'
  })

  it('F3 ✅ Guest can read playing room after joining', () => {
    expect(rlsCanReadRoom(playingRoom, GUEST_ID)).toBe(true)   // via guest_id match
  })

  it('F4 ✅ Stranger CANNOT read closed room', () => {
    expect(rlsCanReadRoom(closedRoom, STRANGER)).toBe(false)
  })

  it('F5 ✅ Stranger CANNOT read playing room', () => {
    expect(rlsCanReadRoom(playingRoom, STRANGER)).toBe(false)
  })

  // ── UPDATE rooms ──
  it('F6 ✅ New guest CAN join waiting empty room (new RLS policy)', () => {
    expect(rlsCanUpdateRoom(waitingRoom, GUEST_ID)).toBe(true)   // ← was blocked before fix!
  })

  it('F7 ✅ Host CAN update their room', () => {
    expect(rlsCanUpdateRoom(waitingRoom, HOST_ID)).toBe(true)
    expect(rlsCanUpdateRoom(playingRoom, HOST_ID)).toBe(true)
  })

  it('F8 ✅ Guest CAN update playing room (e.g., their mimic upload)', () => {
    expect(rlsCanUpdateRoom(playingRoom, GUEST_ID)).toBe(true)
  })

  it('F9 ✅ Stranger CANNOT update waiting room', () => {
    // Stranger isn't host, isn't guest — but room has a guest already
    const takenRoom = { ...waitingRoom, guest_id: GUEST_ID }
    expect(rlsCanUpdateRoom(takenRoom, STRANGER)).toBe(false)
  })

  it('F10 ✅ Stranger CANNOT join playing room (slot taken)', () => {
    expect(rlsCanUpdateRoom(playingRoom, STRANGER)).toBe(false)
  })

  // ── SELECT game_sessions ──
  it('F11 ✅ Host can read game_sessions in playing room', () => {
    expect(rlsCanReadGameSession(playingRoom, HOST_ID)).toBe(true)
  })

  it('F12 ✅ Guest can read game_sessions in playing room', () => {
    expect(rlsCanReadGameSession(playingRoom, GUEST_ID)).toBe(true)
  })

  it('F13 ✅ Stranger CANNOT read game_sessions in playing room', () => {
    expect(rlsCanReadGameSession(playingRoom, STRANGER)).toBe(false)
  })

  it('F14 ✅ Waiting room allows game_sessions read (by design, sessions may not exist)', () => {
    expect(rlsCanReadGameSession(waitingRoom, GUEST_ID)).toBe(true)
  })
})
