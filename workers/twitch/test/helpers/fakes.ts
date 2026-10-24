/* eslint-disable unicorn/no-null -- mirrors RPC and Twitch payloads, which use null */
import { createHmac } from 'node:crypto';
import { vi } from 'vitest';

import type { ChatMessageEvent } from '../../src/eventsub/schemas';
import worker from '../../src/index';

/** In-memory stand-in for the TwitchChannel DO's RPC surface. */
export class FakeChannel {
  enabled = false;
  tier: 'standard' | 'moderator' = 'standard';
  slot: { ok: true } | { ok: false; retryAfterMs: number } = { ok: true };
  claimed = new Set<string>();
  subscriptions = new Map<
    string,
    { type: string; subscriptionId: string; status: string; updatedAt: number }
  >();

  getBot() {
    return { enabled: this.enabled, enabledAt: null, updatedAt: null };
  }
  enableBot() {
    this.enabled = true;
    return this.getBot();
  }
  disableBot() {
    this.enabled = false;
    return this.getBot();
  }
  getSubscription(type: string) {
    return this.subscriptions.get(type) ?? null;
  }
  setSubscription(type: string, subscriptionId: string, status: string) {
    this.subscriptions.set(type, {
      type,
      subscriptionId,
      status,
      updatedAt: Date.now(),
    });
  }
  clearSubscription(type: string) {
    this.subscriptions.delete(type);
  }
  claimMessage(id: string) {
    if (this.claimed.has(id)) return false;
    this.claimed.add(id);
    return true;
  }
  acquireSendSlot() {
    return this.slot;
  }
  setSendTier(tier: 'standard' | 'moderator') {
    this.tier = tier;
  }
}

export class FakeKV {
  store = new Map<string, string>();
  get(key: string, type?: 'json') {
    const value = this.store.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve(type === 'json' ? JSON.parse(value) : value);
  }
  put(key: string, value: string) {
    this.store.set(key, value);
    return Promise.resolve();
  }
}

export const BOT_ID = 'bot-1';
export const BROADCASTER_ID = 'b-123';
export const EVENTSUB_SECRET = 'test-eventsub-secret';

export interface TestEnv {
  env: Env;
  channels: Map<string, FakeChannel>;
  channel: (id: string) => FakeChannel;
  lingoConfigs: Map<string, { bots: string[]; language: string }>;
  send: ReturnType<typeof vi.fn>;
  ai: ReturnType<typeof vi.fn>;
  kv: FakeKV;
  accounts: FakeKV;
}

export function createTestEnv(): TestEnv {
  const channels = new Map<string, FakeChannel>();
  const channel = (id: string) => {
    const key = `twitch:${id}`;
    let found = channels.get(key);
    if (!found) {
      found = new FakeChannel();
      channels.set(key, found);
    }
    return found;
  };
  const lingoConfigs = new Map<string, { bots: string[]; language: string }>();
  const send = vi.fn(() => Promise.resolve());
  const ai = vi.fn();
  const kv = new FakeKV();
  const accounts = new FakeKV();

  const env = {
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_SECRET: 'client-secret',
    TWITCH_EVENTSUB_SECRET: EVENTSUB_SECRET,
    TWITCH_BOT_USER_ID: BOT_ID,
    TWITCH_APP_URL: 'https://twitch.example.com',
    PVTCH_APP_URL: 'https://www.example.com',
    ADMIN_USERS: 'admin_user',
    PVTCH_KV: kv,
    PVTCH_ACCOUNTS: accounts,
    TWITCH_EVENTS: { send },
    AI: { run: ai },
    TWITCH_CHANNEL: {
      idFromName: (name: string) => name,
      get: (name: string) => channel(name.slice('twitch:'.length)),
    },
    PVTCH_USER: {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        lingo: () =>
          Promise.resolve({
            getConfig: () =>
              lingoConfigs.get(name.slice('twitch:'.length)) ?? undefined,
            [Symbol.dispose]: () => {},
          }),
      }),
    },
  } as unknown as Env;

  return { env, channels, channel, lingoConfigs, send, ai, kv, accounts };
}

/** Route-matching fetch mock. Unmatched requests fail the test loudly. */
export type FetchRoute = (
  url: URL,
  init: RequestInit | undefined
) => Response | undefined;

export function mockFetch(...routes: FetchRoute[]) {
  const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return Promise.resolve(response);
    }
    throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Answers the client-credentials token request. */
export const appTokenRoute: FetchRoute = (url) =>
  url.href === 'https://id.twitch.tv/oauth2/token'
    ? Response.json({ access_token: 'app-token', expires_in: 3600 })
    : undefined;

export function sign(
  messageId: string,
  timestamp: string,
  body: string,
  secret = EVENTSUB_SECRET
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(messageId + timestamp + body)
    .digest('hex')}`;
}

export function chatEvent(
  overrides: Partial<ChatMessageEvent> = {}
): ChatMessageEvent {
  return {
    broadcaster_user_id: BROADCASTER_ID,
    broadcaster_user_login: 'streamer',
    chatter_user_id: 'viewer-9',
    chatter_user_login: 'viewer',
    message_id: 'msg-1',
    message: {
      text: 'hola amigos, ¿cómo están todos esta noche?',
      fragments: [
        { type: 'text', text: 'hola amigos, ¿cómo están todos esta noche?' },
      ],
    },
    badges: [],
    source_broadcaster_user_id: null,
    ...overrides,
  };
}

/** Workers AI response carrying the translator's JSON. */
export function aiResponse(data: {
  detected: string;
  detectedCode: string;
  translation: string;
}) {
  return { choices: [{ message: { content: JSON.stringify(data) } }] };
}

/** Call the worker's fetch handler with a plain test Request (no `cf`). */
export function fetchWorker(request: Request, env: Env): Promise<Response> {
  return worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    env
  );
}
