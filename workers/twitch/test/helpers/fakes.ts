/* eslint-disable unicorn/no-null -- mirrors RPC and Twitch payloads, which use null */
import { createHmac } from 'node:crypto';

import { vi } from 'vitest';

import type { ChatMessageEvent } from '@pvtch/shared/twitch-eventsub';
import {
  CHANNEL_EVENT_TYPES,
  HANDLER_IDS,
  TWITCH_HANDLERS,
  TWITCH_SENDERS,
  type HandlerId,
  type SenderId,
} from '@pvtch/shared/twitch-registry';

import worker from '../../src/index';

type Slot =
  | { ok: true }
  | { ok: false; retryAfterMs: number }
  | { ok: false; duplicate: true };

interface Record_ {
  senderId: SenderId;
  type: string;
  subscriptionId: string;
  status: string;
  updatedAt: number;
}

/** In-memory stand-in for the TwitchChannel DO's RPC surface. */
export class FakeChannel {
  handlers = new Set<HandlerId>();
  tiers = new Map<SenderId, 'standard' | 'moderator'>();
  /** What `acquireSendSlot` returns once a claim passes. */
  slot: Slot = { ok: true };
  claimed = new Set<string>();
  flagSet = new Set<string>();
  lingualSettings: { language: string | null; ignoredChatters: string[] } = {
    language: null,
    ignoredChatters: [],
  };
  subscriptions = new Map<string, Record_>();

  getHandler(id: HandlerId) {
    return { enabled: this.handlers.has(id), enabledAt: null, updatedAt: null };
  }
  listHandlers() {
    return HANDLER_IDS.filter((id) => this.handlers.has(id));
  }
  enableHandler(id: HandlerId) {
    this.handlers.add(id);
    return this.getHandler(id);
  }
  disableHandler(id: HandlerId) {
    this.handlers.delete(id);
    return this.getHandler(id);
  }
  getSubscription(senderId: SenderId, type: string) {
    return this.subscriptions.get(`${senderId}/${type}`) ?? null;
  }
  listSubscriptions(senderId: SenderId) {
    return [...this.subscriptions.values()].filter(
      (record) => record.senderId === senderId
    );
  }
  setSubscription(
    senderId: SenderId,
    type: string,
    subscriptionId: string,
    status: string
  ) {
    this.subscriptions.set(`${senderId}/${type}`, {
      senderId,
      type,
      subscriptionId,
      status,
      updatedAt: Date.now(),
    });
  }
  clearSubscription(senderId: SenderId, type: string) {
    this.subscriptions.delete(`${senderId}/${type}`);
  }
  claim(key: string) {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
  routeEvent(input: {
    messageId: string | null;
    subscriptionType: string;
    senderId: SenderId | null;
  }) {
    const fresh = input.messageId === null || this.claim(input.messageId);
    if (!fresh) return { fresh, handlers: [], flags: [] };
    const handlers = CHANNEL_EVENT_TYPES.includes(input.subscriptionType)
      ? this.listHandlers()
      : this.listHandlers().filter(
          (id) =>
            TWITCH_HANDLERS[id].sender === input.senderId &&
            (TWITCH_HANDLERS[id].eventTypes as readonly string[]).includes(
              input.subscriptionType
            )
        );
    return { fresh, handlers, flags: [...this.flagSet] };
  }
  acquireSendSlot(_senderId: SenderId, claimKey: string | null): Slot {
    if (claimKey !== null && !this.claim(claimKey)) {
      return { ok: false, duplicate: true };
    }
    return this.slot;
  }
  getSendTier(senderId: SenderId) {
    return this.tiers.get(senderId) ?? 'standard';
  }
  setSendTier(senderId: SenderId, tier: 'standard' | 'moderator') {
    this.tiers.set(senderId, tier);
  }
  lingual() {
    return {
      getSettings: () => this.lingualSettings,
      [Symbol.dispose]: () => {},
    };
  }
  flags() {
    return {
      list: () => [...this.flagSet].sort(),
      set: (name: string, on: boolean) => {
        if (on) this.flagSet.add(name);
        else this.flagSet.delete(name);
        return [...this.flagSet].sort();
      },
      [Symbol.dispose]: () => {},
    };
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

export const BOT_ID = TWITCH_SENDERS.botlingual.userId;
export const BROADCASTER_ID = 'b-123';
export const EVENTSUB_SECRET = 'test-eventsub-secret';

export interface TestEnv {
  env: Env;
  channels: Map<string, FakeChannel>;
  channel: (id: string) => FakeChannel;
  send: ReturnType<typeof vi.fn>;
  lingualSend: ReturnType<typeof vi.fn>;
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
  const send = vi.fn(() => Promise.resolve());
  const lingualSend = vi.fn(() => Promise.resolve());
  const kv = new FakeKV();
  const accounts = new FakeKV();

  const env = {
    TWITCH_CLIENT_ID: 'client-id',
    // Shaped like a Secrets Store binding, as in production.
    TWITCH_SECRET: { get: () => Promise.resolve('client-secret') },
    TWITCH_EVENTSUB_SECRET: { get: () => Promise.resolve(EVENTSUB_SECRET) },
    TWITCH_APP_URL: 'https://twitch.example.com',
    PVTCH_APP_URL: 'https://www.example.com',
    ADMIN_USERS: 'admin_user',
    PVTCH_KV: kv,
    PVTCH_ACCOUNTS: accounts,
    TWITCH_EVENTS: { send },
    LINGUAL_EVENTS: { send: lingualSend },
    TWITCH_CHANNEL: {
      idFromName: (name: string) => name,
      get: (name: string) => channel(name.slice('twitch:'.length)),
    },
  } as unknown as Env;

  return { env, channels, channel, send, lingualSend, kv, accounts };
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

/** Call the worker's fetch handler with a plain test Request (no `cf`). */
export function fetchWorker(request: Request, env: Env): Promise<Response> {
  return worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    env
  );
}
