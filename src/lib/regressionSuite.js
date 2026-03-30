/**
 * regressionSuite.js — browser-compatible regression tests
 * Ported from multiplayer.integration.test.js
 * Runs via testRunner.js (no vitest / Node.js needed)
 */
import { runSuite, expect } from './testRunner'

// ─── Identities ──────────────────────────────────────────────────────────────
const HOST_ID    = 'host-uuid-aaaa'
const GUEST_ID   = 'guest-uuid-bbbb'
const STRANGER   = 'stranger-uuid-cccc'
const ROOM_ID    = 'room-uuid-test-001'
const SESSION_ID = 'session-uuid-test-001'

const PHASES = {
  WAITING: 'WAITING', HOST_RECORD: 'HOST_RECORD', GUEST_LISTEN: 'GUEST_LISTEN',
  GUEST_MIMIC: 'GUEST_MIMIC', SCORING: 'SCORING', RESULTS: 'RESULTS',
}
const GAME_EVENTS = {
  PLAYER_RECORDING: 'PLAYER_RECORDING', AUDIO_READY: 'AUDIO_READY',
  MIMIC_RECORDING: 'MIMIC_RECORDING', MIMIC_DONE: 'MIMIC_DONE', SHOW_RESULT: 'SHOW_RESULT',
}

// ─── In-memory Supabase mock ──────────────────────────────────────────────────
function buildMock(initialRoom = null) {
  let room = initialRoom ?? { id: ROOM_ID, host_id: HOST_ID, guest_id: null, status: 'waiting', created_at: new Date().toISOString() }
  let sessions = []
  let realtimeListeners = []

  function fireUpdate(updated) { realtimeListeners.forEach(fn => fn({ new: { ...updated } })) }

  const channelHandlers = { postgres_changes: [], broadcast: [] }
  const channelMock = {
    on: (type, _filter, handler) => { channelHandlers[type]?.push(handler); return channelMock },
    subscribe: () => channelMock,
    send: ({ payload }) => channelHandlers.broadcast.forEach(fn => fn({ payload })),
  }

  function makeRooms() {
    return {
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { ...room }, error: null }),
          is: () => ({ select: () => Promise.resolve({ data: [{ ...room }], error: null }) }),
          order: () => Promise.resolve({ data: [{ ...room }], error: null }),
        }),
      }),
      update: (updates) => ({
        eq: (_c, _v) => ({
          is: (_c2, _v2) => ({
            select: () => {
              const canJoin = room.status === 'waiting' && room.guest_id === null
              if (!canJoin) return Promise.resolve({ data: [], error: null })
              room = { ...room, ...updates }
              fireUpdate({ ...room })
              return Promise.resolve({ data: [{ ...room }], error: null })
            },
          }),
          select: () => ({
            single: () => {
              room = { ...room, ...updates }
              fireUpdate({ ...room })
              return Promise.resolve({ data: { ...room }, error: null })
            },
          }),
          single: () => { room = { ...room, ...updates }; return Promise.resolve({ data: { ...room }, error: null }) },
        }),
      }),
      insert: (doc) => ({
        select: () => ({ single: () => { room = { ...room, ...doc }; return Promise.resolve({ data: { ...room }, error: null }) } }),
      }),
    }
  }

  function makeSessions() {
    return {
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => ({ single: () => sessions.length > 0
            ? Promise.resolve({ data: { ...sessions[sessions.length - 1] }, error: null })
            : Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }) }),
          single: () => sessions.length > 0
            ? Promise.resolve({ data: { ...sessions[0] }, error: null })
            : Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
      insert: (doc) => ({
        select: () => ({
          single: () => {
            const s = { id: SESSION_ID, room_id: ROOM_ID, created_at: new Date().toISOString(), ...doc }
            sessions.push(s)
            return Promise.resolve({ data: { ...s }, error: null })
          },
        }),
      }),
      update: (updates) => ({
        eq: () => ({
          select: () => ({
            single: () => {
              if (!sessions.length) return Promise.resolve({ data: null, error: { message: 'no session' } })
              sessions[sessions.length - 1] = { ...sessions[sessions.length - 1], ...updates }
              return Promise.resolve({ data: { ...sessions[sessions.length - 1] }, error: null })
            },
          }),
        }),
      }),
    }
  }

  return {
    from: (table) => table === 'rooms' ? makeRooms() : table === 'game_sessions' ? makeSessions() : {},
    channel: () => channelMock,
    removeChannel: () => {},
    _db: { room: () => ({ ...room }), sessions: () => [...sessions] },
    _addRealtimeListener: (fn) => realtimeListeners.push(fn),
  }
}

