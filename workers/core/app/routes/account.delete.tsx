import { useForm } from '@tanstack/react-form';
import { data, redirect, useFetcher, useLoaderData } from 'react-router';
import { Loader, Trash2, TriangleAlert } from 'lucide-react';
import { z } from 'zod';
import type { Route } from './+types/account.delete';
import { cloudflareEnvironmentContext, userContext } from '@/context';
import { TwitchNextSteps } from '@/components/twitch-next-steps';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { normalizeKey } from '@/lib/normalize-key';
import { isAppOrigin } from '@/lib/origin';
import {
  SESSION_COOKIE,
  clearedSessionCookies,
  readCookie,
} from '@/lib/session-cookie';
import { SESSION_PREFIX } from '@pvtch/shared/session';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Delete account - PVTCH' }];
}

/** The typed login must match the account's, ignoring case. */
function confirmSchema(login: string) {
  return z.object({
    login: z
      .string()
      .trim()
      .refine((value) => value.toLowerCase() === login.toLowerCase(), {
        message: `Type ${login} to confirm`,
      }),
  });
}

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  if (!user) return redirect('/auth/start');
  return data({ login: user.login });
}

/**
 * POST /account/delete: start deleting the signed-in user's account, sign
 * this browser out and land on /account/deleted. The User DO finishes the
 * deletion in the background. Nothing about the deletion is logged.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  if (!isAppOrigin(request, env)) {
    return data({ error: 'Forbidden', login: '' }, { status: 403 });
  }
  const user = context.get(userContext);
  if (!user) {
    return data({ error: 'Sign in first', login: '' }, { status: 401 });
  }

  const formData = await request.formData();
  const typed = formData.get('login');
  const login = typeof typed === 'string' ? typed : '';
  const parsed = confirmSchema(user.login).safeParse({ login });
  if (!parsed.success) {
    return data(
      { error: parsed.error.issues[0]?.message ?? 'Try again', login },
      { status: 400 }
    );
  }

  try {
    // Legacy Lingo config lives under the overlay token in PvtchBackend,
    // which the User DO can't reach. Older tokens' entries expire on their
    // own within a day, since nothing reads them.
    await env.PVTCH_BACKEND.get(
      env.PVTCH_BACKEND.idFromName(normalizeKey(user.token, 'lingo-config'))
    ).clear();
    await env.PVTCH_USER.get(
      env.PVTCH_USER.idFromName(`twitch:${user.id}`)
    ).deleteAccount(user.id);
  } catch (error) {
    console.error(
      'starting account deletion failed:',
      error instanceof Error ? error.message : String(error)
    );
    return data(
      { error: 'Could not delete your account. Try again.', login },
      { status: 500 }
    );
  }

  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (sessionToken) {
    await env.PVTCH_ACCOUNTS.delete(`${SESSION_PREFIX}${sessionToken}`);
  }
  const headers = new Headers();
  for (const cookie of clearedSessionCookies(env)) {
    headers.append('Set-Cookie', cookie);
  }
  return redirect('/account/deleted', { headers });
}

export default function DeleteAccount() {
  const { login } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== 'idle';
  const schema = confirmSchema(login);

  const form = useForm({
    defaultValues: { login: '' },
    validators: {
      onSubmit: ({ value }) => {
        const result = schema.safeParse(value);
        if (!result.success) {
          const fields: Record<string, string> = {};
          for (const issue of result.error.issues) {
            fields[issue.path[0] as string] = issue.message;
          }
          return { fields };
        }
        return;
      },
    },
    onSubmit: ({ value }) => {
      void fetcher.submit(value, { method: 'POST' });
    },
  });

  const serverError =
    fetcher.data && 'error' in fetcher.data ? fetcher.data.error : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Delete your account
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          This permanently deletes your PVTCH account and everything stored for
          it: overlays, progress bars, boards, Lingo and Lingual settings. It
          can&apos;t be undone.
        </p>
      </div>

      <div
        role="alert"
        className="flex gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
      >
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>
          Your overlays and bot commands stop working immediately, even in the
          middle of a live stream.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Afterwards, on Twitch
        </h2>
        <TwitchNextSteps />
      </div>

      <form
        className="max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="login"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                Type <span className="font-mono">{login}</span> to confirm
              </FieldLabel>
              <Input
                id={field.name}
                autoComplete="off"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-red-500">
                  {field.state.meta.errors.join(', ')}
                </p>
              )}
            </Field>
          )}
        />
        {serverError && <p className="text-sm text-red-500">{serverError}</p>}
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? (
            <Loader className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete my account
        </Button>
      </form>
    </div>
  );
}
