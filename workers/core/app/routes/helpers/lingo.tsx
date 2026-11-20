import { useMemo, useEffect } from 'react';
import { useFetcher, useLoaderData, data, redirect } from 'react-router';
import { useForm } from '@tanstack/react-form';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { Route } from './+types/lingo';
import {
  cloudflareEnvironmentContext,
  instanceAccessContext,
  userContext,
} from '@/context';
import { importLegacyLingoConfig } from '@/lib/lingo-legacy';
import type { LingoPluginConfig } from '../../../do/plugins/lingo';
import { isKnownLanguage, normalizeLanguage } from '@pvtch/shared/languages';
import {
  findSupportedTargetLanguage,
  isSupportedTargetLanguage,
} from '@pvtch/shared/supported-languages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { AuthGate } from '@/components/auth-gate';
import { LanguageCombobox } from '@/components/language-combobox';

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

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Lingo - Chat Translator for Twitch Streams - PVTCH' },
    {
      name: 'description',
      content:
        'Lingo, the PVTCH chat translator, was retired early. A translation bot that existing Lingo users are upgraded to automatically is in the works.',
    },
    {
      property: 'og:title',
      content: 'Lingo - Chat Translator for Twitch Streams',
    },
    {
      property: 'og:description',
      content: 'Lingo was retired early. A translation bot is in the works.',
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
  config ??= await importLegacyLingoConfig(env, user.id, user.token);

  return data({
    authenticated: true as const,
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Lingo Translator</h1>
      <div
        role="status"
        className="flex gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 mb-6 text-sm"
      >
        <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-semibold">Lingo has been retired early.</p>
          <p>
            The AI model Lingo used was shut down, so your translate URL no
            longer translates chat. You can remove it from your chatbot.
          </p>
          <p>
            We&apos;re building a translation bot to replace it, and Lingo users
            will be upgraded to it automatically. There&apos;s nothing you need
            to do.
          </p>
        </div>
      </div>
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
    </div>
  );
}
