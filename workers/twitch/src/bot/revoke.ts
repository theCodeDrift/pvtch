import { channelStub } from '../channel';
import type { AuthorizationRevokeEvent } from '../eventsub/schemas';
import { ack, type Outcome } from '../outcome';

const TWITCH_DATA_PREFIX = 'twitch-data-';

/**
 * A user disconnected pvtch on Twitch: every scope they granted is gone.
 * Disable the bot (which queues its unsubscribe) and forget their recorded
 * scopes so the dashboard asks again.
 */
export async function handleAuthorizationRevoke(
  env: Env,
  event: AuthorizationRevokeEvent
): Promise<Outcome> {
  await channelStub(env, event.user_id).disableBot();

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
