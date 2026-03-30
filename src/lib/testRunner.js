/**
 * testRunner.js — lightweight in-browser test runner
 * Mirrors describe / it / expect API (no vitest/jest dependency)
 */

// ─── Assertions ─────────────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AssertionError'
  }
}

function createExpect(value) {
  return {
    toBe(expected) {
      if (!Object.is(value, expected)) {
        throw new AssertionError(
          `expected ${JSON.stringify(value)} to be ${JSON.stringify(expected)}`
        )
      }
    },
    toEqual(expected) {
      if (JSON.stringify(value) !== JSON.stringify(expected)) {
        throw new AssertionError(
          `expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`
        )
      }
    },
    toBeNull() {
      if (value !== null) {
        throw new AssertionError(`expected ${JSON.stringify(value)} to be null`)
      }
    },
    not: {
      toBeNull() {
        if (value === null || value === undefined) {
          throw new AssertionError(`expected value not to be null/undefined`)
        }
      },
      toBe(expected) {
        if (Object.is(value, expected)) {
          throw new AssertionError(`expected ${JSON.stringify(value)} NOT to be ${JSON.stringify(expected)}`)
        }
      },
    },
    toHaveLength(len) {
      if (!Array.isArray(value) && typeof value !== 'string') {
        throw new AssertionError(`toHaveLength requires array or string, got ${typeof value}`)
      }
      if (value.length !== len) {
        throw new AssertionError(`expected length ${len}, got ${value.length}`)
      }
    },
    toMatchObject(subset) {
      for (const [k, v] of Object.entries(subset)) {
        if (JSON.stringify(value?.[k]) !== JSON.stringify(v)) {
          throw new AssertionError(
            `expected .${k} to be ${JSON.stringify(v)}, got ${JSON.stringify(value?.[k])}`
          )
        }
      }
    },
    toResolve() { /* no-op helper */ },
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export async function runSuite(suiteName, tests, { onResult } = {}) {
  const results = []
  for (const { name, fn } of tests) {
    const t0 = performance.now()
    try {
      await fn()
      const result = { suite: suiteName, name, status: 'pass', durationMs: Math.round(performance.now() - t0) }
      results.push(result)
      onResult?.(result)
    } catch (err) {
      const result = { suite: suiteName, name, status: 'fail', durationMs: Math.round(performance.now() - t0), error: err.message }
      results.push(result)
      onResult?.(result)
    }
  }
  return results
}

export const expect = (val) => createExpect(val)
