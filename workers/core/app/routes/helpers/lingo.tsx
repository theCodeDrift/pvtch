import { useMemo, useEffect } from 'react';
import { useFetcher, useLoaderData, data, redirect } from 'react-router';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import type { Route } from './+types/lingo';
import {
  cloudflareEnvironmentContext,
  instanceAccessContext,
  userContext,
} from '@/context';
import { normalizeKey } from '@/lib/normalize-key';
import type { LingoPluginConfig } from '../../../do/plugins/lingo';
import { isKnownLanguage, normalizeLanguage } from '@pvtch/shared/languages';
import {
  findSupportedTargetLanguage,
  isSupportedTargetLanguage,
} from '@pvtch/shared/supported-languages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AuthGate } from '@/components/auth-gate';
import { SecretCopy } from '@/components/secret-copy';
import { LanguageCombobox } from '@/components/language-combobox';

// Firebot setup images
import firebotCreateEvent from './_lingo-assets/firebot/create_event.png';
import firebotHttpRequest from './_lingo-assets/firebot/http_request.png';
import firebotConditional from './_lingo-assets/firebot/conditional.png';
import firebotChat from './_lingo-assets/firebot/chat.png';

// MixItUp setup images
import mixitupChatReceived from './_lingo-assets/mixitup/chat_received.png';
import mixitupSpecialIdentifier from './_lingo-assets/mixitup/special_identifier.png';
import mixitupWebRequest from './_lingo-assets/mixitup/web_request.png';
import mixitupConditionalChat from './_lingo-assets/mixitup/conditional_chat.png';

const defaults = {
  bots: [] as string[],
  language: '',
};

type LingoConfig = typeof defaults;

const trimToLength = (str: string, maxLength: number) => {
  const segmenter = new Intl.Segmenter('en-US', { granularity: 'grapheme' });
  const chunks = [...segmenter.segment(str)];
  if (chunks.length <= maxLength) {
    return str;
  }
  return chunks
    .slice(0, maxLength)
    .map((c) => c.segment)
    .join('');
};

const parseConfig = (configString?: string): LingoConfig => {
  if (!configString || configString.length === 0) {
    return defaults;
  }

  let parsed: Partial<LingoConfig> = {};
  try {
    parsed = JSON.parse(configString) as Partial<LingoConfig>;
  } catch {
    // ignore parse errors
  }

  return {
    bots: [parsed.bots ?? defaults.bots].flat().filter((v) => v !== undefined),
    language: parsed.language || 'english',
  };
};

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Lingo - Chat Translator for Twitch Streams - PVTCH' },
    {
      name: 'description',
      content:
        'Translate Twitch chat messages in real-time with well-establlished language models. Connect global audiences by auto-translating foreign language messages. Works with Firebot, MixItUp, and more.',
    },
    {
      property: 'og:title',
      content: 'Lingo - Chat Translator for Twitch Streams',
    },
    {
      property: 'og:description',
      content:
        'Translate Twitch chat messages in real-time. Connect global audiences by auto-translating foreign language messages.',
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const access = context.get(instanceAccessContext);
  if (access?.isPrivate && !access?.isAllowed) {
    return redirect('/private');
  }

  const user = context.get(userContext);
  if (!user) {
    return data({ authenticated: false as const });
  }

  const env = context.get(cloudflareEnvironmentContext);

  // Fetch config from User DO
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${user.id}`)
  );
  using lingoPlugin = await stub.lingo();
  let config: LingoPluginConfig | undefined = await lingoPlugin.getConfig();

  // Temporary migration: pull from old DO if no config exists yet
  if (!config) {
    const oldKey = normalizeKey(user.token, 'lingo-config');
    const oldStub = env.PVTCH_BACKEND.get(env.PVTCH_BACKEND.idFromName(oldKey));
    const oldConfigString = await oldStub.get();
    if (oldConfigString && oldConfigString.length > 0) {
      const parsed = parseConfig(oldConfigString);
      await lingoPlugin.import(parsed);
      config = parsed;
    }
  }

  return data({
    authenticated: true as const,
    token: user.token,
    hasConfig: config !== undefined,
    config: config ?? defaults,
  });
}

// Action: save config to Durable Object
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);
  if (!user) {
    return data(
      { success: false, error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const env = context.get(cloudflareEnvironmentContext);
  const formData = await request.formData();
  const botsRaw = (formData.get('bots') as string) ?? '';
  const languageRaw = (formData.get('language') as string) ?? 'english';

  // Process bots list
  const bots = botsRaw
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && b.length < 64)
    .slice(0, 15);

  const languageInput = trimToLength(languageRaw, 60);
  const resolved = findSupportedTargetLanguage(languageInput);

  // Grandfather existing users: if their stored value isn't on the curated
  // supported list but IS a recognized ISO 639 language, accept it. The
  // pipeline will fall back to LLM-only mode (no classifier supports the
  // target, so decide() short-circuits to TRANSLATE), preserving the user's
  // prior behavior. Only fail when the value is genuinely unrecognized.
  let language: string;
  if (resolved) {
    language = resolved.name;
  } else if (isKnownLanguage(languageInput)) {
    language = normalizeLanguage(languageInput);
  } else {
    return data(
      {
        error:
          'Unsupported target language. Use a name like "english" or a code like "en"/"eng". See the supported list below the field.',
      },
      { status: 400 }
    );
  }

  // Save to User DO
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${user.id}`)
  );
  using lingoPlugin = await stub.lingo();
  await lingoPlugin.setConfig({ bots, language });

  return data({ success: true });
}

