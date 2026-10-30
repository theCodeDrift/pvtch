import { handlersUsing, type SenderId } from '@pvtch/shared/twitch-registry';

/** The broadcaster's TwitchChannel Durable Object in pvtch-storage. */
export function channelStub(env: Env, broadcasterId: string) {
  return env.TWITCH_CHANNEL.get(
    env.TWITCH_CHANNEL.idFromName(`twitch:${broadcasterId}`)
  );
}

/** A sender lost its authorization in a channel: turn off every handler
 * that posts as it. Each disable schedules the sender's subscription sync. */
export async function disableSenderHandlers(
  env: Env,
  broadcasterId: string,
  senderId: SenderId
): Promise<void> {
  const channel = channelStub(env, broadcasterId);
  for (const handlerId of handlersUsing(senderId)) {
    await channel.disableHandler(handlerId);
  }
}
