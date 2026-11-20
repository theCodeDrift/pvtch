import { LANGUAGES, normalizeLanguage, type LanguageEntry } from './languages';

/**
 * Languages a channel can pick as Lingual's target, and a chatter can name in
 * the translate command.
 *
 * Curated, not exhaustive: every entry goes through the same OpenRouter
 * models, and the list only keeps targets those models translate into well.
 * It is a safety net against typos and arbitrary text ("klingon") reaching
 * the model as a language, not a list of everything a model might handle.
 */
export type SupportedTargetLanguage = LanguageEntry;

// ISO 639-3 codes. Individual-language codes such as `cmn`, `pes` and `nob`
// resolve to their macrolanguage entry through normalizeLanguage.
const SUPPORTED_CODES: ReadonlyArray<string> = [
  'ara', // Arabic
  'bel', // Belarusian
  'ben', // Bengali
  'bul', // Bulgarian
  'cat', // Catalan
  'ces', // Czech
  'cmn', // Mandarin Chinese
  'dan', // Danish
  'deu', // German
  'ell', // Greek
  'eng', // English
  'fin', // Finnish
  'fra', // French
  'heb', // Hebrew
  'hin', // Hindi
  'hrv', // Croatian
  'hun', // Hungarian
  'ind', // Indonesian
  'ita', // Italian
  'jpn', // Japanese
  'kaz', // Kazakh
  'kor', // Korean
  'msa', // Malay
  'nld', // Dutch
  'nob', // Norwegian Bokmål
  'pes', // Persian
  'pol', // Polish
  'por', // Portuguese
  'ron', // Romanian
  'run', // Rundi
  'rus', // Russian
  'spa', // Spanish
  'srp', // Serbian
  'swa', // Swahili
  'swe', // Swedish
  'tam', // Tamil
  'tel', // Telugu
  'tgl', // Tagalog
  'tha', // Thai
  'tur', // Turkish
  'ukr', // Ukrainian
  'urd', // Urdu
  'vie', // Vietnamese
];

function buildSupportedList(): SupportedTargetLanguage[] {
  // Index by canonical name (not iso639_3) so codes like `pes` / `cmn` / `nob`
  // resolve through normalizeLanguage's alias map to their macrolanguage
  // entries instead of being silently dropped.
  const byCanonical = new Map(LANGUAGES.map((l) => [l.name, l]));
  return SUPPORTED_CODES.map((code) => {
    const canonical = normalizeLanguage(code);
    const entry = byCanonical.get(canonical);
    if (!entry) {
      throw new Error(
        `Unknown language code in SUPPORTED_TARGET_LANGUAGES: '${code}' (normalized to '${canonical}'). ` +
          `Add the macrolanguage alias in languages.ts or fix the code.`
      );
    }
    return entry;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export const SUPPORTED_TARGET_LANGUAGES: ReadonlyArray<SupportedTargetLanguage> =
  buildSupportedList();

// Lookup index: ISO 639-1 code, ISO 639-3 code, and lowercase name all map
// to the same entry, so user input in any of those forms resolves cleanly.
const LOOKUP: Record<string, SupportedTargetLanguage> = {};
for (const lang of SUPPORTED_TARGET_LANGUAGES) {
  LOOKUP[lang.iso639_1] = lang;
  LOOKUP[lang.iso639_3] = lang;
  LOOKUP[lang.name] = lang;
}

/**
 * Resolve a user-supplied language identifier (ISO 639-1, ISO 639-3, or
 * canonical lowercase name) against the supported target list. Returns the
 * entry if recognized, or `undefined` if the input does not match any
 * supported target.
 */
export function findSupportedTargetLanguage(
  input: string
): SupportedTargetLanguage | undefined {
  return LOOKUP[input.toLocaleLowerCase().trim()];
}

/** True when `input` resolves to a supported target language. */
export function isSupportedTargetLanguage(input: string): boolean {
  return findSupportedTargetLanguage(input) !== undefined;
}
