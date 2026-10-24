import { channelStub } from '../channel';
import { getSessionUser, isAdmin } from '../session';
import { helix } from '../twitch/helix';

/**
 * GET /admin/status: read-only diagnostics. Shows the app's EventSub
 * subscriptions as Twitch reports them, next to what the admin's own
 * TwitchChannel has recorded. Pass `?broadcaster=<user id>` for another
 * channel.
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
  const [bot, chatSubscription, lingual] = await Promise.all([
    channel.getBot(),
    channel.getSubscription('channel.chat.message'),
    channel.getLingualSettings(),
  ]);

  return Response.json(
    {
      broadcasterId,
      botUserId: env.TWITCH_BOT_USER_ID,
      channel: { bot, chatSubscription, lingual },
      twitch: {
        status: twitch.status,
        body: await twitch.json(),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
