import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import { handleEventSub } from '../src/eventsub/webhook';
import {
  fetchWorker,
  BOT_ID,
  BROADCASTER_ID,
  createTestEnv,
  sign,
  type TestEnv,
} from './helpers/fakes';

const NOW = new Date('2026-10-23T12:00:00.000Z');

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    status: 'enabled',
    type: 'channel.chat.message',
    version: '1',
    condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
    ...overrides,
  };
}

function eventSubRequest(
  messageType: string,
  body: string,
  options: { timestamp?: string; signature?: string; messageId?: string } = {}
) {
  const messageId = options.messageId ?? 'm-1';
  const timestamp = options.timestamp ?? NOW.toISOString();
  return new Request('https://twitch.example.com/eventsub', {
    method: 'POST',
    headers: {
      'Twitch-Eventsub-Message-Id': messageId,
      'Twitch-Eventsub-Message-Timestamp': timestamp,
      'Twitch-Eventsub-Message-Signature':
        options.signature ?? sign(messageId, timestamp, body),
      'Twitch-Eventsub-Message-Type': messageType,
      'Twitch-Eventsub-Subscription-Type': 'channel.chat.message',
    },
    body,
  });
}

describe('POST /eventsub', () => {
  let t: TestEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = createTestEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects a bad signature without enqueueing', async () => {
    const body = JSON.stringify({ subscription: subscription(), event: {} });
    const response = await handleEventSub(
      eventSubRequest('notification', body, { signature: 'sha256=00' }),
      t.env
    );

    expect(response.status).toBe(403);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('rejects a request missing EventSub headers', async () => {
    const response = await handleEventSub(
      new Request('https://twitch.example.com/eventsub', {
        method: 'POST',
        body: '{}',
      }),
      t.env
    );

    expect(response.status).toBe(403);
  });

  it('verifies the raw body, not a re-serialization of it', async () => {
    const body = `{ "subscription" : ${JSON.stringify(subscription())},\n  "event": {"z": 1, "a": 2} }`;
    const response = await handleEventSub(
      eventSubRequest('notification', body),
      t.env
    );

    expect(response.status).toBe(204);
    expect(t.send).toHaveBeenCalledOnce();
  });

  it('rejects a correctly signed message older than 10 minutes', async () => {
    const body = JSON.stringify({ subscription: subscription(), event: {} });
    const response = await handleEventSub(
      eventSubRequest('notification', body, {
        timestamp: new Date(NOW.getTime() - 11 * 60 * 1000).toISOString(),
      }),
      t.env
    );

    expect(response.status).toBe(403);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('answers the challenge as text/plain and marks the subscription enabled', async () => {
    const body = JSON.stringify({
      challenge: 'abc123',
      subscription: subscription({
        status: 'webhook_callback_verification_pending',
      }),
    });
    const response = await handleEventSub(
      eventSubRequest('webhook_callback_verification', body),
      t.env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(await response.text()).toBe('abc123');
    expect(
      t
        .channel(BROADCASTER_ID)
        .getSubscription('botlingual', 'channel.chat.message')
    ).toMatchObject({ subscriptionId: 'sub-1', status: 'enabled' });
  });

  it('records nothing for a subscription of an unregistered sender', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = JSON.stringify({
      challenge: 'abc123',
      subscription: subscription({
        condition: { broadcaster_user_id: BROADCASTER_ID, user_id: '999' },
      }),
    });

    const response = await handleEventSub(
      eventSubRequest('webhook_callback_verification', body),
      t.env
    );

    expect(await response.text()).toBe('abc123');
    expect(t.channel(BROADCASTER_ID).subscriptions.size).toBe(0);
  });

  it("disables the sender's handlers when the broadcaster revokes authorization", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = t.channel(BROADCASTER_ID);
    channel.enableHandler('lingual');
    channel.setSubscription(
      'botlingual',
      'channel.chat.message',
      'sub-1',
      'enabled'
    );
    const body = JSON.stringify({
      subscription: subscription({ status: 'authorization_revoked' }),
    });

    const response = await handleEventSub(
      eventSubRequest('revocation', body),
      t.env
    );

    expect(response.status).toBe(204);
    expect(
      channel.getSubscription('botlingual', 'channel.chat.message')
    ).toBeNull();
    expect(channel.listHandlers()).toEqual([]);
  });

  it('keeps handlers enabled when delivery failures revoke the subscription', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channel = t.channel(BROADCASTER_ID);
    channel.enableHandler('lingual');
    channel.setSubscription(
      'botlingual',
      'channel.chat.message',
      'sub-1',
      'enabled'
    );
    const body = JSON.stringify({
      subscription: subscription({ status: 'notification_failures_exceeded' }),
    });

    await handleEventSub(eventSubRequest('revocation', body), t.env);

    expect(
      channel.getSubscription('botlingual', 'channel.chat.message')
    ).toBeNull();
    expect(channel.listHandlers()).toEqual(['lingual']);
  });

  it('enqueues a notification and returns 204', async () => {
    const event = { message_id: 'chat-1' };
    const body = JSON.stringify({ subscription: subscription(), event });

    const response = await handleEventSub(
      eventSubRequest('notification', body, { messageId: 'm-42' }),
      t.env
    );

    expect(response.status).toBe(204);
    expect(t.send).toHaveBeenCalledWith({
      kind: 'event',
      messageId: 'm-42',
      subscriptionType: 'channel.chat.message',
      condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
      timestamp: NOW.getTime(),
      event,
    });
  });

  it('returns 500 when the queue send fails so Twitch retries', async () => {
    t.send.mockRejectedValueOnce(new Error('queue down'));
    const body = JSON.stringify({ subscription: subscription(), event: {} });

    const response = await handleEventSub(
      eventSubRequest('notification', body),
      t.env
    );

    expect(response.status).toBe(500);
  });

  it('returns 400 for a signed body that is not EventSub-shaped', async () => {
    const response = await handleEventSub(
      eventSubRequest('notification', '{"nope":true}'),
      t.env
    );

    expect(response.status).toBe(400);
    expect(t.send).not.toHaveBeenCalled();
  });
});

describe('router', () => {
  it('returns 404 for unknown paths', async () => {
    const t = createTestEnv();
    const response = await fetchWorker(
      new Request('https://twitch.example.com/anything-else'),
      t.env
    );

    expect(response.status).toBe(404);
  });
});
