import { LANGUAGES, normalizeLanguage, type LanguageEntry } from './languages';

/**
 * Languages we allow users to configure as their Lingo target language.
 *
 * Two tiers:
 *
 * - **ensemble**: ISO 639-3 codes present in BOTH classifiers (tinyld/heavy
 *   intersection with franc-min). The K=2 skip-target rule can fire on these,
 *   so we get the cleanest cost wins and the most decisive diagnostics.
 * - **llm-only**: Major world languages where only one (or neither) classifier
 *   has coverage but the LLM handles them reliably. The K=1 translate path
 *   still works (a single confident non-target vote earns the LLM call), and
 *   the script gate still catches obvious mismatches; only the K=2 skip-target
 *   diagnostic path is unavailable.
 *
 * The list is intentionally curated, not exhaustive. The goal is a safety net
 * — preventing users from typing "klingon" or arbitrary text and getting
 * surprising LLM behavior — not to enumerate every language the LLM might
 * handle.
 */
export type TargetLanguageTier = 'ensemble' | 'llm-only';

export interface SupportedTargetLanguage extends LanguageEntry {
  tier: TargetLanguageTier;
}

// Intersection of tinyld/heavy and franc-min (ISO 639-3 codes). Both
// classifiers can identify these, so SKIP_TARGET (K=2) is achievable.
const ENSEMBLE_CODES: ReadonlyArray<string> = [
  'bel', // Belarusian
  'bul', // Bulgarian
  'ces', // Czech
  'deu', // German
  'eng', // English
  'fra', // French
  'hin', // Hindi
  'hun', // Hungarian
  'ind', // Indonesian
  'ita', // Italian
  'kaz', // Kazakh
  'nld', // Dutch
  'pes', // Persian
  'pol', // Polish
  'por', // Portuguese
  'ron', // Romanian
  'run', // Rundi
  'rus', // Russian
  'spa', // Spanish
  'srp', // Serbian
  'swe', // Swedish
  'tgl', // Tagalog
  'tur', // Turkish
  'ukr', // Ukrainian
  'urd', // Urdu
  'vie', // Vietnamese
];

// Curated additions: major world languages and stream-relevant targets where
// the LLM has strong coverage even if classifier support is one-sided or
// missing entirely. Some are in tinyld's vocabulary, some in franc-min's,
// some in neither — the LLM is the source of truth for translation quality.
const LLM_ONLY_CODES: ReadonlyArray<string> = [
  'ara', // Arabic — tinyld
  'ben', // Bengali — tinyld
  'cat', // Catalan — neither classifier; LLM-only
  'cmn', // Mandarin Chinese — tinyld
  'dan', // Danish — tinyld
  'ell', // Greek — tinyld
  'fin', // Finnish — tinyld
  'heb', // Hebrew — tinyld
  'hrv', // Croatian — franc-min
  'jpn', // Japanese — tinyld
  'kor', // Korean — tinyld
  'msa', // Malay — franc-min (returns 'zlm', aliased)
  'nob', // Norwegian Bokmål — tinyld
  'swa', // Swahili — franc-min (returns 'swh', aliased)
  'tam', // Tamil — tinyld
  'tel', // Telugu — tinyld
  'tha', // Thai — tinyld
];

function buildSupportedList(): SupportedTargetLanguage[] {
  // Index by canonical name (not iso639_3) so codes like `pes` / `cmn` / `nob`
  // resolve through normalizeLanguage's alias map to their macrolanguage
  // entries instead of being silently dropped.
  const byCanonical = new Map(LANGUAGES.map((l) => [l.name, l]));
  const resolve = (
    code: string,
    tier: TargetLanguageTier
  ): SupportedTargetLanguage => {
    const canonical = normalizeLanguage(code);
    const entry = byCanonical.get(canonical);
    if (!entry) {
      throw new Error(
        `Unknown language code in SUPPORTED_TARGET_LANGUAGES: '${code}' (normalized to '${canonical}'). ` +
          `Add the macrolanguage alias in languages.ts or fix the code.`
      );
    }
    return { ...entry, tier };
  };

  return [
    ...ENSEMBLE_CODES.map((c) => resolve(c, 'ensemble')),
    ...LLM_ONLY_CODES.map((c) => resolve(c, 'llm-only')),
  ].sort((a, b) => a.name.localeCompare(b.name));
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
