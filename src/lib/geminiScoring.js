/**
 * Gemini AI Scoring Service
 *
 * Calls the Supabase Edge Function 'gemini-scoring'
 * which securely holds the GEMINI_API_KEY.
 */
import { supabase } from './supabase'

const INVOKE_TIMEOUT_MS = 35_000 // Hard limit for Edge Function round-trip

/**
 * Convert Blob to base64 data string
 */
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
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

  try {
    // supabase.functions.invoke uses fetch internally; pass the signal via options
    const { data, error } = await supabase.functions.invoke(fnName, {
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (error) {
      console.error(`[geminiScoring] Edge Function '${fnName}' returned error:`, error)
      throw new Error(error.message || 'Edge Function error')
    }
    return data
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT')
    }
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
 * THROWS on timeout or network error — caller should handle with withTimeout().
 *
 * @param {Blob} originalBlob — original host audio
 * @param {Blob} mimicBlob — mimic reversed audio
 * @param {string} guestGuessText — guest's written guess
 * @param {string} actualTranscriptionText — confirmed host transcription
 * @param {string} [language='ru'] — game language id
 * @returns {object} { score, comment, breakdown, model, actual_transcription, attempt_transcription }
 */
export async function scoreWithGemini(
  originalBlob,
  mimicBlob,
  guestGuessText = '',
  actualTranscriptionText = '',
  language = 'ru'
) {
  console.log('[geminiScoring] scoreWithGemini: converting blobs...')
  const [originalB64, mimicB64] = await Promise.all([
    blobToBase64(originalBlob),
    blobToBase64(mimicBlob),
  ])

  const originalMimeType = originalBlob.type || 'audio/webm'
  const mimicMimeType = mimicBlob.type || 'audio/wav'
  console.log(`[geminiScoring] scoreWithGemini: original=${(originalB64.length/1024).toFixed(0)}kB, mimic=${(mimicB64.length/1024).toFixed(0)}kB — invoking edge fn...`)

  // NOTE: intentionally NOT catching here — let errors propagate to caller (Game.jsx triggerScoring)
  const data = await invokeWithTimeout('gemini-scoring', {
    originalB64,
    originalMimeType,
    mimicB64,
    mimicMimeType,
    guestGuessText,
    actualTranscriptionText,
    language,
  })

  if (!data) {
    throw new Error('Edge Function returned empty response')
  }

  console.log(`[geminiScoring] scoreWithGemini: score=${data.score}, model=${data.model}`)
  return data
}

/**
 * Check if Gemini is available (assumes Edge Function handles true validation)
 */
export function isGeminiAvailable() {
  return true // Fallback handled server-side
}
