import type { RouterContextProvider } from 'react-router';
import {
  cloudflareEnvironmentContext,
  userContext,
  instanceAccessContext,
} from '@/context';
import { sessionUser } from '@/lib/twitch-data';

function parseAllowedUsers(envValue: string): string[] {
  if (!envValue || envValue.length === 0) return [];
  return envValue
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter((u) => u.length > 0);
}

export async function authMiddleware(
  {
    request,
    context,
  }: { request: Request; context: Readonly<RouterContextProvider> },
  next: () => Promise<Response>
): Promise<Response | void> {
  const env = context.get(cloudflareEnvironmentContext);

  // Resolve user from the session cookie (or the localhost dev user)
  const authenticatedUser = await sessionUser(request, env);
  if (authenticatedUser) {
    context.set(userContext, {
      id: authenticatedUser.id,
      login: authenticatedUser.login,
      displayName: authenticatedUser.display_name,
      token: authenticatedUser.token,
    });
  }

  // Compute instance access
  const allowedUsers = parseAllowedUsers(env.ALLOWED_USERS);
  const isPrivate = allowedUsers.length > 0;
  const isAllowed =
    !isPrivate ||
    (!!authenticatedUser &&
      allowedUsers.includes(authenticatedUser.login.toLowerCase()));

  context.set(instanceAccessContext, { isPrivate, isAllowed });

  return next();
}
