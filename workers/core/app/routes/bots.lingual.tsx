import { useEffect } from 'react';
import {
  Form,
  data,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from 'react-router';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { isValidTranslateCommand } from '@pvtch/shared/lingual-command';
import { findSupportedTargetLanguage } from '@pvtch/shared/supported-languages';
import { TWITCH_HANDLERS, TWITCH_SENDERS } from '@pvtch/shared/twitch-registry';
import { Bot, CheckCircle, Clock, Loader, XCircle } from 'lucide-react';
import type { Route } from './+types/bots.lingual';
import {
  cloudflareEnvironmentContext,
  instanceAccessContext,
  userContext,
} from '@/context';
import {
  canUseLingual,
  clearLingualEnableCookie,
  hasPendingEnable,
  LINGUAL_SCOPE,
  lingualEnableCookie,
  lingualGrantUrl,
} from '@/lib/lingual';
import { twitchDataKeyPrefix, type TwitchUserData } from '@/lib/account-record';
import { AuthGate } from '@/components/auth-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LanguageCombobox } from '@/components/language-combobox';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const CHAT_SUBSCRIPTION = 'channel.chat.message';
const LINGUAL_SENDER = TWITCH_HANDLERS.lingual.sender;

const COMMAND_ERROR =
  'A command is ! and up to 24 letters, numbers or underscores, like !tr.';

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

function formField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

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

  // Back from /auth/grant: enable now that the scope is recorded, but only
  // for the grant this browser started (see lingualEnableCookie). The
  // cookie is cleared so revisiting the URL does nothing.
  if (hasPendingEnable(request) && (await hasLingualScope(env, user.id))) {
    await channel.enableHandler('lingual');
    return redirect('/bots/lingual?enabled=1', {
      headers: { 'Set-Cookie': clearLingualEnableCookie(env) },
    });
  }

  using lingual = await channel.lingual();
  const [handler, subscription, settings] = await Promise.all([
    channel.getHandler('lingual'),
    channel.getSubscription(LINGUAL_SENDER, CHAT_SUBSCRIPTION),
    lingual.getSettings(),
  ]);

  const grantError = url.searchParams.get('grant_error');
  // A failed grant ends the pending enable; drop its cookie.
  const headers = grantError
    ? { 'Set-Cookie': clearLingualEnableCookie(env) }
    : undefined;
  return data(
    {
      state: 'ready' as const,
      enabled: handler.enabled,
      subscriptionStatus: subscription?.status ?? undefined,
      language: settings.language ?? '',
      command: settings.command,
      commandEnabled: settings.commandEnabled,
      botLogin: TWITCH_SENDERS[LINGUAL_SENDER].login,
      justEnabled: url.searchParams.get('enabled') === '1',
      grantError: grantError
        ? (GRANT_ERRORS[grantError] ?? `Twitch returned: ${grantError}`)
        : undefined,
    },
    { headers }
  );
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
    if (!(await hasLingualScope(env, user.id))) {
      const nonce = crypto.randomUUID();
      return redirect(lingualGrantUrl(nonce), {
        headers: { 'Set-Cookie': lingualEnableCookie(env, nonce) },
      });
    }
    await channel.enableHandler('lingual');
    return data({ ok: 'enabled' as const });
  }
  if (intent === 'disable') {
    await channel.disableHandler('lingual');
    return data({ ok: 'disabled' as const });
  }
  if (intent === 'settings') {
    const resolved = findSupportedTargetLanguage(
      formField(formData, 'language').slice(0, 60)
    );
    if (!resolved) {
      return data(
        { error: 'Pick a supported language from the list.' },
        { status: 400 }
      );
    }
    // The command is only sent, and only checked, while it is turned on; off,
    // the stored command is kept for when it is turned back on.
    const commandEnabled = formField(formData, 'commandEnabled') === 'true';
    const command = formField(formData, 'command').trim().toLowerCase();
    if (commandEnabled && !isValidTranslateCommand(command)) {
      return data({ error: COMMAND_ERROR }, { status: 400 });
    }
    using lingual = await channel.lingual();
    await lingual.setSettings({
      language: resolved.name,
      commandEnabled,
      ...(commandEnabled ? { command } : {}),
    });
    return data({ ok: 'saved' as const });
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

interface SettingsValues {
  language: string;
  command: string;
  commandEnabled: boolean;
}

function LingualSettingsForm({
  settings,
  botLogin,
}: {
  settings: SettingsValues;
  botLogin: string;
}) {
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== 'idle';

  const form = useForm({
    defaultValues: settings,
    onSubmit: ({ value }) => {
      void fetcher.submit(
        {
          intent: 'settings',
          language: value.language,
          commandEnabled: String(value.commandEnabled),
          // Off, the command is hidden; the stored one is kept.
          ...(value.commandEnabled ? { command: value.command } : {}),
        },
        { method: 'POST' }
      );
    },
  });

  const { language, command, commandEnabled } = settings;
  useEffect(() => {
    form.reset({ language, command, commandEnabled });
  }, [language, command, commandEnabled]);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if ('ok' in fetcher.data) toast.success('Lingual settings saved');
    else toast.error(fetcher.data.error);
  }, [fetcher.state, fetcher.data]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <form.Field
        name="language"
        validators={{
          onSubmit: ({ value }) =>
            findSupportedTargetLanguage(value)
              ? undefined
              : 'Pick a supported language from the list.',
        }}
        children={(field) => (
          <Field>
            <FieldLabel htmlFor="lingual-language">
              Translate messages to
            </FieldLabel>
            <LanguageCombobox
              id="lingual-language"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(value) => field.handleChange(value)}
            />
            {field.state.meta.errors.length > 0 ? (
              <p className="text-sm text-destructive">
                {field.state.meta.errors[0]}
              </p>
            ) : (
              <FieldDescription>
                {botLogin} will translate messages to your requested language
                when it thinks it will help.
              </FieldDescription>
            )}
          </Field>
        )}
      />
      <form.Field
        name="commandEnabled"
        children={(field) => (
          <div className="flex items-center justify-between gap-4">
            <div>
              <FieldLabel htmlFor="lingual-command-enabled">
                Translate command
              </FieldLabel>
              <FieldDescription>
                Anyone in chat can ask for a translation, like{' '}
                <code className="bg-muted px-1 rounded">
                  {form.state.values.command || '!tr'} spanish good morning
                </code>
                . Lingual ignores every other message that starts with !.
              </FieldDescription>
            </div>
            <Switch
              id="lingual-command-enabled"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          </div>
        )}
      />
      <form.Subscribe
        selector={(state) => state.values.commandEnabled}
        children={(commandEnabled) =>
          commandEnabled && (
            <form.Field
              name="command"
              validators={{
                // A hidden command is neither sent nor checked.
                onSubmit: ({ value, fieldApi }) =>
                  !fieldApi.form.getFieldValue('commandEnabled') ||
                  isValidTranslateCommand(value)
                    ? undefined
                    : COMMAND_ERROR,
              }}
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="lingual-command">Command</FieldLabel>
                  <Input
                    id="lingual-command"
                    autoComplete="off"
                    placeholder="!tr"
                    maxLength={25}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </Field>
              )}
            />
          )
        }
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving && <Loader className="size-4 animate-spin" />}
          Save settings
        </Button>
      </div>
    </form>
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
          can include everyone.
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
              {!loaderData.language && (
                <p>
                  Pick your language below. Until one is set, Lingual only
                  answers the translate command.
                </p>
              )}
              <p>
                Run{' '}
                <code className="bg-muted px-1 rounded">
                  /mod {loaderData.botLogin}
                </code>{' '}
                so it can reply faster in busy chats
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

        {loaderData.state === 'ready' && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>
                Lingual&apos;s own settings. They are separate from the Lingo
                helper&apos;s.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LingualSettingsForm
                settings={{
                  language: loaderData.language,
                  command: loaderData.command,
                  commandEnabled: loaderData.commandEnabled,
                }}
                botLogin={loaderData.botLogin}
              />
            </CardContent>
          </Card>
        )}
      </AuthGate>
    </div>
  );
}
