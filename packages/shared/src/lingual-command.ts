import { findSupportedTargetLanguage } from './supported-languages';

/** `!` and 1 to 24 letters, digits or underscores: one chat word. */
const COMMAND_RE = /^![a-z0-9_]{1,24}$/;

/** True when `command` can be a Lingual translate command. Case-insensitive. */
export function isValidTranslateCommand(command: string): boolean {
  return COMMAND_RE.test(command.trim().toLowerCase());
}

export interface TranslateRequest {
  /** The supported language's canonical name. */
  language: string;
  /** What to translate. */
  text: string;
}

/**
 * Parse `<command> <language> <text>`. Undefined when the message isn't the
 * command, names no supported language (a name or ISO code), or has nothing
 * to translate.
 */
export function parseTranslateCommand(
  message: string,
  command: string
): TranslateRequest | undefined {
  const [first, languageInput = '', ...rest] = message.trim().split(/\s+/);
  if (first?.toLowerCase() !== command.trim().toLowerCase()) return undefined;
  const language = findSupportedTargetLanguage(languageInput);
  const text = rest.join(' ');
  return language && text ? { language: language.name, text } : undefined;
}
