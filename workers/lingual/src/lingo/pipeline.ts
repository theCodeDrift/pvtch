import type { ChatMessageEvent } from '@pvtch/shared/twitch-eventsub';
import { decide } from './decision';
import { textFromFragments } from './preprocess';
import { isSameLanguage, translate } from './translator';

/** Twitch's chat message length limit. */
export const MAX_REPLY_LENGTH = 500;

/**
 * What a translation flow decided. `quiet` is a legitimate no-op (already in
 * the target language, nothing to translate, only @usernames left); `failed`
 * means a model call failed and a retry may succeed.
 */
export type ChatTranslation =
  | { kind: 'reply'; reply: string }
  | { kind: 'quiet' }
  | { kind: 'failed' };

const quiet: ChatTranslation = { kind: 'quiet' };
const failed: ChatTranslation = { kind: 'failed' };

const USERNAME_RE = /@[a-z0-9_]+?([^a-z0-9_]|$)/gi;

/** The translation trimmed to Twitch's limit, or undefined when nothing but
 * @usernames would be left. */
export function formatReply(translation: string): string | undefined {
  if (translation.replaceAll(USERNAME_RE, '$1').trim() === '') {
    return undefined;
  }
  const trimmed = translation.trim();
  return trimmed.length > MAX_REPLY_LENGTH
    ? trimmed.slice(0, MAX_REPLY_LENGTH)
    : trimmed;
}

/**
 * Translate a chat message for the bot. It stays quiet when detection says
 * the message is already in the target language (or too short to tell), the
 * LLM agrees it's the same language, or the result is only @usernames; it
 * fails when the LLM call throws or returns an unusable answer. Detection
 * runs on the message's text fragments; the LLM gets the original text.
 */
export async function translateChatMessage(
  env: Env,
  event: ChatMessageEvent,
  targetLanguage: string
): Promise<ChatTranslation> {
  const decision = decide(
    textFromFragments(event.message.fragments),
    targetLanguage
  );
  if (decision.action !== 'TRANSLATE') return quiet;

  const original = event.message.text;
  let result: Awaited<ReturnType<typeof translate>>;
  try {
    result = await translate(original, { env, targetLanguage });
  } catch (error) {
    console.error('Lingual translate failed', error);
    return failed;
  }
  if (!result.success) {
    console.error('Lingual translate failed', { error: result.error });
    return failed;
  }
  if (isSameLanguage(targetLanguage, original, result)) return quiet;

  const reply = formatReply(result.data.translation);
  return reply ? { kind: 'reply', reply } : quiet;
}
