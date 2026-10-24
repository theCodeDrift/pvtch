/** The broadcaster's TwitchChannel Durable Object in pvtch-storage. */
export function channelStub(env: Env, broadcasterId: string) {
  return env.TWITCH_CHANNEL.get(
    env.TWITCH_CHANNEL.idFromName(`twitch:${broadcasterId}`)
  );
}