export default function HelpersLingo() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // Parse config from loader
  const config = useMemo(() => {
    if (!loaderData.authenticated) return defaults;
    return loaderData.config;
  }, [loaderData]);

  const form = useForm({
    defaultValues: {
      bots: config.bots.join(', '),
      language: config.language,
    },
    onSubmit: ({ value }) => {
      if (!loaderData.authenticated) return;

      const formData = new FormData();
      formData.append('bots', value.bots);
      formData.append('language', value.language);

      void fetcher.submit(formData, { method: 'POST' });
      toast.success('Lingo configuration saved!');
    },
  });

  // Reset form when config changes (loader refetch)
  useEffect(() => {
    form.reset({
      bots: config.bots.join(', '),
      language: config.language,
    });
  }, [config]);

  // Generate URLs for display (placeholder when not authenticated)
  const origin = globalThis.location?.origin ?? 'https://www.pvtch.com';
  const translateUrl = loaderData.authenticated
    ? `${origin}/lingo/translate/${loaderData.token}?user=SENDINGUSER&message=MESSAGEHERE`
    : `${origin}/lingo/translate/YOUR_TOKEN?user=SENDINGUSER&message=MESSAGEHERE`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Lingo Translator</h1>
      <p className="text-muted-foreground mb-6">
        Real-time translation for your Twitch chat. Connect with viewers who
        speak different languages by auto-translating their messages using
        well-established language models.
      </p>

      {(!loaderData.authenticated || !loaderData.hasConfig) && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md p-4 mb-6">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Setup required:</span> You must log
            in and save your configuration below before Lingo will translate
            messages. The translate URL in the setup guide won't work until
            you've saved at least once.
          </p>
        </div>
      )}

      {/* Config + URL section - requires auth */}
      <AuthGate
        authenticated={loaderData.authenticated}
        reason={
          <>
            <span className="font-semibold text-foreground">
              Requires login
            </span>{' '}
            . We need to know who you are to help prevent abuse of the
            translation service and to save your language preferences.
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="flex flex-col gap-6">
            <form.Field
              name="bots"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="bots">
                    Ignored Bots &amp; Users
                  </FieldLabel>
                  <Input
                    id="bots"
                    autoComplete="off"
                    placeholder="yourbot, anotherbot, yetanotherbot"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldDescription>
                    Any bots or users you want to ignore. Messages from these
                    users will never be translated. Separate names with commas.
                    (max 15)
                  </FieldDescription>
                </Field>
              )}
            />
            <form.Field
              name="language"
              validators={{
                onBlur: ({ value }) => {
                  if (!value.trim()) return 'Language is required';
                  if (
                    !isSupportedTargetLanguage(value) &&
                    !isKnownLanguage(value)
                  )
                    return 'Unsupported target language. Use a name like "english" or a code like "en"/"eng".';
                },
                onSubmit: ({ value }) => {
                  if (!value.trim()) return 'Language is required';
                  if (
                    !isSupportedTargetLanguage(value) &&
                    !isKnownLanguage(value)
                  )
                    return 'Unsupported target language. Use a name like "english" or a code like "en"/"eng".';
                },
              }}
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="language">Your Language</FieldLabel>
                  <LanguageCombobox
                    id="language"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(v) => field.handleChange(v)}
                  />
                  {field.state.meta.errors.length > 0 ? (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  ) : (
                    <FieldDescription>
                      Search by language name or 2/3-letter code. &quot;Best
                      supported&quot; languages have stronger classifier
                      coverage and are more likely to translate only text that
                      isn't already in your language. The rest still work, but
                      accuracy is reduced (limited by the libraries that support
                      them), so a few messages already in your language may get
                      translated anyway or reported as needing a translation.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
            <div className="flex flex-row items-center justify-end">
              <Button
                variant="action"
                type="submit"
                disabled={fetcher.state !== 'idle'}
              >
                {fetcher.state === 'idle' ? 'Save' : 'Saving...'}
              </Button>
            </div>
          </div>
        </form>
      </AuthGate>

      {/* Setup Guide Section - always visible */}
      <SetupGuide translateUrl={translateUrl} />
    </div>
  );
}

