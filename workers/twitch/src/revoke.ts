import { ack, type Outcome } from '@pvtch/shared/queue-outcome';
import type { HandlerId } from '@pvtch/shared/twitch-registry';

import { channelStub } from './channel';
import type { AuthorizationRevokeEvent } from './eventsub/schemas';

const TWITCH_DATA_PREFIX = 'twitch-data-';

/**
 * A user disconnected pvtch on Twitch: every scope they granted is gone.
 * Disable each of their enabled handlers (each schedules its sender's
 * subscription sync) and forget their recorded scopes so the dashboard asks
 * again.
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

  const key = `${TWITCH_DATA_PREFIX}${event.user_id}`;
  const data = await env.PVTCH_ACCOUNTS.get<Record<string, unknown>>(
    key,
    'json'
  );
  if (data && 'scopes' in data) {
    const { scopes: _removed, ...rest } = data;
    await env.PVTCH_ACCOUNTS.put(key, JSON.stringify(rest));
  }
  return ack;
}
