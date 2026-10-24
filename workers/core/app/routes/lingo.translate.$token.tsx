import type { Route } from './+types/lingo.translate.$token';
import { v4 } from 'uuid';
import { cloudflareEnvironmentContext } from '@/context';
import { resolveTokenUser } from '@/lib/twitch-data';
import { normalizeKey } from '@/lib/normalize-key';
import { isSameLanguage, translate } from '@/lib/translator';
import { type LingoConfig } from '@/lib/constants/lingo';
import type { LingoPluginConfig } from '../../do/plugins/lingo';
import { knownBots } from '@pvtch/shared/known-bots';
import { createLogger } from '@/lib/logger';
import { decide } from '@/lib/lang-detect/decision';

const ALWAYS_IGNORED_USERS = new Set(knownBots.map((v) => v.toLowerCase()));

interface TranslateRequestContent {
  message?: string;
  user?: string;
}

async function handleTranslate(
  token: string,
  message: string,
  user: string,
  env: Env
): Promise<Response> {
  const value = message.trim();
  const userTrimmed = user.trim();

  // Create logger early with just the token for redaction.
  // Tags will be enriched after token validation resolves user info.
  const logger = createLogger({
    feature: 'lingo',
    requestId: v4(),
    redactTokens: [token],
  });

  // skip always ignored users
  if (ALWAYS_IGNORED_USERS.has(userTrimmed.toLowerCase())) {
    logger.debug('User is in always ignored bots list', { user: userTrimmed });
    return new Response('', { status: 200 });
  }

  if (value.startsWith('!')) {
    logger.debug('Command detected, skipping translation', {
      user: userTrimmed,
      input: value,
    });
    return new Response('', { status: 200 });
  }

  if (value.length === 0 || userTrimmed.length === 0) {
    logger.debug('Skipped, no message or user', {
      user: userTrimmed,
      input: value,
    });
    return new Response('', { status: 200 });
  }

  if (value.toLowerCase().includes('imtyping')) {
    logger.debug('Translation Skip: imtyping', {
      user: userTrimmed,
      input: value,
    });
    return new Response('', { status: 200 });
  }

  const resolved = await resolveTokenUser(token, env);

  if (!resolved) {
    logger.warn('Invalid token for lingo translate');
    return new Response('', { status: 200 });
  }

  // Enrich logger with user context now that we have it. Only add the
  // displayName tag when present so structured logs don't carry an empty
  // tag segment.
  let log = logger.withTag(`uid:${resolved.userId}`);
  if (resolved.displayName) {
    log = log.withTag(`@${resolved.displayName}`);
  }

  // fetch config from User DO
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${resolved.userId}`)
  );
  using lingoPlugin = await stub.lingo();
  let doConfig: LingoPluginConfig | undefined = await lingoPlugin.getConfig();

  // Kick off profile sync if not already scheduled. Fire-and-forget: a
  // transient DO error here shouldn't fail the translate request, but we
  // still need a `.catch` so a rejection doesn't surface as an unhandled
  // promise rejection in the request lifecycle.
  void Promise.resolve(stub.ensureProfileSync()).catch((error: unknown) => {
    log.warn('Failed to schedule profile sync', { error });
  });

  // Temporary migration: pull from old DO if no config exists yet
  if (!doConfig) {
    try {
      const oldKey = normalizeKey(token, 'lingo-config');
      const oldStub = env.PVTCH_BACKEND.get(
        env.PVTCH_BACKEND.idFromName(oldKey)
      );
      const oldConfigString = await oldStub.get();
      if (oldConfigString && oldConfigString.length > 0) {
        const parsed = JSON.parse(oldConfigString) as {
          bots?: string[];
          language?: string;
        };
        const migrated = {
          bots: [parsed.bots ?? []].flat().filter((v) => v !== undefined),
          language: parsed.language ?? 'english',
        };
        await lingoPlugin.import(migrated);
        doConfig = migrated;
        log.info('Migrated config from old DO');
      }
    } catch (error_) {
      log.error('Failed to migrate from old DO', error_);
    }
  }

  if (!doConfig) {
    log.warn('No lingo config found');
    return new Response('', { status: 200 });
  }

  if (!doConfig.bots || !doConfig.language) {
    log.warn('Incomplete lingo config', { doConfig });
    return new Response('', { status: 200 });
  }

  const config: LingoConfig = {
    bots: [...doConfig.bots]
      .filter((v) => v !== undefined)
      .map((v) => v.toLowerCase()),
    language: doConfig.language ?? 'english',
  };

  if (config.bots.includes(userTrimmed.toLowerCase())) {
    // dont reply to ignored bots / users
    log.debug('User is in ignored bots list', { user: userTrimmed });
    return new Response('', { status: 200 });
  }

  log.info('Lingo translate request', {
    user: userTrimmed,
    input: value,
    config,
  });

  const decision = decide(value, config.language);
  const decisionLog = {
    action: decision.action,
    reason: decision.reason,
    input: value,
    target: config.language,
    cleaned: decision.cleaned,
    cleanedLength: decision.cleanedLength,
    scripts: decision.scripts,
    votes: decision.votes,
  };

  if (decision.action !== 'TRANSLATE') {
    log.debug('Pre-LLM detection skip', decisionLog);
    return new Response('', { status: 200 });
  }

  log.info('Pre-LLM detection passed', decisionLog);

  let result;

  try {
    result = await translate(value, {
      targetLanguage: config.language,
      env: env,
    });
  } catch (error_) {
    log.error('Lingo translate failed', error_);
    return new Response('', { status: 200 });
  }

  if (!result || !result.success) {
    log.error('Lingo translate failed. No result');
    return new Response('', { status: 200 });
  }

  log.info('LLM Response', { ...result });

  if (isSameLanguage(config.language, value, result)) {
    log.debug('No translation needed. Language match', {
      user: userTrimmed,
      input: value,
    });
    return new Response('', { status: 200 });
  }

  if (
    result.data.translation
      .replaceAll(/@[a-z0-9_]+?([^a-z0-9_]|$)/gi, '$1')
      .trim() === ''
  ) {
    log.debug('Translation result is empty after removing usernames', {
      user: userTrimmed,
      input: value,
    });
    return new Response('', { status: 200 });
  }

  const output = `ImTyping ${result.data.translation}`;

  return new Response(output, {
    status: 200,
  });
}

// GET request - params from query
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  const { token } = params;

  const url = new URL(request.url);
  const message = url.searchParams.get('message') ?? '';
  const user = url.searchParams.get('user') ?? '';

  return handleTranslate(token, message, user, env);
}

// POST request - params from body
export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  const { token } = params;

  const content = (await request.json().catch(() => ({}))) as
    | TranslateRequestContent
    | undefined;
  const message = String(content?.message ?? '');
  const user = String(content?.user ?? '');

  return handleTranslate(token, message, user, env);
}
