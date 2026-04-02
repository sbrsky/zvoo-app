import { useState, useEffect, useRef } from 'react'
import { useLogs } from '../context/LogContext'
import { useAuth } from '../hooks/useAuth'
import logger from '../lib/logger'
import TestRunner from '../components/admin/TestRunner'

const TABS = [
  { key: 'logs',    label: '📋 Логи',     desc: 'Console & application logs' },
  { key: 'network', label: '🌐 Network',  desc: 'HTTP requests' },
  { key: 'events',  label: '⚡ Events',   desc: 'Realtime & bus events' },
  { key: 'state',   label: '📊 State',    desc: 'Auth & room state' },
  { key: 'ai',      label: '🤖 AI Logs',  desc: 'Gemini scoring history' },
  { key: 'tests',   label: '🧪 Тесты',   desc: 'Regression suite' },
  { key: 'settings',label: '⚙️ Настройки',desc: 'App settings' },
]

const LEVEL_COLORS = {
  DEBUG:   { bg: 'rgba(255,255,255,0.05)', text: 'rgba(255,255,255,0.5)', badge: 'rgba(255,255,255,0.08)' },
  INFO:    { bg: 'rgba(6,182,212,0.05)',   text: '#7EEEE4',              badge: 'rgba(6,182,212,0.15)' },
  WARN:    { bg: 'rgba(245,158,11,0.05)',  text: '#FBBF24',              badge: 'rgba(245,158,11,0.15)' },
  ERROR:   { bg: 'rgba(239,68,68,0.05)',   text: '#FCA5A5',              badge: 'rgba(239,68,68,0.15)' },
  NETWORK: { bg: 'rgba(124,58,237,0.05)',  text: '#4DD9C8',              badge: 'rgba(124,58,237,0.15)' },
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export default function Admin() {
  const { logs, clear } = useLogs()
  const { user, profile } = useAuth()
  const [tab, setTab] = useState('logs')
  const [levelFilter, setLevelFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const bottomRef = useRef(null)

  // AI Admin settings state
  const [geminiModel, setGeminiModel] = useState('gemini-2.0-flash')
  const [savedModel, setSavedModel] = useState('gemini-2.0-flash')
  const [savingModel, setSavingModel] = useState(false)

  // AI Logs state
  const [aiLogs, setAiLogs] = useState([])
  const [aiLogsLoading, setAiLogsLoading] = useState(false)
  const [aiLogsFilter, setAiLogsFilter] = useState('ALL') // ALL | ok | error | timeout | fallback
  const [aiLogExpanded, setAiLogExpanded] = useState(null)

  useEffect(() => {
    const fetchSettings = async () => {
      const { supabase } = await import('../lib/supabase')
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'gemini_model')
        .maybeSingle()
      if (error) { console.error('fetchSettings error:', error); return }
      if (data && data.value !== undefined) {
        const raw = String(data.value)
        const val = raw.replace(/^"|"$/g, '').trim()
        if (val) { setGeminiModel(val); setSavedModel(val) }
      }
    }
    fetchSettings()

    // Fetch AI Logs when that tab is active
    if (tab === 'ai') {
      setAiLogsLoading(true)
      import('../lib/supabase').then(({ supabase }) => {
        supabase
          .from('ai_scoring_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100)
          .then(({ data, error }) => {
            if (error) console.error('AI logs fetch error:', error)
            else setAiLogs(data || [])
            setAiLogsLoading(false)
          })
      })
    }
  }, [tab])

  const handleSaveModel = async () => {
    setSavingModel(true)
    try {
      const { supabase } = await import('../lib/supabase')
      // JSONB column requires a valid JSON value — plain string in quotes
      const jsonValue = `"${geminiModel}"`
      const { error } = await supabase
        .from('app_settings')
        .update({ value: jsonValue })
        .eq('key', 'gemini_model')
      if (error) throw error
      setSavedModel(geminiModel)
      console.log('Saved AI model:', geminiModel)
    } catch (err) {
      console.error('Failed to save AI model setting:', err)
      alert('Ошибка при сохранении модели: ' + err.message)
    } finally {
      setSavingModel(false)
    }
  }

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll, tab])

  // Filter logs
  const filteredLogs = logs.filter(l => {
    if (tab === 'network' && l.level !== 'NETWORK') return false
    if (tab === 'logs' && l.level === 'NETWORK') return false
    if (tab === 'events' && !(l.source === 'eventBus' || l.source === 'supabase' || l.source?.includes('room'))) return false
    if (levelFilter !== 'ALL' && l.level !== levelFilter) return false
    if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const networkLogs = logs.filter(l => l.level === 'NETWORK')

  return (
    <div style={{ minHeight: '100vh', padding: '88px 20px 40px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: 'white', margin: '0 0 4px' }}>🛠 Админ-панель</h1>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', margin: 0 }}>
            Real-time логи, сеть, состояние приложения
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{
            padding: '6px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
            background: 'rgba(16,185,129,0.12)', color: '#10B981',
          }}>
            📊 {logs.length} записей
          </span>
          <button onClick={clear} style={{
            padding: '6px 14px', borderRadius: '10px', border: 'none', fontSize: '12px', fontWeight: 600,
            background: 'rgba(239,68,68,0.12)', color: '#FCA5A5', cursor: 'pointer',
          }}>🗑 Очистить</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: '4px', marginBottom: '16px', padding: '4px',
        borderRadius: '14px', background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: '10px', border: 'none',
              background: tab === t.key ? 'rgba(124,58,237,0.2)' : 'transparent',
              color: tab === t.key ? 'white' : 'rgba(255,255,255,0.45)',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      {(tab === 'logs' || tab === 'network') && (
        <div style={{
          display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center',
        }}>
          {/* Level filter (logs tab only) */}
          {tab === 'logs' && (
            <div style={{ display: 'flex', gap: '4px' }}>
              {['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map(lv => (
                <button
                  key={lv}
                  onClick={() => setLevelFilter(lv)}
                  style={{
                    padding: '5px 10px', borderRadius: '8px', border: 'none', fontSize: '11px', fontWeight: 700,
                    background: levelFilter === lv ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.05)',
                    color: levelFilter === lv ? '#4DD9C8' : 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                  }}
                >{lv}</button>
              ))}
            </div>
          )}
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Поиск..."
            style={{
              flex: 1, minWidth: '140px', padding: '8px 12px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'white', fontSize: '12px', outline: 'none',
            }}
          />
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            style={{
              padding: '6px 12px', borderRadius: '8px', border: 'none', fontSize: '11px', fontWeight: 600,
              background: autoScroll ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
              color: autoScroll ? '#10B981' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
            }}
          >{autoScroll ? '⬇ Auto-scroll ON' : '⬇ Auto-scroll OFF'}</button>
        </div>
      )}

      {/* Content */}
      <div style={{
        borderRadius: '16px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.07)',
        overflow: 'hidden',
      }}>
        {/* LOGS TAB */}
        {(tab === 'logs' || tab === 'events') && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '4px' }}>
            {filteredLogs.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '14px' }}>
                {tab === 'events' ? '⚡ Нет событий' : '📋 Нет логов'}
              </div>
            ) : (
              filteredLogs.map(log => {
                const colors = LEVEL_COLORS[log.level] || LEVEL_COLORS.DEBUG
                const expanded = expandedId === log.id
                return (
                  <div
                    key={log.id}
                    onClick={() => setExpandedId(expanded ? null : log.id)}
                    style={{
                      padding: '8px 12px', margin: '2px',
                      borderRadius: '8px', cursor: 'pointer',
                      background: expanded ? colors.bg : 'transparent',
                      borderLeft: `3px solid ${colors.text}`,
                      transition: 'background 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Time */}
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', flexShrink: 0 }}>
                        {formatTime(log.timestamp)}
                      </span>
                      {/* Level badge */}
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
                        background: colors.badge, color: colors.text,
                      }}>{log.level}</span>
                      {/* Source */}
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>
                        [{log.source}]
                      </span>
                      {/* Message */}
                      <span style={{
                        fontSize: '12px', color: colors.text, flex: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap',
                        fontFamily: 'monospace', wordBreak: 'break-all',
                      }}>{log.message}</span>
                    </div>
                    {/* Expanded data */}
                    {expanded && log.data && (
                      <pre style={{
                        marginTop: '8px', padding: '10px', borderRadius: '8px',
                        background: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.6)',
                        fontSize: '11px', fontFamily: 'monospace', overflow: 'auto',
                        maxHeight: '200px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      }}>
                        {typeof log.data === 'object' ? JSON.stringify(log.data, null, 2) : String(log.data)}
                      </pre>
                    )}
                    {/* Stack trace */}
                    {expanded && log.stack && (
                      <pre style={{
                        marginTop: '4px', padding: '8px', borderRadius: '6px',
                        background: 'rgba(239,68,68,0.08)', color: 'rgba(239,68,68,0.6)',
                        fontSize: '10px', fontFamily: 'monospace', overflow: 'auto',
                        maxHeight: '120px', whiteSpace: 'pre-wrap',
                      }}>{log.stack}</pre>
                    )}
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* NETWORK TAB */}
        {tab === 'network' && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '80px 1fr 80px 90px 80px',
              padding: '10px 16px', background: 'rgba(255,255,255,0.04)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em',
            }}>
              <span>METHOD</span>
              <span>URL</span>
              <span>STATUS</span>
              <span>DURATION</span>
              <span>RESULT</span>
            </div>
            {filteredLogs.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '14px' }}>
                🌐 Нет сетевых запросов
              </div>
            ) : (
              filteredLogs.map(log => {
                const d = log.data || {}
                const statusColor = d.ok ? '#10B981' : d.status >= 400 ? '#EF4444' : '#FBBF24'
                const expanded = expandedId === log.id
                return (
                  <div
                    key={log.id}
                    onClick={() => setExpandedId(expanded ? null : log.id)}
                    style={{
                      display: 'grid', gridTemplateColumns: '80px 1fr 80px 90px 80px',
                      padding: '8px 16px', cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: expanded ? 'rgba(124,58,237,0.05)' : 'transparent',
                      transition: 'background 0.15s',
                      fontSize: '12px', fontFamily: 'monospace', alignItems: 'center',
                    }}
                  >
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '11px',
                      background: d.method === 'POST' ? 'rgba(245,158,11,0.15)' : d.method === 'DELETE' ? 'rgba(239,68,68,0.15)' : 'rgba(6,182,212,0.15)',
                      color: d.method === 'POST' ? '#FBBF24' : d.method === 'DELETE' ? '#FCA5A5' : '#7EEEE4',
                      width: 'fit-content',
                    }}>{d.method || '?'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.url?.replace(/https?:\/\/[^/]+/, '') || log.message}
                    </span>
                    <span style={{ color: statusColor, fontWeight: 700 }}>{d.status || '—'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>{d.duration ? `${d.duration}ms` : '—'}</span>
                    <span style={{ color: d.ok ? '#10B981' : '#EF4444' }}>{d.ok ? '✅' : '❌'}</span>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* STATE TAB */}
        {tab === 'state' && (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Auth state */}
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', marginBottom: '8px', margin: '0 0 8px' }}>
                🔐 AUTH STATE
              </p>
              <pre style={{
                padding: '12px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.6)', fontSize: '11px', fontFamily: 'monospace',
                overflow: 'auto', whiteSpace: 'pre-wrap',
              }}>
                {JSON.stringify({ user: user ? { id: user.id, email: user.email } : null, profile }, null, 2)}
              </pre>
            </div>

            {/* Connection state */}
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', marginBottom: '8px', margin: '0 0 8px' }}>
                🌐 CONNECTION
              </p>
              <div style={{
                padding: '12px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: navigator.onLine ? '#10B981' : '#EF4444',
                  boxShadow: `0 0 8px ${navigator.onLine ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
                }} />
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                  {navigator.onLine ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            {/* Logger stats */}
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', marginBottom: '8px', margin: '0 0 8px' }}>
                📊 LOGGER STATS
              </p>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px',
              }}>
                {['DEBUG', 'INFO', 'WARN', 'ERROR', 'NETWORK'].map(lv => {
                  const count = logs.filter(l => l.level === lv).length
                  const colors = LEVEL_COLORS[lv]
                  return (
                    <div key={lv} style={{
                      padding: '12px', borderRadius: '10px',
                      background: colors.bg, border: `1px solid ${colors.badge}`,
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: colors.text }}>{count}</div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>{lv}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        {/* AI LOGS TAB */}
        {tab === 'ai' && (
          <div style={{ padding: '16px' }}>
            {/* Filter bar */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {['ALL','ok','error','timeout','fallback'].map(f => (
                <button key={f} onClick={() => setAiLogsFilter(f)} style={{
                  padding: '5px 12px', borderRadius: '8px', border: 'none', fontSize: '11px', fontWeight: 700,
                  background: aiLogsFilter === f ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.05)',
                  color: aiLogsFilter === f ? '#4DD9C8' : 'rgba(255,255,255,0.4)', cursor: 'pointer',
                }}>{f.toUpperCase()}</button>
              ))}
              <button onClick={() => {
                setAiLogsLoading(true)
                import('../lib/supabase').then(({ supabase }) => {
                  supabase.from('ai_scoring_logs').select('*').order('created_at', { ascending: false }).limit(100)
                    .then(({ data }) => { setAiLogs(data || []); setAiLogsLoading(false) })
                })
              }} style={{
                padding: '5px 12px', borderRadius: '8px', border: 'none', fontSize: '11px', fontWeight: 700,
                background: 'rgba(16,185,129,0.12)', color: '#10B981', cursor: 'pointer', marginLeft: 'auto',
              }}>🔄 Обновить</button>
            </div>

            {aiLogsLoading ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Загрузка логов...</div>
            ) : aiLogs.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '14px' }}>🤖 Нет AI логов. Сыграйте раунд!</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '65vh', overflowY: 'auto' }}>
                {aiLogs
                  .filter(l => aiLogsFilter === 'ALL' || l.status === aiLogsFilter)
                  .map(log => {
                    const statusColors = {
                      ok:      { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', badge: '#10B981' },
                      error:   { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.3)',  badge: '#EF4444' },
                      timeout: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', badge: '#F59E0B' },
                      fallback:{ bg: 'rgba(167,139,250,0.08)',border: 'rgba(167,139,250,0.3)',badge: '#A78BFA' },
                    }
                    const c = statusColors[log.status] || statusColors.error
                    const expanded = aiLogExpanded === log.id
                    const created = new Date(log.created_at)
                    const timeStr = created.toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    return (
                      <div key={log.id}
                        onClick={() => setAiLogExpanded(expanded ? null : log.id)}
                        style={{
                          padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                          background: c.bg, border: `1px solid ${c.border}`,
                          transition: 'all 0.15s',
                        }}
                      >
                        {/* Row summary */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: c.border, color: 'white' }}>
                            {(log.status || '?').toUpperCase()}
                          </span>
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>{timeStr}</span>
                          <span style={{ fontSize: '12px', color: 'white', fontWeight: 600 }}>
                            {log.action || 'score'}
                          </span>
                          {log.score != null && (
                            <span style={{ fontSize: '12px', fontWeight: 800, color: log.score >= 60 ? '#10B981' : log.score >= 40 ? '#F59E0B' : '#EF4444' }}>
                              {log.score}/100
                            </span>
                          )}
                          {log.duration_ms && (
                            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{log.duration_ms}ms</span>
                          )}
                          {log.used_model && (
                            <span style={{ fontSize: '10px', color: '#4DD9C8', fontFamily: 'monospace' }}>{log.used_model}</span>
                          )}
                          {log.room_id && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>room:{log.room_id.slice(0,8)}</span>
                          )}
                        </div>

                        {/* Error message inline */}
                        {log.error_message && (
                          <div style={{ marginTop: '6px', fontSize: '11px', color: '#FCA5A5', fontFamily: 'monospace' }}>
                            ⚠ {log.error_stage && <span style={{ color: '#FBBF24' }}>[{log.error_stage}] </span>}{log.error_message.slice(0, 150)}
                          </div>
                        )}

                        {/* Expanded details */}
                        {expanded && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {/* Audio info */}
                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                              <span>🎤 orig: {log.original_mime} ({log.original_b64_kb}kB)</span>
                              <span>🔁 mimic: {log.mimic_mime} ({log.mimic_b64_kb}kB)</span>
                              <span>🌐 lang: {log.language}</span>
                              <span>primary: {log.primary_model}</span>
                              <span>fallback: {log.fallback_model}</span>
                            </div>
                            {/* Transcriptions */}
                            {log.original_transcription && (
                              <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                                <div style={{ fontSize: '10px', fontWeight: 700, color: '#10B981', marginBottom: '3px' }}>🟢 ORIGINAL</div>
                                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>{log.original_transcription}</div>
                              </div>
                            )}
                            {log.attempt_transcription && (
                              <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.15)' }}>
                                <div style={{ fontSize: '10px', fontWeight: 700, color: '#4DD9C8', marginBottom: '3px' }}>🔵 ATTEMPT</div>
                                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>{log.attempt_transcription}</div>
                              </div>
                            )}
                            {log.guest_guess && (
                              <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.15)' }}>
                                <div style={{ fontSize: '10px', fontWeight: 700, color: '#A78BFA', marginBottom: '3px' }}>✏️ GUESS</div>
                                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>{log.guest_guess}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                }
              </div>
            )}
          </div>
        )}

        {/* TESTS TAB */}
        {tab === 'tests' && <TestRunner />}

        {/* SETTINGS TAB */}
        {tab === 'settings' && (
          <div style={{ padding: '20px' }}>
            <div style={{
              padding: '32px', borderRadius: '24px',
              background: 'rgba(236,72,153,0.05)', border: '1px solid rgba(236,72,153,0.2)',
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'white', margin: '0 0 6px' }}>
                ⚙️ Настройка ИИ (Gemini Model)
              </h3>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 20px' }}>
                Выберите версию модели Gemini. Эта настройка влияет на серверную часть (Edge Functions) и клиентские вызовы.
                <br /><br />
                Установленная сейчас модель: <strong style={{ color: '#2DC4B2' }}>{savedModel}</strong>
              </p>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <select
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  disabled={savingModel}
                  style={{
                    flex: 1, padding: '12px 14px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.05)', color: 'white',
                    border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                    outline: 'none', fontSize: '14px', maxWidth: '400px'
                  }}
                >
                  <option value="gemini-2.0-flash" style={{ color: 'black' }}>✨ Gemini 2.0 Flash (стабильный, рекомендуется)</option>
                  <option value="gemini-3.1-flash-lite-preview" style={{ color: 'black' }}>Gemini 3.1 Flash Lite Preview (нестабильный)</option>
                  <option value="gemini-2.5-flash" style={{ color: 'black' }}>Gemini 2.5 Flash</option>
                  <option value="gemini-1.5-flash" style={{ color: 'black' }}>Gemini 1.5 Flash (старый, надёжный)</option>
                </select>
                <button
                  onClick={handleSaveModel}
                  disabled={savingModel || geminiModel === savedModel}
                  style={{
                    padding: '12px 20px', borderRadius: '12px', border: 'none',
                    background: geminiModel === savedModel ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #147A8A, #2DC4B2)',
                    color: geminiModel === savedModel ? 'rgba(255,255,255,0.4)' : 'white',
                    fontSize: '14px', fontWeight: 600, cursor: geminiModel === savedModel ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {savingModel ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
