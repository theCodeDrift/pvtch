import {
  HANDLER_IDS,
  SENDER_IDS,
  TWITCH_SENDERS,
} from '@pvtch/shared/twitch-registry';

import { channelStub } from '../channel';
import { getSessionUser, isAdmin } from '../session';
import { helix } from '../twitch/helix';

/**
 * GET /admin/status: read-only diagnostics. Shows the app's EventSub
 * subscriptions as Twitch reports them, next to what the admin's own
 * TwitchChannel has recorded: each handler's state, each sender's
 * subscriptions and send tier, Lingual's settings, and the flags. Pass
 * `?broadcaster=<user id>` for another channel.
 */
export async function adminStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user || !isAdmin(env, user)) {
    return new Response(undefined, { status: 403 });
  }

  const broadcasterId =
    new URL(request.url).searchParams.get('broadcaster') ?? user.id;
  const channel = channelStub(env, broadcasterId);

  const twitch = await helix(env, '/eventsub/subscriptions');
  using lingual = await channel.lingual();
  using flags = await channel.flags();
  const [handlers, senders, lingualSettings, flagList] = await Promise.all([
    Promise.all(
      HANDLER_IDS.map(async (id) => [id, await channel.getHandler(id)] as const)
    ),
    Promise.all(
      SENDER_IDS.map(
        async (id) =>
          [
            id,
            {
              userId: TWITCH_SENDERS[id].userId,
              tier: await channel.getSendTier(id),
              subscriptions: await channel.listSubscriptions(id),
            },
          ] as const
      )
    ),
    lingual.getSettings(),
    flags.list(),
  ]);

  return Response.json(
    {
      broadcasterId,
      channel: {
        handlers: Object.fromEntries(handlers),
        senders: Object.fromEntries(senders),
        lingual: lingualSettings,
        flags: flagList,
      },
      twitch: {
        status: twitch.status,
        body: await twitch.json(),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