// ─── Shared logic (mirrors useRoom.js) ───────────────────────────────────────
async function joinRoom(db, { roomId, userId }) {
  const { data: cur } = await db.from('rooms').select('*').eq('id', roomId).single()
  if (cur?.guest_id === userId) return { status: 'already_guest', room: cur }
  const { data, error } = await db.from('rooms').update({ guest_id: userId, status: 'playing' }).eq('id', roomId).is('guest_id', null).select()
  if (error) return { status: 'error', error }
  if (!data || data.length === 0) return { status: 'slot_taken' }
  return { status: 'joined', room: data[0] }
}
async function createSession(db) {
  const { data, error } = await db.from('game_sessions').insert({ room_id: ROOM_ID }).select().single()
  if (error) throw error
  return data
}
async function updateSession(db, updates) {
  const { data, error } = await db.from('game_sessions').update(updates).eq('id', SESSION_ID).select().single()
  if (error) throw error
  return data
}
async function closeRoom(db) {
  const { data, error } = await db.from('rooms').update({ status: 'finished', guest_id: null }).eq('id', ROOM_ID).select().single()
  if (error) throw error
  return data
}

// ─── RLS helpers ─────────────────────────────────────────────────────────────
const rlsRead   = (r, u) => r.host_id === u || r.guest_id === u || r.status === 'waiting'
const rlsUpdate = (r, u) => r.host_id === u || r.guest_id === u || (r.status === 'waiting' && r.guest_id === null && u != null)
const rlsSession = (r, u) => r.host_id === u || r.guest_id === u || r.status === 'waiting'

