/**
 * Twitch handlers and senders.
 *
 * A *sender* is a Twitch bot account pvtch posts as. A *handler* is a
 * feature that reacts to EventSub events for a channel; it runs in its own
 * worker, consumes its own queue, and replies through its sender. EventSub
 * subscriptions and chat rate limits are per (channel, sender); enablement
 * is per (channel, handler).
 *
 * User ids and logins are public, so they live here rather than in vars:
 * storage, twitch, lingual and core all read the same registry.
 */

export interface TwitchSender {
  /** The bot account's Twitch user id */
  userId: string;
  login: string;
}

export interface TwitchHandler {
  sender: string;
  /** EventSub types this handler receives */
  eventTypes: readonly string[];
  /** Producer binding name on pvtch-twitch for this handler's queue */
  queue: string;
}

export const TWITCH_SENDERS = {
  botlingual: { userId: '1591556954', login: 'botlingual' },
} as const satisfies Record<string, TwitchSender>;

export type SenderId = keyof typeof TWITCH_SENDERS;

export const TWITCH_HANDLERS = {
  lingual: {
    sender: 'botlingual',
    eventTypes: ['channel.chat.message'],
    queue: 'LINGUAL_EVENTS',
  },
} as const satisfies Record<string, TwitchHandler & { sender: SenderId }>;

export type HandlerId = keyof typeof TWITCH_HANDLERS;

/** Event types handled by pvtch-twitch itself for the whole channel. */
export const CHANNEL_EVENT_TYPES: readonly string[] = [
  'user.authorization.revoke',
];

export const HANDLER_IDS = Object.keys(TWITCH_HANDLERS) as HandlerId[];
export const SENDER_IDS = Object.keys(TWITCH_SENDERS) as SenderId[];

export function isHandlerId(value: string): value is HandlerId {
  return Object.hasOwn(TWITCH_HANDLERS, value);
}

export function isSenderId(value: string): value is SenderId {
  return Object.hasOwn(TWITCH_SENDERS, value);
}

export function senderForUserId(userId: string): SenderId | undefined {
  return SENDER_IDS.find((id) => TWITCH_SENDERS[id].userId === userId);
}

/** Handlers that receive `type`, in registry order. */
export function handlersFor(type: string): HandlerId[] {
  return HANDLER_IDS.filter((id) =>
    (TWITCH_HANDLERS[id].eventTypes as readonly string[]).includes(type)
  );
}

/** Handlers that post as `senderId`. */
export function handlersUsing(senderId: SenderId): HandlerId[] {
  return HANDLER_IDS.filter((id) => TWITCH_HANDLERS[id].sender === senderId);
}

/** True when pvtch tracks `type` at all: some handler or the channel. */
export function isTrackedEventType(type: string): boolean {
  return CHANNEL_EVENT_TYPES.includes(type) || handlersFor(type).length > 0;
}
