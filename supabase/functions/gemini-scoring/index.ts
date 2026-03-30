import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// Stable models that support generateContent via REST API
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview'
const FALLBACK_MODEL = 'gemini-2.0-flash'

// Models that DON'T support standard generateContent (Live API only)
const LIVE_API_ONLY_MODELS = [
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-preview-native-audio',
]

function normalizeModelName(raw: string): string {
  // Strip surrounding quotes (e.g. `"gemini-2.0-flash"` → `gemini-2.0-flash`)
  const cleaned = raw.replace(/^"+|"+$/g, '').trim()
  // If it's a Live API model, fall back to the REST-compatible version
  if (LIVE_API_ONLY_MODELS.includes(cleaned)) {
    console.log(`Model ${cleaned} is Live-API-only, using ${DEFAULT_MODEL} instead`)
    return DEFAULT_MODEL
  }
  return cleaned
}

async function getGeminiModels() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) return { primary: DEFAULT_MODEL, fallback: FALLBACK_MODEL }
  
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.gemini_model&select=value`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    })
    const data = await res.json()
    if (data && data.length > 0 && typeof data[0].value === 'string') {
      const primary = normalizeModelName(data[0].value)
      return { primary, fallback: FALLBACK_MODEL }
    }
  } catch (e) {
    console.error('Failed to get gemini_model from DB:', e)
  }
  return { primary: DEFAULT_MODEL, fallback: FALLBACK_MODEL }
}

function getModelUrl(model: string) {
  return `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`
}

// Language-specific system prompts for transcription
const LANGUAGE_HINTS: Record<string, string> = {
  ru: 'The speaker is using RUSSIAN. Transcribe ONLY in Russian (Cyrillic). Output only the spoken words, no explanations.',
  en: 'The speaker is using ENGLISH. Transcribe ONLY in English. Output only the spoken words, no explanations.',
  // Add more languages here — must match ids in src/lib/languages.js
}

/**
 * Step 1: Transcribe a single audio blob to text.
 */
function buildTranscribeRequest(audioB64: string, mimeType: string, langHint: string) {
  return {
    contents: [{
      parts: [
        { text: `Transcribe this audio clip. ${langHint} Output ONLY the spoken words, nothing else.` },
        { inlineData: { mimeType, data: audioB64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
    }
  }
}

/**
 * Step 2: Compare two transcriptions + guest's written guess.
 */
function buildCompareRequest(original: string, attempt: string, guestGuessText: string) {
  return {
    contents: [{
      parts: [{
        text: `Ты судья в аудио-игре EchoFlip AI.

## Правила игры:
1. Игрок 1 записывает фразу.
2. Система переворачивает аудио задом наперёд.
3. Игрок 2 слышит перевёрнутую версию и пытается её повторить.
4. Его повтор снова переворачивается — это "итоговая попытка".
5. Игрок 2 также пишет догадку — что изначально было сказано.

## Данные:
- 🟢 Оригинальная фраза (транскрипция): "${original}"
- 🔵 Итоговая попытка Игрока 2 (транскрипция): "${attempt}"
- ✏️ Письменная догадка Игрока 2: "${guestGuessText || '(не указана)'}"

## Задача:
Сравни оригинал и попытку. Насколько похожи слова, звуки, смысл?
Также учти насколько письменная догадка близка к оригиналу.

## Оценка (итого 0-100):
- Схожесть транскрипций (60%): совпадают ли слова/звуки между оригиналом и попыткой?
- Догадка (40%): насколько письменная догадка близка к оригиналу?

## Шкала:
- 0-15: 💀 Полный провал
- 16-30: 😅 Слабо
- 31-50: 🤔 Средне
- 51-65: 👍 Неплохо
- 66-80: 🔥 Хорошо
- 81-95: ⭐ Отлично
- 96-100: 🏆 Легенда

Ответь СТРОГО в JSON (без markdown):
{"score": <число 0-100>, "comment": "<весёлый комментарий 1-2 предложения>", "original_transcription": "${original}", "attempt_transcription": "${attempt}", "breakdown": {"similarity": <0-100>, "guessAccuracy": <0-100>}}`
      }]
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    }
  }
}

async function callGemini(model: string, requestBody: any) {
  const url = getModelUrl(model)
  console.log(`Calling Gemini model: ${model}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`${model} returned ${response.status}: ${errorText.slice(0, 300)}`)
  }

  return response.json()
}

