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
const IMAGE_MODEL   = 'gemini-3.1-flash-image-preview'

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

async function callGemini(model: string, requestBody: any, timeoutMs = 30_000) {
  const url = getModelUrl(model)
  console.log(`[Gemini] Calling model: ${model} (timeout=${timeoutMs}ms)`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

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
      action = '',           // 'generate_choices' | 'generate_vision' | 'generate_imaginarium' | ''
      transcription = '',   // for superpower/imaginarium actions (legacy)
      phrase = '',          // alias for transcription in generate_imaginarium
      imagStyle = '',       // for generate_imaginarium: crazy_dreams | abstractionism | kids_doodles (legacy)
      style = '',           // alias for imagStyle
    } = await req.json()

    // Normalize aliases
    const _transcription = transcription || phrase
    const _imagStyle = imagStyle || style


    const models = await getGeminiModels()
    console.log(`Using models: primary=${models.primary}, fallback=${models.fallback}, language=${language}, action=${action || 'score'}`)

    // Resolve the transcription hint for this game's language
    const langHint = LANGUAGE_HINTS[language] ?? LANGUAGE_HINTS['ru']

    // ─── Superpower: generate 4 choices ──────────────────────────────────────
    if (action === 'generate_choices') {
      if (!transcription) throw new Error('transcription required for generate_choices')
      const langLabel = language === 'ru' ? 'Russian' : 'English'
      const prompt = `The original phrase is: "${transcription}".
Generate exactly 4 options for a multiple-choice quiz, in ${langLabel}:
- 1 option must be the EXACT original phrase (copy it verbatim)
- 3 options must be plausible-sounding but INCORRECT alternatives (similar phonetically or thematically)
IMPORTANT: all 4 options MUST be different from each other — no duplicates allowed.
Respond ONLY with a JSON array of exactly 4 unique strings, randomly shuffled. Example: ["phrase A", "phrase B", "phrase C", "phrase D"]
No markdown, no explanation, just the JSON array.`
      const choiceReq = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 300 } }
      let choiceData
      try { choiceData = await callGemini(models.primary, choiceReq) }
      catch { choiceData = await callGemini(models.fallback, choiceReq) }
      const raw = choiceData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
      const match = raw.match(/\[[\s\S]*?\]/)
      let choices: string[] = []
      try { choices = JSON.parse(match ? match[0] : '[]') } catch { choices = [] }

      // Dedup: remove any duplicates, keep unique values
      choices = [...new Set(choices.map((c: string) => String(c).trim()).filter(Boolean))]

      // Ensure the correct answer is in the list
      if (!choices.includes(transcription)) choices.unshift(transcription)

      // If we still don't have 4 unique choices, pad with distinct fallbacks
      const fallbacks = [
        `(вариант А) ${transcription.split(' ').reverse().join(' ')}`,
        `(вариант Б) ${transcription.slice(0, Math.ceil(transcription.length / 2))}...`,
        `(вариант В) ...${transcription.slice(Math.floor(transcription.length / 2))}`,
      ]
      for (const fb of fallbacks) {
        if (choices.length >= 4) break
        if (!choices.includes(fb)) choices.push(fb)
      }
      choices = choices.slice(0, 4)

      // Final shuffle
      choices = choices.sort(() => Math.random() - 0.5)
      return new Response(JSON.stringify({ choices }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }


    // ─── Superpower: generate vision image ───────────────────────────────────
    if (action === 'generate_vision') {
      if (!transcription) throw new Error('transcription required for generate_vision')
      const imageUrl = `${GEMINI_BASE_URL}/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`
      const prompt = `Create a simple, clear visual illustration that represents this phrase: "${transcription}". Draw it as a visual hint without any text or letters. Style: clean, colorful, simple graphic.`
      const imageReq = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.7 }
      }
      let imgData: any
      try {
        const imgController = new AbortController()
        const imgTimer = setTimeout(() => imgController.abort(), 30_000)
        const res = await fetch(imageUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(imageReq), signal: imgController.signal })
        clearTimeout(imgTimer)
        imgData = await res.json()
      } catch (e: any) {
        throw new Error(`Image generation failed: ${e.message}`)
      }
      // Extract inline image from response
      const parts = imgData?.candidates?.[0]?.content?.parts || []
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
      if (!imgPart) throw new Error('No image returned from Gemini')
      return new Response(JSON.stringify({
        imageBase64: imgPart.inlineData.data,
        mimeType: imgPart.inlineData.mimeType,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // ─── Imaginarium: generate image + 4 choices ─────────────────────────────
    if (action === 'generate_imaginarium') {
      if (!_transcription) throw new Error('phrase/transcription required for generate_imaginarium')

      const STYLE_PROMPTS: Record<string, string> = {
        crazy_dreams:   `surreal dream painting where bizarre dream imagery represents the concept of "${_transcription}". No text or labels. Style: Salvador Dali-inspired dreamscape.`,
        abstractionism: `abstract expressionist artwork representing the concept of "${_transcription}". Bold shapes, vivid colors, no text. Style: Kandinsky / Mondrian.`,
        kids_doodles:   `simple child's crayon drawing depicting "${_transcription}". Wobbly lines, bright crayons, naive style. No letters or text.`,
      }

      const stylePrompt = STYLE_PROMPTS[_imagStyle as string] || STYLE_PROMPTS['abstractionism']
      const imageUrl = `${GEMINI_BASE_URL}/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`
      const imageReq = {
        contents: [{ parts: [{ text: `Create an illustration: ${stylePrompt}` }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.8 }
      }

      let imageBase64 = ''
      let mimeType = 'image/png'
      try {
        const imagCtrl = new AbortController()
        const imagTimer = setTimeout(() => imagCtrl.abort(), 30_000)
        const res = await fetch(imageUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(imageReq), signal: imagCtrl.signal })
        clearTimeout(imagTimer)
        const imgData = await res.json()
        const parts = imgData?.candidates?.[0]?.content?.parts || []
        const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
        if (imgPart) {
          imageBase64 = imgPart.inlineData.data
          mimeType = imgPart.inlineData.mimeType
        }
      } catch (e: any) {
        console.warn('Image generation failed, continuing without image:', e.message)
      }

      // Generate 4 choices (1 correct + 3 distractors)
      const langLabel = language === 'ru' ? 'Russian' : 'English'
      const choicePrompt = `The original phrase is: "${_transcription}".
Generate exactly 4 options for a multiple-choice quiz, in ${langLabel}:
- 1 option must be the EXACT original phrase (copy it verbatim)
- 3 options must be plausible-sounding but INCORRECT alternatives (similar phonetically or thematically)
IMPORTANT: all 4 options MUST be different from each other — no duplicates allowed.
Respond ONLY with a JSON array of exactly 4 unique strings, randomly shuffled. Example: ["phrase A", "phrase B", "phrase C", "phrase D"]
No markdown, no explanation, just the JSON array.`
      const choiceReq = { contents: [{ parts: [{ text: choicePrompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 300 } }
      let choices: string[] = []
      try {
        let choiceData: any
        try { choiceData = await callGemini(models.primary, choiceReq) }
        catch { choiceData = await callGemini(models.fallback, choiceReq) }
        const raw = choiceData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
        const match = raw.match(/\[[\s\S]*?\]/)
        try { choices = JSON.parse(match ? match[0] : '[]') } catch { choices = [] }
      } catch (e: any) {
        console.warn('Choice generation failed:', e.message)
      }

      // Dedup and ensure correct answer is present
      choices = [...new Set(choices.map((c: string) => String(c).trim()).filter(Boolean))]
      if (!choices.includes(_transcription)) choices.unshift(_transcription)
      const fallbacks = [
        `(вариант А) ${_transcription.split(' ').reverse().join(' ')}`,
        `(вариант Б) ${_transcription.slice(0, Math.ceil(_transcription.length / 2))}...`,
        `(вариант В) ...${_transcription.slice(Math.floor(_transcription.length / 2))}`,
      ]
      for (const fb of fallbacks) {
        if (choices.length >= 4) break
        if (!choices.includes(fb)) choices.push(fb)
      }
      choices = choices.slice(0, 4).sort(() => Math.random() - 0.5)

      return new Response(JSON.stringify({ imageBase64, mimeType, choices }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // ─────────────────────────────────────────────────────────────────────────


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
