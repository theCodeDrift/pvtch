import { ack, type Outcome } from '@pvtch/shared/queue-outcome';
import type { HandlerId } from '@pvtch/shared/twitch-registry';

import { accountStub } from './account';
import { channelStub } from './channel';
import type { AuthorizationRevokeEvent } from './eventsub/schemas';

/**
 * A user disconnected pvtch on Twitch: every scope they granted is gone.
 * Disable each of their enabled handlers (each schedules its sender's
 * subscription sync) and forget their recorded scopes so the dashboard asks
 * again. Scopes are cleared through core's account writer, which serializes
 * it with logins, grants and token rotation. A failure throws, and the
 * consumer retries the whole message.
 */
export async function handleAuthorizationRevoke(
  env: Env,
  event: AuthorizationRevokeEvent,
  handlers: HandlerId[]
): Promise<Outcome> {
  const channel = channelStub(env, event.user_id);
  for (const handlerId of handlers) {
    await channel.disableHandler(handlerId);
  }

  await accountStub(env, event.user_id).clearAccountScopes(event.user_id);
  return ack;
}
