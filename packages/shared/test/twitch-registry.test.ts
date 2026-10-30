import { describe, it, expect } from 'vitest';
import {
  CHANNEL_EVENT_TYPES,
  HANDLER_IDS,
  SENDER_IDS,
  TWITCH_HANDLERS,
  TWITCH_SENDERS,
  handlersFor,
  handlersUsing,
  isTrackedEventType,
  senderForUserId,
} from '../src/twitch-registry';

describe('twitch registry', () => {
  it('gives every sender a distinct user id', () => {
    const userIds = SENDER_IDS.map((id) => TWITCH_SENDERS[id].userId);
    expect(new Set(userIds).size).toBe(userIds.length);
  });

  it('names a registered sender for every handler', () => {
    for (const id of HANDLER_IDS) {
      expect(SENDER_IDS).toContain(TWITCH_HANDLERS[id].sender);
    }
  });

  it('keeps channel-level types out of handler event types', () => {
    for (const type of CHANNEL_EVENT_TYPES) {
      expect(handlersFor(type)).toEqual([]);
    }
  });

  it('finds a sender by user id', () => {
    expect(senderForUserId('1591556954')).toBe('botlingual');
  });

  it('returns undefined for an unknown user id', () => {
    expect(senderForUserId('999')).toBeUndefined();
  });

  it('finds handlers for an event type', () => {
    expect(handlersFor('channel.chat.message')).toEqual(['lingual']);
    expect(handlersFor('channel.follow')).toEqual([]);
  });

  it('finds handlers for a sender', () => {
    expect(handlersUsing('botlingual')).toEqual(['lingual']);
  });

  it('tracks handler and channel-level types only', () => {
    expect(isTrackedEventType('channel.chat.message')).toBe(true);
    expect(isTrackedEventType('user.authorization.revoke')).toBe(true);
    expect(isTrackedEventType('channel.follow')).toBe(false);
  });
});
