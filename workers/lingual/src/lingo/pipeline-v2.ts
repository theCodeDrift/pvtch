import type {
  ChatFragment,
  ChatMessageEvent,
} from '@pvtch/shared/twitch-eventsub';

import { v2ConfigFromEnv, type V2Config } from './config-v2';
import { targetLanguageProbability } from './detector-v2';
import { openRouterClient } from './openrouter';
import { formatReply, type ChatTranslation } from './pipeline';
import { URL_RE, preprocess, textFromFragments } from './preprocess';
import { translateV2 } from './translator-v2';

export type V2Outcome =
  | 'translated'
  | 'nothing-to-detect'
  | 'detection-failed'
  | 'target-language'
  | 'translate-failed'
  | 'unchanged'
  | 'usernames-only';

/** What the v2 flow did with a message. `reply` is what the bot would post. */
export interface V2Trace {
  outcome: V2Outcome;
  cleaned: string;
  /** The probability that the message is in the target language. */
  probability?: number;
  translation?: string;
  reply?: string;
  /** Why a detection or translation call failed. */
  error?: string;
}

/** The message for the translator: Twitch tags native emotes and cheermotes
 * exactly, so they don't spend tokens there, and URLs have nothing to
 * translate. Mentions stay in the reply. */
function textForTranslator(fragments: readonly ChatFragment[]): string {
  return fragments
    .filter(({ type }) => type !== 'emote' && type !== 'cheermote')
    .map((fragment) => fragment.text)
    .join('')
    .replaceAll(URL_RE, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/**
 * The OpenRouter flow. It only translates when the decision model is highly
 * confident the message isn't in the target language, so a failure or any
 * doubt stays quiet. Detection runs on the message's text without emotes and
 * mentions; the translator gets the message without emotes or URLs.
 */
export async function traceChatMessageV2(
  env: Env,
  event: ChatMessageEvent,
  targetLanguage: string,
  evalConfig?: V2Config
): Promise<V2Trace> {
  const cleaned = preprocess(textFromFragments(event.message.fragments));
  if (cleaned.length === 0) return { outcome: 'nothing-to-detect', cleaned };

  let config: V2Config;
  try {
    config = evalConfig ?? v2ConfigFromEnv(env);
  } catch (error) {
    console.error('Lingual v2 config is invalid', error);
    return { outcome: 'detection-failed', cleaned, error: String(error) };
  }

  const client = openRouterClient(env);
  let probability: number | undefined;
  try {
    probability = await targetLanguageProbability(
      client,
      cleaned,
      targetLanguage,
      {
        api: config.detectorApi,
        model: config.detectorModel,
        disableThinking: config.detectorDisableThinking,
      }
    );
  } catch (error) {
    console.error('Lingual v2 detection failed', error);
    return { outcome: 'detection-failed', cleaned, error: String(error) };
  }
  console.log('Lingual v2 detection', { targetLanguage, probability });
  if (probability === undefined) {
    return { outcome: 'detection-failed', cleaned };
  }
  if (probability > config.maxTargetProbability) {
    return { outcome: 'target-language', cleaned, probability };
  }

  // Past detection a translation is required, so the translator doesn't
  // judge the language again.
  const input = textForTranslator(event.message.fragments);
  let translation: string;
  try {
    translation = await translateV2(client, input, targetLanguage, {
      model: config.translatorModel,
      disableThinking: config.translatorDisableThinking,
    });
  } catch (error) {
    console.error('Lingual v2 translate failed', error);
    return {
      outcome: 'translate-failed',
      cleaned,
      probability,
      error: String(error),
    };
  }

  const trace = { cleaned, probability, translation };
  if (translation.trim().toLowerCase() === input.toLowerCase()) {
    return { outcome: 'unchanged', ...trace };
  }
  const reply = formatReply(translation);
  return reply
    ? { outcome: 'translated', ...trace, reply }
    : { outcome: 'usernames-only', ...trace };
}

/** Outcomes where a model call failed, so a retry may succeed. */
const FAILED_OUTCOMES: ReadonlySet<V2Outcome> = new Set([
  'detection-failed',
  'translate-failed',
]);

/** Translate a chat message: a reply to post, quiet when the bot has nothing
 * to say, or failed when a model call failed. */
export async function translateChatMessageV2(
  env: Env,
  event: ChatMessageEvent,
  targetLanguage: string
): Promise<ChatTranslation> {
  const { outcome, reply } = await traceChatMessageV2(
    env,
    event,
    targetLanguage
  );
  if (reply) return { kind: 'reply', reply };
  return FAILED_OUTCOMES.has(outcome) ? { kind: 'failed' } : { kind: 'quiet' };
}
