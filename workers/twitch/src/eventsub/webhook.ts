import { readSecret } from '@pvtch/shared/secrets';
import type { TwitchEventMessage } from '@pvtch/shared/twitch-queue';
import { z } from 'zod';

import { channelStub } from '../channel';
import {
  EVENTSUB_HEADERS,
  notificationBody,
  revocationBody,
  verificationBody,
} from './schemas';
import { isFresh, verifySignature } from './verify';

/** Revocation statuses meaning the broadcaster no longer allows the bot. */
const AUTHORIZATION_LOST = new Set(['authorization_revoked', 'user_removed']);

const forbidden = () => new Response(undefined, { status: 403 });
const noContent = () => new Response(undefined, { status: 204 });

/**
 * POST /eventsub. Verifies the signature and age before anything else, then:
 * answers the callback challenge and handles revocations inline (both are
 * cheap and the challenge must be in the response), and queues notifications
 * so Twitch gets its 2xx without waiting on translation.
 */
export async function handleEventSub(
  request: Request,
  env: Env
): Promise<Response> {
  const messageId = request.headers.get(EVENTSUB_HEADERS.messageId);
  const timestamp = request.headers.get(EVENTSUB_HEADERS.timestamp);
  const signature = request.headers.get(EVENTSUB_HEADERS.signature);
  const messageType = request.headers.get(EVENTSUB_HEADERS.messageType);
  if (!messageId || !timestamp || !signature || !messageType) {
    return forbidden();
  }

  const body = await request.text();
  const valid = await verifySignature(
    await readSecret(env.TWITCH_EVENTSUB_SECRET),
    messageId,
    timestamp,
    body,
    signature
  );
  if (!valid || !isFresh(timestamp)) return forbidden();

  try {
    return await dispatch(env, messageType, messageId, timestamp, body);
  } catch (error) {
    // Signed by Twitch but not the shape we expect: don't make Twitch retry.
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      console.error('Unparseable EventSub message', { messageType, error });
      return new Response(undefined, { status: 400 });
    }
    throw error;
  }
}

async function dispatch(
  env: Env,
  messageType: string,
  messageId: string,
  timestamp: string,
  body: string
): Promise<Response> {
  const json: unknown = JSON.parse(body);

  switch (messageType) {
    case 'webhook_callback_verification': {
      const { challenge, subscription } = verificationBody.parse(json);
      const broadcasterId = subscription.condition.broadcaster_user_id;
      if (broadcasterId) {
        await channelStub(env, broadcasterId).setSubscription(
          subscription.type,
          subscription.id,
          'enabled'
        );
      }
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    case 'revocation': {
      const { subscription } = revocationBody.parse(json);
      const broadcasterId = subscription.condition.broadcaster_user_id;
      console.warn('EventSub subscription revoked', {
        type: subscription.type,
        status: subscription.status,
        broadcasterId,
      });
      if (broadcasterId) {
        const channel = channelStub(env, broadcasterId);
        await channel.clearSubscription(subscription.type);
        if (AUTHORIZATION_LOST.has(subscription.status)) {
          await channel.disableBot();
        }
      }
      return noContent();
    }

    case 'notification': {
      const { subscription, event } = notificationBody.parse(json);
      const message: TwitchEventMessage = {
        kind: 'event',
        messageId,
        subscriptionType: subscription.type,
        timestamp: Date.parse(timestamp),
        event,
      };
      try {
        await env.TWITCH_EVENTS.send(message);
      } catch (error) {
        // A 5xx makes Twitch redeliver; dedupe absorbs any duplicate.
        console.error('Failed to enqueue EventSub notification', error);
        return new Response(undefined, { status: 500 });
      }
      return noContent();
    }

    default: {
      return noContent();
    }
  }
}
