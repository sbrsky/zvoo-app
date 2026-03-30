/**
 * Gemini AI Scoring Service
 *
 * Calls the Supabase Edge Function 'gemini-scoring'
 * which securely holds the GEMINI_API_KEY.
 */
import { supabase } from './supabase'

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
 * Transcribe the host's recorded phrase via Gemini.
 * @param {Blob} originalBlob
 * @param {string} [language='ru'] — game language id (from rooms.game_language)
 */
export async function transcribeHostAudio(originalBlob, language = 'ru') {
  try {
    const originalB64 = await blobToBase64(originalBlob)
    const originalMimeType = originalBlob.type || 'audio/webm'

    const { data, error } = await supabase.functions.invoke('gemini-scoring', {
      body: {
        originalB64,
        originalMimeType,
        only_transcribe: true,
        language,
      }
    })

    if (error) throw error
    if (data && data.transcription) return data.transcription
    return null
  } catch (error) {
    console.error('Gemini transcription error:', error)
    return null
  }
}

/**
 * Score audio similarity using Gemini AI via Supabase Edge Functions.
 *
 * @param {Blob} originalBlob — original host audio
 * @param {Blob} mimicBlob — mimic reversed audio
 * @param {string} guestGuessText — guest's written guess
 * @param {string} actualTranscriptionText — confirmed host transcription
 * @param {string} [language='ru'] — game language id
 */
export async function scoreWithGemini(
  originalBlob,
  mimicBlob,
  guestGuessText = '',
  actualTranscriptionText = '',
  language = 'ru'
) {
  try {
    const [originalB64, mimicB64] = await Promise.all([
      blobToBase64(originalBlob),
      blobToBase64(mimicBlob),
    ])

    const originalMimeType = originalBlob.type || 'audio/webm'
    const mimicMimeType = mimicBlob.type || 'audio/wav'

    const { data, error } = await supabase.functions.invoke('gemini-scoring', {
      body: {
        originalB64,
        originalMimeType,
        mimicB64,
        mimicMimeType,
        guestGuessText,
        actualTranscriptionText,
        language,
      }
    })

    if (error) {
      console.error('Supabase functional error:', error)
      throw error
    }

    if (data) return data

    return { score: 50, comment: 'AI не смог обработать аудио. Попробуйте снова.', breakdown: null, model: 'unknown' }

  } catch (error) {
    console.error('Gemini scoring edge function error:', error)
    return {
      score: Math.floor(Math.random() * 30) + 35,
      comment: `Ошибка AI: ${error.message}. Поставлена приблизительная оценка.`,
      breakdown: null,
      model: 'fallback'
    }
  }
}

/**
 * Check if Gemini is available (assumes Edge Function handles true validation)
 */
export function isGeminiAvailable() {
  return true // Fallback handled server-side
}
