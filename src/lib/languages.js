/**
 * Supported game languages.
 * Each entry defines:
 *   - id:           stored in DB (profiles.preferred_language, rooms.game_language)
 *   - label:        shown in UI
 *   - flag:         emoji flag
 *   - nativeName:   name in that language (shown in picker)
 *   - transcribeHint: injected into the Gemini transcription prompt
 */
export const LANGUAGES = [
  {
    id: 'ru',
    label: 'Русский',
    nativeName: 'Русский',
    flag: '🇷🇺',
    transcribeHint:
      'The speaker is using RUSSIAN. Transcribe in Russian (Cyrillic script). Output only the spoken words, nothing else.',
  },
  {
    id: 'en',
    label: 'English',
    nativeName: 'English',
    flag: '🇬🇧',
    transcribeHint:
      'The speaker is using ENGLISH. Transcribe in English. Output only the spoken words, nothing else.',
  },
  // ─── Add more languages here without touching any other file ───────────────
  // {
  //   id: 'de',
  //   label: 'Deutsch',
  //   nativeName: 'Deutsch',
  //   flag: '🇩🇪',
  //   transcribeHint: 'The speaker is using GERMAN. Transcribe in German. Output only the spoken words.',
  // },
]

/** Map of id → language object for O(1) lookup */
export const LANGUAGE_MAP = Object.fromEntries(LANGUAGES.map(l => [l.id, l]))

/** Default language id */
export const DEFAULT_LANGUAGE_ID = 'ru'

/** Returns the transcription hint for the given language id */
export function getTranscribeHint(langId) {
  return LANGUAGE_MAP[langId]?.transcribeHint ?? LANGUAGE_MAP[DEFAULT_LANGUAGE_ID].transcribeHint
}
