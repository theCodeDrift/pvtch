/* eslint-disable unicorn/no-null -- a queue body can be null */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { consumeDeadLetters, deadLetterFields } from '../src/dead-letter';

function deadLetter(body: unknown) {
  return {
    id: 'q-1',
    timestamp: new Date('2026-10-23T12:00:00.000Z'),
    attempts: 1,
    body,
    ack: vi.fn(),
  };
}

describe('deadLetterFields', () => {
  it('keeps identifying fields and drops payloads', () => {
    expect(
      deadLetterFields({
        kind: 'send',
        sendId: 's-1',
        broadcasterId: 'b-123',
        senderId: 'pvtchbot',
        handlerId: 'lingual',
        message: 'hola amigos',
        replyParentMessageId: 'm-1',
        timestamp: 1000,
      })
    ).toEqual({
      kind: 'send',
      sendId: 's-1',
      broadcasterId: 'b-123',
      senderId: 'pvtchbot',
      handlerId: 'lingual',
      timestamp: 1000,
    });
  });

  it('drops the event payload', () => {
    expect(
      deadLetterFields({
        kind: 'handler-event',
        messageId: 'm-1',
        subscriptionType: 'channel.chat.message',
        event: { message: { text: 'hola amigos' } },
        flags: ['lingual.reply-threading'],
      })
    ).toEqual({
      kind: 'handler-event',
      messageId: 'm-1',
      subscriptionType: 'channel.chat.message',
    });
  });

  it('returns nothing for a body that is not an object', () => {
    expect(deadLetterFields('hello')).toEqual({});
    expect(deadLetterFields(null)).toEqual({});
  });
});

describe('consumeDeadLetters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs and acks every message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = deadLetter({ kind: 'sync', broadcasterId: 'b-123' });
    const second = deadLetter('not json');

    consumeDeadLetters({
      queue: 'twitch-events-dlq',
      messages: [first, second],
    });

    expect(first.ack).toHaveBeenCalledOnce();
    expect(second.ack).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenNthCalledWith(1, {
      message: 'Dead-lettered queue message',
      queue: 'twitch-events-dlq',
      id: 'q-1',
      enqueuedAt: '2026-10-23T12:00:00.000Z',
      attempts: 1,
      kind: 'sync',
      broadcasterId: 'b-123',
    });
  });
});
