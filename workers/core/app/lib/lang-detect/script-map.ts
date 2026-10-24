import { normalizeLanguage } from '@pvtch/shared/languages';

// Maps a canonical (lowercase) language name to the set of Unicode scripts the
// language is normally written in. The set is intentionally permissive — for
// the script-disjoint short-circuit we only care that the input contains *some*
// script the target uses, not that every script the target uses is present.
//
// Latin-script languages (most European, Spanish, Portuguese, Tagalog, etc.)
// are not enumerated; the default returned by `scriptsForLanguage` is
// `['Latin']` so any language we don't recognize falls back to Latin.
const SCRIPT_MAP: Record<string, readonly string[]> = {
  arabic: ['Arabic'],
  bengali: ['Bengali'],
  burmese: ['Myanmar'],
  chinese: ['Han'],
  georgian: ['Georgian'],
  greek: ['Greek'],
  gujarati: ['Gujarati'],
  hebrew: ['Hebrew'],
  hindi: ['Devanagari'],
  japanese: ['Hiragana', 'Katakana', 'Han'],
  kannada: ['Kannada'],
  kashmiri: ['Arabic', 'Devanagari'],
  'central khmer': ['Khmer'],
  korean: ['Hangul', 'Han'],
  lao: ['Lao'],
  malayalam: ['Malayalam'],
  marathi: ['Devanagari'],
  mongolian: ['Cyrillic', 'Mongolian'],
  nepali: ['Devanagari'],
  oriya: ['Oriya'],
  panjabi: ['Gurmukhi'],
  persian: ['Arabic'],
  pashto: ['Arabic'],
  russian: ['Cyrillic'],
  sanskrit: ['Devanagari'],
  sinhala: ['Sinhala'],
  tamil: ['Tamil'],
  telugu: ['Telugu'],
  thai: ['Thai'],
  tibetan: ['Tibetan'],
  tigrinya: ['Ethiopic'],
  ukrainian: ['Cyrillic'],
  urdu: ['Arabic'],
  yiddish: ['Hebrew'],
};

const DEFAULT_SCRIPTS = ['Latin'] as const;

export function scriptsForLanguage(language: string): readonly string[] {
  const normalized = normalizeLanguage(language);
  return SCRIPT_MAP[normalized] ?? DEFAULT_SCRIPTS;
}
