import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || ''
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// Models for audio transcription + text scoring (generateContent via REST API)
const AUDIO_MODEL   = 'gemini-3.1-flash-lite-preview' // primary: audio + text (matches app_settings)
const DEFAULT_MODEL = 'gemini-2.0-flash'               // fallback if AUDIO_MODEL unavailable
const FALLBACK_MODEL = 'gemini-1.5-flash'              // last resort fallback

// Model for image generation only (separate capability, not for audio)
const IMAGE_MODEL   = 'gemini-3.1-flash-image-preview'

// Models that DON'T support standard generateContent (Live API / WebSocket only)
const LIVE_API_ONLY_MODELS = [
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-preview-native-audio',
]

// ─── Structured logger ────────────────────────────────────────────────────────
const startTime = Date.now()
function ts() { return `+${((Date.now() - startTime) / 1000).toFixed(2)}s` }

function logInfo(stage: string, msg: string, data?: unknown) {
  console.log(JSON.stringify({ ts: ts(), stage, level: 'INFO', msg, ...(data ? { data } : {}) }))
}
function logWarn(stage: string, msg: string, data?: unknown) {
  console.warn(JSON.stringify({ ts: ts(), stage, level: 'WARN', msg, ...(data ? { data } : {}) }))
}
function logError(stage: string, msg: string, data?: unknown) {
  console.error(JSON.stringify({ ts: ts(), stage, level: 'ERROR', msg, ...(data ? { data } : {}) }))
}

// ─── DB logger: persist result to ai_scoring_logs ────────────────────────────
async function persistLog(row: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    logWarn('persistLog', 'SUPABASE_URL or SUPABASE_KEY missing — skipping DB log')
    return
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/ai_scoring_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!resp.ok) {
      logWarn('persistLog', `DB insert failed: ${resp.status}`, await resp.text())
    } else {
      logInfo('persistLog', 'Diagnostic log saved to ai_scoring_logs')
    }
  } catch (e: any) {
    logWarn('persistLog', `DB insert exception: ${e.message}`)
  }
}

