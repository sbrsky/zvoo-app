import { useState, useRef, useCallback } from 'react'
import { runAllTests } from '../../lib/regressionSuite'

const SUITE_COLORS = {
  'A — Room Lifecycle':    '#3B82F6',
  'B — Realtime Sync':     '#8B5CF6',
  'C — Full Game Flow':    '#10B981',
  'D — Race Conditions':   '#F59E0B',
  'E — Error Resilience':  '#EF4444',
  'F — RLS Policy Matrix': '#EC4899',
}

function suiteColor(suite) {
  return SUITE_COLORS[suite] ?? '#94A3B8'
}

export default function TestRunner() {
  const [status, setStatus] = useState('idle') // idle | running | done
  const [results, setResults] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(null)

  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const total  = results.length

  const run = useCallback(async () => {
    setStatus('running')
    setResults([])
    setElapsed(0)
    startRef.current = performance.now()

    await runAllTests({
      onResult: (result) => {
        setResults(prev => [...prev, result])
        setElapsed(Math.round(performance.now() - startRef.current))
      },
    })

    setElapsed(Math.round(performance.now() - startRef.current))
    setStatus('done')
  }, [])

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ results, passed, failed, total, elapsedMs: elapsed }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `regression-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  // Group results by suite
  const suites = results.reduce((acc, r) => {
    if (!acc[r.suite]) acc[r.suite] = []
    acc[r.suite].push(r)
    return acc
  }, {})

  const allPassed = status === 'done' && failed === 0

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Header controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em' }}>
            MULTIPLAYER REGRESSION SUITE
          </p>
          <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.28)' }}>
            6 suites · 40 tests · Runs in browser
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {status === 'done' && (
            <button
              onClick={downloadJson}
              style={{
                padding: '8px 16px', borderRadius: '10px', border: 'none', fontSize: '12px', fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
              }}
            >⬇ JSON</button>
          )}
          <button
            onClick={run}
            disabled={status === 'running'}
            style={{
              padding: '10px 22px', borderRadius: '10px', border: 'none', fontSize: '13px', fontWeight: 700,
              background: status === 'running' ? 'rgba(124,58,237,0.15)' : 'linear-gradient(135deg, #7C3AED, #4F46E5)',
              color: status === 'running' ? '#A78BFA' : 'white',
              cursor: status === 'running' ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              boxShadow: status !== 'running' ? '0 4px 20px rgba(124,58,237,0.35)' : 'none',
            }}
          >
            {status === 'running' ? '⏳ Выполняется...' : '▶ Запустить тесты'}
          </button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      {(status === 'running' || status === 'done') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Track */}
          <div style={{ height: '6px', borderRadius: '99px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '99px',
              width: total > 0 ? `${Math.round((total / 40) * 100)}%` : '0%',
              background: failed > 0 ? 'linear-gradient(90deg,#EF4444,#F87171)' : 'linear-gradient(90deg,#10B981,#34D399)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', fontFamily: 'monospace' }}>
            <span style={{ color: '#10B981', fontWeight: 700 }}>✅ {passed} passed</span>
            {failed > 0 && <span style={{ color: '#EF4444', fontWeight: 700 }}>❌ {failed} failed</span>}
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>{total}/40 run</span>
            {elapsed > 0 && <span style={{ color: 'rgba(255,255,255,0.25)' }}>{elapsed}ms</span>}
          </div>
        </div>
      )}

      {/* ── Result summary badge ── */}
      {status === 'done' && (
        <div style={{
          padding: '14px 20px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '12px',
          background: allPassed ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${allPassed ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <span style={{ fontSize: '28px' }}>{allPassed ? '🎉' : '⚠️'}</span>
          <div>
            <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '14px', color: allPassed ? '#10B981' : '#EF4444' }}>
              {allPassed ? `Все ${total} тестов прошли!` : `${failed} тест(а) упали`}
            </p>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
              {passed}/{total} passed · {elapsed}ms
            </p>
          </div>
        </div>
      )}

      {/* ── Suite results ── */}
      {Object.entries(suites).map(([suite, tests]) => {
        const suitePassed = tests.filter(t => t.status === 'pass').length
        const suiteFailed = tests.filter(t => t.status === 'fail').length
        const color = suiteColor(suite)
        return (
          <div key={suite} style={{
            borderRadius: '14px', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            {/* Suite header */}
            <div style={{
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: `${color}10`,
            }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color }}>
                {suite}
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#10B981', fontWeight: 700 }}>✅ {suitePassed}</span>
                {suiteFailed > 0 && <span style={{ fontSize: '11px', color: '#EF4444', fontWeight: 700 }}>❌ {suiteFailed}</span>}
              </div>
            </div>

            {/* Test rows */}
            {tests.map((t, i) => (
              <div key={i} style={{
                padding: '8px 16px',
                borderBottom: i < tests.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                background: t.status === 'fail' ? 'rgba(239,68,68,0.04)' : 'transparent',
              }}>
                <span style={{ fontSize: '14px', flexShrink: 0, lineHeight: '18px' }}>
                  {t.status === 'pass' ? '✅' : '❌'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: '12px', fontFamily: 'monospace',
                    color: t.status === 'pass' ? 'rgba(255,255,255,0.7)' : '#FCA5A5',
                    display: 'block',
                  }}>
                    {t.name}
                  </span>
                  {t.error && (
                    <span style={{
                      display: 'block', marginTop: '3px',
                      fontSize: '11px', fontFamily: 'monospace',
                      color: '#EF4444', wordBreak: 'break-all',
                    }}>
                      {t.error}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', flexShrink: 0, lineHeight: '18px' }}>
                  {t.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        )
      })}

      {/* Empty state */}
      {status === 'idle' && (
        <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '14px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🧪</div>
          Нажмите <strong style={{ color: 'rgba(255,255,255,0.4)' }}>▶ Запустить тесты</strong> чтобы запустить регрессию
        </div>
      )}
    </div>
  )
}
