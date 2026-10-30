import { scriptsForLanguage } from './script-map';

// Unicode scripts we care about for language detection. Each entry is checked
// independently against the input; the result is the set of scripts present.
// Order is arbitrary — detection runs all checks.
const SCRIPT_CHECKS: ReadonlyArray<[string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Tamil', /\p{Script=Tamil}/u],
  ['Telugu', /\p{Script=Telugu}/u],
  ['Kannada', /\p{Script=Kannada}/u],
  ['Malayalam', /\p{Script=Malayalam}/u],
  ['Gujarati', /\p{Script=Gujarati}/u],
  ['Gurmukhi', /\p{Script=Gurmukhi}/u],
  ['Oriya', /\p{Script=Oriya}/u],
  ['Sinhala', /\p{Script=Sinhala}/u],
  ['Myanmar', /\p{Script=Myanmar}/u],
  ['Khmer', /\p{Script=Khmer}/u],
  ['Lao', /\p{Script=Lao}/u],
  ['Tibetan', /\p{Script=Tibetan}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
  ['Mongolian', /\p{Script=Mongolian}/u],
];

export function detectScripts(input: string): Set<string> {
  const found = new Set<string>();
  for (const [name, re] of SCRIPT_CHECKS) {
    if (re.test(input)) found.add(name);
  }
  return found;
}

/**
 * True when none of the scripts present in the input are scripts the target
 * language is normally written in. Returns false if `inputScripts` is empty
 * (no detectable script — e.g. digits and punctuation only) so callers don't
 * over-trigger TRANSLATE on emoji/number-only input.
 */
export function isScriptDisjoint(
  inputScripts: ReadonlySet<string>,
  target: string
): boolean {
  if (inputScripts.size === 0) return false;
  const targetScripts = scriptsForLanguage(target);
  for (const script of inputScripts) {
    if (targetScripts.includes(script)) return false;
  }
  return true;
}
