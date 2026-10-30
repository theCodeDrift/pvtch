import { readSecret } from '@pvtch/shared/secrets';
import type { TwitchEventMessage } from '@pvtch/shared/twitch-queue';
import { senderForUserId } from '@pvtch/shared/twitch-registry';
import { z } from 'zod';

import { channelStub, disableSenderHandlers } from '../channel';
import {
  EVENTSUB_HEADERS,
  notificationBody,
  revocationBody,
  verificationBody,
  type EventSubSubscription,
} from './schemas';
import { isFresh, verifySignature } from './verify';

/** Revocation statuses meaning the broadcaster no longer allows the sender. */
const AUTHORIZATION_LOST = new Set(['authorization_revoked', 'user_removed']);

const forbidden = () => new Response(undefined, { status: 403 });
const noContent = () => new Response(undefined, { status: 204 });

/**
 * POST /eventsub. Verifies the signature and age before anything else, then:
 * answers the callback challenge and handles revocations inline (both are
 * cheap and the challenge must be in the response), and queues notifications
 * so Twitch gets its 2xx without waiting on routing or handlers.
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

/**
 * The channel and sender a per-sender subscription belongs to, or undefined
 * for app-level subscriptions and accounts that aren't registered senders.
 */
function subscriptionOwner(subscription: EventSubSubscription) {
  const broadcasterId = subscription.condition.broadcaster_user_id;
  const userId = subscription.condition.user_id;
  if (!broadcasterId || !userId) return;
  const senderId = senderForUserId(userId);
  if (!senderId) {
    console.warn('EventSub subscription for an unregistered sender', {
      type: subscription.type,
      userId,
    });
    return;
  }
  return { broadcasterId, senderId };
}

/** Twitch's condition with absent values dropped, as the queue carries it. */
function conditionOf(subscription: EventSubSubscription) {
  return Object.fromEntries(
    Object.entries(subscription.condition).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
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
      const owner = subscriptionOwner(subscription);
      if (owner) {
        await channelStub(env, owner.broadcasterId).setSubscription(
          owner.senderId,
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
      console.warn('EventSub subscription revoked', {
        type: subscription.type,
        status: subscription.status,
        condition: subscription.condition,
      });
      const owner = subscriptionOwner(subscription);
      if (owner) {
        await channelStub(env, owner.broadcasterId).clearSubscription(
          owner.senderId,
          subscription.type
        );
        if (AUTHORIZATION_LOST.has(subscription.status)) {
          await disableSenderHandlers(env, owner.broadcasterId, owner.senderId);
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
        condition: conditionOf(subscription),
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