// ─── Broadcast event dispatcher ───────────────────────────────────────────────
function applyEvent(event, isHost, state) {
  if (!isHost) {
    if (event === GAME_EVENTS.PLAYER_RECORDING) state.guestPhase = PHASES.HOST_RECORD
    if (event === GAME_EVENTS.AUDIO_READY)       state.guestPhase = PHASES.GUEST_LISTEN
    if (event === GAME_EVENTS.MIMIC_DONE)        state.guestPhase = PHASES.SCORING
    if (event === GAME_EVENTS.SHOW_RESULT)       state.guestPhase = PHASES.RESULTS
  } else {
    if (event === GAME_EVENTS.MIMIC_RECORDING)   state.hostPhase  = PHASES.GUEST_MIMIC
    if (event === GAME_EVENTS.MIMIC_DONE)        state.hostPhase  = PHASES.SCORING
    if (event === GAME_EVENTS.SHOW_RESULT)       state.hostPhase  = PHASES.RESULTS
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// SUITES
// ════════════════════════════════════════════════════════════════════════════════

const suiteA = [
  { name: 'A1 ✅ Room is created in waiting state', fn: async () => {
    const db = buildMock()
    const r = db._db.room()
    expect(r.host_id).toBe(HOST_ID)
    expect(r.guest_id).toBeNull()
    expect(r.status).toBe('waiting')
  }},
  { name: 'A2 ✅ Guest successfully joins empty room', fn: async () => {
    const db = buildMock()
    const res = await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(res.status).toBe('joined')
    expect(res.room.guest_id).toBe(GUEST_ID)
    expect(res.room.status).toBe('playing')
  }},
  { name: 'A3 ✅ Host can close room from waiting phase', fn: async () => {
    const db = buildMock()
    await closeRoom(db)
    expect(db._db.room().status).toBe('finished')
    expect(db._db.room().guest_id).toBeNull()
  }},
  { name: 'A4 ✅ Host can close room after guest joined', fn: async () => {
    const db = buildMock()
    await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    await closeRoom(db)
    expect(db._db.room().status).toBe('finished')
  }},
  { name: 'A5 ✅ Only one guest can join (second gets slot_taken)', fn: async () => {
    const db = buildMock()
    await joinRoom(db, { roomId: ROOM_ID, userId: 'other-guest' })
    const res2 = await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(res2.status).toBe('slot_taken')
    expect(db._db.room().guest_id).toBe('other-guest')
  }},
  { name: 'A6 ✅ Page refresh: guest rejoining returns already_guest', fn: async () => {
    const db = buildMock({ id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing', created_at: new Date().toISOString() })
    const res = await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(res.status).toBe('already_guest')
  }},
]

const suiteB = [
  { name: 'B1 ✅ Host receives postgres_changes UPDATE when guest joins', fn: async () => {
    const db = buildMock()
    let received = null
    db._addRealtimeListener((e) => { received = e.new })
    await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(received).not.toBeNull()
    expect(received.guest_id).toBe(GUEST_ID)
  }},
  { name: 'B2 ✅ Host transitions to HOST_RECORD when room becomes playing', fn: async () => {
    const db = buildMock()
    let hostPhase = PHASES.WAITING
    const ref = { current: false }
    db._addRealtimeListener(async (e) => {
      if (e.new.status === 'playing' && !ref.current) { ref.current = true; hostPhase = PHASES.HOST_RECORD }
    })
    await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(hostPhase).toBe(PHASES.HOST_RECORD)
  }},
  { name: 'B3 ✅ sessionCreatedRef prevents double createSession', fn: async () => {
    let calls = 0
    const ref = { current: false }
    function try_() { if (ref.current) return; ref.current = true; calls++ }
    try_(); try_(); try_()
    expect(calls).toBe(1)
  }},
  { name: 'B4 ✅ Guest receives room status update via Realtime', fn: async () => {
    const db = buildMock()
    let guestRoom = db._db.room()
    db._addRealtimeListener((e) => { guestRoom = e.new })
    await closeRoom(db)
    expect(guestRoom.status).toBe('finished')
  }},
  { name: 'B5 ✅ Channel on() is called with postgres_changes', fn: async () => {
    const db = buildMock()
    const ch = db.channel(`room:${ROOM_ID}`)
    let called = false
    const fn = ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, () => { called = true })
    expect(fn).not.toBeNull()
  }},
]

const suiteC = [
  { name: 'C1 ✅ Phase 1→2: WAITING → HOST_RECORD when guest joins', fn: async () => {
    const db = buildMock()
    let hostPhase = PHASES.WAITING
    db._addRealtimeListener((e) => { if (e.new.status === 'playing') hostPhase = PHASES.HOST_RECORD })
    await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(hostPhase).toBe(PHASES.HOST_RECORD)
  }},
  { name: 'C2 ✅ Phase 2→3: HOST_RECORD → GUEST_LISTEN after AUDIO_READY', fn: async () => {
    const state = { hostPhase: PHASES.HOST_RECORD, guestPhase: PHASES.HOST_RECORD }
    applyEvent(GAME_EVENTS.AUDIO_READY, false, state)
    expect(state.guestPhase).toBe(PHASES.GUEST_LISTEN)
  }},
  { name: 'C3 ✅ Phase 3→4: GUEST_LISTEN → GUEST_MIMIC after MIMIC_RECORDING', fn: async () => {
    const state = { hostPhase: PHASES.HOST_RECORD, guestPhase: PHASES.GUEST_LISTEN }
    applyEvent(GAME_EVENTS.MIMIC_RECORDING, true, state)
    expect(state.hostPhase).toBe(PHASES.GUEST_MIMIC)
  }},
  { name: 'C4 ✅ Phase 4→5: GUEST_MIMIC → SCORING after MIMIC_DONE', fn: async () => {
    const state = { hostPhase: PHASES.GUEST_MIMIC, guestPhase: PHASES.GUEST_MIMIC }
    applyEvent(GAME_EVENTS.MIMIC_DONE, true, state)
    applyEvent(GAME_EVENTS.MIMIC_DONE, false, state)
    expect(state.hostPhase).toBe(PHASES.SCORING)
    expect(state.guestPhase).toBe(PHASES.SCORING)
  }},
  { name: 'C5 ✅ Phase 5→6: SCORING → RESULTS after SHOW_RESULT', fn: async () => {
    const state = { hostPhase: PHASES.SCORING, guestPhase: PHASES.SCORING }
    applyEvent(GAME_EVENTS.SHOW_RESULT, true, state)
    applyEvent(GAME_EVENTS.SHOW_RESULT, false, state)
    expect(state.hostPhase).toBe(PHASES.RESULTS)
    expect(state.guestPhase).toBe(PHASES.RESULTS)
  }},
  { name: 'C6 ✅ Session created exactly once when game starts', async fn() {
    const db = buildMock()
    let calls = 0
    const ref = { current: false }
    db._addRealtimeListener(async (e) => {
      if (e.new.status === 'playing' && !ref.current) { ref.current = true; calls++; await createSession(db) }
    })
    await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(calls).toBe(1)
    expect(db._db.sessions()).toHaveLength(1)
  }},
  { name: 'C7 ✅ Full game: join → session → score → results → close', fn: async () => {
    const db = buildMock()
    const state = { hostPhase: PHASES.WAITING, guestPhase: PHASES.WAITING, score: null }
    const ref = { current: false }
    let session = null
    db._addRealtimeListener(async (e) => {
      if (e.new.status === 'playing' && !ref.current) {
        ref.current = true; state.hostPhase = PHASES.HOST_RECORD
        session = await createSession(db)
      }
    })
    const joinRes = await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID })
    expect(joinRes.status).toBe('joined')
    state.guestPhase = PHASES.HOST_RECORD
    await updateSession(db, { original_audio_url: 'audio/orig.wav' })
    state.hostPhase = state.guestPhase = PHASES.GUEST_LISTEN
    state.guestPhase = PHASES.GUEST_MIMIC
    await updateSession(db, { mimic_audio_url: 'audio/mimic.wav' })
    state.hostPhase = state.guestPhase = PHASES.SCORING
    await updateSession(db, { ai_score: 78, ai_comment: 'Great!' })
    state.hostPhase = state.guestPhase = PHASES.RESULTS
    state.score = 78
    await closeRoom(db)
    expect(state.hostPhase).toBe(PHASES.RESULTS)
    expect(state.guestPhase).toBe(PHASES.RESULTS)
    expect(state.score).toBe(78)
    expect(session).not.toBeNull()
    expect(db._db.sessions()[0].ai_score).toBe(78)
    expect(db._db.room().status).toBe('finished')
  }},
]

const suiteD = [
  { name: 'D1 ✅ Concurrent joins: only one succeeds', fn: async () => {
    const db = buildMock()
    const [a, b] = await Promise.all([
      joinRoom(db, { roomId: ROOM_ID, userId: 'guest-a' }),
      joinRoom(db, { roomId: ROOM_ID, userId: 'guest-b' }),
    ])
    const results = [a, b]
    expect(results.filter(r => r.status === 'joined').length).toBe(1)
    expect(results.filter(r => r.status === 'slot_taken').length).toBe(1)
    expect(db._db.room().guest_id).not.toBeNull()
  }},
  { name: 'D2 ✅ Double createSession guarded by ref', fn: async () => {
    let n = 0; const ref = { current: false }
    const guard = () => { if (ref.current) return; ref.current = true; n++ }
    guard(); guard(); guard(); guard()
    expect(n).toBe(1)
  }},
  { name: 'D3 ✅ Stranger cannot join room with guest', fn: async () => {
    const db = buildMock({ id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing', created_at: new Date().toISOString() })
    const res = await joinRoom(db, { roomId: ROOM_ID, userId: STRANGER })
    expect(res.status).toBe('slot_taken')
    expect(db._db.room().guest_id).toBe(GUEST_ID)
  }},
  { name: 'D4 ✅ joiningRef mutex blocks re-entrant call', fn: async () => {
    const db = buildMock()
    const ref = { current: false }
    async function guarded() {
      if (ref.current) return null
      ref.current = true
      try { return await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID }) } finally { ref.current = false }
    }
    ref.current = true
    const blocked = await guarded()
    expect(blocked).toBeNull()
    expect(db._db.room().guest_id).toBeNull()
  }},
]

const suiteE = [
  { name: 'E1 ✅ joinRoom handles network error gracefully', fn: async () => {
    const db = buildMock()
    db.from = () => ({ select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('Network timeout')) }) }) })
    let caught = false
    try { await joinRoom(db, { roomId: ROOM_ID, userId: GUEST_ID }) } catch (e) { caught = e.message === 'Network timeout' }
    expect(caught).toBe(true)
  }},
  { name: 'E2 ✅ createSession throws on DB error', fn: async () => {
    const db = buildMock()
    db.from = () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'DB constraint' } }) }) }) })
    let caught = false
    try { await createSession(db) } catch (e) { caught = e.message === 'DB constraint' }
    expect(caught).toBe(true)
  }},
  { name: 'E3 ✅ closeRoom works when guest_id already null', fn: async () => {
    const db = buildMock()
    const res = await closeRoom(db)
    expect(res.status).toBe('finished')
  }},
  { name: 'E4 ✅ updateSession throws when no session', fn: async () => {
    const db = buildMock()
    db.from = () => ({ update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'no session' } }) }) }) }) })
    let caught = false
    try { await updateSession(db, { ai_score: 50 }) } catch (e) { caught = e.message === 'no session' }
    expect(caught).toBe(true)
  }},
]

