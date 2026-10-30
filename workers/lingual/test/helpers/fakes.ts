/* eslint-disable unicorn/no-null -- mirrors RPC and Twitch payloads, which use null */
import type { ChatMessageEvent } from '@pvtch/shared/twitch-eventsub';
import type { HandlerEventMessage } from '@pvtch/shared/twitch-queue';
import { vi } from 'vitest';

/** In-memory stand-in for the parts of TwitchChannel Lingual uses. */
export class FakeChannel {
  claimed = new Set<string>();
  settings: { language: string | null; ignoredChatters: string[] } = {
    language: null,
    ignoredChatters: [],
  };

  claim(key: string) {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
  lingual() {
    return {
      getSettings: () => this.settings,
      [Symbol.dispose]: () => {},
    };
  }
}

export const BROADCASTER_ID = 'b-123';

export interface TestEnv {
  env: Env;
  channel: (id: string) => FakeChannel;
  send: ReturnType<typeof vi.fn>;
  ai: ReturnType<typeof vi.fn>;
}

export function createTestEnv(): TestEnv {
  const channels = new Map<string, FakeChannel>();
  const channel = (id: string) => {
    let found = channels.get(id);
    if (!found) {
      found = new FakeChannel();
      channels.set(id, found);
    }
    return found;
  };
  const send = vi.fn(() => Promise.resolve());
  const ai = vi.fn();

  const env = {
    TWITCH_EVENTS: { send },
    AI: { run: ai },
    TWITCH_CHANNEL: {
      idFromName: (name: string) => name,
      get: (name: string) => channel(name.slice('twitch:'.length)),
    },
  } as unknown as Env;

  return { env, channel, send, ai };
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

/** A routed chat event as pvtch-twitch puts it on `lingual-events`. */
export function handlerEvent(
  event: ChatMessageEvent = chatEvent(),
  overrides: Partial<HandlerEventMessage> = {}
): HandlerEventMessage {
  return {
    kind: 'handler-event',
    handlerId: 'lingual',
    broadcasterId: event.broadcaster_user_id,
    senderId: 'botlingual',
    messageId: 'm-1',
    subscriptionType: 'channel.chat.message',
    timestamp: Date.now(),
    event,
    flags: [],
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
