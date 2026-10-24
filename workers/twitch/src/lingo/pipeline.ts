import type { ChatMessageEvent } from '../eventsub/schemas';
import { decide } from './decision';
import { textFromFragments } from './preprocess';
import { isSameLanguage, translate } from './translator';

/** Twitch's chat message length limit. */
export const MAX_REPLY_LENGTH = 500;

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
 * Translate a chat message for the bot, or return undefined when it should
 * stay quiet: detection says it's already in the target language (or too
 * short to tell), the LLM fails or agrees it's the same language, or the
 * result is only @usernames. Detection runs on the message's text fragments;
 * the LLM gets the original text.
 */
export async function translateChatMessage(
  env: Env,
  event: ChatMessageEvent,
  targetLanguage: string
): Promise<string | undefined> {
  const decision = decide(
    textFromFragments(event.message.fragments),
    targetLanguage
  );
  if (decision.action !== 'TRANSLATE') return undefined;

  const original = event.message.text;
  let result: Awaited<ReturnType<typeof translate>>;
  try {
    result = await translate(original, { env, targetLanguage });
  } catch (error) {
    console.error('Lingual translate failed', error);
    return undefined;
  }
  if (!result.success) {
    console.error('Lingual translate failed', { error: result.error });
    return undefined;
  }
  if (isSameLanguage(targetLanguage, original, result)) return undefined;

  return formatReply(result.data.translation);
}