function SetupGuide({ translateUrl }: { translateUrl: string }) {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-4">Setup Guide</h2>
      <div>
        <p className="text-muted-foreground mb-4">
          When translating messages from chat, you'll send the entire message
          along with the sender's username. If the language is different from
          your target language, you'll get back a translated version.
        </p>

        <div className="bg-muted p-3 rounded-md mb-6 font-mono text-sm">
          ImTyping This is translated text from Dutch (nl) to English (en)
        </div>

        <Tabs defaultValue="firebot">
          <TabsList className="mb-4">
            <TabsTrigger value="firebot">Firebot</TabsTrigger>
            <TabsTrigger value="streamerbot">Streamer.bot</TabsTrigger>
            <TabsTrigger value="mixitup">MixItUp</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="firebot" className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">Create a new Event</h3>
              <p className="text-muted-foreground mb-3">
                In the Firebot app, go to the <strong>Events</strong> section
                and create a new event associated with{' '}
                <code className="bg-muted px-1 rounded">
                  Chat Message (Twitch)
                </code>
              </p>
              <img
                src={firebotCreateEvent}
                alt="Creating a new Firebot Event"
                className="border rounded-lg shadow-md"
              />
            </div>

            <div>
              <h3 className="font-semibold mb-2">The Three Event Effects</h3>
              <p className="text-muted-foreground mb-2">
                Your Firebot Event will have three effects:
              </p>
              <ol className="list-decimal list-inside text-muted-foreground mb-3 space-y-1">
                <li>HTTP Request (send the message to Lingo)</li>
                <li>
                  Conditional Effects (chat only if there is a translation)
                </li>
                <li>
                  Conditional Effect → Chat (send translation to your channel)
                </li>
              </ol>
            </div>

            <div>
              <h3 className="font-semibold mb-2">1. HTTP Request Effect</h3>
              <p className="text-muted-foreground mb-2">
                In the HTTP Request effect, set it up as follows:
              </p>
              <p className="text-muted-foreground mb-2">
                <strong>URL:</strong> Use this URL with Firebot variables:
              </p>
              <SecretCopy
                className="mb-2"
                value={translateUrl
                  .replace('SENDINGUSER', '$user')
                  .replace('MESSAGEHERE', '$encodeForUrl[$chatMessage]')}
              />
              <p className="text-muted-foreground mb-3">
                <strong>Method:</strong> GET
              </p>
              <img
                src={firebotHttpRequest}
                alt="Firebot HTTP Request Effect Setup"
                className="border rounded-lg shadow-md"
              />
            </div>

            <div>
              <h3 className="font-semibold mb-2">2. Conditional Effects</h3>
              <p className="text-muted-foreground mb-2">
                Add a Conditional Effect to check if the response got data back.
              </p>
              <p className="text-muted-foreground mb-3">
                <strong>Condition (all):</strong>{' '}
                <code className="bg-muted px-1 rounded">
                  $effectOutput[httpResponse]
                </code>{' '}
                is not [Not Set]
              </p>
              <p>
                <strong>
                  (I know this looks weird. We're checking that we didn't get
                  back an empty response)
                </strong>
              </p>
              <img
                src={firebotConditional}
                alt="Firebot Conditional Effect Setup"
                className="border rounded-lg shadow-md"
              />
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                3. Chat Effect (in conditional)
              </h3>
              <p className="text-muted-foreground mb-2">
                In the Chat effect, reply to the original poster:
              </p>
              <ul className="text-muted-foreground mb-3 space-y-1">
                <li>
                  <strong>Chat as:</strong> Bot
                </li>
                <li>
                  <strong>Message:</strong>{' '}
                  <code className="bg-muted px-1 rounded">
                    $effectOutput[httpResponse]
                  </code>
                </li>
                <li>
                  <strong>Send as reply:</strong> Yes
                </li>
              </ul>
              <img
                src={firebotChat}
                alt="Firebot Chat Effect Setup"
                className="border rounded-lg shadow-md"
              />
            </div>
          </TabsContent>

          <TabsContent value="streamerbot">
            <p className="text-muted-foreground">
              Coming soon. If you'd like to write this guide, please reach out
              on{' '}
              <a
                href="https://github.com/thecodedrift/pvtch"
                className="text-primary underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              !
            </p>
          </TabsContent>

          <TabsContent value="mixitup" className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">
                Create a new Chat Message Received Event
              </h3>
              <p className="text-muted-foreground mb-3">
                The Chat Message Received event triggers whenever a message is
                sent in your chat. Find the event under{' '}
                <strong>Events → Chat</strong> (not Twitch).
              </p>
              <img
                src={mixitupChatReceived}
                alt="Creating a Chat Received Event in MixItUp"
                className="border rounded-lg shadow-md"
              />
            </div>

            <div>
              <h3 className="font-semibold mb-2">The Three Event Actions</h3>
              <ol className="list-decimal list-inside text-muted-foreground mb-3 space-y-1">
                <li>Special Identifier Action - prepare the message</li>
                <li>Web Request Action - send the message to PVTCH</li>
                <li>Conditional + Chat Action - send translation to channel</li>
              </ol>
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                1. Special Identifier Action
              </h3>
              <ul className="text-muted-foreground mb-3 space-y-1">
                <li>
                  <strong>Name:</strong>{' '}
                  <code className="bg-muted px-1 rounded">encodedMessage</code>
                </li>
                <li>
                  <strong>Value:</strong>{' '}
                  <code className="bg-muted px-1 rounded">
                    uriescape($message)
                  </code>
                </li>
              </ul>
              <img
                src={mixitupSpecialIdentifier}
                alt="Setting Up the MixItUp Special Identifier"
                className="border rounded-lg shadow-md"
              />
            </div>

            <div>
              <h3 className="font-semibold mb-2">2. Web Request Action</h3>
              <p className="text-muted-foreground mb-2">
                <strong>URL:</strong> Use this URL with MixItUp variables:
              </p>
              <SecretCopy
                className="mb-2"
                value={translateUrl
                  .replace('SENDINGUSER', '$user')
                  .replace('MESSAGEHERE', '$encodedMessage')}
              />
              <p className="text-muted-foreground mb-3">
                <strong>Response Processing Type:</strong> Plain Text
              </p>
              <img
                src={mixitupWebRequest}
                alt="The MixItUp Web Request Action"
                className="border rounded-lg shadow-md"
              />
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                3. Conditional and Chat Actions
              </h3>
              <p className="text-muted-foreground mb-2">
                Add a Conditional Action to check if PVTCH returned data:
              </p>
              <ul className="text-muted-foreground mb-3 space-y-1">
                <li>
                  <strong>First Value:</strong>{' '}
                  <code className="bg-muted px-1 rounded">
                    $webrequestresult
                  </code>
                </li>
                <li>
                  <strong>Compare:</strong>{' '}
                  <code className="bg-muted px-1 rounded">{'<>'}</code>
                </li>
                <li>
                  <strong>Second Value:</strong> (blank)
                </li>
              </ul>
              <p className="text-muted-foreground mb-2">
                <strong>Chat Message:</strong>{' '}
                <code className="bg-muted px-1 rounded">
                  @$user $webrequestresult
                </code>
              </p>
              <img
                src={mixitupConditionalChat}
                alt="MixItUp Conditional Action Setup"
                className="border rounded-lg shadow-md"
              />
            </div>
          </TabsContent>

          <TabsContent value="custom">
            <p className="text-muted-foreground">
              Coming soon. If you'd like to write this guide, please reach out
              on{' '}
              <a
                href="https://github.com/thecodedrift/pvtch"
                className="text-primary underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              !
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