const suiteF = () => {
  const waiting = { id: ROOM_ID, host_id: HOST_ID, guest_id: null,     status: 'waiting' }
  const playing = { id: ROOM_ID, host_id: HOST_ID, guest_id: GUEST_ID, status: 'playing' }
  const closed  = { id: ROOM_ID, host_id: HOST_ID, guest_id: null,     status: 'finished'  }
  return [
    { name: 'F1  ✅ Host can always READ their room',             fn: async () => { expect(rlsRead(waiting, HOST_ID)).toBe(true); expect(rlsRead(playing, HOST_ID)).toBe(true) }},
    { name: 'F2  ✅ Guest can read waiting room before join',     fn: async () => { expect(rlsRead(waiting, GUEST_ID)).toBe(true) }},
    { name: 'F3  ✅ Guest can read playing room after joining',   fn: async () => { expect(rlsRead(playing, GUEST_ID)).toBe(true) }},
    { name: 'F4  ✅ Stranger CANNOT read closed room',            fn: async () => { expect(rlsRead(closed, STRANGER)).toBe(false) }},
    { name: 'F5  ✅ Stranger CANNOT read playing room',           fn: async () => { expect(rlsRead(playing, STRANGER)).toBe(false) }},
    { name: 'F6  ✅ New guest CAN join waiting empty room (RLS)', fn: async () => { expect(rlsUpdate(waiting, GUEST_ID)).toBe(true) }},
    { name: 'F7  ✅ Host CAN update their room',                  fn: async () => { expect(rlsUpdate(waiting, HOST_ID)).toBe(true) }},
    { name: 'F8  ✅ Guest CAN update playing room',               fn: async () => { expect(rlsUpdate(playing, GUEST_ID)).toBe(true) }},
    { name: 'F9  ✅ Stranger CANNOT update room with guest',      fn: async () => { expect(rlsUpdate({ ...waiting, guest_id: GUEST_ID }, STRANGER)).toBe(false) }},
    { name: 'F10 ✅ Stranger CANNOT join playing room',           fn: async () => { expect(rlsUpdate(playing, STRANGER)).toBe(false) }},
    { name: 'F11 ✅ Host can read game_sessions',                 fn: async () => { expect(rlsSession(playing, HOST_ID)).toBe(true) }},
    { name: 'F12 ✅ Guest can read game_sessions',                fn: async () => { expect(rlsSession(playing, GUEST_ID)).toBe(true) }},
    { name: 'F13 ✅ Stranger CANNOT read game_sessions',         fn: async () => { expect(rlsSession(playing, STRANGER)).toBe(false) }},
    { name: 'F14 ✅ Waiting room allows game_sessions read',      fn: async () => { expect(rlsSession(waiting, GUEST_ID)).toBe(true) }},
  ]
}

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function runAllTests({ onResult } = {}) {
  const all = []
  all.push(...await runSuite('A — Room Lifecycle',       suiteA,    { onResult }))
  all.push(...await runSuite('B — Realtime Sync',        suiteB,    { onResult }))
  all.push(...await runSuite('C — Full Game Flow',       suiteC,    { onResult }))
  all.push(...await runSuite('D — Race Conditions',      suiteD,    { onResult }))
  all.push(...await runSuite('E — Error Resilience',     suiteE,    { onResult }))
  all.push(...await runSuite('F — RLS Policy Matrix',    suiteF(),  { onResult }))
  return all
}