async function transcribeAudio(audioB64: string, mimeType: string, langHint: string, models: { primary: string, fallback: string }): Promise<string> {
  const req = buildTranscribeRequest(audioB64, mimeType, langHint)
  let data
  try {
    data = await callGemini(models.primary, req)
  } catch (e: any) {
    console.warn(`Transcribe with ${models.primary} failed, trying fallback ${models.fallback}:`, e.message)
    data = await callGemini(models.fallback, req)
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return text.trim()
}

function parseCompareResponse(data: any) {
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  // Try direct parse first (if responseMimeType worked)
  let parsed: any = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Compare response not JSON:', raw.slice(0, 200))
      return null
    }
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return null }
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50)))
  return {
    score,
    comment: parsed.comment || 'AI не оставил комментарий.',
    original_transcription: parsed.original_transcription || '',
    attempt_transcription: parsed.attempt_transcription || '',
    breakdown: parsed.breakdown || null,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      originalB64,
      originalMimeType = 'audio/webm',
      mimicB64,
      mimicMimeType = 'audio/wav',
      guestGuessText = '',
      only_transcribe = false,
      actualTranscriptionText = '',
      language = 'ru',
    } = await req.json()

    const models = await getGeminiModels()
    console.log(`Using models: primary=${models.primary}, fallback=${models.fallback}, language=${language}`)

    // Resolve the transcription hint for this game's language
    const langHint = LANGUAGE_HINTS[language] ?? LANGUAGE_HINTS['ru']

    if (only_transcribe) {
      if (!originalB64) throw new Error('Missing audio data for transcription')
      const cleanOrigMime = originalMimeType.split(';')[0]
      const t = await transcribeAudio(originalB64, cleanOrigMime, langHint, models)
      return new Response(JSON.stringify({ transcription: t }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!originalB64 || !mimicB64) {
      throw new Error('Missing audio data: need both originalB64 and mimicB64')
    }

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({
        score: Math.floor(Math.random() * 60) + 40,
        comment: 'Демо-режим: Gemini API ключ не настроен в Edge Function.',
        breakdown: null,
        actual_transcription: actualTranscriptionText || 'Demo original',
        model: 'demo'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const cleanOrigMime = originalMimeType.split(';')[0]
    const cleanMimicMime = mimicMimeType.split(';')[0]

    console.log('Transcribing audio...')
    let originalTranscription = actualTranscriptionText
    let attemptTranscription = ''

    if (actualTranscriptionText) {
      // Keep confirmed transcription, only transcribe the mimic attempt
      console.log('Using provided actual transcription:', actualTranscriptionText)
      attemptTranscription = await transcribeAudio(mimicB64, cleanMimicMime, langHint, models)
    } else {
      [originalTranscription, attemptTranscription] = await Promise.all([
        transcribeAudio(originalB64, cleanOrigMime, langHint, models),
        transcribeAudio(mimicB64, cleanMimicMime, langHint, models),
      ])
    }

    console.log('Original:', originalTranscription)
    console.log('Attempt:', attemptTranscription)

    // Step 2: compare transcriptions + written guess
    const compareReq = buildCompareRequest(originalTranscription, attemptTranscription, guestGuessText)
    let compareData
    let usedModel = models.primary
    try {
      compareData = await callGemini(models.primary, compareReq)
    } catch (primaryErr: any) {
      console.warn('Primary model failed on compare, trying fallback:', primaryErr.message)
      usedModel = models.fallback
      compareData = await callGemini(models.fallback, compareReq)
    }

    const result = parseCompareResponse(compareData)
    if (result) {
      return new Response(JSON.stringify({
        score: result.score,
        comment: result.comment,
        breakdown: result.breakdown,
        actual_transcription: originalTranscription,
        attempt_transcription: attemptTranscription,
        model: usedModel,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    throw new Error('Failed to parse compare response')

  } catch (error: any) {
    console.error('Scoring error:', error.message)
    return new Response(JSON.stringify({
      score: 50,
      comment: `Ошибка AI: ${error.message}. Поставлена приближённая оценка.`,
      breakdown: null,
      actual_transcription: null,
      model: 'fallback'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })
  }
})
