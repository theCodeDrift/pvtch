/**
 * Lingual dev harness (wrangler.harness.jsonc). Never deployed.
 *
 *   GET  /      the form
 *   GET  /evals      the v2 eval table
 *   POST /evals/run  { text, emotes, config } → the v2 trace; never posts to Twitch
 *   POST /send  { broadcasterId, text, flow } → a fake chat message on
 *               lingual-events, sent through translation flow v1 or v2
 *
 * From the queue on it's production code: pvtch-lingual translates and
 * pvtch-twitch posts as botlingual. The result shows up in Twitch chat and in
 * the terminal, not here.
 */
import type { OpenRouter } from '@openrouter/sdk';
import { CHAT_MESSAGE_TYPE } from '@pvtch/shared/twitch-eventsub';
import type { ChatMessageEvent } from '@pvtch/shared/twitch-eventsub';
import type { HandlerEventMessage } from '@pvtch/shared/twitch-queue';
import { z } from 'zod';

import { NO_THREAD_FLAG, TRANSLATE_V2_FLAG } from '../handler';
import { openRouterClient } from '../lingo/openrouter';
import { modelId, v2ConfigFromEnv, type V2Config } from '../lingo/config-v2';
import { traceChatMessageV2, type V2Outcome } from '../lingo/pipeline-v2';
import { EVAL_FIXTURES } from './eval-fixtures';
import { evalsPage } from './evals-page';
import { modelSupport } from './model-support';
import { harnessPage } from './page';

/** Every harness message translates into this language. */
const TARGET_LANGUAGE = 'english';

type HarnessEnv = Env & { LINGUAL_EVENTS: Queue };

const sendBody = z.object({
  broadcasterId: z.string().regex(/^\d+$/),
  text: z.string().trim().min(1).max(500),
  flow: z.enum(['v1', 'v2']),
});

const evalBody = z.object({
  text: z.string().trim().min(1).max(500),
  emotes: z.array(z.string()).default([]),
  config: z
    .object({
      detectorApi: z.enum(['decisions', 'chat']),
      detectorModel: modelId,
      translatorModel: modelId,
      maxTargetProbability: z.number().min(0).max(1),
    })
    .optional(),
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Private LAN addresses, for machines where mDNS names don't resolve well. */
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** This posts as the real bot, so only this page may call it. Any website
 * can POST to a local address, but only this page sends this origin. */
function isLocalRequest(request: Request, url: URL): boolean {
  const { hostname } = url;
  const isLocal =
    LOCAL_HOSTS.has(hostname) ||
    hostname.endsWith('.local') ||
    PRIVATE_IP.test(hostname);
  if (!isLocal) return false;
  const origin = request.headers.get('Origin');
  return origin === null || origin === url.origin;
}

/** A chat event for a harness message. Mentions and any `emotes` become
 * typed fragments, as they do on Twitch. */
export function chatEvent(
  broadcasterId: string,
  text: string,
  messageId: string,
  emotes: readonly string[] = []
): ChatMessageEvent {
  const emoteNames = new Set(emotes);
  const fragments = text
    .split(/(@[a-z0-9_]{1,25}|\s+)/i)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith('@')) return { type: 'mention' as const, text: part };
      if (emoteNames.has(part)) return { type: 'emote' as const, text: part };
      return { type: 'text' as const, text: part };
    });
  return {
    broadcaster_user_id: broadcasterId,
    broadcaster_user_login: 'harness',
    chatter_user_id: 'harness',
    chatter_user_login: 'harness',
    message_id: messageId,
    message: { text, fragments },
    badges: [],
  };
}

async function send(request: Request, env: HarnessEnv): Promise<Response> {
  const body = sendBody.safeParse(await request.json());
  if (!body.success) return Response.json(body.error, { status: 400 });
  const { broadcasterId, text, flow } = body.data;

  const channel = env.TWITCH_CHANNEL.get(
    env.TWITCH_CHANNEL.idFromName(`twitch:${broadcasterId}`)
  );
  using lingual = await channel.lingual();
  await lingual.setSettings({
    language: TARGET_LANGUAGE,
    ignoredChatters: [],
  });

  const messageId = crypto.randomUUID();
  const routed: HandlerEventMessage = {
    kind: 'handler-event',
    handlerId: 'lingual',
    broadcasterId,
    senderId: 'botlingual',
    messageId,
    subscriptionType: CHAT_MESSAGE_TYPE,
    timestamp: Date.now(),
    event: chatEvent(broadcasterId, text, messageId),
    flags:
      flow === 'v2' ? [NO_THREAD_FLAG, TRANSLATE_V2_FLAG] : [NO_THREAD_FLAG],
  };
  await env.LINGUAL_EVENTS.send(routed);
  return Response.json({ queued: true, messageId });
}

type EvalPair = NonNullable<z.infer<typeof evalBody>['config']>;

/** Turn thinking off only where a model supports it, since v2 requires
 * providers to honor every parameter it sends. */
async function chatModelSettings(
  client: OpenRouter,
  model: string
): Promise<{ disableThinking: boolean } | { error: string }> {
  try {
    const support = await modelSupport(client, model);
    return support.structuredOutputs
      ? { disableThinking: support.disableThinking }
      : { error: `${model} doesn't support structured outputs` };
  } catch (error) {
    // The lookup only picks a setting, so let the model call decide.
    console.warn('Eval model lookup failed', { model, error: String(error) });
    return { disableThinking: false };
  }
}

/** The pair's full config, or the stage that can't run and why. */
async function resolvePair(
  client: OpenRouter,
  pair: EvalPair
): Promise<V2Config | { outcome: V2Outcome; error: string }> {
  const detector =
    pair.detectorApi === 'chat'
      ? await chatModelSettings(client, pair.detectorModel)
      : { disableThinking: false };
  if ('error' in detector) {
    return { outcome: 'detection-failed', error: detector.error };
  }

  const translator = await chatModelSettings(client, pair.translatorModel);
  if ('error' in translator) {
    return { outcome: 'translate-failed', error: translator.error };
  }

  return {
    ...pair,
    detectorDisableThinking: detector.disableThinking,
    translatorDisableThinking: translator.disableThinking,
  };
}

export async function runEval(
  request: Request,
  env: HarnessEnv
): Promise<Response> {
  const body = evalBody.safeParse(await request.json());
  if (!body.success) return Response.json(body.error, { status: 400 });

  const config = await resolvePair(
    openRouterClient(env),
    body.data.config ?? v2ConfigFromEnv(env)
  );
  if ('outcome' in config) return Response.json({ ...config, cleaned: '' });

  const started = Date.now();
  const trace = await traceChatMessageV2(
    env,
    chatEvent('harness', body.data.text, crypto.randomUUID(), body.data.emotes),
    TARGET_LANGUAGE,
    config
  );
  return Response.json({ ...trace, ms: Date.now() - started });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!isLocalRequest(request, url)) {
      return new Response('Forbidden', { status: 403 });
    }

    switch (`${request.method} ${url.pathname}`) {
      case 'GET /': {
        return new Response(harnessPage(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      case 'GET /evals': {
        return new Response(evalsPage(EVAL_FIXTURES, v2ConfigFromEnv(env)), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      case 'POST /evals/run': {
        return runEval(request, env);
      }
      case 'POST /send': {
        return send(request, env);
      }
      default: {
        return new Response('Not Found', { status: 404 });
      }
    }
  },
} satisfies ExportedHandler<HarnessEnv>;
