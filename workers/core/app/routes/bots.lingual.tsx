import { useEffect } from 'react';
import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router';
import { toast } from 'sonner';
import { Bot, CheckCircle, Clock, Loader, XCircle } from 'lucide-react';
import type { Route } from './+types/bots.lingual';
import {
  cloudflareEnvironmentContext,
  instanceAccessContext,
  userContext,
} from '@/context';
import { canUseLingual, LINGUAL_SCOPE } from '@/lib/lingual';
import { twitchDataKeyPrefix, type TwitchUserData } from '@/lib/twitch-data';
import { AuthGate } from '@/components/auth-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const CHAT_SUBSCRIPTION = 'channel.chat.message';

const GRANT_ERRORS: Record<string, string> = {
  access_denied:
    'Twitch permission was declined. Lingual needs it to chat in your channel.',
  account_mismatch:
    'You approved with a different Twitch account than the one logged in to PVTCH.',
};

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Lingual - Chat Translation Bot - PVTCH' }];
}

function channelStub(env: Env, userId: string) {
  return env.TWITCH_CHANNEL.get(
    env.TWITCH_CHANNEL.idFromName(`twitch:${userId}`)
  );
}

async function hasLingualScope(env: Env, userId: string): Promise<boolean> {
  const record = await env.PVTCH_ACCOUNTS.get<TwitchUserData>(
    `${twitchDataKeyPrefix}${userId}`,
    'json'
  );
  return record?.scopes?.includes(LINGUAL_SCOPE) ?? false;
}

const GRANT_URL = `/auth/grant?${new URLSearchParams({
  scopes: LINGUAL_SCOPE,
  return_to: '/bots/lingual?enable=1',
}).toString()}`;

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = context.get(instanceAccessContext);
  if (access?.isPrivate && !access?.isAllowed) {
    return redirect('/private');
  }

  const user = context.get(userContext);
  if (!user) return data({ state: 'anonymous' as const });

  const env = context.get(cloudflareEnvironmentContext);
  if (!canUseLingual(env, user.login)) {
    return data({ state: 'unavailable' as const });
  }

  const url = new URL(request.url);
  const channel = channelStub(env, user.id);

  // Back from /auth/grant: enable now that the scope is recorded.
  if (
    url.searchParams.get('enable') === '1' &&
    (await hasLingualScope(env, user.id))
  ) {
    await channel.enableBot();
    return redirect('/bots/lingual?enabled=1');
  }

  const [bot, subscription, lingoConfig] = await Promise.all([
    channel.getBot(),
    channel.getSubscription(CHAT_SUBSCRIPTION),
    (async () => {
      using lingo = await env.PVTCH_USER.get(
        env.PVTCH_USER.idFromName(`twitch:${user.id}`)
      ).lingo();
      return lingo.getConfig();
    })(),
  ]);

  const grantError = url.searchParams.get('grant_error');
  return data({
    state: 'ready' as const,
    enabled: bot.enabled,
    subscriptionStatus: subscription?.status ?? undefined,
    language: lingoConfig?.language,
    botLogin: env.LINGUAL_BOT_LOGIN,
    justEnabled: url.searchParams.get('enabled') === '1',
    grantError: grantError
      ? (GRANT_ERRORS[grantError] ?? `Twitch returned: ${grantError}`)
      : undefined,
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);
  const env = context.get(cloudflareEnvironmentContext);
  if (!user || !canUseLingual(env, user.login)) {
    return data({ error: 'Not available' }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get('intent');
  const channel = channelStub(env, user.id);

  if (intent === 'enable') {
    if (!(await hasLingualScope(env, user.id))) return redirect(GRANT_URL);
    await channel.enableBot();
    return data({ ok: 'enabled' as const });
  }
  if (intent === 'disable') {
    await channel.disableBot();
    return data({ ok: 'disabled' as const });
  }
  return data({ error: 'Unknown action' }, { status: 400 });
}

function StatusBadge({
  enabled,
  status,
}: {
  enabled: boolean;
  status: string | undefined;
}) {
  if (!enabled) {
    return (
      <Badge variant="secondary" className="gap-1">
        <XCircle className="size-3" /> Off
      </Badge>
    );
  }
  if (status === 'enabled') {
    return (
      <Badge className="gap-1">
        <CheckCircle className="size-3" /> Live
      </Badge>
    );
  }
  if (!status || status === 'webhook_callback_verification_pending') {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="size-3" /> Connecting
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="size-3" /> {status.replaceAll('_', ' ')}
    </Badge>
  );
}

export default function BotsLingual() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  const justEnabled =
    loaderData.state === 'ready' ? loaderData.justEnabled : false;
  const grantError =
    loaderData.state === 'ready' ? loaderData.grantError : undefined;

  useEffect(() => {
    if (justEnabled) toast.success('Lingual is joining your chat');
  }, [justEnabled]);
  useEffect(() => {
    if (grantError) toast.error(grantError);
  }, [grantError]);
  useEffect(() => {
    if (!actionData) return;
    if ('ok' in actionData) {
      toast.success(
        actionData.ok === 'enabled'
          ? 'Lingual is joining your chat'
          : 'Lingual has left your chat'
      );
    } else {
      toast.error(actionData.error);
    }
  }, [actionData]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <div className="mb-8">
        <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          <Bot className="size-7" /> Lingual
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          A chat bot that translates messages in your Twitch chat. It replies in
          a thread under each message that isn&apos;t in your language, so you
          don&apos;t need Nightbot, Firebot or any other chatbot.
        </p>
      </div>

      <AuthGate
        authenticated={loaderData.state !== 'anonymous'}
        reason="Log in to add Lingual to your channel."
      >
        {loaderData.state === 'unavailable' && (
          <p className="text-zinc-600 dark:text-zinc-400">
            Lingual is in preview and isn&apos;t available on your account yet.
          </p>
        )}

        {loaderData.state === 'ready' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>Your channel</CardTitle>
                <StatusBadge
                  enabled={loaderData.enabled}
                  status={loaderData.subscriptionStatus}
                />
              </div>
              <CardDescription>
                Lingual chats as{' '}
                <span className="font-medium">@{loaderData.botLogin}</span>.
                Turning it on asks Twitch to let that account chat in your
                channel (the <code>channel:bot</code> permission). PVTCH stores
                no Twitch tokens.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              {loaderData.language ? (
                <p>
                  Translating into{' '}
                  <span className="font-medium capitalize text-zinc-900 dark:text-zinc-50">
                    {loaderData.language}
                  </span>
                  . Change the language and ignored users in{' '}
                  <Link to="/helpers/lingo" className="text-brand underline">
                    Lingo settings
                  </Link>
                  .
                </p>
              ) : (
                <p>
                  Pick a target language in{' '}
                  <Link to="/helpers/lingo" className="text-brand underline">
                    Lingo settings
                  </Link>{' '}
                  first. Lingual stays quiet until one is set.
                </p>
              )}
              <p>
                Making @{loaderData.botLogin} a moderator lets it reply faster
                in busy chats.
              </p>
            </CardContent>
            <CardFooter>
              <Form method="post">
                {loaderData.enabled ? (
                  <Button
                    type="submit"
                    name="intent"
                    value="disable"
                    variant="outline"
                    disabled={busy}
                  >
                    {busy && <Loader className="size-4 animate-spin" />}
                    Turn off Lingual
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    name="intent"
                    value="enable"
                    disabled={busy}
                  >
                    {busy && <Loader className="size-4 animate-spin" />}
                    Turn on Lingual
                  </Button>
                )}
              </Form>
            </CardFooter>
          </Card>
        )}
      </AuthGate>
    </div>
  );
}
