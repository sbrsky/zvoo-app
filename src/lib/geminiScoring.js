/**
 * Gemini AI Scoring Service
 *
 * Calls the Supabase Edge Function 'gemini-scoring'
 * which securely holds the GEMINI_API_KEY.
 */
import { supabase } from './supabase'

const INVOKE_TIMEOUT_MS = 40_000 // Hard limit for Edge Function round-trip

// ─── Non-blocking base64 conversion ──────────────────────────────────────────
// IMPORTANT: Do NOT use the synchronous `String.fromCharCode` loop — it blocks
// the JS Event Loop for large audio files (1-3s freeze on mobile), causing the
// browser to appear hung and breaking abort signals.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const sizeKb = (blob.size / 1024).toFixed(0)
    console.log(`[geminiScoring] blobToBase64: starting (${sizeKb}kB, type=${blob.type})`)
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result // data:...;base64,XXXXXXX
      const base64 = result.split(',')[1]
      console.log(`[geminiScoring] blobToBase64: done (${(base64.length / 1024).toFixed(0)}kB base64)`)
      resolve(base64)
    }
    reader.onerror = (e) => {
      console.error('[geminiScoring] blobToBase64 FileReader error:', e)
      reject(new Error('FileReader error: ' + e))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Invoke a Supabase Edge Function with an AbortController timeout.
 * Throws if: network error, timeout, Supabase error, or function error.
 */
async function invokeWithTimeout(fnName, body, timeoutMs = INVOKE_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    console.warn(`[geminiScoring] Edge Function '${fnName}' timed out after ${timeoutMs}ms — aborting`)
    controller.abort()
  }, timeoutMs)

  const t0 = Date.now()
  console.log(`[geminiScoring] invokeWithTimeout: calling '${fnName}' (timeout=${timeoutMs}ms)`)

  try {
    const { data, error } = await supabase.functions.invoke(fnName, {
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const elapsed = Date.now() - t0
    console.log(`[geminiScoring] invokeWithTimeout: '${fnName}' returned in ${elapsed}ms`)

    if (error) {
      console.error(`[geminiScoring] Edge Function '${fnName}' returned error:`, error)
      throw new Error(error.message || 'Edge Function error')
    }
    return data
  } catch (err) {
    clearTimeout(timer)
    const elapsed = Date.now() - t0
    if (err.name === 'AbortError') {
      console.error(`[geminiScoring] TIMEOUT: '${fnName}' aborted after ${elapsed}ms`)
      throw new Error('TIMEOUT')
    }
    console.error(`[geminiScoring] '${fnName}' threw after ${elapsed}ms:`, err.message)
    throw err
  }
}

/**
 * Transcribe the host's recorded phrase via Gemini.
 * @param {Blob} originalBlob
 * @param {string} [language='ru'] — game language id (from rooms.game_language)
 * @returns {string|null} transcription or null on error
 */
export async function transcribeHostAudio(originalBlob, language = 'ru') {
  try {
    console.log('[geminiScoring] transcribeHostAudio: converting blob...')
    const originalB64 = await blobToBase64(originalBlob)
    const originalMimeType = originalBlob.type || 'audio/webm'
    console.log(`[geminiScoring] transcribeHostAudio: invoking edge fn (${(originalB64.length / 1024).toFixed(0)}kB base64)`)

    const data = await invokeWithTimeout('gemini-scoring', {
      originalB64,
      originalMimeType,
      only_transcribe: true,
      language,
    })

    if (data?.transcription) {
      console.log(`[geminiScoring] transcribeHostAudio: got transcription: "${data.transcription}"`)
      return data.transcription
    }
    console.warn('[geminiScoring] transcribeHostAudio: no transcription in response', data)
    return null
  } catch (error) {
    console.error('[geminiScoring] transcribeHostAudio error:', error.message)
    return null // Transcription is non-critical — return null on failure
  }
}

/**
 * Score audio similarity using Gemini AI via Supabase Edge Functions.
 * THROWS on timeout or network error — caller should handle with withTimeout()
 * in Game.jsx (additional safety layer on top of invokeWithTimeout).
 *
 * @param {Blob} originalBlob — original host audio
 * @param {Blob} mimicBlob — mimic reversed audio
 * @param {string} guestGuessText — guest's written guess
 * @param {string} actualTranscriptionText — confirmed host transcription
 * @param {string} [language='ru'] — game language id
 * @param {string} [roomId=''] — room id for logging
 * @returns {object} { score, comment, breakdown, model, actual_transcription, attempt_transcription }
 */
export async function scoreWithGemini(
  originalBlob,
  mimicBlob,
  guestGuessText = '',
  actualTranscriptionText = '',
  language = 'ru',
  roomId = ''
) {
  console.log('[geminiScoring] scoreWithGemini: start — converting blobs in parallel...')
  const t0 = Date.now()

  // Both conversions are non-blocking (FileReader based) and run in parallel
  const [originalB64, mimicB64] = await Promise.all([
    blobToBase64(originalBlob),
    blobToBase64(mimicBlob),
  ])

  console.log(
    `[geminiScoring] scoreWithGemini: blobs ready in ${Date.now() - t0}ms — ` +
    `original=${(originalB64.length/1024).toFixed(0)}kB, mimic=${(mimicB64.length/1024).toFixed(0)}kB`
  )

  const originalMimeType = originalBlob.type || 'audio/webm'
  const mimicMimeType = mimicBlob.type || 'audio/wav'

  console.log(`[geminiScoring] scoreWithGemini: invoking edge fn... language=${language}`)

  // NOTE: intentionally NOT catching here — let errors propagate to caller (Game.jsx triggerScoring)
  const data = await invokeWithTimeout('gemini-scoring', {
    originalB64,
    originalMimeType,
    mimicB64,
    mimicMimeType,
    guestGuessText,
    actualTranscriptionText,
    language,
    room_id: roomId,
  })

  if (!data) {
    throw new Error('Edge Function returned empty response')
  }

  const total = Date.now() - t0
  console.log(`[geminiScoring] scoreWithGemini: COMPLETE in ${total}ms — score=${data.score}, model=${data.model}`)
  return data
}

/**
 * Check if Gemini is available (assumes Edge Function handles true validation)
 */
export function isGeminiAvailable() {
  return true // Fallback handled server-side
}