// ─── Model normaliser ─────────────────────────────────────────────────────────
function normalizeModelName(raw: string): string {
  const cleaned = raw.replace(/^\"+|\"+$/g, '').trim()
  if (LIVE_API_ONLY_MODELS.includes(cleaned)) {
    logWarn('normalizeModel', `Model ${cleaned} is Live-API-only → using ${DEFAULT_MODEL}`)
    return DEFAULT_MODEL
  }
  return cleaned
}

async function getGeminiModels() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    logWarn('getModels', 'No Supabase creds → using defaults')
    return { primary: AUDIO_MODEL, fallback: DEFAULT_MODEL }
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.gemini_model&select=value`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    })
    const data = await res.json()
    if (data?.length > 0 && typeof data[0].value === 'string') {
      const primary = normalizeModelName(data[0].value)
      logInfo('getModels', `DB model config: primary=${primary}`)
      return { primary, fallback: DEFAULT_MODEL }
    }
    logWarn('getModels', 'No gemini_model in app_settings → using AUDIO_MODEL default')
  } catch (e: any) {
    logError('getModels', `Failed to fetch model config: ${e.message}`)
  }
  return { primary: AUDIO_MODEL, fallback: DEFAULT_MODEL }
}

function getModelUrl(model: string) {
  return `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`
}

// ─── Language hints ───────────────────────────────────────────────────────────
const LANGUAGE_HINTS: Record<string, string> = {
  ru: 'The speaker is using RUSSIAN. Transcribe ONLY in Russian (Cyrillic). Output only the spoken words, no explanations.',
  en: 'The speaker is using ENGLISH. Transcribe ONLY in English. Output only the spoken words, no explanations.',
}

// ─── Request builders ─────────────────────────────────────────────────────────
function buildTranscribeRequest(audioB64: string, mimeType: string, langHint: string) {
  return {
    contents: [{
      parts: [
        { text: `Transcribe this audio clip. ${langHint} Output ONLY the spoken words, nothing else.` },
        { inlineData: { mimeType, data: audioB64 } }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
  }
}

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

// ─── Core Gemini caller with AbortController timeout ──────────────────────────
async function callGemini(model: string, requestBody: any, timeoutMs = 28_000): Promise<any> {
  const url = getModelUrl(model)
  const payloadKb = (JSON.stringify(requestBody).length / 1024).toFixed(0)
  logInfo('callGemini', `→ ${model} | payload=${payloadKb}kB | timeout=${timeoutMs}ms`)

  const controller = new AbortController()
  const timer = setTimeout(() => {
    logError('callGemini', `AbortController fired after ${timeoutMs}ms for ${model}`)
    controller.abort()
  }, timeoutMs)

  let response: Response
  const t0 = Date.now()
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (e: any) {
    clearTimeout(timer)
    const elapsed = Date.now() - t0
    if (e.name === 'AbortError') {
      logError('callGemini', `TIMEOUT: ${model} did not respond in ${elapsed}ms`)
      throw new Error(`TIMEOUT:${model}`)
    }
    logError('callGemini', `Network error calling ${model}: ${e.message} (${elapsed}ms)`)
    throw e
  } finally {
    clearTimeout(timer)
  }

  const elapsed = Date.now() - t0
  logInfo('callGemini', `← ${model} | HTTP ${response.status} | ${elapsed}ms`)

  if (!response.ok) {
    const errorBody = await response.text()
    logError('callGemini', `${model} HTTP ${response.status}`, errorBody.slice(0, 500))
    throw new Error(`${model} HTTP ${response.status}: ${errorBody.slice(0, 300)}`)
  }

  const json = await response.json()
  // Log finish_reason if available (catches SAFETY blocks, MAX_TOKENS, etc.)
  const finishReason = json?.candidates?.[0]?.finishReason
  if (finishReason && finishReason !== 'STOP') {
    logWarn('callGemini', `${model} finishReason=${finishReason}`, json?.candidates?.[0]?.safetyRatings)
  }
  return json
}

// ─── Transcribe with fallback ─────────────────────────────────────────────────
async function transcribeAudio(
  audioB64: string, mimeType: string, langHint: string,
  models: { primary: string; fallback: string },
  label: string // 'original' | 'mimic'
): Promise<string> {
  const sizeKb = (audioB64.length / 1024).toFixed(0)
  logInfo('transcribe', `Transcribing ${label} audio | mime=${mimeType} | size=${sizeKb}kB`)
  const req = buildTranscribeRequest(audioB64, mimeType, langHint)
  let data: any
  try {
    data = await callGemini(models.primary, req)
  } catch (e: any) {
    logWarn('transcribe', `Primary (${models.primary}) failed for ${label}: ${e.message} → trying fallback`)
    try {
      data = await callGemini(models.fallback, req)
    } catch (e2: any) {
      logError('transcribe', `Fallback (${models.fallback}) also failed for ${label}: ${e2.message}`)
      return ''
    }
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const result = text.trim()
  logInfo('transcribe', `${label} transcription: "${result.slice(0, 80)}"`)
  return result
}

// ─── Parse compare response ───────────────────────────────────────────────────
function parseCompareResponse(data: any) {
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  logInfo('parseCompare', `Raw compare response: ${raw.slice(0, 200)}`)
  let parsed: any = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logWarn('parseCompare', 'No JSON found in compare response')
      return null
    }
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return null }
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50)))
  logInfo('parseCompare', `Parsed score=${score}, comment="${(parsed.comment || '').slice(0, 60)}"`)
  return {
    score,
    comment: parsed.comment || 'AI не оставил комментарий.',
    original_transcription: parsed.original_transcription || '',
    attempt_transcription: parsed.attempt_transcription || '',
    breakdown: parsed.breakdown || null,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const reqStart = Date.now()
  let logRow: Record<string, unknown> = { status: 'ok', action: 'score' }

  try {
    const body = await req.json()
    const {
      originalB64,
      originalMimeType = 'audio/webm',
      mimicB64,
      mimicMimeType = 'audio/wav',
      guestGuessText = '',
      only_transcribe = false,
      actualTranscriptionText = '',
      language = 'ru',
      action = '',
      transcription = '',
      phrase = '',
      imagStyle = '',
      style = '',
      room_id = '',
      session_id = '',
    } = body

    const _transcription = transcription || phrase
    const _imagStyle = imagStyle || style

    logRow.action = action || (only_transcribe ? 'transcribe' : 'score')
    logRow.room_id = room_id
    logRow.session_id = session_id
    logRow.language = language
    logRow.original_mime = originalMimeType
    logRow.mimic_mime = mimicMimeType
    logRow.original_b64_kb = originalB64 ? +(originalB64.length / 1024).toFixed(1) : null
    logRow.mimic_b64_kb = mimicB64 ? +(mimicB64.length / 1024).toFixed(1) : null
    logRow.guest_guess = guestGuessText?.slice(0, 100) || null

    logInfo('main', `Request received | action=${logRow.action} | language=${language} | room_id=${room_id}`)
    logInfo('main', `Audio sizes | original=${logRow.original_b64_kb}kB | mimic=${logRow.mimic_b64_kb}kB`)

    // ── Key check ────────────────────────────────────────────────────────────
    if (!GEMINI_API_KEY && action !== 'generate_choices' && action !== 'generate_imaginarium') {
      logError('main', 'GEMINI_API_KEY is not set in Edge Function environment!')
      logRow.status = 'fallback'
      logRow.error_stage = 'key_missing'
      logRow.error_message = 'GEMINI_API_KEY not configured'
      logRow.score = 50
      logRow.duration_ms = Date.now() - reqStart
      await persistLog(logRow)
      return new Response(JSON.stringify({
        score: Math.floor(Math.random() * 60) + 40,
        comment: 'Демо-режим: Gemini API ключ не настроен в Edge Function.',
        breakdown: null, actual_transcription: actualTranscriptionText || 'Demo', model: 'demo'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const models = await getGeminiModels()
    logRow.primary_model = models.primary
    logRow.fallback_model = models.fallback
    logInfo('main', `Models: primary=${models.primary}, fallback=${models.fallback}`)

    const langHint = LANGUAGE_HINTS[language] ?? LANGUAGE_HINTS['ru']

    // ── generate_choices ─────────────────────────────────────────────────────
    if (action === 'generate_choices') {
      if (!_transcription) throw new Error('transcription required for generate_choices')
      logInfo('main', `Generating choices for: "${_transcription}"`)
      const langLabel = language === 'ru' ? 'Russian' : 'English'
      const prompt = `The original phrase is: "${_transcription}". Generate exactly 4 options for a multiple-choice quiz, in ${langLabel}:\n- 1 option must be the EXACT original phrase (copy it verbatim)\n- 3 options must be plausible-sounding but INCORRECT alternatives (similar phonetically or thematically)\nIMPORTANT: all 4 options MUST be different from each other — no duplicates allowed.\nRespond ONLY with a JSON array of exactly 4 unique strings, randomly shuffled.\nNo markdown, no explanation, just the JSON array.`
      const choiceReq = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 300 } }
      let choiceData: any
      try { choiceData = await callGemini(models.primary, choiceReq) }
      catch { choiceData = await callGemini(models.fallback, choiceReq) }
      const raw = choiceData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
      const match = raw.match(/\[[\s\S]*?\]/)
      let choices: string[] = []
      try { choices = JSON.parse(match ? match[0] : '[]') } catch { choices = [] }
      choices = [...new Set(choices.map((c: string) => String(c).trim()).filter(Boolean))]
      if (!choices.includes(_transcription)) choices.unshift(_transcription)
      const fallbacks = [
        `(вариант А) ${_transcription.split(' ').reverse().join(' ')}`,
        `(вариант Б) ${_transcription.slice(0, Math.ceil(_transcription.length / 2))}...`,
        `(вариант В) ...${_transcription.slice(Math.floor(_transcription.length / 2))}`,
      ]
      for (const fb of fallbacks) { if (choices.length >= 4) break; if (!choices.includes(fb)) choices.push(fb) }
      choices = choices.slice(0, 4).sort(() => Math.random() - 0.5)
      logInfo('main', `Generated ${choices.length} choices`)
      logRow.duration_ms = Date.now() - reqStart
      await persistLog(logRow)
      return new Response(JSON.stringify({ choices }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── generate_vision ──────────────────────────────────────────────────────
    if (action === 'generate_vision') {
      if (!_transcription) throw new Error('transcription required for generate_vision')
      logInfo('main', `Generating vision image for: "${_transcription}"`)
      const imageUrl = `${GEMINI_BASE_URL}/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`
      const prompt = `Create a simple, clear visual illustration that represents this phrase: "${_transcription}". Draw it as a visual hint without any text or letters. Style: clean, colorful, simple graphic.`
      const imageReq = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.7 } }
      let imgData: any
      try {
        const ic = new AbortController(); const it = setTimeout(() => ic.abort(), 30_000)
        const res = await fetch(imageUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(imageReq), signal: ic.signal })
        clearTimeout(it); imgData = await res.json()
      } catch (e: any) { throw new Error(`Image generation failed: ${e.message}`) }
      const parts = imgData?.candidates?.[0]?.content?.parts || []
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
      if (!imgPart) throw new Error('No image returned from Gemini')
      logRow.duration_ms = Date.now() - reqStart
      await persistLog(logRow)
      return new Response(JSON.stringify({ imageBase64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── generate_imaginarium ─────────────────────────────────────────────────
    if (action === 'generate_imaginarium') {
      if (!_transcription) throw new Error('phrase/transcription required for generate_imaginarium')
      logInfo('main', `Generating imaginarium for: "${_transcription}" style=${_imagStyle}`)
      const STYLE_PROMPTS: Record<string, string> = {
        crazy_dreams:   `surreal dream painting where bizarre dream imagery represents the concept of "${_transcription}". No text or labels. Style: Salvador Dali-inspired dreamscape.`,
        abstractionism: `abstract expressionist artwork representing the concept of "${_transcription}". Bold shapes, vivid colors, no text. Style: Kandinsky / Mondrian.`,
        kids_doodles:   `simple child's crayon drawing depicting "${_transcription}". Wobbly lines, bright crayons, naive style. No letters or text.`,
      }
      const stylePrompt = STYLE_PROMPTS[_imagStyle as string] || STYLE_PROMPTS['abstractionism']
      const imageUrl = `${GEMINI_BASE_URL}/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`
      const imageReq = { contents: [{ parts: [{ text: `Create an illustration: ${stylePrompt}` }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.8 } }
      let imageBase64 = ''; let mimeType = 'image/png'
      try {
        const ic = new AbortController(); const it = setTimeout(() => ic.abort(), 30_000)
        const res = await fetch(imageUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(imageReq), signal: ic.signal })
        clearTimeout(it); const imgData = await res.json()
        const parts = imgData?.candidates?.[0]?.content?.parts || []
        const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
        if (imgPart) { imageBase64 = imgPart.inlineData.data; mimeType = imgPart.inlineData.mimeType }
      } catch (e: any) { logWarn('main', `Imaginarium image failed: ${e.message}`) }
      const langLabel = language === 'ru' ? 'Russian' : 'English'
      const choicePrompt = `The original phrase is: "${_transcription}". Generate exactly 4 multiple-choice options (1 correct, 3 wrong distractors) in ${langLabel}. Respond ONLY with a JSON array of 4 unique strings.`
      const choiceReq = { contents: [{ parts: [{ text: choicePrompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 300 } }
      let choices: string[] = []
      try {
        let cd: any
        try { cd = await callGemini(models.primary, choiceReq) } catch { cd = await callGemini(models.fallback, choiceReq) }
        const raw = cd?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
        const match = raw.match(/\[[\s\S]*?\]/)
        try { choices = JSON.parse(match ? match[0] : '[]') } catch { choices = [] }
      } catch (e: any) { logWarn('main', `Choice gen failed: ${e.message}`) }
      choices = [...new Set(choices.map((c: string) => String(c).trim()).filter(Boolean))]
      if (!choices.includes(_transcription)) choices.unshift(_transcription)
      const fallbacks2 = [`(вар А) ${_transcription.split(' ').reverse().join(' ')}`, `(вар Б) ${_transcription.slice(0, Math.ceil(_transcription.length / 2))}...`, `(вар В) ...${_transcription.slice(Math.floor(_transcription.length / 2))}`]
      for (const fb of fallbacks2) { if (choices.length >= 4) break; if (!choices.includes(fb)) choices.push(fb) }
      choices = choices.slice(0, 4).sort(() => Math.random() - 0.5)
      logRow.duration_ms = Date.now() - reqStart
      await persistLog(logRow)
      return new Response(JSON.stringify({ imageBase64, mimeType, choices }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── only_transcribe mode ─────────────────────────────────────────────────
    if (only_transcribe) {
      if (!originalB64) throw new Error('Missing audio data for transcription')
      logRow.action = 'transcribe'
      const cleanOrigMime = originalMimeType.split(';')[0]
      const t = await transcribeAudio(originalB64, cleanOrigMime, langHint, models, 'original')
      logRow.original_transcription = t
      logRow.duration_ms = Date.now() - reqStart
      await persistLog(logRow)
      return new Response(JSON.stringify({ transcription: t }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Full scoring pipeline ────────────────────────────────────────────────
    if (!originalB64 || !mimicB64) {
      throw new Error(`Missing audio data: originalB64=${!!originalB64}, mimicB64=${!!mimicB64}`)
    }

    const cleanOrigMime = originalMimeType.split(';')[0]
    const cleanMimicMime = mimicMimeType.split(';')[0]

    // Step 1: Transcribe
    logInfo('main', 'Step 1: Transcribing audio...')
    let originalTranscription = actualTranscriptionText
    let attemptTranscription = ''
    let errorStage = ''

    try {
      if (actualTranscriptionText) {
        logInfo('main', `Using provided actual transcription: "${actualTranscriptionText}"`)
        attemptTranscription = await transcribeAudio(mimicB64, cleanMimicMime, langHint, models, 'mimic')
      } else {
        logInfo('main', 'Transcribing both original and mimic in parallel...')
        ;[originalTranscription, attemptTranscription] = await Promise.all([
          transcribeAudio(originalB64, cleanOrigMime, langHint, models, 'original'),
          transcribeAudio(mimicB64, cleanMimicMime, langHint, models, 'mimic'),
        ])
      }
    } catch (e: any) {
      errorStage = 'transcription'
      logError('main', `Transcription step failed: ${e.message}`)
      throw e
    }

    logInfo('main', `Transcriptions complete | original="${originalTranscription.slice(0, 60)}" | attempt="${attemptTranscription.slice(0, 60)}"`)
    logRow.original_transcription = originalTranscription.slice(0, 200)
    logRow.attempt_transcription = attemptTranscription.slice(0, 200)

    // Step 2: Compare
    logInfo('main', 'Step 2: Compare + score...')
    const compareReq = buildCompareRequest(originalTranscription, attemptTranscription, guestGuessText)
    let compareData: any
    let usedModel = models.primary
    try {
      compareData = await callGemini(models.primary, compareReq)
    } catch (primaryErr: any) {
      logWarn('main', `Primary model ${models.primary} failed on compare: ${primaryErr.message} → trying fallback`)
      errorStage = 'compare_primary'
      usedModel = models.fallback
      compareData = await callGemini(models.fallback, compareReq)
    }

    logRow.used_model = usedModel

    const result = parseCompareResponse(compareData)
    if (!result) throw new Error('Failed to parse compare response from Gemini')

    logInfo('main', `Final result: score=${result.score}, model=${usedModel} | total=${Date.now() - reqStart}ms`)

    logRow.score = result.score
    logRow.has_comment = !!result.comment
    logRow.has_breakdown = !!result.breakdown
    logRow.status = errorStage ? 'fallback' : 'ok'
    logRow.error_stage = errorStage || null
    logRow.duration_ms = Date.now() - reqStart
    await persistLog(logRow)

    return new Response(JSON.stringify({
      score: result.score,
      comment: result.comment,
      breakdown: result.breakdown,
      actual_transcription: originalTranscription,
      attempt_transcription: attemptTranscription,
      model: usedModel,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    const duration = Date.now() - reqStart
    const isTimeout = error.message?.startsWith('TIMEOUT:')
    logError('main', `Unhandled error after ${duration}ms: ${error.message}`)

    logRow.status = isTimeout ? 'timeout' : 'error'
    logRow.error_message = error.message?.slice(0, 500)
    logRow.duration_ms = duration
    logRow.score = 50
    await persistLog(logRow)

    return new Response(JSON.stringify({
      score: 50,
      comment: isTimeout
        ? `AI не успел ответить (${Math.round(duration / 1000)}с). Поставлена оценка 50.`
        : `Ошибка AI: ${error.message?.slice(0, 200)}. Поставлена приближённая оценка.`,
      breakdown: null,
      actual_transcription: null,
      model: 'fallback',
      _debug: { error: error.message, duration_ms: duration, status: logRow.status }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })
  }
})
